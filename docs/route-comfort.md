# Brief: comfort from A to B

Mock: https://claude.ai/artifact/LZJbcXCBTyxqeHZdmehFqo#artboard-Route

## Why

The owner wants to know how rough a run will be before making it: from home to a mark, or from a mark home, leaving at a chosen time. Wind speed alone does not answer that. The same wind is a head sea on one course and a following sea on another, and the wind at the far end is the wind an hour after leaving.

## What to build

1. A path over water from A to B.
2. A comfort level and a comfortable speed for each short leg of the path, at the time the boat reaches that leg.
3. A route view on the Day screen, with the day display collapsed so the map can grow.
4. The same path and scores in Run home on the Now screen.

Build steps 1 to 4 first. Ferry lanes, section 5, are a second step.

## 1. The path

- Search the existing water raster (`MASK` in `src/ui/map.js`) with A*, eight neighbors.
- Keep the path about 200 m off the land: treat water cells next to land as closed.
- Use only water joined to the open Gulf. An end that sits on land or in closed water starts from the nearest open cell. Home at a marina is the usual case.
- Then straighten the path: keep a point only where a straight line to a later point would touch closed cells.
- The path has no depths. Label it on the screen: "A line for scoring. Not a route to steer."
- If the search finds no path, say so. Do not fall back to a straight line.
- Keep the last path for a pair of ends, so a new leave time does not search again.

## 2. Legs and time

- Cut the path into legs no longer than 0.3 nautical miles.
- Start the clock at the leave time: the pinned time on Day, now on Now.
- For each leg in order: read wind and chop at the leg's middle for the clock time (`condAt`), score the leg, add the leg's time at its comfortable speed to the clock.
- A leg the forecast does not cover gets no score. Draw it gray, and say in the totals that the score is incomplete.

## 3. Scoring rules

These are a first guess. Keep every number below in one place in `engine.js`, because the owner's own trip ratings will correct them later.

Inputs for a leg:

| Name | Meaning |
|---|---|
| `h` | Chop height in meters, from `chop()`. It already includes the flow factor. |
| `a` | The angle between the boat's course and the direction the wind comes from, 0 to 180 degrees. 0 is a head sea. 180 is a following sea. |
| `v` | Boat speed on the leg, knots. |
| `cruise` | The owner's boat speed from Limits. |

Three terms, each in meters:

```
slam   = h × (1 + cos a) / 2 × (v / cruise)²
roll   = 0.6 × h × sin² a
follow = 0.25 × h
score  = the largest of the three
```

- `slam` is the hull meeting waves. It is largest head-on and grows with the square of speed.
- `roll` is waves on the beam. Speed does not change it.
- `follow` is a floor, so a large following sea never scores as flat water.

The rule uses wave height and not wave period. In wind chop the two rise together, and `chop()` has already steepened the waves where the flow runs against them.

**Level.** Score the leg at `v = cruise`:

| Score, m | Level |
|---|---|
| under 0.15 | Easy |
| 0.15 to under 0.30 | Fair |
| 0.30 to under 0.45 | Bumpy |
| 0.45 to under 0.65 | Rough |
| 0.65 and over | Very rough |

**Cause.** With `h` under 0.15, the cause is "sheltered". Otherwise it is "head sea" for `a` up to 50, "beam sea" from 50 to 130, and "following sea" above 130.

**Comfortable speed.** The fastest speed, up to `cruise`, that keeps `slam` at or under 0.30:

```
v = cruise × √( 0.30 / (h × (1 + cos a) / 2) )     capped at cruise, never under 8 kn
```

The level shows the leg at cruising speed. The comfortable speed shows what it takes to make the leg Fair. The trip time uses the comfortable speeds.

Without a boat speed in Limits, the page asks for one, as Run home does now. It does not guess.

Worked examples, for the tests, with `cruise` 22:

| `h` | `a` | Score at cruise | Level | Cause | Comfortable speed |
|---|---|---|---|---|---|
| 0.6 | 0 | 0.60 | Rough | head sea | 15.6 kn |
| 0.6 | 90 | 0.36 | Bumpy | beam sea | 22 kn |
| 0.6 | 180 | 0.15 | Fair | following sea | 22 kn |
| 0.2 | 0 | 0.20 | Fair | head sea | 22 kn |
| 1.0 | 0 | 1.00 | Very rough | head sea | 12.0 kn |
| 2.5 | 0 | 2.50 | Very rough | head sea | 8 kn, the floor |
| 0.1 | 0 | 0.10 | Easy | sheltered | 22 kn |

## 4. The screens

Follow the mock.

**Opening a route.** Each row of "Where to go" and the probe reading get a "Route" button. A is home on Day and the iPad's position on Now. B is the place chosen. A "Swap" button exchanges them. "Close route" ends it.

**Day display.** Opening a route collapses the day display to one row: the selected day drawn as a Week row, with the pinned time. "Show day display" restores it. The map takes the freed width.

**Map.**
- Draw the path as a dark line with the level color on top, leg by leg.
- Mark A and B.
- Add a view button "Route" that fits the map to the path (`fitBox`).

**Strip under the map**, from A to B by distance:
- The level color for each leg.
- The cause, written under each stretch wider than 70 px.
- The comfortable speed as a line, with its value at each end.
- A tick every 2 nautical miles.

**Route panel.** A, B, Swap, Close route. Then distance, trip time at comfortable speeds with the time at cruising speed beside it, and the worst stretch. Then the stretches in order: level, cause and height, length, comfortable speed. Join neighboring legs of one level. Leave out stretches under 0.5 nautical miles.

**Time bar.** While a route is open its label reads "Leave time". A new time scores the route again.

**Run home, on Now.** Use the path from the position to home, leaving now. Show its distance and its trip time at comfortable speeds. The leave-by rule keeps its form and uses that trip time in place of the straight-line run. Remove the notes about the straight line.

**Level colors.** Easy `#2E8B57`, Fair `#9DB23F`, Bumpy `#D8B31E`, Rough `#E59400`, Very rough `#D9381E`. Use the dark-theme values of the Week wind ramp for the dark theme. Always write the level's name beside its color.

## 5. Ferry lanes, second step

- Auckland Transport publishes its routes as open data (GTFS, CC BY 4.0), with a path for each route.
- Add a script in `tools/` that keeps the ferry paths inside the map and writes `data/ferries.json`.
- Mark each place where the path crosses a ferry path: a tick on the strip with the route's name, and a count in the route panel.
- No timetable and no wash height in this step.

## Tests and checks

- Put the scoring, the comfortable speed and the stretch joining in `engine.js`. Test them against the worked examples.
- Test the path search on a small made-up raster: a path around an island, an end on land, and two ends with no water between them.
- Test the clock: with a wind that rises during the run, a later leg must be scored with the later wind.
- Check Day and Now, both themes, an iPad in landscape and a 390 px wide screen. The Day screen must not scroll with a route open.
- Check a route with part of its time past the end of the forecast.

## Then update the docs

- `CLAUDE.md`: the route, the scoring rules and where their numbers are kept.
- `docs/ipad-plan.md`: Run home no longer uses a straight line.
- `NOTICE.md`: Auckland Transport, once ferry lanes are in.

## Left out on purpose

| Item | Reason |
|---|---|
| Comfort at anchor and adrift | The next brief. |
| Ferry timetables and wash height | Section 5 marks the lanes only. |
| Other boats | Nothing forecasts them. |
| Depths | The data is not licensed yet. |
| Swell | The map's forecast grid carries wind and current only. |
| The owner's trip ratings | They come after this works, and they will tune the numbers in section 3. |

## Build order

Each step is one pull request, merged before the next starts.

| Step | Work | State |
|---|---|---|
| 1 | The arithmetic, in `engine.js`: the path search, the legs, the clock, the scoring rules, the comfortable speed and the stretches. Their tests. | Done. |
| 2 | The route on the Day screen: the Route buttons, the path on the map with A and B, the Route view, the collapsed day display, the route panel and the time bar's Leave time. | Done. |
| 3 | The strip under the map. | Done. |
| 4 | The Now screen: a route from the iPad's position, and Run home on the path. | Done. |
| 5 | Ferry lanes. | Done. `tools/ferries.py` writes `data/ferries.json`, 15 lanes in 13 KB. |

## Decisions made in the build

- **Narrow passages.** A water cell is closed when any of its eight neighbors is land or water the map does not join to the Gulf. A cell is 185 m across, so a passage needs three cells of water across, about 0.3 nautical miles, to stay open. On the map's coastline the Gulf stays one body of open water, and only a few narrow inlets are cut off. Only open water joined to the Gulf counts, so an end in such an inlet, or on land beside one, starts from the Gulf's nearest open cell, and the route panel says how far it moved. This came from the review of step 1: before it, such an end found no path. The page's search therefore always finds a path; the engine still reports no path for a raster without a seed, and the panel still has words for that case.
- **Corners.** A diagonal step needs both cells beside it open, and a straightened line that passes exactly through a corner needs the same. A path therefore never squeezes between two closed cells.
- **Moved ends.** `Engine.findPath` reports how far each end moved to reach open water, so the route panel can say so.
- **Legs without a forecast.** The clock crosses them at cruising speed, because the page has nothing to slow down for. The trip time is then a lower bound, and the totals say the score is incomplete.
- **A stretch's values.** Its cause is the one that covers most of its length. Its height is the highest chop on it. Its speed is its length over its time at comfortable speeds, so the stretches' times add up to the trip time.
- **Worst stretch.** The stretch with the highest level, and of two at one level, the one with the higher score. A stretch shorter than 0.5 nautical miles can be the worst, though the list leaves it out.
- **A slow boat.** The comfortable speed never drops under 8 kn, or under the cruising speed when that is under 8 kn.
- **A without home.** On the Day screen, A is the starting point of Where to go: home, or the selected tide spot until home is set. The brief names home; the selected spot covers the time before the owner sets it.
- **Fixed ends.** A route keeps the positions its ends had when it opened. Moving home or a mark later does not move an open route.
- **A and B on the map.** They mark the ends of the path, where the scoring starts and stops. They sit over the saved places, because B is usually a mark, and they take no taps, so the mark under B can still be selected.
- **Moved ends in the panel.** When an end moved 0.2 nautical miles or more to reach open water, the panel says how far.
- **The collapsed day display.** It keeps the date buttons, so the owner can leave on another day. Its reading keeps the time, the tide and the wind. Its Week row spans the time bar's hours, and a tap or click on it sets the leave time, as on the Week screen. With the day display shown again, the route stays open: the path stays on the map, the bar still reads Leave time, and the button reads Show route.
- **The map's buttons.** With a route open in the wide layout, the map's buttons sit in rows, as in the mock: views along the top, layers and zoom along the bottom. The Route view keeps the path 60 px clear of the top and bottom of the map, where those rows sit. The Route view takes the place of the view around the starting point while a route is open.
- **The probe reading.** A saved place's reading now has four buttons. Below the wide map they fit beside the name. Elsewhere they take a line of their own, so the name keeps its room.
- **Closing a route.** The map returns to the view it had before the route opened, unless the owner moved the map since.
- **No boat speed.** The page draws the path and gives its distance. It asks for a boat speed under Limits before it scores, as Run home does.
- **Suggestions.** While a route is open, the suggestions leave the map and the list, and the reach ring goes with them. Their letters, A to C, would read as the route's A and B. A route to a suggestion names it "Calmest water", with the nearest tide spot when there is one.
- **The leave time on the Day screen.** A route leaves at a time on the day shown: the pinned time, or now on today. Opening a route on another day with nothing pinned, or moving to another day, pins the start of the bar. With a route open, Now returns to today and leaves now. The bar's Leave time therefore always names the time the route was scored for. This rule came from the review of step 2.
- **The strip's place.** While a route is open, the strip takes the place of Where to go under the map. A tap on the map still opens a reading there, and closing the reading brings the strip back. In the wide route layout the box under the map is 150 px tall, not 200 px, so the map gains the difference.
- **The strip's drawing.**
  - The level bar has one rectangle per stretch.
  - A cause label too long for its stretch drops its height and keeps the cause.
  - The speed line runs from 8 kn, or the cruising speed when that is lower, at its foot to the cruising speed at its top. It passes through each leg's middle, and it has a gap where a leg has no score.
  - The axis labels every 2 nautical miles when there is room, and every 4, 10, 20 or 50 when there is not.
  - The heading gives the leave day when it is not today.
- **A route on each screen.** The Day and Now screens each keep their own route. A route opened on one does not show on the other.
- **A on the Now screen.** A follows the iPad's position, so the route redraws as the boat moves: on a move of a tenth of a mile or more, and once a minute. Without a position, A is the selected spot, as for the rest of the Now screen. The route leaves now, whatever time the Now map shows.
- **The Now screen's layout.** The route panel and the strip take the place of Where to go, whose title reads "Route from here" and gains a Close route button. The panel comes first, because that box is short.
- **Run home.** `Engine.leaveBy` now takes the trip time in place of a distance and a speed. Run home gives the path's distance, the trip time at comfortable speeds, and the worst stretch leaving now, which replaces the chop on the straight line. The map draws the path home dotted. Without a path, Run home says so and gives no leave-by time.
- **Path cache.** Paths are kept by the raster cells of their ends, so a move of the iPad within one cell, 185 m, does not search again.
- **The strip's own reasons.** On the Day screen, the strip says why it draws no path, in the panel's words, and asks for a boat speed when none is set. With the day display shown again, the panel is hidden, so the strip also says why legs are gray, with Load now after a failed load. This came from the review of step 3.
- **Water off the path in Run home.** The path keeps about 200 m from land, so a home at a marina, or a position beside one, sits off it. Run home counts that water at the owner's boat speed, in the distance and the trip time, and says so when an end is 0.2 nautical miles or more from open water. This came from the review of step 4.
- **The leave-by time and the sea then.** The brief scores the trip home leaving now. The sea at the leave-by time can differ, so Run home scores the trip again leaving at the leave-by time, up to three times, and keeps the earliest leave-by time. When the trip then differs from the trip now by a minute or more, a note gives it. The Trip now row and the worst stretch still describe leaving now. This came from the review of step 4.
- **No map raster.** When the browser cannot build the water raster, Run home says the map has no coastline to search, and gives no leave-by time. It does not fall back to a straight line.
- **The Now screen's title after Swap.** The title follows the live end: "Route from here", or "Route to here" after Swap.
- **Ferry lane names.** The feed names its ferry routes by code, such as MTIA. `tools/ferries.py` names each lane after the two ends of its route's most common trip, as "Downtown – Waiheke", and routes with the same name share one lane. A round trip takes its headsign, "Harbour Cruise". The paths are simplified to about 40 m.
- **Counting crossings.** `Engine.laneCrossings` counts a lane once when it crosses the path twice within 0.3 nautical miles, because a lane often has a path for each direction, side by side. A lane that runs beside the path can still be crossed more than once, so the panel gives the number of crossings and the number of lanes, and its note names each lane once, in the order first crossed. From Westhaven to the east of Waiheke, the path crosses 14 lanes 26 times.
- **Labels on the strip.** Each crossing gets a mark over the bar. Marks less than 40 px apart share one label: the lane's name for one crossing, or the number of crossings. A label that would reach the next group's first mark is left out, so in the crowded inner harbor the marks show without labels. The panel names every lane.
