# RUG Bandaid Finder

An Android app that shows bandaid dispensers on the University of Groningen floor plans
from [RUG Maps](https://maps.rug.nl) and lists the nearest non-empty ones.

## Using the Finder

- **Search point.** The list ranks from your GPS position (blue dot, *Nearest to you*). Tap an
  empty spot on the map to search from there instead: a blue pin appears (*Nearest to the pin*)
  and stays put while you walk. The locate button removes the pin and returns to GPS.
- **Your floor.** *I'm on floor* sets the floor the ranking starts from, also for a pin.
- **Results.** The 3 nearest non-empty dispensers. Tap one to switch the map to its floor and
  zoom in. Dot colour = fill: green above 50%, yellow 26 to 50%, orange 1 to 25%, grey not checked.
- **Buttons, top left:** zoom, locate, layers (street map or aerial photo). They sit in one
  column and grow with the phone's text size.
- **Floor panel, right:** the floor the map shows. **↻** reloads the data.

The project is split over three repositories:

| Repository | Visibility | Holds |
| --- | --- | --- |
| `markspan/rug-pleistermap` (this one) | public | Bandaid Finder, and the shared map core (`web/shared`) |
| `markspan/rug-pleistermap-editor` | private | Bandaid Editor; uses this repository as a git submodule |
| `markspan/rug-pleistermap-data` | public | `dispensers.geojson`, the dataset (one commit per Editor save) |

The data is public because the Finder reads it without logging in. The Editor's GitHub token
is scoped to the data repository only, so it can never change app code.

## Architecture

```
web/shared/   map core shared with the Editor: floor plans, floors, dispenser layer,
              dataset read/write, locate button, base maps (map or aerial photo)
web/finder/   Finder UI, nearest-dispenser ranking (nearest.js), search point (searchPoint.js)
apps/finder/  Capacitor Android shell (android/ is generated in CI)
              android-patch.json: permissions and backup setting for the APK
scripts/      patch-android.mjs: applies android-patch.json and stamps the version
test/         unit tests for ranking and dataset logic (node --test)
public/data/  offline copy of the dataset bundled into the APK (refreshed at each build)
```

**Floor plans.** RUG Maps serves vector tiles from pg_tileserv at
`mapsrugtileserv.web.rug.nl`. One floor at a time is requested with a CQL filter, as RUG Maps
does: `app_views.rooms/{z}/{x}/{y}.pbf?filter=floor='01'`. Floor codes are strings
(`-1`, `-S`, `00`, `0T`, `01`, `2T`, ...). On Android, tiles are fetched via `CapacitorHttp`.

**Base maps.** OpenStreetMap, or the Dutch national aerial photo `Actueel_orthoHR` from PDOK
(Beeldmateriaal Nederland, CC BY 4.0), switched with the layers button. Floor plans fade to 55%
over the photo. Map credits stay above the bottom panel, as both licenses require.

**Map buttons.** `createMapCore()` returns `addButton(control)`, which puts an OpenLayers control
in the shared top-left column (`.map-buttons`). Use it instead of `map.addControl()` for buttons
that belong there.

**Dataset.** Read anonymously from `raw.githubusercontent.com`, with the bundled copy as offline
fallback. GitHub's CDN can serve a copy up to a few minutes old. Feature properties: `floor`,
`building`, `room`, `note`, `fill` (0 to 100, or null if never checked) and `checkedAt`.

**Nearest dispenser.** Straight-line distance from the search point (GPS or a tapped pin) plus
20 m per floor between the user's floor (picked in the app) and the dispenser's floor. The 20 m is a convention for the cost of a
staircase, set in `web/shared/config.js`. Empty dispensers are skipped.

## Releasing

On GitHub: **Actions > Finder APK > Run workflow**, enter a version higher than the last release
(e.g. `1.3.0`). In about 3 minutes tag `v1.3.0` and a Release with `bandaid-finder.apk` appear.
Pushes to `main` only make test APKs (the run's *Artifacts*). The version is stamped into the
APK, so each release installs as an update.

Signing uses the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and
`ANDROID_KEY_ALIAS`. Without them, debug APKs are built.

## Development

```bash
npm install
npm run dev:finder     # http://localhost:5173, tiles through a dev proxy
npm test
npm run build          # dist/finder
```

A change in `web/shared` reaches the Editor when its repository updates the `core` submodule:
`git submodule update --remote core`, commit, push.

The full setup and operating manual (repositories, signing keys, releases, tokens,
troubleshooting) is kept as a Claude doc: "RUG Bandaid apps: build, host and secrets manual".

## Caveats

The tile server is internal CIT/Geodienst infrastructure, not a documented public API. Check
with Geodienst (smartbuildings@rug.nl) before distributing the app widely.

## License

GPL-3.0-or-later. Map data © University of Groningen and OpenStreetMap contributors; aerial
photo © Beeldmateriaal Nederland / PDOK, CC BY 4.0.
