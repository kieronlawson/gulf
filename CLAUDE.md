# Gulf Almanac

A personal fishing almanac for the Hauraki Gulf. The product is one static page: tides, sun, moon, solunar periods, weather, and a map of wind, flow and chop.

## Commands

| Command | Result |
|---|---|
| `npm install` | Installs the build dependencies. |
| `npm run build` | Writes `dist/index.html`, one self-contained file. |
| `npm test` | Checks tide predictions against the LINZ 2028 table for Auckland, and one day of sun, moon and solunar values against recorded results. |
| `python3 tools/screenshot.py` | Renders the built page with a mocked forecast. Needs Python Playwright. Read the header of the file for options. |

## Layout

| Path | Contents |
|---|---|
| `src/template.html` | Page markup. `build.mjs` replaces each `/*__NAME__*/` marker. |
| `src/style.css` | All styles. Color tokens are on `:root`, for light and dark. |
| `src/engine.js` | Time, tides, sun, moon, solunar. No DOM. Exposes the global `Engine`. |
| `src/ui.js` | Everything on screen, the forecast loaders, and the map overlay. |
| `data/` | Auckland harmonic constants and tidal levels, the spots, the coastline. |
| `test/` | Node tests. `test/engine.mjs` loads the engine as the page does. |
| `tools/` | The scripts that produced the data, and the screenshot tool. |
| `docs/ipad-plan.md` | The agreed next step. |
| `.github/workflows/pages.yml` | Tests, builds and publishes `dist/` to GitHub Pages on every push to `main`. |

The page scripts are plain globals, loaded in this order: `Astronomy`, `Neaps`, `DATA`, `Engine`, then the UI. The build inlines `astronomy-engine` and a bundle of `@neaps/tide-predictor`.

## Rules

1. The product stays static, with no server. A service worker file may join `index.html`; see the plan.
2. Show every time in Pacific/Auckland time, whatever the device time zone. Use `Engine.parts`, `Engine.midnight`, `Engine.addDays` and `Engine.fmtTime`. Do not use the local getters of `Date`.
3. Never invent data. A forecast that is missing shows as missing.
4. Use US English spelling. Proper names keep theirs: "Waitematā Harbour".
5. Write interface text plainly: name the actor, make one claim per sentence, use no idiom.
6. The map uses no third-party component. It is SVG drawn from `data/coast.json`.
7. Check both themes and a 390 px wide screen after any layout change.

## Design

The look follows Braun products of the 1960s. Tokens are in `src/style.css`.

- Chassis `#F5F4F0` on a workbench `#E7E6E1`. Hairlines `#D4D2CA`. Ink `#1A1A18`.
- Text is Helvetica Neue, then Inter. Every number is JetBrains Mono with tabular figures.
- Each section heading carries an index number and a hairline above it.
- Color carries meaning and nothing else:

| Color | Meaning |
|---|---|
| Green `#2E8B57` | Active or selected. Solunar periods and the solunar line. |
| Amber `#E59400` | Needles on gauges, and the map probe. |
| Vermilion `#D9381E` | Alerts, wind from 20 knots, and "now" in the day display. |
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

**Weather.** The browser fetches Open-Meteo. Each spot gets a forecast and marine data. The map gets a grid of 83 water points: wind from the forecast service, current from the marine service. The page keeps the last loaded data in `localStorage` under keys that start with `gulf-almanac-`.

**Flow.** The current model has cells of about 8 km. It does not resolve the channels. `loadFlowField` in `ui.js` is the only code that knows the source, so a better source can replace it there.

**Chop.** The page measures fetch on a raster of the coastline, takes wave height and period from the JONSWAP growth curves, then applies a wave and current factor. The rating steps are 0.15, 0.3, 0.5 and 0.8 m. The owner has not yet confirmed these against the boat.

## Testing notes

- The page needs Open-Meteo. Where it is out of reach, mock it. `tools/screenshot.py` shows how.
- The owner confirmed the live forecast, wind and flow working in a browser on 26 November 2026.
- The published Claude artifact of this page cannot load weather. The page on GitHub Pages replaces it.

## Next

`docs/ipad-plan.md` holds the agreed plan for the iPad: three screens (Week, Day, Now), saved marks, zoom, stored data and a Sync button. Its build order table records which step is done.
