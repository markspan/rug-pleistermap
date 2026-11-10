/**
 * Bandaid Finder: shows dispensers and lists the nearest non-empty ones,
 * based on GPS position plus the floor the user says they are on.
 */
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { circular } from 'ol/geom/Polygon.js';
import { fromLonLat } from 'ol/proj.js';
import { Style, Circle, Fill, Stroke } from 'ol/style.js';
import { CONFIG } from '../shared/config.js';
import { createMapCore } from '../shared/mapCore.js';
import { fetchPublic } from '../shared/dataset.js';
import { fillStatus } from '../shared/dispenserLayer.js';
import { rankDispensers, describeRoute } from './nearest.js';
import { watchLocation } from './location.js';

const RESULT_COUNT = 3;
const USER_FLOOR_KEY = 'bandaid-finder.userFloor';

const $ = (id) => document.getElementById(id);
const setStatus = (text) => ($('status').textContent = text);

/** Layer with the user's position dot and GPS accuracy circle. */
function createPositionLayer() {
  const dot = new Feature();
  const halo = new Feature();
  dot.setStyle(new Style({ image: new Circle({ radius: 7, fill: new Fill({ color: '#1971c2' }), stroke: new Stroke({ color: '#fff', width: 2 }) }) }));
  halo.setStyle(new Style({ fill: new Fill({ color: 'rgba(25,113,194,0.12)' }), stroke: new Stroke({ color: 'rgba(25,113,194,0.5)', width: 1 }) }));
  const layer = new VectorLayer({ source: new VectorSource({ features: [halo, dot] }), zIndex: 90 });

  return {
    layer,
    update({ lon, lat, accuracy }) {
      dot.setGeometry(new Point(fromLonLat([lon, lat])));
      halo.setGeometry(circular([lon, lat], accuracy, 48).transform('EPSG:4326', 'EPSG:3857'));
    },
  };
}

/** Floor the user says they are on; remembered between launches. */
function mountUserFloor(select, onChange) {
  let stored = null;
  try {
    stored = localStorage.getItem(USER_FLOOR_KEY);
  } catch {
    /* storage unavailable: fall back to default */
  }
  select.replaceChildren(...CONFIG.floors.map((code) => new Option(code, code)));
  select.value = CONFIG.floors.includes(stored) ? stored : CONFIG.defaultFloor;
  select.addEventListener('change', () => {
    try {
      localStorage.setItem(USER_FLOOR_KEY, select.value);
    } catch {
      /* not persisted, still works for this session */
    }
    onChange();
  });
}

async function init() {
  const { map, floors, dispensers } = createMapCore({
    target: 'map',
    floorPanel: $('floors'),
    onTileError: () => setStatus('Floor plans could not be loaded'),
  });

  const position = createPositionLayer();
  map.addLayer(position.layer);

  /** @type {object[]} */
  let features = [];
  /** @type {{ lon: number, lat: number, accuracy: number } | null} */
  let fix = null;
  let centredOnUser = false;

  const userFloorSelect = $('user-floor');

  /** Focus a dispenser: switch the map to its floor and centre on it. */
  const focus = (feature) => {
    floors.set(feature.properties.floor);
    dispensers.select(feature.id);
    map.getView().animate({ center: fromLonLat(feature.geometry.coordinates), zoom: 19, duration: 400 });
  };

  const renderResults = () => {
    const list = $('results');
    if (features.length === 0) {
      list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'No dispensers in the dataset yet.' }));
      return;
    }
    if (!fix) {
      list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Waiting for your location...' }));
      return;
    }

    const ranked = rankDispensers(features, fix, userFloorSelect.value, CONFIG).slice(0, RESULT_COUNT);
    if (ranked.length === 0) {
      list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'All known dispensers are empty.' }));
      return;
    }

    list.replaceChildren(
      ...ranked.map((entry) => {
        const p = entry.feature.properties;
        const status = fillStatus(p.fill);
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'result';
        button.innerHTML = `
          <span class="badge" style="background:${status.color}"></span>
          <span class="where"></span>
          <span class="how"></span>`;
        // textContent for data fields: dataset content is never parsed as HTML.
        button.querySelector('.where').textContent = [p.building && `Building ${p.building}`, p.room && `room ${p.room}`, `floor ${p.floor}`].filter(Boolean).join(', ');
        button.querySelector('.how').textContent = `${describeRoute(entry, userFloorSelect.value, CONFIG.floors)} · ${status.label}`;
        button.addEventListener('click', () => focus(entry.feature));
        item.append(button);
        return item;
      }),
    );
  };

  const loadData = async () => {
    setStatus('Loading dispensers...');
    const { collection, source } = await fetchPublic(CONFIG.dataset, './data/dispensers.geojson');
    features = collection.features;
    dispensers.setCollection(collection);
    setStatus(`${features.length} dispensers${source === 'bundled' ? ' (offline copy)' : ''}`);
    renderResults();
  };

  mountUserFloor(userFloorSelect, () => {
    floors.set(userFloorSelect.value);
    renderResults();
  });
  floors.set(userFloorSelect.value);

  $('refresh').addEventListener('click', loadData);

  await loadData();

  watchLocation(
    (next) => {
      fix = next;
      position.update(next);
      const poor = next.accuracy > CONFIG.poorAccuracyMetres;
      $('accuracy').hidden = !poor;
      $('accuracy').textContent = poor ? `GPS accuracy is about ${Math.round(next.accuracy)} m indoors, so the order is approximate.` : '';
      if (!centredOnUser) {
        map.getView().animate({ center: fromLonLat([next.lon, next.lat]), duration: 400 });
        centredOnUser = true;
      }
      renderResults();
    },
    (error) => {
      $('accuracy').hidden = false;
      $('accuracy').textContent = `No location: ${error.message}. Tap a dispenser on the map instead.`;
    },
  );
}

init();
