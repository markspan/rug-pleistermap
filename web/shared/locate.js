/**
 * "Locate me" support shared by Finder and Editor:
 *
 *   PositionTracker  one GPS watch per app, started on demand, emits "fix"
 *   createPositionLayer  blue dot + accuracy circle
 *   LocateControl    map button that centres the map on the current fix
 *
 * The tracker starts lazily, so the Editor asks for location permission
 * only when the button is first pressed; the Finder starts it at launch.
 */
import Control from 'ol/control/Control.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { circular } from 'ol/geom/Polygon.js';
import { fromLonLat } from 'ol/proj.js';
import { Style, Circle, Fill, Stroke } from 'ol/style.js';
import { watchLocation } from './location.js';

/** Zoom used when centring on the user; close enough to read room numbers. */
const LOCATE_ZOOM = 19;

/** @typedef {{ lon: number, lat: number, accuracy: number }} Fix */

export class PositionTracker extends EventTarget {
  /** @type {Fix|null} latest position, null until the first fix */
  fix = null;
  /** @type {Promise<void>|null} */
  #started = null;

  /** Start watching (idempotent). Emits "fix" (detail: Fix) and "error" (detail: Error). */
  start() {
    this.#started ??= watchLocation(
      (fix) => {
        this.fix = fix;
        this.dispatchEvent(new CustomEvent('fix', { detail: fix }));
      },
      (error) => this.dispatchEvent(new CustomEvent('error', { detail: error })),
    ).then(() => undefined);
    return this.#started;
  }
}

/**
 * Blue dot and accuracy circle that follow the tracker.
 * @param {PositionTracker} tracker
 */
export function createPositionLayer(tracker) {
  const dot = new Feature();
  const halo = new Feature();
  dot.setStyle(new Style({ image: new Circle({ radius: 7, fill: new Fill({ color: '#1971c2' }), stroke: new Stroke({ color: '#fff', width: 2 }) }) }));
  halo.setStyle(new Style({ fill: new Fill({ color: 'rgba(25,113,194,0.12)' }), stroke: new Stroke({ color: 'rgba(25,113,194,0.5)', width: 1 }) }));

  tracker.addEventListener('fix', ({ detail: { lon, lat, accuracy } }) => {
    dot.setGeometry(new Point(fromLonLat([lon, lat])));
    halo.setGeometry(circular([lon, lat], accuracy, 48).transform('EPSG:4326', 'EPSG:3857'));
  });

  return new VectorLayer({ source: new VectorSource({ features: [halo, dot] }), zIndex: 90 });
}

/** Centre the view on a fix, zooming in but never out. */
export function centreOn(map, { lon, lat }) {
  const view = map.getView();
  view.animate({ center: fromLonLat([lon, lat]), zoom: Math.max(view.getZoom() ?? 0, LOCATE_ZOOM), duration: 400 });
}

/**
 * Map button (below the zoom buttons) that centres on the user's position.
 * Pressed before the first fix, it starts the tracker and centres as soon
 * as a position arrives.
 */
export class LocateControl extends Control {
  /**
   * @param {PositionTracker} tracker
   * @param {{ onError?: (error: Error) => void }} [options]
   */
  constructor(tracker, { onError } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Show my location';
    button.setAttribute('aria-label', 'Show my location');
    // Crosshair icon, drawn inline so it needs no icon font.
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>' +
      '<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';

    const element = document.createElement('div');
    element.className = 'locate ol-unselectable ol-control';
    element.append(button);
    super({ element });

    this.tracker = tracker;
    this.button = button;
    let pending = false;

    tracker.addEventListener('fix', ({ detail }) => {
      if (!pending) return;
      pending = false;
      button.classList.remove('busy');
      centreOn(this.getMap(), detail);
    });
    tracker.addEventListener('error', ({ detail }) => {
      pending = false;
      button.classList.remove('busy');
      onError?.(detail);
    });

    button.addEventListener('click', () => {
      if (tracker.fix) {
        centreOn(this.getMap(), tracker.fix);
        return;
      }
      pending = true;
      button.classList.add('busy');
      tracker.start().catch((error) => onError?.(error));
    });
  }
}
