# Gulf Almanac

A personal fishing almanac for the Hauraki Gulf. The product is one static page: tides, sun, moon, solunar periods, weather, and a map of wind, flow and chop.

## Commands

| Command | Result |
|---|---|
| `npm install` | Installs the build dependencies. Use the Node version in `.nvmrc`; the publish workflow uses it too. |
| `npm run build` | Writes `dist/index.html`, one self-contained file. |
| `npm test` | Checks tide predictions against the LINZ 2028 table for Auckland, one day of sun, moon and solunar values against recorded results, the rules that find windows, and the leave-by time. |
| `python3 tools/screenshot.py` | Renders the built page with a mocked forecast, at an iPad size or a phone size, on any of the three screens. Needs Python Playwright. Read the header of the file for options. |

## Layout

| Path | Contents |
|---|---|
| `src/template.html` | Page markup. `build.mjs` replaces each `/*__NAME__*/` marker. |
| `src/style.css` | All styles. Color tokens are on `:root`, for light and dark. |
| `src/engine.js` | Time, tides, sun, moon, solunar. No DOM. Exposes the global `Engine`. |
| `src/ui/` | Everything on screen. `build.mjs` joins these files, in the order its `UI_FILES` list gives, inside one function, so they share one scope. `core.js` holds the helpers, the state and the spot forecast. `day.js`, `tables.js`, `map.js` and `week.js` each draw one part. `marks.js` holds the saved marks and home, and `wheretogo.js` the list of places to go. `now.js` holds the Now screen and the iPad's position. `app.js` holds the state changes and the wiring, and runs last. |
| `data/` | Auckland harmonic constants and tidal levels, the spots, the coastline. |
| `test/` | Node tests. `test/engine.mjs` loads the engine as the page does. |
| `tools/` | The scripts that produced the data, and the screenshot tool. |
| `docs/ipad-plan.md` | The agreed next step. |
| `.github/workflows/pages.yml` | Tests, builds and publishes `dist/` to GitHub Pages on every push to `main`. Tests and builds each pull request without publishing. |
| `.claude/approvals.yml` | The Claude Approvals policy. A change merges once Claude's Code Review passes, and Claude then approves it. The policy is enforced. |

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
| Vermilion `#D9381E` | Alerts. On the Week and Now screens, wind over the owner's limit is an alert. Wind from 20 knots in the day display and the tables. "Now" in the day display, on the Week screen and in the Now screen's next six hours. |
| Yellow `#DCA400`, disc `#F5C400` | The sun, in the day display. |
| Slate `#525866` | The moon, in the day display. |
| Blue `#2A6FA8` | The tide, in the day display and in the Now screen's next six hours. |

- The day display has a light ground by day, `#FBFAF7`, and a darker one at night, `#D8D6CE`. It is never black.
- A dark theme serves devices in dark mode. Change both themes together.
- Motion is short and mechanical: 160 to 240 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`.

## Data and accuracy

**Tides.** The page predicts Auckland from 43 harmonic constants (TICON-4, by way of the Neaps database) and adds the LINZ mean sea level, 1.94 m above chart datum. Five constants were left out because they made the fit to LINZ worse: M3, T3, R3, 3L2, 3N2. Every other spot applies the LINZ Secondary Ports Table to the Auckland prediction: a time difference for high water, one for low water, a range ratio and a mean sea level. Those values are in `data/spots.json`.

**Measured fit.** Against 146 highs and lows in the LINZ 2028 Auckland table: median time difference 2.3 min, nine in ten within 6.1 min, largest 9 min, heights within 0.10 m. `npm test` guards these figures. The secondary spots have not been checked against LINZ daily tables.

**Solunar.** A major period is two hours centered on the moon's upper or lower transit. A minor period is one hour centered on moonrise or moonset. The day rating, the activity index and the fish levels are rules of thumb defined in `engine.js`. They are not measurements.

**Weather.** The browser fetches Open-Meteo. Each spot gets a forecast and marine data. The map gets a grid of 83 water points: wind from the forecast service, current from the marine service. The page keeps the last loaded data in `localStorage` under keys that start with `gulf-almanac-`. A load runs when the page opens, once a minute if the data is over an hour old, when the page returns to the foreground, and when the owner presses Sync. After a failed load, automatic loads wait 10 minutes. Sync, a return to the page and a restored connection try at once.

**Windows.** `Engine.windows` finds them. A window is a stretch between first light and last light (civil dawn and dusk) when the sustained wind stays at or under the owner's limit for the owner's minimum time or longer. Each hourly forecast value stands for the half hour either side of its time. The wind is compared in whole knots, as the page shows it. A missing hour ends a window. Gusts and chop do not close a window. The owner sets the two limits under Limits, and the iPad stores them in `localStorage` under `gulf-almanac-limits`, with the boat speed and margin for the run home; the defaults are 15 kn and 3 h. `Engine.rankWindows` puts the longest first. `test/windows.test.mjs` covers these rules.

**Week.** The Week screen shows today and the next six days. Every row shares one range of local hours: from the hour before the earliest first light to the hour after the latest last light. Wind over the limit and hours with no forecast are drawn only between first light and last light. A best-window card lists the major period that overlaps the window most, and the high and low waters inside it.

**Flow.** The current model has cells of about 8 km. It does not resolve the channels. `loadFlowField` in `src/ui/map.js` is the only code that knows the source, so a better source can replace it there.

**Screen layout.** The wide layout applies from 1000 px wide and 700 px tall: `isWide` in `src/ui/core.js` and the media query at the end of `src/style.css` use the same test. In it, the frame fills the window and the page does not scroll. Below 700 px of height, as on an iPad mini in Safari, the screens stack and the page scrolls. Day puts the map on the left, the day on the right and the time bar along the bottom, and the day display takes the height that is left. Now puts the map on the left and the rest on the right, where the list of places scrolls in its part. On narrow screens, Now stacks its parts with the map last.

**Saved places.** The owner saves the probe's point as a numbered mark or as home, from the probe reading under the map. The iPad stores them in `localStorage` under `gulf-almanac-marks` and `gulf-almanac-home`, as latitude and longitude. A deleted mark's number goes to the next new mark. A place may sit on land in the simplified coastline, as a marina often does; there the page gives a position and no wind, flow or chop estimate. Once home is set, the map's third preset centers on it.

**Where to go.** Under the map, a list ranks the owner's marks and up to three suggestions, lowest chop first, at the map's time. A suggestion is one of the calmest chop cells within 10 nautical miles of the starting point, at least 3 nautical miles from the other suggestions and 1 from any mark. It makes no claim about fish. On the Day screen the starting point is home, or the selected tide spot until home is set. On the Now screen it is the iPad's position. A dashed ring on the map shows the reach.

**Map view.** The map's view is a center and a zoom, `view` in `src/ui/map.js`. At zoom 1 the whole map fits its frame, and the viewBox takes the frame's shape. Zoom stops at 6, because the coastline and the current model hold no finer detail. Pins, labels, arrows and the probe keep one size on screen at any zoom. Arrows sit 22 map units apart, or 11 once 22 units would be 70 px or more on screen. The presets are Whole Gulf, Inner Gulf, and 10 nautical miles around the starting point of Where to go. The Day and Now screens share one map: `moveMap` in `src/ui/now.js` moves it to the screen that shows, and each screen keeps its own view.

**Now.** The Now screen asks the iPad for its position while the screen shows and the page is in the foreground. Without a position, or with one outside the map, the screen says so and measures from the selected spot. The tide and the solunar periods come from the nearest tide spot, which the Tide card names. The wind and chop come from the grid at the position. A position on land in the simplified coastline, as at a marina, uses the nearest water cell within 1.5 nautical miles, and the cards say how far away that cell is. The four cards show the present. The map shows now or up to three hours ahead, and the screen opens at now. The next six hours show one hourly slot each for wind and chop, with night, the solunar periods, the turns of the tide and last light behind them. Run home is described below.

**Run home.** `Engine.leaveBy` gives the leave-by time: last light, less the run at the owner's boat speed, less the owner's margin, rounded down to the minute. The run is the straight line from the Now screen's starting point to home, because the map cannot route around land; when that line crosses land, Run home says the real run is longer. The owner sets the speed and the margin under Limits. Both start unset, and until both are set, and home too, the page shows no leave-by time. Once the leave-by time has passed, it shows as an alert. Chop on the way is the roughest chop on the line at the leave-by time, or now once that has passed. `test/runhome.test.mjs` covers the arithmetic.

**Chop.** The page measures fetch on a raster of the coastline, takes wave height and period from the JONSWAP growth curves, then applies a wave and current factor. The rating steps are 0.15, 0.3, 0.5 and 0.8 m. The owner has not yet confirmed these against the boat.

## Testing notes

- The page needs Open-Meteo. Where it is out of reach, mock it. `tools/screenshot.py` shows how.
- The owner confirmed the live forecast, wind and flow working in a browser on 26 November 2026.
- The published Claude artifact of this page cannot load weather. The page on GitHub Pages replaces it.

## Next

`docs/ipad-plan.md` holds the agreed plan for the iPad: three screens (Week, Day, Now), saved marks, zoom, stored data and a Sync button. Its build order table records which step is done.
