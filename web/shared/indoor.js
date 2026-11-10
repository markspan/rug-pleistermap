/**
 * Indoor floor-plan layers from the RUG Maps pg_tileserv backend.
 *
 * Mirrors what maps.rug.nl does: per-floor layers are requested with a
 * pg_tileserv CQL filter, ?filter=floor='01', and the tile URL is swapped
 * when the floor changes. The server then only sends the active floor.
 */
import VectorTileLayer from 'ol/layer/VectorTile.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import MVT from 'ol/format/MVT.js';
import { Style, Fill, Stroke, Circle, Text } from 'ol/style.js';
import { vectorTileLoader } from './net.js';

/** Static styles per layer kind; created once and shared by all features. */
const STYLES = {
  building: new Style({
    fill: new Fill({ color: 'rgba(240, 240, 240, 0.6)' }),
    stroke: new Stroke({ color: '#777', width: 1.2 }),
  }),
  room: new Style({
    fill: new Fill({ color: 'rgba(214, 214, 214, 0.9)' }),
    stroke: new Stroke({ color: '#6b6b6b', width: 0.8 }),
  }),
  entrance: new Style({
    image: new Circle({ radius: 4, fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#333', width: 1.5 }) }),
  }),
};

/**
 * Tile URL template for a layer, with the floor filter when applicable.
 * @param {string} baseUrl
 * @param {{ id: string, perFloor: boolean }} spec
 * @param {string} floor
 */
export function tileUrl(baseUrl, spec, floor) {
  const url = `${baseUrl}/${spec.id}/{z}/{x}/{y}.pbf`;
  // Floor codes are fixed configuration values, but quote-escape anyway so
  // a stray apostrophe can never break out of the CQL string literal.
  const literal = floor.replaceAll("'", "''");
  return spec.perFloor ? `${url}?filter=${encodeURIComponent(`floor='${literal}'`)}` : url;
}

/**
 * Style function for one layer: base style plus an optional room label.
 * @param {{ kind: keyof STYLES, label?: string }} spec
 * @param {number} labelMaxResolution
 */
function makeStyle(spec, labelMaxResolution) {
  const base = STYLES[spec.kind];
  if (!spec.label) return base;

  const labelStyle = new Style({
    text: new Text({
      font: '11px system-ui, sans-serif',
      fill: new Fill({ color: '#222' }),
      stroke: new Stroke({ color: '#fff', width: 3 }),
    }),
  });

  return (feature, resolution) => {
    const text = resolution < labelMaxResolution ? feature.get(spec.label) : undefined;
    if (!text) return base;
    labelStyle.getText().setText(String(text));
    return [base, labelStyle];
  };
}

/**
 * Create one VectorTileLayer per configured layer and keep per-floor
 * layers in sync with the floor state.
 * @param {import('./floors.js').FloorState} floors
 * @param {{ baseUrl: string, layers: readonly object[], labelMaxResolution: number }} options
 * @returns {VectorTileLayer[]}
 */
export function createIndoorLayers(floors, { baseUrl, layers, labelMaxResolution }) {
  return layers.map((spec, index) => {
    const source = new VectorTileSource({
      format: new MVT(),
      url: tileUrl(baseUrl, spec, floors.current),
      tileLoadFunction: vectorTileLoader,
    });

    if (spec.perFloor) {
      // setUrl clears the tile cache, so the new floor is fetched fresh.
      floors.addEventListener('change', () => source.setUrl(tileUrl(baseUrl, spec, floors.current)));
    }

    return new VectorTileLayer({
      source,
      zIndex: 10 + index,
      declutter: Boolean(spec.label),
      style: makeStyle(spec, labelMaxResolution),
      properties: { title: spec.id, kind: spec.kind },
    });
  });
}
