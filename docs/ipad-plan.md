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
8. **Zoom** uses the current SVG map: preset views (Whole Gulf, Inner Gulf, Around me), pinch, and plus and minus buttons.
9. **Stored data.** The page shows the last loaded forecast from the device, with its age.
10. **Loading.** The page loads on open, on return to the foreground, on a timer while open, and from a Sync button. Safari on iPad cannot load data while the page is closed.
11. **Tables** for tides, moon, weather and the days ahead move behind a Tables button.
12. **Hosting.** The owner will host the page at an https address. Position and a service worker both need one.

## Assumed, not confirmed

- The 15 knot limit is sustained wind, not gusts.
- Chop is shown but does not close a window.
- "Within reach" for a suggestion has no agreed distance. The Now wireframe draws a 10 nautical mile ring.

## Open

- Where the page is hosted.
- A service worker, so the page opens with no reception. It needs a second file beside `index.html`.
- A full-detail coastline for zoom. The current one is simplified to about 110 m. See `tools/coast.py`.
- Better flow data for the channels. Options found so far:
  - Tidal stream tables printed on nautical charts. Not yet checked for the Gulf.
  - MetService Point Forecast API: 5 km model, needs a key, browser access unconfirmed.
  - NIWA: its tide model computes currents, but no public download was found.
- Great Barrier and Port Jackson spots. LINZ refers them to Marsden Point, not Auckland.
- The "run home" estimate. The map cannot route around land.
- Touch targets of at least 44 px, and type large enough to read in sunlight.
