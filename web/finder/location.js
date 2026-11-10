/**
 * Continuous position updates. Uses the Capacitor Geolocation plugin, which
 * asks for the Android runtime permission on native and falls back to the
 * browser Geolocation API on the web.
 */
import { Geolocation } from '@capacitor/geolocation';
import { IS_NATIVE } from '../shared/config.js';

/**
 * @param {(fix: { lon: number, lat: number, accuracy: number }) => void} onFix
 * @param {(error: Error) => void} onError
 * @returns {Promise<() => void>} stop function
 */
export async function watchLocation(onFix, onError) {
  if (IS_NATIVE) {
    const status = await Geolocation.requestPermissions({ permissions: ['location'] });
    if (status.location !== 'granted') {
      onError(new Error('Location permission denied'));
      return () => {};
    }
  }

  const id = await Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
    (position, error) => {
      if (error || !position) {
        onError(error ?? new Error('No position'));
        return;
      }
      const { longitude: lon, latitude: lat, accuracy } = position.coords;
      onFix({ lon, lat, accuracy });
    },
  );
  return () => Geolocation.clearWatch({ id });
}
