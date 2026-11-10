#!/usr/bin/env node
/**
 * Adds app-specific Android manifest entries after `npx cap add android`.
 *
 * The android/ projects are generated in CI rather than committed, so every
 * native tweak must be reproducible from here. Idempotent: running it twice
 * leaves the manifest unchanged.
 *
 * Usage: node scripts/patch-android.mjs <finder|editor>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Manifest lines per app, inserted before <application>. */
const MANIFEST_ADDITIONS = {
  finder: [
    // Required by @capacitor/geolocation.
    '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
  ],
  editor: [],
};

const app = process.argv[2];
if (!(app in MANIFEST_ADDITIONS)) {
  console.error(`Usage: patch-android.mjs <${Object.keys(MANIFEST_ADDITIONS).join('|')}>`);
  process.exit(2);
}

const manifestPath = fileURLToPath(new URL(`../apps/${app}/android/app/src/main/AndroidManifest.xml`, import.meta.url));
let manifest = readFileSync(manifestPath, 'utf8');

const missing = MANIFEST_ADDITIONS[app].filter((line) => !manifest.includes(line));
if (missing.length > 0) {
  manifest = manifest.replace(/(\s*)<application/, (match, indent) => `${missing.map((l) => `${indent}${l}`).join('')}${match}`);
  writeFileSync(manifestPath, manifest);
}
console.log(`${app}: ${missing.length} manifest entr${missing.length === 1 ? 'y' : 'ies'} added`);
