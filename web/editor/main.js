/**
 * Bandaid Editor: add, move, delete dispensers and record how full they are.
 * Every change is one commit to the dataset file in the GitHub repository.
 *
 * State flow: UI action -> pure mutation (dataset.js) -> GitHubDataset.commit
 * -> committed collection -> map refresh. The map is never edited directly,
 * so what you see is always what is in the repository.
 */
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { CONFIG } from '../shared/config.js';
import { createMapCore } from '../shared/mapCore.js';
import { GitHubDataset, mutations, normalizeFeature } from '../shared/dataset.js';
import { fillStatus } from '../shared/dispenserLayer.js';
import { loadToken, saveToken, forgetToken } from './token.js';

const $ = (id) => document.getElementById(id);
const setStatus = (text) => ($('status').textContent = text);

/** Short human label used in commit messages and the panel title. */
const labelOf = (p) => [p.building, p.room].filter(Boolean).join('.') || 'unnamed';

/** Coordinates rounded to ~1 cm; more digits only add noise to diffs. */
const toStoredLonLat = (coordinate) => toLonLat(coordinate).map((v) => Math.round(v * 1e7) / 1e7);

async function init() {
  const { map, floors, dispensers, roomsLayer } = createMapCore({
    target: 'map',
    floorPanel: $('floors'),
    onTileError: () => setStatus('Floor plans could not be loaded'),
  });

  /** @type {GitHubDataset|null} */
  let dataset = null;
  /** @type {{ type: string, features: object[] }} */
  let collection = { type: 'FeatureCollection', features: [] };

  /**
   * Interaction mode:
   *   idle   tap selects a dispenser
   *   add    next tap on the map places a new one
   *   move   next tap moves the selected one
   */
  let mode = 'idle';
  /** Feature being edited; for a new dispenser it is not in `collection` yet. */
  let editing = null;
  let isNew = false;

  const featureById = (id) => collection.features.find((f) => f.id === id);

  const showCollection = (next) => {
    collection = next;
    dispensers.setCollection(collection);
  };

  /** Run one commit with status feedback; returns false on failure. */
  const commit = async (mutation, message) => {
    if (!dataset) {
      openSettings('Add a GitHub token first.');
      return false;
    }
    setStatus('Saving...');
    try {
      showCollection(await dataset.commit(mutation, message));
      setStatus(`Saved · ${collection.features.length} dispensers`);
      return true;
    } catch (error) {
      console.error(error);
      setStatus(`Save failed: ${error.message}`);
      return false;
    }
  };

  /* ---------- Detail panel ---------- */

  const detail = $('detail');
  const fillButtons = CONFIG.fillSteps.map((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = value === 0 ? 'Empty' : value === 100 ? 'Full' : `${value}%`;
    button.dataset.value = String(value);
    button.addEventListener('click', () => setFill(value));
    return button;
  });
  $('fill-buttons').replaceChildren(...fillButtons);

  /** Fill buttons and timestamp only; must not touch the text inputs the user may be typing in. */
  const renderFill = () => {
    const p = editing.properties;
    fillButtons.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.value) === p.fill)));
    $('checked-at').textContent = p.checkedAt ? `checked ${new Date(p.checkedAt).toLocaleString()}` : 'never checked';
  };

  /** Full panel render, only when a dispenser is opened. */
  const renderDetail = () => {
    const p = editing.properties;
    $('detail-title').textContent = isNew ? 'New dispenser' : `Dispenser ${labelOf(p)}`;
    $('detail-floor').textContent = p.floor;
    detail.elements.building.value = p.building;
    detail.elements.room.value = p.room;
    detail.elements.note.value = p.note;
    renderFill();
    $('move').hidden = isNew;
    $('delete').hidden = isNew;
    resetDeleteButton();
  };

  const openDetail = (feature, asNew) => {
    editing = structuredClone(feature);
    isNew = asNew;
    dispensers.select(asNew ? null : feature.id);
    renderDetail();
    detail.hidden = false;
  };

  const closeDetail = () => {
    editing = null;
    isNew = false;
    setMode('idle');
    dispensers.select(null);
    detail.hidden = true;
  };

  /** Fill level of an existing dispenser is committed at once: it is the most frequent edit. */
  const setFill = async (value) => {
    editing.properties.fill = value;
    editing.properties.checkedAt = new Date().toISOString();
    renderFill();
    if (isNew) return; // saved together with the rest on "Save"
    await commit(
      mutations.update(editing.id, { fill: value, checkedAt: editing.properties.checkedAt }),
      `Fill ${labelOf(editing.properties)}: ${fillStatus(value).label}`,
    );
  };

  detail.addEventListener('submit', async (event) => {
    event.preventDefault();
    const changes = {
      building: detail.elements.building.value.trim(),
      room: detail.elements.room.value.trim(),
      note: detail.elements.note.value.trim(),
    };
    Object.assign(editing.properties, changes);
    const ok = isNew
      ? await commit(mutations.add(editing), `Add dispenser ${labelOf(editing.properties)} (floor ${editing.properties.floor})`)
      : await commit(mutations.update(editing.id, changes), `Edit dispenser ${labelOf(editing.properties)}`);
    if (ok) closeDetail();
  });

  $('detail-close').addEventListener('click', closeDetail);

  $('move').addEventListener('click', () => {
    setMode('move');
    setStatus('Tap the new location');
  });

  // Two-step delete instead of a confirm() dialog, which blocks WebViews badly.
  let deleteArmed = false;
  const resetDeleteButton = () => {
    deleteArmed = false;
    $('delete').textContent = 'Delete';
  };
  $('delete').addEventListener('click', async () => {
    if (!deleteArmed) {
      deleteArmed = true;
      $('delete').textContent = 'Tap again to delete';
      return;
    }
    if (await commit(mutations.remove(editing.id), `Delete dispenser ${labelOf(editing.properties)}`)) closeDetail();
  });

  /* ---------- Map interaction ---------- */

  const setMode = (next) => {
    mode = next;
    $('add-toggle').setAttribute('aria-pressed', String(mode === 'add'));
    document.body.classList.toggle('placing', mode !== 'idle');
  };

  $('add-toggle').addEventListener('click', () => {
    closeDetail();
    setMode(mode === 'add' ? 'idle' : 'add');
    if (mode === 'add') setStatus(`Tap where the dispenser is (floor ${floors.current})`);
  });

  /** Building and room number of the floor-plan room under a pixel, if any. */
  const roomAt = (pixel) => {
    const hit = roomsLayer && map.getFeaturesAtPixel(pixel, { layerFilter: (l) => l === roomsLayer, hitTolerance: 2 })[0];
    return hit ? { building: String(hit.get('building') ?? ''), room: String(hit.get('room_number') ?? '') } : null;
  };

  map.on('singleclick', async (event) => {
    if (mode === 'add') {
      setMode('idle');
      const room = roomAt(event.pixel) ?? { building: '', room: '' };
      const feature = normalizeFeature({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: toStoredLonLat(event.coordinate) },
        properties: { floor: floors.current, ...room },
      });
      openDetail(feature, true);
      return;
    }

    if (mode === 'move' && editing) {
      setMode('idle');
      const coordinates = toStoredLonLat(event.coordinate);
      if (await commit(mutations.move(editing.id, coordinates), `Move dispenser ${labelOf(editing.properties)}`)) {
        openDetail(featureById(editing.id), false);
      }
      return;
    }

    const hit = map.forEachFeatureAtPixel(event.pixel, (f) => f, { layerFilter: (l) => l === dispensers.layer, hitTolerance: 6 });
    if (hit) openDetail(featureById(hit.getId()), false);
    else closeDetail();
  });

  /* ---------- Settings ---------- */

  const settings = $('settings');
  const { owner, repo } = CONFIG.dataset;
  $('repo-name').textContent = `${owner}/${repo}`;

  function openSettings(message = '') {
    settings.elements.token.value = loadToken() ?? '';
    $('settings-result').textContent = message;
    settings.hidden = false;
  }

  const connect = async (token) => {
    dataset = new GitHubDataset(CONFIG.dataset, token);
    setStatus('Loading dispensers...');
    showCollection(await dataset.load());
    setStatus(`${collection.features.length} dispensers`);
  };

  settings.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = settings.elements.token.value.trim();
    $('settings-result').textContent = 'Testing...';
    try {
      const name = await new GitHubDataset(CONFIG.dataset, token).verify();
      saveToken(token);
      await connect(token);
      $('settings-result').textContent = `Connected to ${name}.`;
      settings.hidden = true;
    } catch (error) {
      $('settings-result').textContent = `Failed: ${error.message}`;
    }
  });
  $('settings-close').addEventListener('click', () => (settings.hidden = true));
  $('open-settings').addEventListener('click', () => openSettings());
  $('forget-token').addEventListener('click', () => {
    forgetToken();
    dataset = null;
    settings.elements.token.value = '';
    $('settings-result').textContent = 'Token removed from this device.';
  });

  /* ---------- Start ---------- */

  const token = loadToken();
  if (token) {
    try {
      await connect(token);
    } catch (error) {
      setStatus(`Could not load: ${error.message}`);
      openSettings(`Stored token failed: ${error.message}`);
    }
  } else {
    setStatus('Not connected');
    openSettings();
  }
}

init();
