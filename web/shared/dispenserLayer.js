/**
 * Map layer that draws dispensers on the active floor, coloured by fill level.
 * Shared by Finder and Editor; holds no data of its own beyond what
 * setCollection() hands it.
 */
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Style, Icon, Circle, Fill, Stroke } from 'ol/style.js';
import { CONFIG } from './config.js';

export const geojson = new GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });

/** Fill level to a status bucket; used for colour and wording in both apps. */
export function fillStatus(fill) {
  if (fill === null || fill === undefined) return { key: 'unknown', label: 'not checked', color: '#8a8a8a' };
  if (fill <= CONFIG.emptyThreshold) return { key: 'empty', label: 'empty', color: '#5a5a5a' };
  if (fill <= 25) return { key: 'low', label: `${fill}%`, color: '#e8590c' };
  if (fill <= 50) return { key: 'half', label: `${fill}%`, color: '#f2b705' };
  return { key: 'ok', label: `${fill}%`, color: '#2b8a3e' };
}

function iconSrc(background) {
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
        `<rect x="2" y="2" width="24" height="24" rx="6" fill="${background}" stroke="#fff" stroke-width="2"/>` +
        `<path d="M11 7h6v4h4v6h-4v4h-6v-4H7v-6h4z" fill="#fff"/></svg>`,
    )
  );
}

/** Styles are built once per (status, selected) pair and reused. */
const styleCache = new Map();
function styleFor(status, selected) {
  const key = `${status.key}|${selected}`;
  if (!styleCache.has(key)) {
    const styles = [];
    if (selected) {
      styles.push(new Style({ image: new Circle({ radius: 22, fill: new Fill({ color: 'rgba(220,0,45,0.18)' }), stroke: new Stroke({ color: '#dc002d', width: 2 }) }) }));
    }
    // Empty dispensers are drawn grey so they do not read as a place to go.
    styles.push(new Style({ image: new Icon({ src: iconSrc(status.key === 'empty' ? '#9a9a9a' : '#dc002d') }) }));
    styles.push(
      new Style({
        image: new Circle({
          radius: 5,
          displacement: [11, 11],
          fill: new Fill({ color: status.color }),
          stroke: new Stroke({ color: '#fff', width: 1.5 }),
        }),
      }),
    );
    styleCache.set(key, styles);
  }
  return styleCache.get(key);
}

/**
 * @param {import('./floors.js').FloorState} floors
 */
export function createDispenserLayer(floors) {
  const source = new VectorSource();
  let selectedId = null;

  const layer = new VectorLayer({
    source,
    zIndex: 100,
    style: (feature) => {
      if (!floors.isVisible(feature.get('floor'))) return null;
      return styleFor(fillStatus(feature.get('fill')), feature.getId() === selectedId);
    },
  });
  floors.addEventListener('change', () => layer.changed());

  return {
    layer,
    source,
    /** Replace all features with a (normalized) GeoJSON collection. */
    setCollection(collection) {
      source.clear(true);
      source.addFeatures(geojson.readFeatures(collection));
    },
    select(id) {
      selectedId = id;
      layer.changed();
    },
    get selectedId() {
      return selectedId;
    },
  };
}
