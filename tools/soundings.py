"""Compares the depth grid with the soundings on the LINZ charts, and prints the result.

Usage: python3 tools/soundings.py [Hauraki_topobathy_DEM.tif] [soundings.json]

It needs Python 3 and numpy, and a LINZ Data Service key in the environment variable LDS_KEY. The script sends
the key only in its requests to data.linz.govt.nz and never prints it. Without a grid path, the script reads
Hauraki_topobathy_DEM.tif from the repository's root, where tools/depth.py downloads it. When the second path
names a file that exists, the script reads the soundings from it; otherwise it fetches them and, if a path was
given, writes them there for the next run.

Sources:
  The grid: K. Mackay (2025), "Hauraki Gulf BathyTopo Digital Elevation Model", Zenodo,
  doi:10.5281/zenodo.15887269, CC BY 4.0. tools/depth.py reads it.
  The soundings: LINZ Data Service, "Sounding points (Hydro, ...)" at three scales, CC BY 4.0, made from the
  official electronic charts. Not for navigation. A sounding's depth is meters below chart datum, and a drying
  height is a negative sounding.

What the script does:
1. It fetches every sounding inside the map's bounds from the Harbour (1:4k to 1:22k), Approach (1:22k to 1:90k)
   and Coastal (1:90k to 1:350k) layers, through WFS as GeoJSON.
2. For each sounding it reads three depths below chart datum: the 20 m grid cell under the sounding, the same
   cell with the drying flats raised as tools/depth.py raises them, and the cell of data/depth.png under it. The
   grid holds heights above LAT, and every depth takes chart datum as LAT, as tools/depth.py does.
3. It prints, for each scale, each area and the drying heights on their own: the number of soundings, the share
   within 1 m, the median difference, and the middle half of the differences. A positive difference means the
   grid shows more water than the chart. A table by the grid's height above LAT shows the gap on the drying
   flats that tools/depth.py corrects. The script then lists the largest differences with their positions.
"""
import json, math, os, pathlib, sys, urllib.parse, urllib.request
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import depth  # noqa: E402  tools/depth.py: the TIFF reader and the projection

LAYERS = {'Harbour': 50858, 'Approach': 50866, 'Coastal': 50506}
PAGE = 5000                 # features per WFS request
WITHIN_M = 1.0              # the brief's threshold
TOP = 15                    # how many of the largest differences to list
ROOT = depth.ROOT
# Named areas for the report: west, east, south, north, in degrees. A sounding takes the first area that holds it.
AREAS = {
    'Upper Waitematā Harbour': (174.55, 174.72, -36.86, -36.74),
    'Waitematā, bridge to North Head': (174.72, 174.84, -36.86, -36.82),
    'Tāmaki Estuary': (174.83, 174.95, -36.95, -36.85),
    'Mahurangi Harbour': (174.68, 174.76, -36.52, -36.42),
    'Firth of Thames': (175.25, 175.60, -37.26, -37.00),
    'Tāmaki Strait and the inner islands': (174.84, 175.20, -36.92, -36.75),
    'Whangaparāoa to Kawau': (174.65, 174.95, -36.75, -36.38),
}
REST = 'Rest of the Gulf'


def fetch(key, layer):
    """Every sounding of one LDS layer inside the map's bounds: a list of (lon, lat, depth, source date, id)."""
    out, start = [], 0
    while True:
        q = urllib.parse.urlencode({
            'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': 'layer-%d' % layer,
            'outputFormat': 'application/json', 'srsName': 'EPSG:4326', 'count': PAGE, 'startIndex': start,
            'sortBy': 'fidn', 'bbox': '%g,%g,%g,%g,urn:ogc:def:crs:EPSG::4326' % (-37.26, 174.52, -35.97, 175.66)})
        url = 'https://data.linz.govt.nz/services;key=%s/wfs?%s' % (key, q)
        try:
            d = json.load(urllib.request.urlopen(url, timeout=300))
        except Exception as e:  # the message could hold the request's address, and the address holds the key
            sys.exit('LDS request failed for layer %d: %s' % (layer, str(e).replace(key, '***')))
        feats = d['features']
        for f in feats:
            p, x = f['properties'], f['geometry']['coordinates']
            out.append((x[0], x[1], p['depth'], p.get('sordat') or '', f['id']))
        if len(feats) < PAGE:
            return out
        start += PAGE


def lonlat_to_mercator41(lon, lat):
    """Degrees to EPSG:3994, the inverse of depth.mercator41_to_lonlat."""
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    e = math.sqrt(e2)
    s1 = math.sin(math.radians(-41.0))
    k0 = math.cos(math.radians(-41.0)) / math.sqrt(1 - e2 * s1 * s1)
    phi = np.radians(lat)
    s = np.sin(phi)
    x = a * k0 * np.radians(np.asarray(lon, float) - 100.0)
    y = a * k0 * np.log(np.tan(math.pi / 4 + phi / 2) * ((1 - e * s) / (1 + e * s)) ** (e / 2))
    return x, y


def stats(diff):
    """n, share within WITHIN_M, median, lower and upper quartile."""
    if len(diff) == 0:
        return '%6d' % 0
    q1, med, q3 = np.percentile(diff, [25, 50, 75])
    within = np.mean(np.abs(diff) <= WITHIN_M + 1e-9) * 100
    return '%6d  %5.1f%%  %+6.2f  %+6.2f to %+6.2f' % (len(diff), within, med, q1, q3)


def main():
    key = os.environ.get('LDS_KEY')
    grid_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'Hauraki_topobathy_DEM.tif'
    cache = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
    if cache and cache.exists():
        snd = json.loads(cache.read_text())
    else:
        if not key:
            sys.exit('Set LDS_KEY to a LINZ Data Service key.')
        snd = {name: fetch(key, layer) for name, layer in LAYERS.items()}
        if cache:
            cache.write_text(json.dumps(snd))

    a, west, north, cell, epsg = depth.read_tiff(grid_path)
    if epsg != depth.EPSG:
        sys.exit('The grid is in EPSG:%s. This script reads EPSG:%d only.' % (epsg, depth.EPSG))
    H, W = a.shape
    meta = json.loads((ROOT / 'data' / 'depth.json').read_text())
    png = read_depth_png(ROOT / 'data' / 'depth.png')
    off = meta['encoding']['offsetDm']

    rows = []
    for scale, pts in snd.items():
        for lon, lat, d, date, fid in pts:
            rows.append((scale, lon, lat, d, date, fid))
    lon = np.array([r[1] for r in rows]); lat = np.array([r[2] for r in rows])
    sounding = np.array([r[3] for r in rows], float)
    scale = np.array([r[0] for r in rows])
    # A sounding shown at two scales is one sounding: the figures for all soundings count each position once.
    _, first = np.unique(np.round(lon, 5) * 1e6 + np.round(lat, 5), return_index=True)
    once = np.zeros(len(rows), bool); once[first] = True

    x, y = lonlat_to_mercator41(lon, lat)
    gi = np.floor((x - west) / cell).astype(int); gj = np.floor((north - y) / cell).astype(int)
    inside = (gi >= 0) & (gi < W) & (gj >= 0) & (gj < H)
    elev = np.full(len(rows), np.nan)
    elev[inside] = a[gj[inside], gi[inside]]
    grid_depth = meta['latAboveCd'] - elev                      # meters below chart datum
    raised_depth = meta['latAboveCd'] - depth.raise_drying(elev)  # the same, with the drying flats raised

    R = meta['cellsPerUnit']
    ci = np.floor((lon - meta['W']) * meta['k'] * meta['scale'] * R).astype(int)
    cj = np.floor((meta['N'] - lat) * meta['scale'] * R).astype(int)
    ok = (ci >= 0) & (ci < meta['nx']) & (cj >= 0) & (cj < meta['ny'])
    v = np.zeros(len(rows), int)
    v[ok] = png[cj[ok], ci[ok]]
    file_depth = np.where(v >= 2, (v - off) / 10.0, np.nan)    # land (1) and no data (0) give no depth

    area = np.array([next((n for n, (w0, e0, s0, n0) in AREAS.items() if w0 <= lo <= e0 and s0 <= la <= n0), REST)
                     for lo, la in zip(lon, lat)])
    have = np.isfinite(grid_depth)
    diff = grid_depth - sounding                                 # positive: the grid shows more water
    rdiff = raised_depth - sounding
    fdiff = file_depth - sounding
    fhave = np.isfinite(file_depth)
    classes = [('Drying heights (negative soundings)', sounding < 0)] + [
        ('Charted %g to %g m' % (lo, hi) if hi < 1000 else 'Charted %g m and deeper' % lo, (sounding >= lo) & (sounding < hi))
        for lo, hi in ((0, 2), (2, 5), (5, 10), (10, 20), (20, 1000))]

    print('Soundings inside the map: %s; %d positions once each.' % (', '.join('%s %d' % (s, len(p)) for s, p in snd.items()), once.sum()))
    print('No grid value under %d soundings. In data/depth.png, %d fall on land cells and %d on no data.'
          % ((~have).sum(), (v == 1).sum(), (v == 0).sum()))
    print()
    print('Difference = grid depth - charted depth, meters. Positive: the grid shows more water than the chart.')
    head = '%-38s %6s  %6s  %6s  %s' % ('', 'n', '<=1 m', 'median', 'middle half')
    print('The 20 m grid')
    print(head)
    print('%-38s %s' % ('All positions', stats(diff[have & once])))
    for s in snd:
        print('%-38s %s' % ('  ' + s + ' scale', stats(diff[have & (scale == s)])))
    for n in list(AREAS) + [REST]:
        print('%-38s %s' % ('  ' + n, stats(diff[have & once & (area == n)])))
    for name, m in classes:
        print('%-38s %s' % (name, stats(diff[have & once & m])))
        if name.startswith('Drying'):
            for n in list(AREAS) + [REST]:
                mm = have & once & m & (area == n)
                if mm.any():
                    print('%-38s %s' % ('  ' + n, stats(diff[mm])))

    print()
    print("The chart against the grid, by the grid's height above LAT (positions once each)")
    print('%-24s %6s  %s' % ('Grid height above LAT', 'n', 'chart height above LAT: median, middle half'))
    for lo, hi in ((-2, -1), (-1, -0.5), (-0.5, -0.01), (-0.01, 0.01), (0.01, 0.5), (0.5, 1), (1, 1.5), (1.5, 2), (2, 4)):
        m = have & once & (elev >= lo) & (elev < hi)
        if m.any():
            q1, med, q3 = np.percentile(-sounding[m], [25, 50, 75])
            print('%+5.2f to %+5.2f m         %6d  %+6.2f  %+6.2f to %+6.2f' % (lo, hi, m.sum(), med, q1, q3))

    print()
    print('The 20 m grid with the drying flats raised by %g m, as tools/depth.py reads it' % depth.DRY_RAISE_M)
    print(head)
    for name, m in [('All positions', once)] + classes:
        print('%-38s %s' % (name, stats(rdiff[have & once & m])))

    print()
    print('data/depth.png. Each cell holds the shallowest water in about 93 m, so it reads shallower than the chart.')
    print('%-38s %6s  %6s  %6s  %-15s %s' % ('', 'n', '<=1 m', 'median', 'middle half', 'more water than the chart by over 0.5 m, 1 m'))
    for name, m in [('All positions', once)] + classes:
        mm = fhave & once & m
        print('%-38s %s  %5.1f%%  %5.1f%%' % (name, stats(fdiff[mm]), 100 * np.mean(fdiff[mm] > 0.5), 100 * np.mean(fdiff[mm] > 1)))

    print()
    print('The %d largest differences between the 20 m grid and the chart (positions once each)' % TOP)
    print('%-9s %10s %11s  %8s %8s %8s  %s' % ('Scale', 'Lat', 'Lon', 'Chart', 'Grid', 'Diff', 'Area'))
    idx = np.nonzero(have & once)[0]
    for i in idx[np.argsort(-np.abs(diff[idx]))][:TOP]:
        print('%-9s %10.5f %11.5f  %8.1f %8.1f %+8.1f  %s' % (scale[i], lat[i], lon[i], sounding[i], grid_depth[i], diff[i], area[i]))


def read_depth_png(path):
    """The stored values of data/depth.png, red * 256 + green, as an (ny, nx) array. Reads the PNG that
    tools/depth.py writes: 8-bit RGB, one IDAT stream, any of the five row filters."""
    import struct, zlib
    raw = pathlib.Path(path).read_bytes()
    pos, idat, w = 8, b'', 0
    while pos < len(raw):
        n, = struct.unpack('>I', raw[pos:pos + 4]); kind = raw[pos + 4:pos + 8]; data = raw[pos + 8:pos + 8 + n]
        if kind == b'IHDR':
            w, h, bits, ctype = struct.unpack('>IIBB', data[:10])
            if bits != 8 or ctype != 2:
                sys.exit('data/depth.png must be 8-bit RGB.')
        elif kind == b'IDAT':
            idat += data
        pos += 12 + n
    buf = np.frombuffer(zlib.decompress(idat), np.uint8).reshape(h, 1 + w * 3)
    out = np.zeros((h, w * 3), np.int32)
    prev = np.zeros(w * 3, np.int32)
    for j in range(h):
        ftype, cur = buf[j, 0], buf[j, 1:].astype(np.int32)
        if ftype == 0:
            row = cur
        elif ftype == 2:
            row = (cur + prev) % 256
        else:
            row = np.zeros(w * 3, np.int32)
            for i in range(w * 3):
                left = row[i - 3] if i >= 3 else 0
                up, ul = prev[i], (prev[i - 3] if i >= 3 else 0)
                if ftype == 1:
                    pr = left
                elif ftype == 3:
                    pr = (left + up) // 2
                else:
                    p = left + up - ul
                    pa, pb, pc = abs(p - left), abs(p - up), abs(p - ul)
                    pr = left if pa <= pb and pa <= pc else (up if pb <= pc else ul)
                row[i] = (cur[i] + pr) % 256
        out[j] = row
        prev = row
    rgb = out.reshape(h, w, 3)
    return rgb[..., 0] * 256 + rgb[..., 1]


if __name__ == '__main__':
    main()
