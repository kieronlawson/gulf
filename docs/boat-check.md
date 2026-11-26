# Boat check

Step 11 of the build order in `docs/ipad-plan.md`. The owner does this check on the boat. It covers what a browser on a desk cannot test: reading the screen in sunlight, touching it on a moving boat, the iPad's position, and the chop steps against the boat.

Write notes in the tables below, or on paper, and pass them on. The changes that follow from them are listed at the end.

## Before the trip

1. Open https://kieronlawson.github.io/gulf/ in Safari on the iPad. Select Share, then Add to Home Screen. From then on, open the page from the Home Screen icon. Opened that way, the iPad keeps your marks and home, and it keeps a copy of the page for use without a connection.
2. On the Day screen, tap the map at the dry stack, then select Set home in the reading under the map.
3. Under Limits, set your wind limit and minimum time, your boat speed, and how long before last light you want to be home.
4. Open the Now screen once while you have a connection. When the iPad asks, allow it to use your location.
5. Turn on Airplane Mode, open the page from the Home Screen, and check that it opens and shows the forecast with its age. Then turn Airplane Mode off.

An iPad without a cellular connection has no GPS. On the water it gets no position, and the Now screen says so and measures from the selected spot instead.

## On the water

| Check | How | What to note |
|---|---|---|
| Sunlight | Read the Now screen at arm's length in direct sun, at full brightness. Try the light theme, and the dark theme at dusk. | Any text you cannot read. Likely candidates: the small gray lines under each card, the hints under the lists, and the chop shading on the map. |
| Touch | On a moving boat, use the Now, +1 h, +2 h and +3 h buttons, the map's view buttons, plus and minus, a row in Where to go, and a tide spot lamp on the map. | Any tap that missed or hit the wrong thing, and with wet or cold hands. |
| Position | Compare "You" on the map with the chartplotter or a phone's map. Read the line under "Here, now". | How far apart the two positions are, and the accuracy the page states. |
| Chop steps | At three or more places, compare the Chop card with what the boat feels. Use the table below. | One row for each place. |
| Flow | Near a channel, compare the flow arrows with what the boat or a mooring buoy shows. | Places where the arrows point the wrong way or show no flow. The current model has cells of about 8 km, so channels are expected to differ. |
| Run home | Note when you left for home and when you reached it. | Your leave time, the page's leave-by time, the time you reached home, and last light. |
| Without a connection | Out of mobile coverage, close the page and open it again from the Home Screen. | Whether it opens, and the forecast age it shows. |

## Chop steps

The page rates chop by estimated wave height:

| Rating | From |
|---|---|
| Smooth | under 0.15 m |
| Light | 0.15 m |
| Moderate | 0.3 m |
| Rough | 0.5 m |
| Very rough | 0.8 m |

For each place, note what the page said and what the boat felt.

| Time | Place: a mark number, or a description | Page: chop and height | Page: wind | Boat: smooth, light, moderate, rough or very rough | Notes |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |

## What changes afterwards

- **Chop steps.** If the page's rating is often one step off, the heights in the table above change. They are set in the `chop` function in `src/ui/map.js`.
- **Sunlight.** Text that cannot be read gets darker ink, a larger size or a heavier weight. The colors are tokens in `src/style.css`, so a change applies across the page in both themes.
- **Touch.** A control that is missed gets a larger target. Buttons are 44 px tall today, and a lamp's tap circle is 34 px across.
- **Run home.** If the straight-line run proves too short, the margin under Limits is the first thing to change. A run that routes around land would need a better coastline; the plan lists that as open.
