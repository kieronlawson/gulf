# Brief: depths, chart marks and a full-screen map

Mocks:

- Depths, marks and a route: https://claude.ai/artifact/LZJbcXCBTyxqeHZdmehFqo#artboard-MapFull
- Wind, flow and chop over depths: https://claude.ai/artifact/LZJbcXCBTyxqeHZdmehFqo#artboard-MapFullChop

## Why

The map knows where land is and nothing about the water. With depths, the page can keep a path out of shallow water, show the depth under any point at any time, and later steepen waves over shallows. With chart marks, the owner sees rocks, buoys and beacons. A full-screen map gives room for all of it on the iPad.

This stays a personal, non-commercial app. The depth data's license depends on that.

## What to build

1. A depth grid for the Gulf, made from NIWA's 20 m grid.
2. Chart marks from LINZ chart data.
3. Depth in the page: the map, the probe, Limits and the route.
4. A full-screen map on Day and Now.

Waves over shallows are a second step, at the end.

## 1. Sources and licenses

The build changed the depth source and its license. See "Decisions made in the build" below.

| Source | What to take | License and limits |
|---|---|---|
| NIWA, "Hauraki Gulf bathymetric grid", Mackay et al. (2012). A 20 m grid, 197 MB, from niwa.co.nz/our-science/oceans/bathymetry/download-the-data | A depth for every cell of water. | NIWA Open Data Licence BY-NN-NC-SA 1.0: attribution, non-commercial, share-alike. Not for navigation. |
| LINZ Data Service, chart vector data ("Hydro" layers), made from the official electronic charts | Rocks, wrecks, obstructions, buoys, beacons, lights, restricted areas, marine farms. Depth areas and soundings, for checks and for gaps. | Creative Commons Attribution 4.0. Not for navigation. LINZ paused updates to these layers in May 2024. |

Rules that follow:

- The reduced depth file in this repository is a copy of NIWA's data, so it carries NIWA's license. Add `data/LICENSE-depth.md` and a row in `NOTICE.md`.
- LINZ needs a free account and a key. Read the key from the environment variable `LDS_KEY`. Never commit it.
- The page keeps the words "Not for navigation" on the map whenever depths or marks show.

## 2. Tools

Each tool runs on the owner's machine and writes a file in `data/`. Record the source file's name and date in the output.

**`tools/depth.py`**

1. Read the NIWA grid. Find its projection and its vertical datum, and write both into the output. Stop and report if either is unclear.
2. Reproject to the map's bounds in `data/coast.json`.
3. Resample to 100 m. Keep the **shallowest** value in each new cell, so a reduced cell never hides a shoal.
4. Convert depths to meters below chart datum, the level the tide heights use. If NIWA's datum is mean sea level, the offset at Auckland is 1.94 m.
5. Write `data/depth.png`: depth in decimeters across two color channels, with one value for "no data". Write `data/depth.json`: bounds, cell size, datum, source and date.
6. Report the cells of water the grid does not cover. The Firth of Thames and the upper Waitematā are the likely gaps.

**`tools/contours.py`**

Draw contours from the reduced grid at 2, 5, 10, 20, 30 and 50 m. Simplify them and write `data/contours.json`. Contours come from the grid, not from LINZ, so the lines agree with the numbers.

**`tools/chartmarks.py`**

1. Download the LINZ layers inside the map's bounds, at the Approach scale (1:22k to 1:90k), with the Harbour scale (1:4k to 1:22k) where it exists and the Coastal scale (1:90k to 1:350k) where Approach is missing.
2. Where two scales show one object, keep the larger scale.
3. Keep position, kind, name and the few attributes the page draws. Write `data/marks.json`.
4. For water the NIWA grid does not cover, take the shallower limit of each LINZ depth area and write those cells into the depth file, flagged as coarse.

**Size.** Aim for `depth.png` under 1 MB, contours under 300 KB and marks under 100 KB. If the depth file is larger, use 150 m cells. The build ships these files beside `index.html`, and the service worker stores them.

**Coastline.** The current coastline is simplified to about 110 m and looks coarse when zoomed in. Replace it with LINZ's 1:50,000 coastline if that layer is available under the same license. Otherwise lower `TOLERANCE` in `tools/coast.py`.

## 3. Depth in the page

**Two depths.** "Chart depth" is the stored value. "Depth at a time" is chart depth plus the tide height at that time. Take the tide from the tide spot nearest the point.

**Engine.** Add `depthAt(point)` and `depthAtTime(point, t)` to `engine.js`, with tests. A point with no data returns nothing, and the page says "No depth here".

**Limits.** Add "Safe depth", in meters: the least water the owner accepts under the boat. Range 0.5 to 5.0, step 0.1. It starts unset, like boat speed. Until it is set, the page hatches nothing and the route ignores depth.

**Map layers.** Add two toggles beside Wind, Flow and Chop:

| Layer | Drawing |
|---|---|
| Depth | Contours as blue hairlines, labeled in meters. Water under the safe depth at the map's time is hatched. With Chop off, three blue tints show chart depth under 5 m, 5 to 10 m and 10 to 20 m. With Chop on, the tints give way to the chop tint, and the contours turn a darker blue so they read over it. |
| Marks | Rocks, wrecks and obstructions; buoys and beacons; restricted areas and marine farms as outlines. Tapping a mark names it. |

A legend states the time the hatching is drawn for.

**Probe.** Add a row: `Depth at 14:05 — 16.3 m`, and under it `chart 15.7 m + tide 0.6 m`. "Where to go" and saved marks show the same depth.

**Route.**

- The path search treats a cell as closed when its depth is under the safe depth. Use the lowest tide between the leave time and the arrival time at cruising speed, plus 30 minutes.
- Coarse cells count as closed unless their depth is at least twice the safe depth.
- The strip under the map gains a depth line, the safe depth as a dashed line, and the least depth on the path.
- If no path exists at that tide, say so and name the least depth that blocks it.
- Keep the label "A line for scoring. Not a route to steer."

## 4. Full-screen map

Follow the mock.

- **Entering.** A "Full screen" button on the map, on Day and on Now. "Exit full screen" and the Escape key leave it. The page remembers the choice.
- **How.** Make it a layout of the page, not the browser's fullscreen mode. Opened from the Home Screen, the page already has the whole screen.
- **Map.** It fills the screen, edge to edge. Pan, pinch and the view buttons work as now.
- **Top left.** Exit, then the map's time: "Gulf at 14:05, pinned".
- **Top right.** View buttons and zoom.
- **Left.** Layer toggles: Depth, Marks, Route, Wind, Flow, Chop. Under them, one legend: the chop scale when Chop is on, otherwise the depth tints. The hatching and the contour line are in both.
- **Right.** The probe reading as a card, with "Route to here" and "Save as mark".
- **Bottom.** One panel. The time bar is always there. With a route open, the comfort and depth strip sits above it.
- **Rules.** No scrolling. Every control at least 44 px. The panels never cover the probe point or the selected spot: move the map so that both stay clear.

## 5. Second step: waves over shallows

- Cap the chop height at 0.6 times the depth at that time.
- Where the uncapped height is over half the depth, mark the cell "breaking likely" and score a leg through it as Very rough.
- Keep both numbers with the other scoring numbers in `engine.js`.

## Tests and checks

- `depthAt` on a small made-up grid: a cell, a cell edge, land, no data.
- `depthAtTime` adds the tide of the nearest spot.
- Resampling keeps the shallowest value: a made-up grid with one shoal still shows it at 100 m.
- A path avoids a made-up shoal at low tide and crosses it at high tide.
- Compare the reduced grid with LINZ soundings. Report the share within 1 m and the largest differences. Do not ship if the datum looks wrong.
- Check Day and Now, both themes, an iPad in landscape in full screen, and a 390 px wide screen.
- `npm test` passes. The page still opens with no connection.

## Then update the docs

`CLAUDE.md`: the depth file, its datum, the two depths, and the rule that reduced cells keep the shallowest value. `NOTICE.md`: NIWA and LINZ. `docs/ipad-plan.md`: the full-screen map.

## Order of work

| Step | Work |
|---|---|
| 1 | `tools/depth.py`, with the datum and coverage report. Stop here and show the owner the report. |
| 2 | `depthAt`, `depthAtTime`, the probe row. |
| 3 | Contours, tints and hatching. Safe depth in Limits. |
| 4 | `tools/chartmarks.py` and the Marks layer. |
| 5 | Depth in the route. |
| 6 | Full-screen map. |
| 7 | Waves over shallows. |

## Not yet known

| Question | Why it matters |
|---|---|
| Which level NIWA's depths are measured from | The page adds the tide to them. |
| Whether the grid covers the Firth of Thames and the upper Waitematā | Gaps fall back to coarse LINZ depth areas. |
| How the 2012 grid compares with current LINZ soundings | Sand moves. Large differences should be flagged on the map. |
| The size of the reduced files | It decides between 100 m and 150 m cells. |

## Left out on purpose

| Item | Reason |
|---|---|
| LINZ chart images under the map | The page draws its own map. This can come later as a toggle. |
| Navionics or another embedded chart | It would replace the map and give the page no numbers. |
| Detailed tidal flow | No free source exists. |
| Live updates to chart data | LINZ paused them. |

## Build order

Each step is one pull request, merged before the next starts.

| Step | Work | State |
|---|---|---|
| 1 | `tools/depth.py`, with the datum and coverage report. | Done. `data/depth.png` is 740 KB. |
| 2 | `depthAt`, `depthAtTime`, the probe row. | Done. The grid was checked against the LINZ soundings first, and the drying flats raised by 0.4 m. |
| 3 | Contours, tints and hatching. Safe depth in Limits. | Done. `data/contours.json` is 235 KB. |
| 4 | `tools/chartmarks.py` and the Marks layer. | Done. `data/marks.json` is 91 KB. |
| 5 | Depth in the route. | |
| 6 | Full-screen map. | |
| 7 | Waves over shallows. | |

## Decisions made in the build

- **The depth source.** NIWA no longer offers its 2012 Hauraki Gulf grid for download; its download page offers only the 250 m grid of all of New Zealand. The build uses K. Mackay (2025), "Hauraki Gulf BathyTopo Digital Elevation Model", Zenodo, doi:10.5281/zenodo.15887269: a revised version of the 2012 grid, by its first author, with 20 m cells. Its license is CC BY 4.0, which asks for attribution and allows any use. `data/LICENSE-depth.md` records it. The app stays personal and non-commercial for the other reasons in this brief.
- **Projection.** The grid is in EPSG:3994, WGS 84 Mercator with true scale at 41°S. `tools/depth.py` reads the code from the file and stops if it differs. The test of the conversion reproduces the corners the grid's own record gives in degrees, to five decimal places.
- **Vertical datum.** The record says the bathymetry is reduced to Lowest Astronomical Tide (LAT) and the land heights are LiDAR heights in NZVD2016. It does not say where the two sources meet, and at Auckland the two datums are about 1.9 m apart. A check against the LINZ charts settled it for the water (see below), so every value is read as a height above LAT.
- **LAT and chart datum.** The page's tide model, run over 19 years from 2020, puts LAT 0.10 m above chart datum at Auckland; the same run puts highest astronomical tide at 3.72 m, against 3.74 m in LINZ's table. The build takes chart datum as LAT, which errs by 0.1 m on the side of less water.
- **Cells.** A map cell is a quarter of a map unit, 92.7 m. Four cells across make one cell of the route's water raster, so a later step can close route cells by depth without resampling. At this size `depth.png` is 740 KB, under the brief's 1 MB, so the brief's fallback to 150 m cells is not needed.
- **The shallowest value.** Each map cell keeps the highest value, which is the shallowest water, among the 20 m cells whose centers fall inside it. A cell that holds any land therefore reads as land or as drying.
- **Land in the depth file.** A cell more than 4.0 m above LAT is stored as land. Highest astronomical tide is about 3.6 m above LAT, so such a cell never floats. The page's coastline still decides where land is drawn.
- **Coverage.** The grid covers every cell of the map, including the Firth of Thames and the upper Waitematā. No cell needs a LINZ depth area, so step 4 has no gaps to fill, and the brief's rules for coarse cells have no cell to apply to.
- **The drying flats.** The comparison with the LINZ soundings (below) found the grid's drying flats too low: where the grid reads at or above LAT, the charts read a median 0.3 to 0.5 m higher. The owner chose to correct it. `tools/depth.py` raises every 20 m value at or above LAT by 0.4 m before the reduction. Between LAT and 0.5 m below it, the raise grows in a straight line from nothing, so the depths stay continuous. Deeper water keeps its value. The owner carries a depth sounder, so the depths on the page are information, and the words "Not for navigation" stay.
- **Shipping the grid.** The page fetches the grid; inlined, it would add about 1 MB of base64 to `index.html`. `build.mjs` copies `data/depth.png` to `dist/depth.<hash>.png`, where the hash is of the file's content, and puts the name and the numbers that place the cells into `DATA.depth`. The service worker stores the file on install and serves it from the store. A new grid gets a new name, so no stored copy is ever out of date.
- **Decoding.** The page decodes the PNG in script, with no canvas: `Engine.pngChunks` reads the header and joins the compressed data, `DecompressionStream` inflates it, and `Engine.pngValues` undoes the row filters. A canvas can change the bytes it gives back, because some browsers, Safari among them, add noise to canvas reads to resist fingerprinting; one unit of red would move a depth by 25.6 m. A browser without `DecompressionStream`, which Safari has had since 16.4, gets no depths. `test/png.test.mjs` tests the decoder on made-up images with all five row filters. A browser check compared 400 random cells with Python's reading of the file and found no difference.
- **Contours.** `tools/contours.py` traces each depth by marching squares through the centers of the cells of `data/depth.png`, with land counted as shallower than any contour. A closed line shorter than 2 map units, about 740 m, rings one or two cells; the tool drops it, and the hatching still shows the shoal. The tool simplifies each line to within 0.12 map units, about 45 m. The file holds one SVG path per depth and 356 label points; it is 235 KB, under the brief's 300 KB. The page fetches it and the service worker stores it, as it does the grid.
- **Contour labels.** Labels keep one size on screen. Every other label shows from zoom 1.8 and all of them from zoom 3.6, so that labels stand about 160 px apart along a line. At the whole-Gulf view the lines carry no labels.
- **Tints and hatching.** Both are pictures of the grid, one pixel per cell, laid over the map under the land. The tints are drawn once for each theme's colors. The hatching is a mask over a pattern of diagonal lines that keep one spacing on screen. The page finds, once, the cells whose chart depth is under 5.5 m, and the nearest tide spot of each. For each map time it draws the mask again when the safe depth or any spot's tide changes by a centimeter.
- **The colors.** The tints are the tide blue at three strengths, as in the mock. Over the chop tint, the contours take a darker blue in the light theme and a lighter one in the dark theme. The hatching uses the ink color.
- **The key.** In the map's corner, under the scale, the key takes at most four lines, so it covers little of the map: "Depth at 14:05" once a safe depth is set, or "Chart depth" before; the tints while they show; the hatching and the contour line; and "Not for navigation".
- **Four layer buttons.** On a map frame too short for two columns of buttons, the layers go in a row along the foot. The row of four needs a frame 362 px wide. A short frame narrower than that, as on the Day screen of an iPad mini in landscape, puts them in two columns of two.
- **Chart scales.** `tools/chartmarks.py` uses each scale's coverage polygons. It keeps every Harbour object, an Approach object outside the Harbour coverage, and a Coastal object outside both. An area counts as inside when the mean of its outer ring's corners is. Where two scales still show one object of one kind within 40 m, it keeps the larger scale.
- **Gaps.** The brief's step for filling gaps in the depth grid from the LINZ depth areas has nothing to fill: the grid covers the whole map.
- **What the marks keep.** 777 rocks, 45 wrecks, 28 obstructions, 127 buoys, 500 beacons, 80 lights on their own, 17 marine farms as points, and 138 areas: restricted areas, marine farms and foul ground. A light within 30 m of a buoy or beacon joins it, and its characteristic, such as "Fl G 3s", goes into the mark's facts. The tool writes each name and fact in words from the S-57 codes. A special mark's purpose is written only for six codes whose meaning is certain; the others read "Special beacon" or "Special buoy". Restricted areas take LINZ's note, with its heading as the area's name.
- **Size.** The file is 91 KB, under the brief's 100 KB. Each name and fact is listed once in `texts`, points keep 0.1 map unit, about 37 m, outlines are simplified to within 0.1 map unit, and each kind is one letter.
- **Symbols and color.** The marks are drawn in ink. Lateral marks are not red and green, because in this page green means active or inside the owner's limits, and red means an alert. The reading names the side, as in "Port-hand beacon". A light on a buoy or beacon is not drawn apart from it.
- **Zoom.** About 1,500 marks would hide the water at the whole-Gulf view, so marks show from zoom 2. Outlines show at every zoom. The marks redraw only when the view leaves a box twice its size, or when the zoom changes.
- **Naming a mark.** A tap places the probe, as before. The reading then names the mark nearest the probe within 18 px on screen, with its distance, and every area that holds the probe. A tap never selects a mark in place of the probe, so the probe stays usable over crowded water.
- **Five layer buttons.** The map's buttons follow the frame's size, and the rules at the container queries in `src/style.css` give the arithmetic. From 416 px tall the layers stand in a column. A shorter frame at least 436 px wide puts them in a row, with or without a route open. A shorter frame from 288 to 436 px wide puts them in three columns of two rows. A narrower one, as in a 320 px window, puts them in two columns of three rows. A frame under 266 px tall and under 436 px wide, as on the Day screen of a window just over 700 px tall, also puts the view buttons in two columns. A check that sets the frame to every size from 270 to 780 px wide and 216 to 480 px tall, in the wide layout and the stacked one, with and without a route, found no button over another and none outside the frame.
- **The coastline.** LINZ's NZ Coastlines and Islands Polygons (Topo 1:50k), layer 51153, is CC BY 4.0, so it replaced the GSHHG coastline. `tools/coast.py` reads it inside the map's bounds, keeps islands over about half a hectare, and simplifies the shore to within 0.0003 degrees, about 30 m. That keeps 165 land polygons and 13,144 points, against 82 polygons and about 3,100 points before. The coastline grows from 34 KB to 175 KB, and `index.html`, which inlines it, from about 548 KB to 705 KB. A 20 m tolerance would have taken 180 KB for the path alone; 30 m is about one pixel at the highest zoom on the largest screen.
- **Zoom.** With the finer coastline, zoom stops at 8 instead of 6. At zoom 8 on the largest iPad, a pixel is about 20 m.
- **Routes and chop after the coastline.** The route's water raster, at 2 cells per map unit, gained 1.3% more water joined to the Gulf. Eight sample routes changed length by −0.68 to +0.56 nautical miles: Westhaven to the Rangitoto Channel 6.08 to 5.93, Half Moon Bay to Matiatia 8.05 to 8.09, Gulf Harbour to Kawau 15.71 to 15.35, Bayswater to Motuihe 10.25 to 10.32, Pine Harbour to Coromandel 24.67 to 24.42, Sandspit to Tiritiri 14.05 to 14.61, Westhaven to Hobsonville 5.36 to 5.12, and Kawakawa Bay to the east of Waiheke 8.42 to 7.74. Fetch at 72 points over the inner Gulf, from eight directions each, changed by a median 0.3 km, 1%; a tenth of the readings changed by more than 21%, all near the shore. Chop grows with the square root of fetch, so those move by about a tenth.
- **The probe row.** The row reads "Depth at 14:05" and the depth at the map's time. The line under it gives the chart depth, the tide and the tide spot, and ends "Not for navigation." A drying cell covered by the tide says how much the ground dries. A drying cell above the tide says "Dry". A land cell says the grid puts it above high water. The row shows on a point the coastline puts on land, such as a marina, because the grid often has a value there. In Where to go, each row gives the depth after the distance, before the wind, because a long line loses its end.

## The datum check

The brief asks for a comparison with LINZ soundings. The LINZ Data Service needs a key that this build did not have, so the first check used the LINZ charts as wetmaps.co.nz shows them, stitched from the official raster charts. A LINZ key can repeat the check against the sounding layers later.

1. **Chart tints.** Screenshots of the charts over seven areas, at zoom 14, were matched pixel by pixel to the 20 m grid: the Waitematā west of the bridge, the upper harbor, Shoal Bay, the Tāmaki Estuary, Mahurangi, the Weiti and the harbor entrance. Along the line where the charts' green drying tint meets the blue water tint, the charts' 0 m line, the grid reads a median of 0.01 m above LAT, with half the samples between −0.03 and 0.24 m. Read as NZVD2016, that line would sit near −2 m. Under the charts' drying tint the grid reads 0.0 to 1.6 m above LAT for 80% of samples. Along the outer edge of the blue tint, the grid reads a median of 4.6 m below LAT.
2. **Drying heights.** Six drying heights printed in Shoal Bay, 0.3 to 1.5 m, compare with the grid as follows: every one within 1.0 m, and the grid lower by 0.6 m on average. On these flats the grid shows about half a meter more water than the chart.
3. **Round values.** The grid holds many cells at exactly 0.0, 0.5, 1.0, 1.5 and −2.0 m above LAT. A grid interpolated in part from charted contours and drying heights would hold such values, which would also explain why its 0 m line sits on the charts' drying line.
4. **LINZ soundings.** `tools/soundings.py` compared the grid with every sounding of the LINZ charts inside the map: 13,035 at the Harbour scale (1:4k to 1:22k), 9,940 at the Approach scale (1:22k to 1:90k) and 3,204 at the Coastal scale (1:90k to 1:350k), which make 22,938 positions once each. The figures below count each position once. A positive difference means the grid shows more water than the chart.
   - **All positions.** 78.9% agree within 1 m. The median difference is +0.03 m, and the middle half lies between −0.18 and +0.48 m. Between 5 and 20 m of water the median is within 0.04 m.
   - **By area.** Within 1 m: Whangaparāoa to Kawau 92%, Tāmaki Strait and the inner islands 90%, Mahurangi Harbour 90%, the Tāmaki Estuary 82%, the Firth of Thames 80%, the Waitematā 70 to 72%, and the waters around Great Barrier Island 62%.
   - **The largest differences** lie on steep shores, most of them around Great Barrier Island. Of the 592 positions that differ by more than 5 m, 375 lie there. At 36°01.6′S 175°24.6′E, near Port Fitzroy, the chart gives 8.5 m and the grid 29.8 m. At 36°50.5′S 175°25.1′E, on the Coromandel shore, the chart gives 2.7 m where the grid has land 21 m high. The grid's cells there come from sparse data, and a 20 m cell on a steep shore can hold a very different depth from a sounding beside it.
   - **Drying heights.** The charts give 1,660 drying heights. 80.9% agree within 1 m, and the median difference is +0.38 m: the grid shows more water. The gap grows with the drying height: +0.14 m under 0.5 m, +0.61 m from 1.0 to 1.5 m, +1.09 m from 2 to 3 m. The gap holds in every area but Mahurangi Harbour (+0.05 m).
   - **By the grid's height.** Where the grid reads below LAT, the charts agree: grid cells 0.5 to 1.0 m below LAT hold charted depths with a median of 0.6 m. Where the grid reads at or above LAT, the charts read higher: cells at exactly 0.0 m hold charted drying heights with a median of 0.3 m, and cells 0.5 to 1.0 m above LAT a median of 0.9 m.
   - **The datum.** Below LAT the grid agrees with the charts, so the datum is right. The gap is on the drying flats alone, where the grid was probably interpolated between the charts' 0 m line and the land.
   - **The correction.** Raising every value at or above LAT by 0.4 m, ramped in over the 0.5 m below LAT, brings the drying heights to a median difference of −0.01 m, with 88.1% within 1 m. Water deeper than 0.5 m below LAT does not change.
   - **The shipped file.** Each cell of `data/depth.png` holds the shallowest water in about 93 m, so it reads a median 0.2 m shallower than the chart. With the correction, it shows more than 1 m more water than the chart at 6.1% of all positions and at 4.2% of drying heights, against 8.7% of drying heights without it. Most of those positions lie on steep shores, where the cell of the sounding holds deep water beside it.
