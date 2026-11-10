import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubDataset, mutations, normalizeCollection, serialize } from '../web/shared/dataset.js';

const ref = { owner: 'o', repo: 'r', branch: 'main', path: 'public/data/dispensers.geojson' };
const point = (id, props = {}) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [6.5, 53.2] }, properties: { floor: '00', ...props } });
const b64 = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

test('normalize upgrades v0.1 features (no id, no fill) and drops non-points', () => {
  const c = normalizeCollection({ features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { floor: 1 } }, { geometry: { type: 'LineString' } }] });
  assert.equal(c.features.length, 1);
  assert.equal(typeof c.features[0].id, 'string');
  assert.equal(c.features[0].properties.floor, '1');
  assert.equal(c.features[0].properties.fill, null);
});

test('serialize is stable regardless of feature order', () => {
  const a = normalizeCollection({ features: [point('b'), point('a')] });
  const b = normalizeCollection({ features: [point('a'), point('b')] });
  assert.equal(serialize(a), serialize(b));
});

test('commit re-applies the mutation on a 409 conflict instead of overwriting', async (t) => {
  // Remote state changes between our load and our PUT: another device added "other".
  const remote = [
    { sha: 's1', features: [point('mine')] },
    { sha: 's2', features: [point('mine'), point('other')] },
  ];
  let loads = 0;
  const puts = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const json = (status, body) => ({ ok: status < 300, status, statusText: '', json: async () => body });
    if (!init.method || init.method === 'GET') {
      const state = remote[Math.min(loads++, remote.length - 1)];
      return json(200, { sha: state.sha, content: b64({ type: 'FeatureCollection', features: state.features }) });
    }
    const body = JSON.parse(init.body);
    puts.push(body);
    if (body.sha === 's1') return json(409, { message: 'sha does not match' });
    return json(200, { content: { sha: 's3' } });
  });

  const ds = new GitHubDataset(ref, 'token');
  const result = await ds.commit(mutations.update('mine', { fill: 50 }), 'Fill');

  assert.equal(puts.length, 2);
  assert.equal(puts[1].sha, 's2');
  assert.deepEqual(result.features.map((f) => f.id).sort(), ['mine', 'other']);
  assert.equal(result.features.find((f) => f.id === 'mine').properties.fill, 50);
  assert.equal(ds.sha, 's3');
});

test('UTF-8 content survives the base64 round trip', async (t) => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (init.method === 'PUT') { sent = JSON.parse(init.body).content; return { ok: true, status: 200, json: async () => ({ content: { sha: 'x' } }) }; }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ message: 'Not Found' }) };
  });
  const ds = new GitHubDataset(ref, 't');
  await ds.commit(mutations.add(point('n', { note: 'naast de koffieautomaat, café' })), 'Add');
  assert.match(Buffer.from(sent, 'base64').toString('utf8'), /café/);
});
