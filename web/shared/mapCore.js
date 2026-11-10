/**
 * Builds the map both apps share: selectable base map (street map or aerial
 * photo), RUG floor plans, floor switcher
 * and the dispenser layer. Each app adds its own behaviour on top.
 */
import 'ol/ol.css';
import './style.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { fromLonLat } from 'ol/proj.js';
import { defaults as defaultControls } from 'ol/control/defaults.js';
import { CONFIG } from './config.js';
import { FloorState, mountFloorSwitcher } from './floors.js';
import { createIndoorLayers } from './indoor.js';
import { createDispenserLayer } from './dispenserLayer.js';
import { createBasemaps } from './basemaps.js';

/** ?tileserv=<url> overrides the configured backend (browser use only). */
function resolveTileservUrl() {
  const override = new URLSearchParams(location.search).get('tileserv');
  return (override ?? CONFIG.tileservUrl).replace(/\/+$/, '');
}

/**
 * Map credits (OpenStreetMap, PDOK) are a license requirement, but OpenLayers
 * puts them bottom-right, under the apps' bottom sheets. This publishes the
 * height of the tallest visible sheet as --sheet-h, which the CSS uses to
 * lift the credits above it.
 */
function keepAttributionVisible() {
  const sheets = [...document.querySelectorAll('.sheet')];
  const update = () => {
    const height = Math.max(0, ...sheets.filter((s) => !s.hidden).map((s) => s.offsetHeight));
    document.documentElement.style.setProperty('--sheet-h', `${height}px`);
  };
  const observer = new ResizeObserver(update);
  sheets.forEach((sheet) => observer.observe(sheet));
  // `hidden` toggles do not always resize; watch the attribute too.
  const attributes = new MutationObserver(update);
  sheets.forEach((sheet) => attributes.observe(sheet, { attributes: true, attributeFilter: ['hidden'] }));
  update();
}

/**
 * @param {{ target: string, floorPanel: HTMLElement, onTileError?: () => void }} options
 */
export function createMapCore({ target, floorPanel, onTileError }) {
  const floors = new FloorState(CONFIG.floors, CONFIG.defaultFloor);

  const map = new Map({
    target,
    controls: defaultControls({ rotate: false }),
    view: new View({ center: fromLonLat(CONFIG.center), zoom: CONFIG.zoom, maxZoom: 22 }),
  });

  mountFloorSwitcher(floorPanel, floors);

  const indoorLayers = createIndoorLayers(floors, {
    baseUrl: resolveTileservUrl(),
    layers: CONFIG.layers,
    labelMaxResolution: CONFIG.labelMaxResolution,
  });
  indoorLayers.forEach((layer) => map.addLayer(layer));

  const basemaps = createBasemaps(indoorLayers);
  basemaps.layers.forEach((layer) => map.addLayer(layer));
  map.addControl(basemaps.control);

  if (onTileError) {
    let reported = false;
    indoorLayers.forEach((layer) =>
      layer.getSource().on('tileloaderror', () => {
        if (!reported) onTileError();
        reported = true;
      }),
    );
  }

  const dispensers = createDispenserLayer(floors);
  map.addLayer(dispensers.layer);

  keepAttributionVisible();

  const roomsLayer = indoorLayers.find((l) => l.get('kind') === 'room');

  return { map, floors, dispensers, roomsLayer };
}
