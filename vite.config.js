/**
 * One Vite config for both apps. The mode selects the app:
 *   vite --mode finder        dev server for web/finder
 *   vite build --mode editor  production build into dist/editor
 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const APPS = ['finder', 'editor'];
const fromRoot = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => {
  if (!APPS.includes(mode)) {
    throw new Error(`Unknown app "${mode}". Use --mode ${APPS.join(' or --mode ')}.`);
  }
  return {
    root: fromRoot(`./web/${mode}`),
    // Relative base: Capacitor serves the build from the WebView's local origin.
    base: './',
    // Bundled offline copy of the dataset (public/data/dispensers.geojson).
    publicDir: fromRoot('./public'),
    build: { outDir: fromRoot(`./dist/${mode}`), emptyOutDir: true },
    server: {
      proxy: {
        // Dev-only proxy to avoid CORS against the RUG tile server in a browser.
        '/tileserv': {
          target: 'https://mapsrugtileserv.web.rug.nl',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/tileserv/, ''),
        },
      },
    },
  };
});
