import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankDispensers, describeRoute } from '../web/finder/nearest.js';

const FLOORS = ['02', '01', '0T', '00', '-1'];
const OPTS = { floors: FLOORS, metresPerFloor: 20, emptyThreshold: 0 };
const here = { lon: 6.5355, lat: 53.2405 };
// ~0.0001 deg latitude is ~11 m.
const at = (id, dLat, floor, fill = 100) => ({
  id, geometry: { type: 'Point', coordinates: [here.lon, here.lat + dLat] },
  properties: { floor, fill, building: '', room: '', note: '', checkedAt: null },
});

test('floor penalty can outweigh horizontal distance', () => {
  const ranked = rankDispensers([at('near-upstairs', 0.0001, '02'), at('far-same', 0.0003, '00')], here, '00', OPTS);
  // near-upstairs: 11 m + 3 floors * 20 = 71 m; far-same: 33 m.
  assert.deepEqual(ranked.map((r) => r.feature.id), ['far-same', 'near-upstairs']);
  assert.equal(ranked[1].floorDelta, 3);
});

test('empty dispensers are excluded, unchecked ones kept', () => {
  const ranked = rankDispensers([at('empty', 0.00001, '00', 0), at('unknown', 0.0002, '00', null)], here, '00', OPTS);
  assert.deepEqual(ranked.map((r) => r.feature.id), ['unknown']);
});

test('unknown floor code gets no penalty instead of crashing', () => {
  const [r] = rankDispensers([at('odd', 0, 'XX')], here, '00', OPTS);
  assert.equal(r.floorDelta, 0);
});

test('route wording uses up/down from the top-first floor list', () => {
  const [r] = rankDispensers([at('a', 0.0001, '02')], here, '00', OPTS);
  assert.match(describeRoute(r, '00', FLOORS), /3 floors up$/);
});
