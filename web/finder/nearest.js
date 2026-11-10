/**
 * Ranking of dispensers by "effective distance" from the user.
 *
 * effective = horizontal great-circle distance
 *           + |floor difference| * metresPerFloor
 *
 * The floor term is a convention (the cost of a staircase), not a measured
 * walking distance; real routes depend on where stairs and lifts are. Empty
 * dispensers are excluded; unchecked ones are kept but flagged.
 *
 * Pure functions only, so this is testable without a map or a phone.
 */
import { getDistance } from 'ol/sphere.js';

/**
 * @typedef {Object} Ranked
 * @property {object} feature       GeoJSON feature
 * @property {number} horizontal    metres, straight line
 * @property {number} floorDelta    number of floors to climb or descend
 * @property {number} effective     metres, used for sorting
 */

/**
 * @param {object[]} features             normalized GeoJSON features
 * @param {{ lon: number, lat: number }} here
 * @param {string} userFloor              RUG floor code
 * @param {{ floors: readonly string[], metresPerFloor: number, emptyThreshold: number }} options
 * @returns {Ranked[]} closest first
 */
export function rankDispensers(features, here, userFloor, { floors, metresPerFloor, emptyThreshold }) {
  const floorIndex = (code) => floors.indexOf(code);
  const userIndex = floorIndex(userFloor);

  return features
    .filter((f) => !(Number.isFinite(f.properties.fill) && f.properties.fill <= emptyThreshold))
    .map((feature) => {
      const [lon, lat] = feature.geometry.coordinates;
      const horizontal = getDistance([here.lon, here.lat], [lon, lat]);
      const targetIndex = floorIndex(feature.properties.floor);
      // Unknown floor codes get no penalty rather than an arbitrary one.
      const floorDelta = userIndex < 0 || targetIndex < 0 ? 0 : Math.abs(targetIndex - userIndex);
      return { feature, horizontal, floorDelta, effective: horizontal + floorDelta * metresPerFloor };
    })
    .sort((a, b) => a.effective - b.effective);
}

/** Human wording for a ranked entry, e.g. "40 m, 2 floors up". */
export function describeRoute(ranked, userFloor, floors) {
  const metres = ranked.horizontal < 1000 ? `${Math.round(ranked.horizontal / 5) * 5} m` : `${(ranked.horizontal / 1000).toFixed(1)} km`;
  if (ranked.floorDelta === 0) return `${metres}, same floor`;
  // Floors are listed top first, so a lower index is higher up.
  const up = floors.indexOf(ranked.feature.properties.floor) < floors.indexOf(userFloor);
  const n = ranked.floorDelta;
  return `${metres}, ${n} floor${n > 1 ? 's' : ''} ${up ? 'up' : 'down'}`;
}
