# RUG Bandaid apps

Two Android apps on top of the University of Groningen floor plans from
[RUG Maps](https://maps.rug.nl):

- **Bandaid Finder**: shows dispensers on the map and lists the nearest non-empty ones.
- **Bandaid Editor**: add, move and delete dispensers, and record how full they are.

## Architecture

```
web/shared/   map core used by both apps (floor plans, floors, dispenser layer, dataset)
web/finder/   Finder UI, location, nearest-dispenser ranking
web/editor/   Editor UI, GitHub token storage
apps/finder/  Capacitor Android shell for the Finder (android/ is generated in CI)
apps/editor/  Capacitor Android shell for the Editor
scripts/      patch-android.mjs: manifest permissions, applied after `cap add android`
test/         unit tests for ranking and dataset logic (node --test)
public/data/  offline copy of the dataset bundled into the APKs (refreshed at each build)
```

**Floor plans.** RUG Maps serves vector tiles from pg_tileserv at
`mapsrugtileserv.web.rug.nl`. Both apps request one floor at a time with a CQL filter,
as RUG Maps does: `app_views.rooms/{z}/{x}/{y}.pbf?filter=floor='01'`. Floor codes are
strings (`-1`, `-S`, `00`, `0T`, `01`, `2T`, ...). On Android, tiles are fetched via
`CapacitorHttp` (native, so the tile server's CORS policy does not matter).

**Dataset.** `dispensers.geojson` in the separate public repository
[`markspan/rug-pleistermap-data`](https://github.com/markspan/rug-pleistermap-data) is the database.
It is kept apart from the code so the Editor's token can only reach the data: a leaked token can
change dispensers (undoable from git history), never the apps.

- The Finder reads it anonymously from `raw.githubusercontent.com`, with the copy bundled
  in the APK as offline fallback. CI refreshes that copy from the data repository at every build. GitHub's CDN can serve a copy up to a few minutes old.
- The Editor writes it through the GitHub Contents API. Every change is one commit, so
  the git history is the audit log. Saves use optimistic locking: if another phone
  committed in between, the Editor re-reads and re-applies its change instead of
  overwriting.
- Dataset commits happen in the data repository, so they never trigger app builds.
- Android backup is disabled for the Editor, so the token never leaves the phone.

Feature properties: `floor`, `building`, `room`, `note`, `fill` (0 to 100, or null if
never checked) and `checkedAt` (ISO time). See `web/shared/dataset.js`.

**Nearest dispenser.** Ranked by straight-line GPS distance plus 20 m per floor between
the user's floor (picked in the app) and the dispenser's floor. The 20 m is a convention
for the cost of a staircase, set in `web/shared/config.js`, not a measured walking
distance. Indoors, GPS is often 20 to 50 m off, which the app shows when it happens.
Empty dispensers are skipped.

## Setup

1. **Repository.** Push this project to a *public* GitHub repository and set
   `CONFIG.dataset` in `web/shared/config.js` to match (default `markspan/rug-pleistermap`, branch `main`).
2. **Release the APKs.** On GitHub: **Actions > Android APKs > Run workflow**, enter a
   version higher than the last release (e.g. `0.2.3`), **Run workflow**. In about 3 minutes
   tag `v0.2.3` and a Release with `bandaid-finder.apk` and `bandaid-editor.apk` appear.
   Pushes to `main` only make test APKs (the run's *Artifacts*). Pushing a `v*` tag yourself
   also makes a release. The version is stamped into the APKs, so each release installs as
   an update. Installing needs "Install unknown apps" allowed for your browser.
3. **Editor token.** On github.com: Settings, Developer settings, Fine-grained tokens.
   Repository access: only `rug-pleistermap-data` (never the code repository).
   Permissions: *Contents: Read and write*.
   Paste it in the Editor's settings (gear icon). It is stored on the phone only.

### Stable signing (recommended)

Without signing secrets the workflow builds debug APKs with a new key each run, so you
must uninstall before installing an update. To sign with one key:

```bash
keytool -genkeypair -v -keystore bandaid.jks -alias bandaid -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 bandaid.jks   # PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("bandaid.jks"))
```

Add repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and
`ANDROID_KEY_ALIAS` (`bandaid`). Keep `bandaid.jks` safe: losing it means users must reinstall.

## Development

```bash
npm install
npm run dev:finder     # http://localhost:5173, tiles through a dev proxy
npm run dev:editor
npm test               # ranking and dataset logic
npm run build          # dist/finder and dist/editor
```

Building an APK locally instead of in CI (needs Android Studio, JDK 21):

```bash
npm run build:finder
cd apps/finder && npx cap add android && node ../../scripts/patch-android.mjs finder && npx cap sync android
npx cap open android
```

## Troubleshooting

- **Tiles return 404:** RUG Maps renamed its layers. Open maps.rug.nl, DevTools, Network,
  filter on `.pbf`, and update `layers` in `web/shared/config.js`.
- **Editor save fails with 401/403:** the token expired or lacks Contents write access.
- **Finder shows an old fill level:** GitHub's CDN cache; tap ↻ after a few minutes.

## Caveats

- The tile server is internal CIT/Geodienst infrastructure, not a documented public API.
  Check with Geodienst (smartbuildings@rug.nl) before distributing the apps widely.
- The token is stored in the app's private storage, which is not encrypted. Use a token
  scoped to this repository only.

## License

GPL-3.0-or-later. Map data © University of Groningen and OpenStreetMap contributors.
