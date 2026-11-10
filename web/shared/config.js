/**
 * Shared configuration for the Finder and Editor apps.
 *
 * Backend values come from the network traffic of maps.rug.nl (November
 * 2026). That backend is not a documented public API: if floor plans stop
 * loading, compare this file with the DevTools Network tab on maps.rug.nl.
 */
import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

export const CONFIG = Object.freeze({
  /**
   * pg_tileserv base URL. The browser dev server proxies /tileserv to avoid
   * CORS; the Android apps fetch natively (see net.js), where CORS does not apply.
   */
  tileservUrl: import.meta.env.DEV && !isNative ? '/tileserv' : 'https://mapsrugtileserv.web.rug.nl',

  /**
   * Floor codes as used by RUG Maps, top floor first. They are strings:
   * "0T"/"2T" are mezzanines and "-S" a souterrain.
   */
  floors: ['14', '13', '12', '11', '10', '09', '08', '07', '06', '05', '04', '03', '2T', '02', '01', '0T', '00', '-S', '-1'],
  defaultFloor: '00',

  /** pg_tileserv layers; perFloor layers get ?filter=floor='xx' like maps.rug.nl. */
  layers: [
    { id: 'app_views.buildings', kind: 'building', perFloor: false },
    { id: 'app_views.rooms', kind: 'room', perFloor: true, label: 'room_number' },
    { id: 'app_views.building_entrances', kind: 'entrance', perFloor: true },
  ],
  labelMaxResolution: 0.35,

  /** Initial view: Zernike Campus, as [lon, lat]. */
  center: [6.5355, 53.2405],
  zoom: 17,

  /**
   * The dispenser dataset lives in a public GitHub repository.
   * Finder reads it anonymously; Editor writes it via the Contents API.
   */
  dataset: {
    owner: 'markspan',
    repo: 'rug-pleistermap',
    branch: 'main',
    path: 'public/data/dispensers.geojson',
  },

  /** Fill levels offered in the Editor, as percentages. */
  fillSteps: [0, 25, 50, 75, 100],
  /** At or below this percentage the Finder treats a dispenser as empty. */
  emptyThreshold: 0,

  /**
   * Nearest-dispenser ranking: each floor of difference costs this many
   * metres. Rough cost of a staircase; a convention, not a measurement.
   */
  metresPerFloor: 20,
  /** Above this GPS accuracy (metres) the Finder warns that ranking is rough. */
  poorAccuracyMetres: 30,
});

export const IS_NATIVE = isNative;
