/**
 * Network helpers that behave the same in a browser and in the Android apps.
 *
 * Inside the Capacitor WebView the page origin is https://localhost, and the
 * RUG tile server may not send CORS headers for that origin. On native we
 * therefore load binary tiles through CapacitorHttp, which runs the request
 * in Java and is not subject to CORS. In a browser we use plain fetch.
 */
import { CapacitorHttp } from '@capacitor/core';
import TileState from 'ol/TileState.js';
import { IS_NATIVE } from './config.js';

/** Decode the base64 payload CapacitorHttp returns for binary responses. */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * GET a URL as an ArrayBuffer.
 * @param {string} url
 * @returns {Promise<ArrayBuffer>}
 */
export async function getArrayBuffer(url) {
  if (IS_NATIVE) {
    const response = await CapacitorHttp.get({ url, responseType: 'arraybuffer' });
    if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${url}`);
    return typeof response.data === 'string' ? base64ToArrayBuffer(response.data) : response.data;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.arrayBuffer();
}

/**
 * OpenLayers tileLoadFunction for VectorTile sources using getArrayBuffer.
 * @param {import('ol/VectorTile.js').default} tile
 * @param {string} url
 */
export function vectorTileLoader(tile, url) {
  tile.setLoader((extent, resolution, projection) => {
    getArrayBuffer(url)
      .then((data) => {
        const format = tile.getFormat();
        tile.setFeatures(format.readFeatures(data, { extent, featureProjection: projection }));
      })
      .catch(() => tile.setState(TileState.ERROR));
  });
}
