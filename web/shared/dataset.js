/**
 * The dispenser dataset: one GeoJSON FeatureCollection in a public GitHub repo.
 *
 * Feature schema (EPSG:4326 point):
 *   id         string   stable UUID, used to address a dispenser when editing
 *   floor      string   RUG Maps floor code ("00", "0T", "-S", ...)
 *   building   string   building number, e.g. "5161"
 *   room       string   room number or location hint, e.g. "0107"
 *   note       string   free text
 *   fill       number   0..100, percentage of stock left, or null if unknown
 *   checkedAt  string   ISO 8601 time of the last fill check, or null
 *
 * Reading (Finder) is anonymous via raw.githubusercontent.com.
 * Writing (Editor) uses the GitHub Contents API with optimistic locking:
 * every commit sends the blob SHA it was based on; if someone else committed
 * in between, GitHub answers 409 and we re-read, re-apply and retry.
 */

const API = 'https://api.github.com';

/** @typedef {{ owner: string, repo: string, branch: string, path: string }} DatasetRef */
/** @typedef {{ type: 'FeatureCollection', features: object[] }} FeatureCollection */

/** Empty, valid collection; used when the file does not exist yet. */
export const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });

/**
 * Bring a feature into the current schema. Tolerates files written by the
 * first version of the app (no id, no fill).
 */
export function normalizeFeature(feature) {
  const p = feature.properties ?? {};
  return {
    type: 'Feature',
    id: feature.id ?? p.id ?? crypto.randomUUID(),
    geometry: feature.geometry,
    properties: {
      floor: p.floor == null ? null : String(p.floor),
      building: p.building ?? '',
      room: p.room ?? '',
      note: p.note ?? '',
      fill: Number.isFinite(p.fill) ? Math.max(0, Math.min(100, p.fill)) : null,
      checkedAt: p.checkedAt ?? null,
    },
  };
}

/** @param {unknown} json @returns {FeatureCollection} */
export function normalizeCollection(json) {
  const features = Array.isArray(json?.features) ? json.features : [];
  return {
    type: 'FeatureCollection',
    features: features.filter((f) => f?.geometry?.type === 'Point').map(normalizeFeature),
  };
}

/** Stable, diff-friendly serialisation: one feature per line block, sorted by id. */
export function serialize(collection) {
  const sorted = [...collection.features].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({ type: 'FeatureCollection', features: sorted }, null, 2) + '\n';
}

/* ---------- UTF-8 safe base64 (GitHub API transports file content as base64) ---------- */

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Chunked to stay below the argument limit of String.fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64Utf8(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/* ---------- Anonymous read (Finder) ---------- */

/**
 * Read the published dataset. raw.githubusercontent.com is cached by a CDN
 * for a few minutes; the timestamp parameter asks for a fresh copy.
 * Falls back to the copy bundled in the app when offline.
 * @param {DatasetRef} ref
 * @param {string} bundledUrl
 * @returns {Promise<{ collection: FeatureCollection, source: 'github'|'bundled' }>}
 */
export async function fetchPublic(ref, bundledUrl) {
  const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.branch}/${ref.path}?t=${Date.now()}`;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { collection: normalizeCollection(await response.json()), source: 'github' };
  } catch (error) {
    console.warn('GitHub dataset unavailable, using bundled copy:', error);
    const response = await fetch(bundledUrl);
    return { collection: normalizeCollection(await response.json()), source: 'bundled' };
  }
}

/* ---------- Authenticated read/write (Editor) ---------- */

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class GitHubDataset {
  /** @param {DatasetRef} ref @param {string} token fine-grained PAT, Contents: read and write */
  constructor(ref, token) {
    this.ref = ref;
    this.token = token;
    /** SHA of the blob the in-memory copy is based on; null if the file does not exist. */
    this.sha = null;
  }

  get #contentsUrl() {
    const { owner, repo, path } = this.ref;
    return `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  async #request(method, url, body) {
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new GitHubError(response.status, json.message ?? response.statusText);
    return json;
  }

  /** Load the current file and remember its SHA. @returns {Promise<FeatureCollection>} */
  async load() {
    try {
      const file = await this.#request('GET', `${this.#contentsUrl}?ref=${encodeURIComponent(this.ref.branch)}`);
      this.sha = file.sha;
      return normalizeCollection(JSON.parse(decodeBase64Utf8(file.content)));
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) {
        this.sha = null;
        return emptyCollection();
      }
      throw error;
    }
  }

  /**
   * Apply a change and commit it. The mutation receives a fresh copy of the
   * collection and returns the new one; on a conflict it is re-applied to the
   * latest version, so concurrent edits by other devices are not overwritten.
   * @param {(c: FeatureCollection) => FeatureCollection} mutate pure function
   * @param {string} message commit message
   * @param {number} [attempts]
   * @returns {Promise<FeatureCollection>} the committed collection
   */
  async commit(mutate, message, attempts = 3) {
    let latest = await this.load();
    for (let attempt = 1; ; attempt++) {
      const next = mutate(structuredClone(latest));
      try {
        const result = await this.#request('PUT', this.#contentsUrl, {
          message,
          content: encodeBase64Utf8(serialize(next)),
          branch: this.ref.branch,
          ...(this.sha ? { sha: this.sha } : {}),
        });
        this.sha = result.content.sha;
        return next;
      } catch (error) {
        const conflict = error instanceof GitHubError && (error.status === 409 || error.status === 422);
        if (!conflict || attempt >= attempts) throw error;
        latest = await this.load();
      }
    }
  }

  /** Cheap credential check for the settings screen. */
  async verify() {
    const { owner, repo } = this.ref;
    const info = await this.#request('GET', `${API}/repos/${owner}/${repo}`);
    if (!info.permissions?.push) throw new GitHubError(403, 'Token has no write access to this repository');
    return info.full_name;
  }
}

/* ---------- Pure mutations, shared by the Editor UI and tests ---------- */

export const mutations = {
  /** @param {object} feature normalized feature */
  add: (feature) => (c) => ({ ...c, features: [...c.features, feature] }),

  /** Merge property changes into one dispenser; no-op if it was deleted meanwhile. */
  update: (id, changes) => (c) => ({
    ...c,
    features: c.features.map((f) => (f.id === id ? { ...f, properties: { ...f.properties, ...changes } } : f)),
  }),

  move: (id, coordinates) => (c) => ({
    ...c,
    features: c.features.map((f) => (f.id === id ? { ...f, geometry: { type: 'Point', coordinates } } : f)),
  }),

  remove: (id) => (c) => ({ ...c, features: c.features.filter((f) => f.id !== id) }),
};
