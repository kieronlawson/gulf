"""Rebuilds data/coast.json from the GSHHG full-resolution shoreline.

Get the source data first:
  pip download basemap-data-hires --no-deps -d wheels
  unzip wheels/basemap_data_hires-*.whl 'mpl_toolkits/basemap_data/gshhs_f.dat' 'mpl_toolkits/basemap_data/gshhsmeta_f.dat' -d gshhs
Needs: pip install numpy shapely

TOLERANCE sets the detail. 0.0011 degrees is about 110 m and gives about 3,100 points.
A zoomable map needs a smaller value and will make the page larger.
"""
import json, math
import numpy as np
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

W, E, S, N = 174.52, 175.66, -37.26, -35.97   # map bounds, degrees
SCALE = 300.0                                  # map units per degree of latitude
TOLERANCE = 0.0011                             # simplification, degrees
MIN_AREA = 2.0e-6                              # drop rocks smaller than about 2 hectares, square degrees
BASE = 'gshhs/mpl_toolkits/basemap_data/'

# The first cut is a little wider than the map. Its exact bounds decide where each ring starts,
# and the simplification depends on that, so keep them to reproduce data/coast.json exactly.
W1, E1, S1, N1 = 174.35, 175.75, -37.28, -35.95
frame = box(W1, S1, E1, N1)
parts = []
with open(BASE + 'gshhsmeta_f.dat') as meta, open(BASE + 'gshhs_f.dat', 'rb') as dat:
    for line in meta:
        f = line.split()
        kind, npts, south, north, offset, nbytes = int(f[0]), int(f[2]), float(f[3]), float(f[4]), int(f[5]), int(f[6])
        if kind != 1 or north < S1 or south > N1 or npts < 4:
            continue
        dat.seek(offset)
        pts = np.frombuffer(dat.read(nbytes), dtype='<f4').astype('f8').reshape(npts, 2)
        if pts[:, 0].max() < W1 or pts[:, 0].min() > E1:
            continue
        poly = Polygon(pts)
        if not poly.is_valid:
            poly = poly.buffer(0)
        cut = poly.intersection(frame)
        if not cut.is_empty:
            parts.append(cut)

land = unary_union(parts).intersection(box(W, S, E, N))
k = math.cos(math.radians(36.6))
X = lambda lon: (lon - W) * k * SCALE
Y = lambda lat: (N - lat) * SCALE
path, count = '', 0
for g in (land.geoms if hasattr(land, 'geoms') else [land]):
    if g.geom_type != 'Polygon' or g.area < MIN_AREA:
        continue
    s = g.simplify(TOLERANCE, preserve_topology=True)
    for ring in [s.exterior] + list(s.interiors):
        pts = list(ring.coords)
        if len(pts) >= 4:
            path += 'M' + ' '.join('%.1f,%.1f' % (X(x), Y(y)) for x, y in pts[:-1]) + 'Z'
            count += len(pts)
out = {'path': path, 'w': round((E - W) * k * SCALE, 1), 'h': round((N - S) * SCALE, 1), 'W': W, 'E': E, 'S': S, 'N': N, 'k': k, 'scale': SCALE}
json.dump(out, open('data/coast.json', 'w'), separators=(',', ':'))
print(count, 'points,', len(path), 'bytes')
