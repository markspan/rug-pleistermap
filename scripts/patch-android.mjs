#!/usr/bin/env node
/**
 * Adds app-specific Android manifest entries after `npx cap add android`.
 *
 * The android/ projects are generated in CI rather than committed, so every
 * native tweak must be reproducible from here. Idempotent: running it twice
 * leaves the manifest unchanged.
 *
 * Usage: node scripts/patch-android.mjs <finder|editor>
 *
 * With APP_VERSION set (e.g. "0.2.2"), it also stamps the Android version:
 * versionName = APP_VERSION and versionCode = major*10000 + minor*100 + patch,
 * so every release has a higher code than the one before and Android always
 * treats it as an update.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * "1.2.3" -> 10203. Minor and patch must stay below 100 to keep codes ordered.
 * @param {string} version
 */
function versionCode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`APP_VERSION must look like 1.2.3, got "${version}"`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 99 || patch > 99) throw new Error(`Minor and patch must be below 100, got "${version}"`);
  return major * 10000 + minor * 100 + patch;
}
import { fileURLToPath } from 'node:url';

/** Required by @capacitor/geolocation (both apps have the locate button). */
const LOCATION = [
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
];

/** Manifest lines per app, inserted before <application>. */
const MANIFEST_ADDITIONS = {
  finder: LOCATION,
  editor: LOCATION,
};

/**
 * Apps whose data must not leave the phone. The Editor stores the GitHub
 * token; Android's automatic backup would otherwise copy it to the user's
 * Google account (Capacitor's template sets allowBackup="true").
 */
const NO_BACKUP = new Set(['editor']);

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
}
if (NO_BACKUP.has(app)) {
  manifest = manifest.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
  if (!manifest.includes('android:allowBackup="false"')) throw new Error('Could not disable allowBackup: manifest layout changed');
  console.log(`${app}: Android backup disabled`);
}
writeFileSync(manifestPath, manifest);
console.log(`${app}: ${missing.length} manifest entr${missing.length === 1 ? 'y' : 'ies'} added`);

const version = process.env.APP_VERSION?.replace(/^v/, '');
if (version) {
  const gradlePath = fileURLToPath(new URL(`../apps/${app}/android/app/build.gradle`, import.meta.url));
  const gradle = readFileSync(gradlePath, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${versionCode(version)}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`);
  writeFileSync(gradlePath, gradle);
  console.log(`${app}: version ${version} (code ${versionCode(version)})`);
}
