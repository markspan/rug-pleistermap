/**
 * Bandaid Finder: shows dispensers and lists the nearest non-empty ones,
 * based on GPS position plus the floor the user says they are on.
 */
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { CONFIG } from '../shared/config.js';
import { createMapCore } from '../shared/mapCore.js';
import { fetchPublic } from '../shared/dataset.js';
import { fillStatus } from '../shared/dispenserLayer.js';
import { rankDispensers, describeRoute } from './nearest.js';
import { PositionTracker, createPositionLayer, LocateControl, centreOn } from '../shared/locate.js';
import { SearchPoint } from './searchPoint.js';

const RESULT_COUNT = 3;
const USER_FLOOR_KEY = 'bandaid-finder.userFloor';

const $ = (id) => document.getElementById(id);
const setStatus = (text) => ($('status').textContent = text);

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
  const { map, floors, dispensers, addButton } = createMapCore({
    target: 'map',
    floorPanel: $('floors'),
    onTileError: () => setStatus('Floor plans could not be loaded'),
  });

  const tracker = new PositionTracker();
  map.addLayer(createPositionLayer(tracker));
  /** Last location error, shown while searching from GPS; cleared by a fix. */
  let locationError = null;
  const showLocationProblem = (error) => {
    locationError = error;
    renderSearchState();
  };
  // Search from GPS by default, or from the last tapped spot; locate returns to GPS.
  const search = new SearchPoint();
  map.addLayer(search.layer);
  addButton(new LocateControl(tracker, { onError: showLocationProblem, onPress: () => search.useGps() }));

  /** @type {object[]} */
  let features = [];
  /** Latest GPS accuracy in metres, for the warning shown in gps mode. */
  let accuracy = null;
  let centredOnUser = false;

  const userFloorSelect = $('user-floor');

  /** Focus a dispenser: switch the map to its floor and centre on it. */
  const focus = (feature) => {
    floors.set(feature.properties.floor);
    dispensers.select(feature.id);
    map.getView().animate({ center: fromLonLat(feature.geometry.coordinates), zoom: 19, duration: 400 });
  };

  /** Heading and GPS warning follow the search mode. */
  const renderSearchState = () => {
    const pinned = search.mode === 'pin';
    $('sheet-title').textContent = pinned ? 'Nearest to the pin' : 'Nearest to you';
    const poor = !pinned && accuracy !== null && accuracy > CONFIG.poorAccuracyMetres;
    const message = pinned
      ? ''
      : locationError
        ? `No location: ${locationError.message}. Tap the map to search from a spot.`
        : poor
          ? `GPS accuracy is about ${Math.round(accuracy)} m indoors, so the order is approximate. Tap the map to search from a spot instead.`
          : '';
    $('accuracy').hidden = !message;
    $('accuracy').textContent = message;
  };

  const renderResults = () => {
    renderSearchState();
    const list = $('results');
    if (features.length === 0) {
      list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'No dispensers in the dataset yet.' }));
      return;
    }
    const origin = search.origin;
    if (!origin) {
      list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Waiting for your location... or tap the map to search from a spot.' }));
      return;
    }

    const ranked = rankDispensers(features, origin, userFloorSelect.value, CONFIG).slice(0, RESULT_COUNT);
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

  search.addEventListener('change', renderResults);

  // Tap a dispenser to show it; tap anywhere else to search from that spot.
  map.on('singleclick', (event) => {
    const hit = map.forEachFeatureAtPixel(event.pixel, (f) => f, { layerFilter: (l) => l === dispensers.layer, hitTolerance: 6 });
    if (hit) {
      dispensers.select(hit.getId());
      return;
    }
    const [lon, lat] = toLonLat(event.coordinate);
    search.setPin({ lon, lat });
  });

  await loadData();

  tracker.addEventListener('fix', ({ detail: next }) => {
    accuracy = next.accuracy;
    locationError = null;
    if (!centredOnUser && search.mode === 'gps') {
      centreOn(map, next);
      centredOnUser = true;
    }
    search.setGps(next); // re-ranks only while searching from GPS
    renderSearchState();
  });
  tracker.addEventListener('error', ({ detail }) => showLocationProblem(detail));
  // The Finder needs the position from the start; the Editor starts it on demand.
  tracker.start();
}

init();
