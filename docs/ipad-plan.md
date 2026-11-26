# iPad plan

Target: an iPad in landscape, with no scrolling, used at home to plan a trip and on the boat during one.

Wireframes: https://claude.ai/artifact/LZJbcXCBTyxqeHZdmehFqo

## The owner's jobs

| Situation | Questions |
|---|---|
| Planning, days ahead | Which day and which hours? Where on that day? When to launch, and when to be back? |
| On the water | What is it doing here now? What changes in the next few hours? Where is flatter water nearby? When to head home? |

## Decided

1. **Three screens**, switched by three buttons at the top: Week, Day, Now. The spot, the day and the pinned time carry across all three.
2. **Week** finds a window. Seven day rows run from first light to last light. Each row shows the hours inside the limits, the solunar periods and the tide. A ranked list of the best windows sits beside the rows. Tapping a window opens Day.
3. **Day** plans the trip. The map and the day display share the screen. A time bar along the bottom moves both. A list ranks places at the pinned time.
4. **Now** is for the boat. It shows tide, bite, wind and chop at the iPad's position, the next six hours there, places to go, and a leave-by time for the run home. The map can step ahead one, two or three hours.
5. **Wind, flow and chop** appear on the map in Day and in Now. Week shows only the windows.
6. **A window** is wind up to 15 knots, for 3 hours or longer, between first light and last light.
7. **Where to go** is one list that mixes the owner's saved marks with suggested water, lowest chop first. A mark is a named point the owner places on the map. A suggestion means calm water within reach. It makes no claim about fish.
8. **Zoom** uses the current SVG map: preset views (Whole Gulf, Inner Gulf, Around home in Day, Around me in Now), pinch, and plus and minus buttons.
9. **Stored data.** The page shows the last loaded forecast from the device, with its age.
10. **Loading.** The page loads on open, on return to the foreground, on a timer while open, and from a Sync button. Safari on iPad cannot load data while the page is closed.
11. **Tables** for tides, moon, weather and the days ahead move behind a Tables button.
12. **Hosting.** GitHub Pages serves the page. `.github/workflows/pages.yml` runs the tests, builds the page and publishes `dist/` on every push to `main`. A pull request runs the tests and the build without publishing. Position and a service worker both need the https address that Pages gives. The repository and the site are both public. Saved marks and home stay on the device and never reach the site.
13. **Screen sizes.** The page serves every iPad sold since late 2021, in landscape. The smallest are the iPad (9th generation) at 1080 × 810 points and the iPad mini at 1133 × 744. The largest is the 13-inch iPad Pro at 1376 × 1032. The layout fits the smallest sizes with no scrolling, after Safari's bars take their share of the height.
14. **Narrow screens.** On a phone, an iPad in portrait, or a narrow Split View window, the parts of each screen stack and the page scrolls.
15. **Home** is where the boat goes into and comes out of the water: a ramp, a marina or a dry stack. The owner sets it on the map, and it starts unset. Day measures distance from home, the run home ends there, and a map preset centers on it. The wireframes call it the ramp.
16. **Boat speed and margin.** The owner sets a cruising speed and a margin before last light under Limits. The leave-by time shows as missing until both are set.
17. **Wind over the limit** shows in vermilion on Week, as an alert. Step 3 updates the color table in CLAUDE.md to match.
18. **Touch targets** are at least 44 px, from step 1 on.

## Assumed, not confirmed

- The 15 knot limit is sustained wind, not gusts. The page applies it that way.
- Chop is shown but does not close a window. The page applies it that way.
- "Within reach" for a suggestion has no agreed distance. The Now wireframe draws a 10 nautical mile ring.

## Open

- A full-detail coastline for zoom. The current one is simplified to about 110 m. See `tools/coast.py`.
- Better flow data for the channels. Options found so far:
  - Tidal stream tables printed on nautical charts. Not yet checked for the Gulf.
  - MetService Point Forecast API: 5 km model, needs a key, browser access unconfirmed.
  - NIWA: its tide model computes currents, but no public download was found.
- Great Barrier and Port Jackson spots. LINZ refers them to Marsden Point, not Auckland.
- The "run home" estimate. The map cannot route around land.
- Type and contrast that read in sunlight. Step 11 checks them on the boat.

## Storage on the iPad

Safari deletes a site's stored data after seven days of Safari use in which the owner did not use the site. A page opened from the Home Screen keeps its own count of days, so its data stays. Saved marks and home live in that storage, so the owner should open the page from the Home Screen.

## Build order

Each step ends with a working page that the owner can try on the iPad. Logic that several screens share comes before the screens that use it. The service worker comes last, because during development it would show its stored copy of the page instead of the newest build.

| Step | Work | State |
|---|---|---|
| 0 | Publish the current page to GitHub Pages. | Done. The page is at https://kieronlawson.github.io/gulf/. |
| 1 | Screen frame: Week, Day and Now buttons, spot, Tables, Sync and forecast age in the top bar. Tables behind a button. Load on return to the foreground, and try again 10 minutes after a failed load. Split `src/ui.js` into shared code and one file per part. Screenshot tool gets iPad sizes, a screen choice and a mocked position. | Done. Until step 5, the Day screen scrolls inside the frame. Now says which step brings it. |
| 2 | Windows in `engine.js`, with Node tests. Limits button in the top bar, and its editor. | Done. Until step 3 builds Week, the Day screen lists the day's windows. |
| 3 | Week screen. | Done. A tap on a window or on a best-window card opens Day with the window's start pinned. |
| 4 | Map zoom: presets, pinch, plus and minus. | Done. Until step 6 adds home, the third preset centers on the selected spot. Zoom stops at 6, where the coastline still reads. |
| 5 | Day screen: map beside the day display, time bar with −30 min, +30 min and Play. | Done. The wide layout needs 700 px of height. An iPad mini fits from the Home Screen; in Safari its page scrolls. |
| 6 | Saved marks and home: place, name, move, delete. | Done. A tap on the map places the probe, and the probe reading saves it as a mark or as home. |
| 7 | Where to go: marks and suggested water, lowest chop first, for Day and Now. | Done for Day. The list sits under the map, where there is room. Now uses it in step 8. |
| 8 | Now screen, with the iPad's position. | Done. The map moves between Day and Now, and each keeps its own view. Without a position, Now measures from the selected spot. Run home shows the distance, sunset and last light; step 9 adds the leave-by time. |
| 9 | Run home and leave-by. | |
| 10 | Service worker, stored fonts, and Home Screen tags. | |
| 11 | Check on the boat: sunlight, touch size, chop steps. | |
