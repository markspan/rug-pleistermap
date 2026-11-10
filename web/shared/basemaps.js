/**
 * Selectable base maps (street map or aerial photo) and the toggle for them.
 *
 * The aerial photo is the Dutch national "Actueel_orthoHR" orthophoto from
 * PDOK (Beeldmateriaal Nederland), open data under CC BY 4.0, served as
 * Web Mercator tiles up to zoom 21. Global imagery (Esri, Google, Bing) was
 * not used: their terms do not allow it in an app like this, and PDOK is
 * sharper for Groningen.
 *
 * Over the photo, the floor plans are drawn semi-transparent so the building
 * underneath stays visible.
 */
import Control from 'ol/control/Control.js';
import TileLayer from 'ol/layer/Tile.js';
import OSM from 'ol/source/OSM.js';
import XYZ from 'ol/source/XYZ.js';

const STORAGE_KEY = 'rug-pleistermap.basemap';

/** Base maps in the order the switch shows them; the first is the default. */
export const BASEMAPS = [
  {
    id: 'map',
    label: 'Map',
    indoorOpacity: 1,
    source: () => new OSM(),
  },
  {
    id: 'aerial',
    label: 'Aerial',
    indoorOpacity: 0.55,
    source: () =>
      new XYZ({
        url: 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
        maxZoom: 21, // deeper zooms upscale the zoom-21 tiles
        attributions: 'Aerial photo © <a href="https://www.beeldmateriaal.nl/">Beeldmateriaal Nederland</a> / PDOK, CC BY 4.0',
      }),
  },
];

function loadChoice() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return BASEMAPS.some((b) => b.id === stored) ? stored : BASEMAPS[0].id;
  } catch {
    return BASEMAPS[0].id;
  }
}

function saveChoice(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* not remembered, still switches */
  }
}

/**
 * Create one tile layer per base map; only the chosen one is visible.
 * Hidden layers load no tiles, so offering both costs nothing.
 * @param {import('ol/layer/Base.js').default[]} overlays layers to fade over the photo (the floor plans)
 */
export function createBasemaps(overlays) {
  const layers = new Map(
    BASEMAPS.map((spec) => [spec.id, new TileLayer({ source: spec.source(), zIndex: 0, visible: false, properties: { basemap: spec.id } })]),
  );

  let current = null;
  const select = (id) => {
    const spec = BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
    current = spec.id;
    for (const [layerId, layer] of layers) layer.setVisible(layerId === spec.id);
    overlays.forEach((layer) => layer.setOpacity(spec.indoorOpacity));
    saveChoice(spec.id);
    control?.sync(spec.id);
  };

  /**
   * One small toggle under the locate button. Each press moves to the next
   * base map (with two: map <-> aerial). Its label names the map it switches
   * TO; it is tinted while a non-default base map is showing.
   */
  class BasemapControl extends Control {
    constructor() {
      const button = document.createElement('button');
      button.type = 'button';
      // Layers icon, drawn inline so it needs no icon font.
      button.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">' +
        '<path d="M12 3 2 8l10 5 10-5z"/><path d="m2 13 10 5 10-5"/></svg>';
      const element = document.createElement('div');
      element.className = 'basemap-toggle ol-unselectable ol-control';
      element.append(button);
      super({ element });

      this.button = button;
      button.addEventListener('click', () => {
        const index = BASEMAPS.findIndex((b) => b.id === current);
        select(BASEMAPS[(index + 1) % BASEMAPS.length].id);
      });
    }

    sync(id) {
      const index = BASEMAPS.findIndex((b) => b.id === id);
      const next = BASEMAPS[(index + 1) % BASEMAPS.length];
      const label = `Switch to ${next.label.toLowerCase()}`;
      this.button.title = label;
      this.button.setAttribute('aria-label', label);
      this.button.classList.toggle('active', index > 0);
    }
  }

  const control = new BasemapControl();
  select(loadChoice());

  return { layers: [...layers.values()], control, select, get current() { return current; } };
}
