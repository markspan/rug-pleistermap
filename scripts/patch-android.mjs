#!/usr/bin/env node
/**
 * Applies an app's native Android settings after `npx cap add android`.
 *
 * The android/ projects are generated in CI rather than committed, so every
 * native tweak must be reproducible from here. Idempotent: running it twice
 * leaves the project unchanged. Shared by the public Finder repository and
 * the private Editor repository (which includes this one as a submodule).
 *
 * Usage: node patch-android.mjs <app dir>
 *   <app dir> holds capacitor.config.json, android/ and android-patch.json:
 *   {
 *     "permissions": ["location"],   // permission groups, see PERMISSION_GROUPS
 *     "allowBackup": false            // optional; false keeps app data off Google backups
 *   }
 *
 * With APP_VERSION set (e.g. "0.2.2"), it also stamps the Android version:
 * versionName = APP_VERSION and versionCode = major*10000 + minor*100 + patch,
 * so every release has a higher code than the one before and Android always
 * treats it as an update.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

/** Manifest lines per permission group, inserted before <application>. */
const PERMISSION_GROUPS = {
  // Required by @capacitor/geolocation.
  location: [
    '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
  ],
};

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

const appDir = process.argv[2] && resolve(process.argv[2]);
if (!appDir) {
  console.error('Usage: patch-android.mjs <app dir>');
  process.exit(2);
}
const app = basename(appDir);
const settings = JSON.parse(readFileSync(join(appDir, 'android-patch.json'), 'utf8'));

/* ---------- Manifest: permissions and backup ---------- */

const manifestPath = join(appDir, 'android/app/src/main/AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');

const lines = (settings.permissions ?? []).flatMap((group) => {
  if (!(group in PERMISSION_GROUPS)) throw new Error(`Unknown permission group "${group}"`);
  return PERMISSION_GROUPS[group];
});
const missing = lines.filter((line) => !manifest.includes(line));
if (missing.length > 0) {
  manifest = manifest.replace(/(\s*)<application/, (match, indent) => `${missing.map((l) => `${indent}${l}`).join('')}${match}`);
}
console.log(`${app}: ${missing.length} manifest entr${missing.length === 1 ? 'y' : 'ies'} added`);

if (settings.allowBackup === false) {
  manifest = manifest.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
  if (!manifest.includes('android:allowBackup="false"')) throw new Error('Could not disable allowBackup: manifest layout changed');
  console.log(`${app}: Android backup disabled`);
}
writeFileSync(manifestPath, manifest);

/* ---------- Version stamp ---------- */

const version = process.env.APP_VERSION?.replace(/^v/, '');
if (version) {
  const gradlePath = join(appDir, 'android/app/build.gradle');
  const gradle = readFileSync(gradlePath, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${versionCode(version)}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`);
  writeFileSync(gradlePath, gradle);
  console.log(`${app}: version ${version} (code ${versionCode(version)})`);
}
