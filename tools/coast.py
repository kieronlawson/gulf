"""Rebuilds data/coast.json, the page's coastline, from LINZ's NZ Coastlines and Islands Polygons (Topo 1:50k).

Usage: python3 tools/coast.py [layer.json]
It needs Python 3 and shapely (pip install shapely). Without a path, it fetches the layer inside the map's bounds
from the LINZ Data Service, which needs a key in the environment variable LDS_KEY; the script sends the key only
in its request to data.linz.govt.nz and never prints it. With a path to a file that exists, it reads the layer
from there; with a path to a file that does not exist, it fetches the layer and keeps it there.

Source: LINZ, NZ Coastlines and Islands Polygons (Topo 1:50k), layer 51153, CC BY 4.0.

TOLERANCE sets the detail: 0.0003 degrees is about 30 m, about one pixel at the map's highest zoom on the
largest screen. MIN_AREA drops islets and rocks under about half a hectare; the chart marks show rocks. The
map's bounds, scale and k must not change: every other data file uses them.
"""
import json, math, os, pathlib, sys, urllib.parse, urllib.request
from shapely.geometry import shape, box
from shapely.ops import unary_union

W, E, S, N = 174.52, 175.66, -37.26, -35.97   # map bounds, degrees
SCALE = 300.0                                  # map units per degree of latitude
TOLERANCE = 0.0003                             # simplification, degrees
MIN_AREA = 5.0e-7                              # drop islands smaller than about half a hectare, square degrees
LAYER = 51153
ROOT = pathlib.Path(__file__).resolve().parent.parent


def fetch(path):
    key = os.environ.get('LDS_KEY')
    if not key:
        sys.exit('Set LDS_KEY to a LINZ Data Service key, or give the path of a saved copy of the layer.')
    # A margin around the map keeps every shore the map shows whole.
    q = urllib.parse.urlencode({'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': 'layer-%d' % LAYER,
                                'outputFormat': 'application/json', 'srsName': 'EPSG:4326',
                                'bbox': '%g,%g,%g,%g,urn:ogc:def:crs:EPSG::4326' % (S - 0.04, W - 0.07, N + 0.04, E + 0.06)})
    try:
        raw = urllib.request.urlopen('https://data.linz.govt.nz/services;key=%s/wfs?%s' % (key, q), timeout=600).read()
    except Exception as e:  # the message could hold the request's address, and the address holds the key
        sys.exit('LDS request failed: %s' % str(e).replace(key, '***'))
    if path:
        path.write_bytes(raw)
    return json.loads(raw)


def main():
    path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
    layer = json.loads(path.read_text()) if path and path.exists() else fetch(path)
    polys = [shape(f['geometry']) for f in layer['features']]
    polys = [p if p.is_valid else p.buffer(0) for p in polys]
    land = unary_union(polys).intersection(box(W, S, E, N))
    k = math.cos(math.radians(36.6))
    X = lambda lon: (lon - W) * k * SCALE
    Y = lambda lat: (N - lat) * SCALE
    path_d, count, islands = '', 0, 0
    for g in (land.geoms if hasattr(land, 'geoms') else [land]):
        if g.geom_type != 'Polygon' or g.area < MIN_AREA:
            continue
        s = g.simplify(TOLERANCE, preserve_topology=True)
        islands += 1
        for ring in [s.exterior] + list(s.interiors):
            pts = list(ring.coords)
            if len(pts) >= 4:
                path_d += 'M' + ' '.join('%.2f,%.2f' % (X(x), Y(y)) for x, y in pts[:-1]) + 'Z'
                count += len(pts) - 1
    out = {'path': path_d, 'w': round((E - W) * k * SCALE, 1), 'h': round((N - S) * SCALE, 1), 'W': W, 'E': E, 'S': S, 'N': N, 'k': k,
           'scale': SCALE, 'source': 'LINZ, NZ Coastlines and Islands Polygons (Topo 1:50k), CC BY 4.0, simplified to %g degrees.' % TOLERANCE}
    text = json.dumps(out, separators=(',', ':'))
    (ROOT / 'data' / 'coast.json').write_text(text)
    print('%d land polygons, %d points, %d bytes' % (islands, count, len(text)))


if __name__ == '__main__':
    main()
