# Gulf Almanac

A personal fishing almanac for the Hauraki Gulf. The product is one static page: tides, sun, moon, solunar periods, weather, and a map of wind, flow and chop.

## Commands

| Command | Result |
|---|---|
| `npm install` | Installs the build dependencies. Use the Node version in `.nvmrc`; the publish workflow uses it too. |
| `npm run build` | Writes `dist/index.html`, one self-contained file. |
| `npm test` | Checks tide predictions against the LINZ 2028 table for Auckland, one day of sun, moon and solunar values against recorded results, and the rules that find windows. |
| `python3 tools/screenshot.py` | Renders the built page with a mocked forecast, at an iPad size or a phone size, on any of the three screens. Needs Python Playwright. Read the header of the file for options. |

## Layout

| Path | Contents |
|---|---|
| `src/template.html` | Page markup. `build.mjs` replaces each `/*__NAME__*/` marker. |
| `src/style.css` | All styles. Color tokens are on `:root`, for light and dark. |
| `src/engine.js` | Time, tides, sun, moon, solunar. No DOM. Exposes the global `Engine`. |
| `src/ui/` | Everything on screen. `build.mjs` joins these files, in the order its `UI_FILES` list gives, inside one function, so they share one scope. `core.js` holds the helpers, the state and the spot forecast. `day.js`, `tables.js`, `map.js` and `week.js` each draw one part. `app.js` holds the state changes and the wiring, and runs last. |
| `data/` | Auckland harmonic constants and tidal levels, the spots, the coastline. |
| `test/` | Node tests. `test/engine.mjs` loads the engine as the page does. |
| `tools/` | The scripts that produced the data, and the screenshot tool. |
| `docs/ipad-plan.md` | The agreed next step. |
| `.github/workflows/pages.yml` | Tests, builds and publishes `dist/` to GitHub Pages on every push to `main`. Tests and builds each pull request without publishing. |
| `.claude/approvals.yml` | The Claude Approvals policy. A change merges once Claude's Code Review passes. It is in observe mode. |

The page scripts are plain globals, loaded in this order: `Astronomy`, `Neaps`, `DATA`, `Engine`, then the UI. The build inlines `astronomy-engine` and a bundle of `@neaps/tide-predictor`.

## Rules

1. The product stays static, with no server. A service worker file may join `index.html`; see the plan.
2. Show every time in Pacific/Auckland time, whatever the device time zone. Use `Engine.parts`, `Engine.midnight`, `Engine.addDays` and `Engine.fmtTime`. Do not use the local getters of `Date`.
3. Never invent data. A forecast that is missing shows as missing.
4. Use US English spelling. Proper names keep theirs: "Waitematā Harbour".
5. Write interface text plainly: name the actor, make one claim per sentence, use no idiom.
6. The map uses no third-party component. It is SVG drawn from `data/coast.json`.
7. Check both themes after any layout change, at the iPad sizes in `tools/screenshot.py` and on a 390 px wide screen.
8. Open a pull request when a task is complete.

## Design

The look follows Braun products of the 1960s. Tokens are in `src/style.css`.

- Chassis `#F5F4F0` on a workbench `#E7E6E1`. Hairlines `#D4D2CA`. Ink `#1A1A18`.
- Text is Helvetica Neue, then Inter. Every number is JetBrains Mono with tabular figures.
- Each section heading carries an index number and a hairline above it.
- Color carries meaning and nothing else:

| Color | Meaning |
|---|---|
| Green `#2E8B57` | Active or selected. Windows inside the owner's limits. Solunar periods and the solunar line. |
| Amber `#E59400` | Needles on gauges, and the map probe. |
| Vermilion `#D9381E` | Alerts. On the Week screen, wind over the owner's limit is an alert. Wind from 20 knots in the day display and the tables. "Now" in the day display and on the Week screen. |
| Yellow `#DCA400`, disc `#F5C400` | The sun, in the day display. |
| Slate `#525866` | The moon, in the day display. |
| Blue `#2A6FA8` | The tide, in the day display. |

- The day display has a light ground by day, `#FBFAF7`, and a darker one at night, `#D8D6CE`. It is never black.
- A dark theme serves devices in dark mode. Change both themes together.
- Motion is short and mechanical: 160 to 240 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`.

## Data and accuracy

**Tides.** The page predicts Auckland from 43 harmonic constants (TICON-4, by way of the Neaps database) and adds the LINZ mean sea level, 1.94 m above chart datum. Five constants were left out because they made the fit to LINZ worse: M3, T3, R3, 3L2, 3N2. Every other spot applies the LINZ Secondary Ports Table to the Auckland prediction: a time difference for high water, one for low water, a range ratio and a mean sea level. Those values are in `data/spots.json`.

**Measured fit.** Against 146 highs and lows in the LINZ 2028 Auckland table: median time difference 2.3 min, nine in ten within 6.1 min, largest 9 min, heights within 0.10 m. `npm test` guards these figures. The secondary spots have not been checked against LINZ daily tables.

**Solunar.** A major period is two hours centered on the moon's upper or lower transit. A minor period is one hour centered on moonrise or moonset. The day rating, the activity index and the fish levels are rules of thumb defined in `engine.js`. They are not measurements.

**Weather.** The browser fetches Open-Meteo. Each spot gets a forecast and marine data. The map gets a grid of 83 water points: wind from the forecast service, current from the marine service. The page keeps the last loaded data in `localStorage` under keys that start with `gulf-almanac-`. A load runs when the page opens, once a minute if the data is over an hour old, when the page returns to the foreground, and when the owner presses Sync. After a failed load, automatic loads wait 10 minutes. Sync, a return to the page and a restored connection try at once.

**Windows.** `Engine.windows` finds them. A window is a stretch between first light and last light (civil dawn and dusk) when the sustained wind stays at or under the owner's limit for the owner's minimum time or longer. Each hourly forecast value stands for the half hour either side of its time. The wind is compared in whole knots, as the page shows it. A missing hour ends a window. Gusts and chop do not close a window. The owner sets the two limits under Limits, and the iPad stores them; the defaults are 15 kn and 3 h. `Engine.rankWindows` puts the longest first. `test/windows.test.mjs` covers these rules.

**Week.** The Week screen shows today and the next six days. Every row shares one range of local hours: from the hour before the earliest first light to the hour after the latest last light. Wind over the limit and hours with no forecast are drawn only between first light and last light. A best-window card lists the major period that overlaps the window most, and the high and low waters inside it.

**Flow.** The current model has cells of about 8 km. It does not resolve the channels. `loadFlowField` in `src/ui/map.js` is the only code that knows the source, so a better source can replace it there.

**Map view.** The map's view is a center and a zoom, `view` in `src/ui/map.js`. At zoom 1 the whole map fits its frame, and the viewBox takes the frame's shape. Zoom stops at 6, because the coastline and the current model hold no finer detail. Pins, labels, arrows and the probe keep one size on screen at any zoom. Arrows sit 22 map units apart, or 11 once 22 units would be 70 px or more on screen. The presets are Whole Gulf, Inner Gulf, and 10 nautical miles around the selected spot.

**Chop.** The page measures fetch on a raster of the coastline, takes wave height and period from the JONSWAP growth curves, then applies a wave and current factor. The rating steps are 0.15, 0.3, 0.5 and 0.8 m. The owner has not yet confirmed these against the boat.

## Testing notes

- The page needs Open-Meteo. Where it is out of reach, mock it. `tools/screenshot.py` shows how.
- The owner confirmed the live forecast, wind and flow working in a browser on 26 November 2026.
- The published Claude artifact of this page cannot load weather. The page on GitHub Pages replaces it.

## Next

`docs/ipad-plan.md` holds the agreed plan for the iPad: three screens (Week, Day, Now), saved marks, zoom, stored data and a Sync button. Its build order table records which step is done.
