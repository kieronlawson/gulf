# Brief: Week rows with hourly wind, and click to a time

Mock: https://claude.ai/artifact/LZJbcXCBTyxqeHZdmehFqo#artboard-WeekBars

## Why

The owner uses the Week screen to find good weather windows. The current row shows wind as yes or no: a red band over the limit, nothing under it. The owner cannot see how far over the limit the wind is, how close to it, or whether it is rising or falling at the edge of a window.

## What to build

1. Redraw each Week row so that hourly wind is its main content.
2. Make a click on a row open the Day screen pinned at the time under the pointer.

Files: `src/ui/week.js`, `src/ui/app.js` (the `#wkRows` click handler), `src/style.css` (the `.wk-*` rules), `CLAUDE.md`, tests.

Do not change the window rule, the hour range of the rows, the best-window cards, or the row height.

## 1. The row

Each lane keeps its hour range and its night ground. Draw these layers, listed from the top of the lane to the bottom. Positions are shares of the lane height.

| Layer | Position | Drawing |
|---|---|---|
| Major periods | 0 to 18% | A bracket, 1.6 px, `--c-sol`, across the period, with its ends turned down. Four rating lamps, 4 px, centered above the bracket. Lit lamps use `--c-sol`. This replaces the `.wk-major` box. Keep the rule that hides a period when less than 15 minutes of it shows. |
| Wind field | 23 to 73% | Bars, gust ticks, the limit line and the window wash. See below. |
| Window bracket | 73 to 79% | A bracket, 2.4 px, `--green`, from the window's start to its end, with its ends turned up. |
| Tide | 82 to 98% | The existing tide line, on its existing scale. |

The "now" line stays as it is.

### Wind field

- **Scale.** 0 at the bottom, twice the owner's wind limit at the top. The limit line then sits at mid height. Use the same scale in all seven rows. Cap taller values at the top.
- **Bars.** One bar for each forecast hour, centered on the hour, 46% of an hour wide, with 1.5 px corners. The height is the wind speed.
- **Color.** Color each bar by its speed as a share of the limit. Join the stops in the table below with straight lines in RGB.
- **Rounded speed.** Color the rounded speed, because the window rule compares the rounded speed with the limit. An hour inside a window must never be amber or red.
- **Night.** Draw bars before first light and after last light at 40% opacity.
- **Gusts.** One tick, 1.3 px, across the width of each bar, at the gust speed. Ink at 60% opacity, 30% at night.
- **Limit line.** A dotted hairline at the limit, across the lane. Put the limit's number at its left end, mono, 8.5 px.
- **Window wash.** Fill the wind field with `--win` from the window's start to its end.
- **No forecast.** Keep the existing grille for hours with no forecast, placed in the wind field.

| Speed as a share of the limit | At a 15 kn limit | Light theme | Dark theme, proposed |
|---|---|---|---|
| 0 to 0.60 | 0 to 9 kn | `#2E8B57` | `#37A56B` |
| 0.87 | 13 kn | `#9DB23F` | `#A9BE4F` |
| 1.00 | 15 kn | `#D8B31E` | `#E2BD2E` |
| just over 1.00 | over 15 kn | `#E59400` | `#F0A01A` |
| 1.33 | 20 kn | `#D9381E` | `#E5492E` |
| 1.80 and over | 27 kn | `#8F2413` | `#B5331F` |

The dark values are untested. Check them on screen and adjust them.

### Window button

Keep one `.wk-win` button for each window, with its `aria-label`, `data-t` and `data-end`. Make it transparent and let it cover the lane from the top to the bottom of the window bracket. Keep a visible focus ring.

### Label column

| Line | Content |
|---|---|
| 1 | The day name, and the four solunar rating lamps at the right. Drop the rating word. |
| 2 | Wind between first light and last light, mono: direction, lowest to highest speed, top gust. Example: `SW 5–18 kn, gusts 26`. Use `daySummary`. With no forecast, write `No forecast`. |
| 3 | High water times, as now. |

### Legend

Replace the "wind over the limit" entry with a swatch of the color ramp from 0 to 1.8 times the limit, and the words: "Wind. Yellow ends at your limit, 15 kn." Use the owner's limit for the number. Add an entry for gusts. Keep the entries for window, major period, tide, now and no forecast.

## 2. A click opens the Day screen at that time

Today a click inside a window pins the window's start, and a click elsewhere on a row opens the day with no pin. Change the `#wkRows` handler to this:

| The owner clicks or taps | Result |
|---|---|
| Anywhere on a lane, inside or outside a window | `openDay(d0, t)`, where `t` is the time under the pointer: `a + (clientX − left) / width × (b − a)`. Clamp `t` to the row's calendar day. `pinTime` rounds it to 5 minutes. |
| A window button with the keyboard | `openDay(d0, start)`. A key press has no pointer position, so pin the window's start. |
| The day name | No change. The day opens with no new pin. |
| A best-window card | No change. The window's start is pinned. |

A window button reports a mouse click and a key press through the same `click` event. A key press gives `event.detail === 0`.

For a mouse only: while the pointer is over a lane, draw a hairline under it and a small flag with the time, rounded to 5 minutes. Remove both when the pointer leaves. A touch screen gets no hairline.

## Tests and checks

- Put the color function and the time-under-the-pointer function where the tests can load them. Test both:
  - At a 15 kn limit, a speed of 15.4 kn gets the color for 15 kn, and 15.6 kn gets the color for 16 kn.
  - A click at the left edge of a lane gives the lane's first hour. A click at the right edge gives a time inside the same calendar day.
- `npm test` passes.
- Check both themes, a 390 px wide screen, and an iPad in landscape. The Week screen must not scroll.
- Check a day with no window, a day with two windows, and a day with part of its forecast missing.

## Then update CLAUDE.md

- The Week paragraph: the row now draws hourly wind, and a click on a lane pins the time under the pointer.
- The color table: add the wind ramp and the rule that yellow ends at the owner's limit.

## Left out on purpose

Hourly wind direction, rain, chop and minor periods. The row must stay simple. Rain is the first candidate to add later.

## Build order

Each step is one pull request, merged before the next starts.

| Step | Work | State |
|---|---|---|
| 1 | The row: the wind field, the major-period and window brackets, the tide's new place, the transparent window button and the legend. The color function and its tests. | Done. |
| 2 | The label column: the rating lamps and the day's wind. | Done. The column is 156 px wide, so the longest wind line fits. |
| 3 | A click opens the Day screen at the time under the pointer. The hairline and time flag for a mouse. The time function and its tests. | Done. The note above the rows now reads "Tap a row to open that day at that time." |

## Decisions made in the build

- **Bar height.** A bar's height uses the speed in whole knots, as its color does. A bar inside a window therefore never rises over the limit line.
- **Dark theme colors.** The proposed dark values were checked on screen and kept. On the dark lane's day ground, the top stop, `#B5331F`, has a contrast of 1.4 to 1. Its bars still read, because they are saturated and reach the top of the wind field. The light theme's yellow, at 1.9 to 1 on its ground, reads the same way.
- **The day's wind.** The wind line covers the same hours as the window rule: each hour stands for the half hour either side of its time. It needs one such hour with a forecast. A day with part of its forecast missing summarizes the hours it has, and its row shows the grille for the rest.
- **Rating lamps.** VoiceOver reads the lamps as "Solunar rating" and the rating word, which the screen no longer shows.
- **Time under the pointer.** `Engine.laneTime` rounds the time to 5 minutes and keeps it between midnight and 23:55 of the row's day. A row that ran to the next midnight therefore pins 23:55 at its right edge, never the next day. The flag shows the same time that a click would pin.
- **Clicks without a pointer.** The brief pins a window's start for a key press, because a key press has no pointer position. VoiceOver and Switch Control may also activate a window button without a pointer, and send a click with a position at the button's center. The page therefore counts a click as a pointer's only when a pointer was released on the same lane less than a second before it. Any other click on a window button pins the window's start. A mouse or a finger still pins the time under it, however long it is held. If VoiceOver on the iPad sends a real tap at the button's center, the page cannot tell it from a finger, and it pins the time at the window's center. Only the iPad can show which happens, so `docs/boat-check.md` lists the check. This rule came from the reviews of step 3 and of its follow-up.
- **Legend swatch.** The swatch has 18 steps of a tenth of the limit. The tenth step is yellow, at the limit, and the eleventh is amber, just over it.
