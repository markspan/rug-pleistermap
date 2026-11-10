/**
 * Where the Finder searches from.
 *
 *   gps  (default) the user's GPS position; follows every new fix
 *   pin  a spot the user tapped on the map; stays put while GPS moves
 *
 * Tapping the map sets a pin; the locate button returns to gps. The pin is
 * drawn as a marker so it is always clear which point the list ranks from.
 */
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { fromLonLat } from 'ol/proj.js';
import { Style, Icon } from 'ol/style.js';

/** Map pin, anchored at its tip. Blue like the GPS dot: both are "you search from here". */
const PIN_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">' +
      '<path d="M14 35C14 35 26 21 26 13A12 12 0 0 0 2 13C2 21 14 35 14 35Z" fill="#1971c2" stroke="#fff" stroke-width="2"/>' +
      '<circle cx="14" cy="13" r="4.5" fill="#fff"/></svg>',
  );

/** @typedef {{ lon: number, lat: number }} LonLat */

export class SearchPoint extends EventTarget {
  /** @type {'gps'|'pin'} */
  mode = 'gps';
  /** @type {LonLat|null} */
  #pin = null;
  /** @type {LonLat|null} latest GPS fix */
  #gps = null;

  #marker = new Feature();

  /** Layer showing the pin while in pin mode. */
  layer = new VectorLayer({
    source: new VectorSource({ features: [this.#marker] }),
    zIndex: 95,
    style: new Style({ image: new Icon({ src: PIN_ICON, anchor: [0.5, 1] }) }),
  });

  /** The point to rank from, or null while waiting for the first GPS fix. */
  get origin() {
    return this.mode === 'pin' ? this.#pin : this.#gps;
  }

  /** Record a GPS fix; changes the origin only in gps mode. */
  setGps(fix) {
    this.#gps = { lon: fix.lon, lat: fix.lat };
    if (this.mode === 'gps') this.#changed();
  }

  /** Search from a tapped spot. @param {LonLat} lonLat */
  setPin(lonLat) {
    this.mode = 'pin';
    this.#pin = lonLat;
    this.#marker.setGeometry(new Point(fromLonLat([lonLat.lon, lonLat.lat])));
    this.#changed();
  }

  /** Back to searching from the GPS position. */
  useGps() {
    if (this.mode === 'gps') return;
    this.mode = 'gps';
    this.#pin = null;
    this.#marker.setGeometry(undefined);
    this.#changed();
  }

  #changed() {
    this.dispatchEvent(new Event('change'));
  }
}
