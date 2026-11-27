# License of the depth data

`data/depth.png` and `data/depth.json` are adapted from this work:

Mackay, K. (2025). *Hauraki Gulf BathyTopo Digital Elevation Model* [Data set]. Zenodo. https://doi.org/10.5281/zenodo.15887269

The work is a revised version of Mackay, K.A., Mackay, E.J., Neil, H.L., Mitchell, J.S. and Bardsley, S.A. (2012), *Hauraki Gulf*, NIWA Chart, Miscellaneous Series 91. Its author is with Earth Sciences New Zealand, formerly NIWA.

The work is licensed under the Creative Commons Attribution 4.0 International License: https://creativecommons.org/licenses/by/4.0/

`tools/depth.py` made these changes:

- It moved the values from EPSG:3994 into the map's grid of cells about 93 m across.
- It kept, in each cell, the shallowest of the 20 m values inside it.
- It converted heights above Lowest Astronomical Tide into depths below chart datum, in decimeters.
- It stored a cell more than 4 m above Lowest Astronomical Tide as land.

The data are not to be used for navigation.
