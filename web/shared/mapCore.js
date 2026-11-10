/**
 * Builds the map both apps share: OSM base, RUG floor plans, floor switcher
 * and the dispenser layer. Each app adds its own behaviour on top.
 */
import 'ol/ol.css';
import './style.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import OSM from 'ol/source/OSM.js';
import { fromLonLat } from 'ol/proj.js';
import { defaults as defaultControls } from 'ol/control/defaults.js';
import { CONFIG } from './config.js';
import { FloorState, mountFloorSwitcher } from './floors.js';
import { createIndoorLayers } from './indoor.js';
import { createDispenserLayer } from './dispenserLayer.js';

/** ?tileserv=<url> overrides the configured backend (browser use only). */
function resolveTileservUrl() {
  const override = new URLSearchParams(location.search).get('tileserv');
  return (override ?? CONFIG.tileservUrl).replace(/\/+$/, '');
}

/**
 * @param {{ target: string, floorPanel: HTMLElement, onTileError?: () => void }} options
 */
export function createMapCore({ target, floorPanel, onTileError }) {
  const floors = new FloorState(CONFIG.floors, CONFIG.defaultFloor);

  const map = new Map({
    target,
    controls: defaultControls({ rotate: false }),
    layers: [new TileLayer({ source: new OSM(), zIndex: 0 })],
    view: new View({ center: fromLonLat(CONFIG.center), zoom: CONFIG.zoom, maxZoom: 22 }),
  });

  mountFloorSwitcher(floorPanel, floors);

  const indoorLayers = createIndoorLayers(floors, {
    baseUrl: resolveTileservUrl(),
    layers: CONFIG.layers,
    labelMaxResolution: CONFIG.labelMaxResolution,
  });
  indoorLayers.forEach((layer) => map.addLayer(layer));

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

  const roomsLayer = indoorLayers.find((l) => l.get('kind') === 'room');

  return { map, floors, dispensers, roomsLayer };
}
