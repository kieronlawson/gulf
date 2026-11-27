"""Writes data/depth.png and data/depth.json: the depth of the water over the map, below chart datum.

Source: K. Mackay (2025), "Hauraki Gulf BathyTopo Digital Elevation Model", Zenodo, doi:10.5281/zenodo.15887269,
licensed CC BY 4.0. It revises NIWA's 20 m Hauraki Gulf grid (Mackay et al. 2012), which NIWA no longer offers
for download. Not to be used for navigation.

Usage: python3 tools/depth.py [path to Hauraki_topobathy_DEM.tif]
Without a path, the script downloads the grid, 223 MB. It needs Python 3 and numpy.

What the script does:
1. It reads the grid, a GeoTIFF of 20 m cells. It stops if the file's projection is not EPSG:3994, or if the
   file is compressed or holds anything but 32-bit floating point values.
2. It places each 20 m cell in the map's grid by the cell's center. The map's grid takes its bounds from
   data/coast.json and has CELLS_PER_UNIT cells per map unit, about 93 m.
3. It raises the drying flats, which the grid shows too low (see below).
4. Each map cell keeps the highest value among the 20 m cells inside it, which is the shallowest water.
   A map cell therefore never shows deeper water than the shallowest 20 m cell inside it.
5. It converts the grid's heights to depths below chart datum and writes the two files.
6. It prints a report: the projection, the vertical datum, the cells of water the grid does not cover, and
   the cells of water that dry or lie within 2 m of LAT.

The vertical datum. The record states that the bathymetry is reduced to Lowest Astronomical Tide (LAT) and
that the land heights come from LiDAR in New Zealand Vertical Datum 2016 (NZVD2016). It does not say where the
two sources meet. At Auckland the two datums are about 1.9 m apart. A check against the LINZ charts found the
grid's 0 m line on the charts' drying line, and the grid's drying flats within 1 m of the charts' drying
heights, so the script reads every value as a height above LAT. docs/depth-map.md records the check.

The drying flats. tools/soundings.py compared the grid with the LINZ chart soundings. Below LAT the two agree.
Where the grid reads at or above LAT, the charts' drying heights read a median 0.3 to 0.5 m higher, so the grid
shows the flats with too much water. The script raises every 20 m value at or above LAT by DRY_RAISE_M. Between
LAT and DRY_RAMP_M below it, the raise grows in a straight line from nothing, so the depths stay continuous.

data/depth.png holds one value per cell in its red and green channels: v = red * 256 + green.
  v = 0     no data
  v = 1     land: more than LAND_M above LAT
  v >= 2    depth below chart datum in decimeters is v - OFFSET_DM. A negative depth is a drying height.
"""
import hashlib, json, math, pathlib, re, struct, sys, urllib.request, zlib
import numpy as np

URL = 'https://zenodo.org/api/records/15887269/files/Hauraki_topobathy_DEM.tif/content'
MD5 = '5c582a02eea1102c012b6edf08024cb4'
SOURCE = ('K. Mackay (2025), Hauraki Gulf BathyTopo Digital Elevation Model, 20 m cells, Zenodo, '
          'doi:10.5281/zenodo.15887269, published 15 July 2025. A revised version of Mackay et al. (2012), '
          'Hauraki Gulf, NIWA Chart Miscellaneous Series 91. CC BY 4.0. Not to be used for navigation.')
DATUM = ('Bathymetry: Lowest Astronomical Tide (LAT). Land heights: New Zealand Vertical Datum 2016, from LINZ '
         'LiDAR. The record does not say where the two sources meet. A check against the LINZ charts placed the '
         "grid's 0 m line on the charts' drying line, so every value is read as a height above LAT.")
EPSG = 3994                 # WGS 84 / Mercator 41: Mercator on WGS 84, true scale at 41 S, central meridian 100 E
CELLS_PER_UNIT = 4          # map cells per map unit; a map unit is 1/300 degree of latitude, about 371 m
LAT_ABOVE_CD = 0.0          # LAT above chart datum, meters. The page's tide model gives 0.10 m at Auckland;
                            # 0 errs on the side of less water.
LAND_M = 4.0                # a cell more than this above LAT is land: highest astronomical tide is about 3.6 m
SHALLOW_M = -2.0            # the report counts water cells from this height above LAT up to LAND_M
DRY_RAISE_M = 0.4           # the raise of heights at or above LAT: the median gap to the LINZ drying heights
DRY_RAMP_M = 0.5            # the raise grows from nothing at this depth below LAT to DRY_RAISE_M at LAT
OFFSET_DM = 100             # stored value of a depth of 0 m; drying heights down to 9.8 m fit
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_PNG, OUT_JSON = ROOT / 'data' / 'depth.png', ROOT / 'data' / 'depth.json'

# Named areas for the report: west, east, south, north, in degrees.
AREAS = {
    'Upper Waitematā Harbour': (174.55, 174.72, -36.86, -36.74),
    'Tāmaki Estuary': (174.83, 174.95, -36.95, -36.85),
    'Firth of Thames': (175.25, 175.60, -37.26, -37.00),
    'Mahurangi Harbour': (174.68, 174.76, -36.52, -36.42),
}


def read_tiff(path):
    """The first image of an uncompressed GeoTIFF of 32-bit floats: (values, west, north, cell, epsg)."""
    raw = pathlib.Path(path).read_bytes()
    bo = {b'II': '<', b'MM': '>'}.get(raw[:2])
    if not bo or struct.unpack(bo + 'H', raw[2:4])[0] != 42:
        sys.exit('Not a classic TIFF file: ' + str(path))
    size = {1: 1, 2: 1, 3: 2, 4: 4, 12: 8, 16: 8}
    code = {1: 'B', 2: 's', 3: 'H', 4: 'I', 12: 'd', 16: 'Q'}
    ifd = struct.unpack(bo + 'I', raw[4:8])[0]
    n = struct.unpack(bo + 'H', raw[ifd:ifd + 2])[0]
    tags = {}
    for i in range(n):
        tag, typ, cnt, val = struct.unpack(bo + 'HHI4s', raw[ifd + 2 + 12 * i: ifd + 14 + 12 * i])
        nb = size.get(typ, 1) * cnt
        at = struct.unpack(bo + 'I', val)[0]
        data = val[:nb] if nb <= 4 else raw[at:at + nb]
        tags[tag] = data.rstrip(b'\0').decode('latin-1') if typ == 2 else struct.unpack(bo + code.get(typ, 'B') * cnt, data)
    one = lambda t, d=None: tags[t][0] if t in tags else d
    if one(259, 1) != 1 or one(258) != 32 or one(339, 1) != 3 or one(277, 1) != 1:
        sys.exit('The grid must be one band of uncompressed 32-bit floats.')
    keys = tags.get(34735, ())
    geo = {keys[4 * k]: keys[4 * k + 3] for k in range(1, keys[3] + 1)} if keys else {}
    epsg = geo.get(3072)
    if geo.get(1025, 1) != 1:
        sys.exit('The grid must give the corners of its cells (PixelIsArea).')
    W, H = one(256), one(257)
    a = np.full((H, W), np.nan, np.float32)
    dt = np.dtype(bo + 'f4')
    if 322 in tags:
        tw, th = one(322), one(323)
        across = (W + tw - 1) // tw
        for k, (o, nb) in enumerate(zip(tags[324], tags[325])):
            r, c = divmod(k, across)
            t = np.frombuffer(raw, dt, tw * th, o).reshape(th, tw)
            h, w = min(th, H - r * th), min(tw, W - c * tw)
            a[r * th:r * th + h, c * tw:c * tw + w] = t[:h, :w]
    else:
        rps = one(278, H)
        for k, o in enumerate(tags[273]):
            rows = min(rps, H - k * rps)
            a[k * rps:k * rps + rows] = np.frombuffer(raw, dt, rows * W, o).reshape(rows, W)
    nodata = float(tags[42113]) if 42113 in tags else None
    if nodata is not None:
        a[a == np.float32(nodata)] = np.nan
    a[~np.isfinite(a) | (np.abs(a) > 1e30)] = np.nan
    cell = tags[33550][0]
    if abs(tags[33550][1] - cell) > 1e-9:
        sys.exit('The grid cells must be square.')
    tp = tags[33922]
    return a, tp[3] - tp[0] * cell, tp[4] + tp[1] * cell, cell, epsg


def mercator41_to_lonlat(x, y):
    """EPSG:3994 to degrees. Mercator (variant B) on WGS 84, standard parallel 41 S, central meridian 100 E."""
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    e = math.sqrt(e2)
    s1 = math.sin(math.radians(-41.0))
    k0 = math.cos(math.radians(-41.0)) / math.sqrt(1 - e2 * s1 * s1)
    lon = 100.0 + np.degrees(np.asarray(x, float) / (a * k0))
    t = np.exp(-np.asarray(y, float) / (a * k0))
    phi = math.pi / 2 - 2 * np.arctan(t)
    for _ in range(10):
        s = np.sin(phi)
        phi = math.pi / 2 - 2 * np.arctan(t * ((1 - e * s) / (1 + e * s)) ** (e / 2))
    return lon, np.degrees(phi)


def raise_drying(a):
    """Heights above LAT, with the drying flats raised: DRY_RAISE_M at or above LAT, less below it, and nothing
    from DRY_RAMP_M below LAT down. NaN stays NaN."""
    share = np.clip((a + DRY_RAMP_M) / DRY_RAMP_M, 0.0, 1.0)
    return (a + DRY_RAISE_M * share).astype(np.float32)


def shallowest(a, rows, cols, ny, nx):
    """Reduces a to (ny, nx). rows[i] and cols[j] give the map cell of each 20 m row and column, or -1 outside
    the map. Each map cell keeps the highest value of the 20 m cells inside it; NaN only where all are NaN."""
    def along(v, idx, n, axis):
        keep = np.nonzero(idx >= 0)[0]
        v = np.take(v, keep, axis=axis)
        idx = idx[keep]
        if np.any(np.diff(idx) < 0):
            sys.exit('The grid rows or columns are not in map order.')
        starts = np.r_[0, np.nonzero(np.diff(idx))[0] + 1]
        red = np.fmax.reduceat(v, starts, axis=axis)
        shape = list(v.shape)
        shape[axis] = n
        out = np.full(shape, np.nan, np.float32)
        if axis == 0:
            out[idx[starts]] = red
        else:
            out[:, idx[starts]] = red
        return out
    return along(along(a, rows, ny, 0), cols, nx, 1)


def water_mask(coast, ny, nx):
    """The page's water, at the centers of the map cells: outside every land ring of data/coast.json (even-odd)."""
    rings = [np.array([[float(p) for p in xy.split(',')] for xy in ring.split()]) for ring in re.findall(r'M([^MZ]+)Z', coast['path'])]
    edges = np.concatenate([np.hstack([r, np.roll(r, -1, axis=0)]) for r in rings])
    x1, y1, x2, y2 = (edges[:, i] * CELLS_PER_UNIT for i in range(4))
    land = np.zeros((ny, nx), bool)
    for j in range(ny):
        yc = j + 0.5
        m = (y1 <= yc) != (y2 <= yc)
        xs = x1[m] + (yc - y1[m]) * (x2[m] - x1[m]) / (y2[m] - y1[m])
        toggle = np.zeros(nx + 1, int)
        np.add.at(toggle, np.clip(np.ceil(xs - 0.5).astype(int), 0, nx), 1)
        land[j] = (np.cumsum(toggle)[:nx] % 2) == 1
    return ~land


def write_png(path, rgb):
    """An 8-bit RGB PNG with no color profile. Each row takes the filter that gives the smallest sum of bytes."""
    h, w, _ = rgb.shape
    cur = rgb.reshape(h, w * 3).astype(np.int16)
    prev = np.vstack([np.zeros((1, w * 3), np.int16), cur[:-1]])
    left = np.hstack([np.zeros((h, 3), np.int16), cur[:, :-3]])
    upleft = np.hstack([np.zeros((h, 3), np.int16), prev[:, :-3]])
    p = left + prev - upleft
    pa, pb, pc = np.abs(p - left), np.abs(p - prev), np.abs(p - upleft)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, prev, upleft))
    cands = [cur, cur - left, cur - prev, cur - (left + prev) // 2, cur - paeth]
    cands = [(c % 256).astype(np.uint8) for c in cands]
    cost = np.stack([np.minimum(c, 256 - c.astype(np.int16)).sum(axis=1) for c in cands])
    best = cost.argmin(axis=0)
    rows = b''.join(bytes([best[i]]) + cands[best[i]][i].tobytes() for i in range(h))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
           chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))
    pathlib.Path(path).write_bytes(png)
    return len(png)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if not src:
        src = ROOT / 'Hauraki_topobathy_DEM.tif'
        print('Downloading', URL)
        urllib.request.urlretrieve(URL, src)
    md5 = hashlib.md5(pathlib.Path(src).read_bytes()).hexdigest()
    if md5 != MD5:
        print('Warning: the file differs from the published grid (md5 %s, expected %s).' % (md5, MD5))
    a, west, north, cell, epsg = read_tiff(src)
    if epsg != EPSG:
        sys.exit('The grid is in EPSG:%s. This script reads EPSG:%d only.' % (epsg, EPSG))
    H, W = a.shape
    lon, _ = mercator41_to_lonlat(west + (np.arange(W) + 0.5) * cell, 0.0)
    _, lat = mercator41_to_lonlat(0.0, north - (np.arange(H) + 0.5) * cell)

    coast = json.loads((ROOT / 'data' / 'coast.json').read_text())
    nx, ny = math.ceil(coast['w'] * CELLS_PER_UNIT), math.ceil(coast['h'] * CELLS_PER_UNIT)
    cx = np.floor((lon - coast['W']) * coast['k'] * coast['scale'] * CELLS_PER_UNIT).astype(int)
    cy = np.floor((coast['N'] - lat) * coast['scale'] * CELLS_PER_UNIT).astype(int)
    cx[(cx < 0) | (cx >= nx)] = -1
    cy[(cy < 0) | (cy >= ny)] = -1
    elev = shallowest(raise_drying(a), cy, cx, ny, nx)   # height above LAT; the shallowest 20 m cell in each map cell

    depth = LAT_ABOVE_CD - elev                    # meters below chart datum
    v = np.zeros((ny, nx), np.int32)
    have = np.isfinite(elev)
    v[have & (elev > LAND_M)] = 1
    sea = have & (elev <= LAND_M)
    v[sea] = np.clip(np.round(depth[sea] * 10).astype(int) + OFFSET_DM, 2, 65535)
    rgb = np.zeros((ny, nx, 3), np.uint8)
    rgb[..., 0], rgb[..., 1] = v >> 8, v & 255
    png_bytes = write_png(OUT_PNG, rgb)

    cell_m = 111_200.0 / coast['scale'] / CELLS_PER_UNIT
    meta = {
        'source': SOURCE,
        'file': pathlib.Path(src).name, 'md5': md5,
        'projection': 'EPSG:3994, WGS 84 / Mercator 41. Read from the file.',
        'datum': DATUM,
        'depth': 'Meters below chart datum. Chart datum is taken as LAT (latAboveCd).',
        'latAboveCd': LAT_ABOVE_CD,
        'drying': ('Heights at or above LAT are raised by %g m, and heights within %g m below LAT by a share of it, '
                   'because the LINZ drying heights read higher than the grid.' % (DRY_RAISE_M, DRY_RAMP_M)),
        'reduced': 'Each cell keeps the shallowest of the %g m cells whose centers fall inside it.' % cell,
        'W': coast['W'], 'E': coast['E'], 'S': coast['S'], 'N': coast['N'], 'k': coast['k'], 'scale': coast['scale'],
        'cellsPerUnit': CELLS_PER_UNIT, 'cellM': round(cell_m, 1), 'nx': nx, 'ny': ny,
        'encoding': {'value': 'red * 256 + green', 'noData': 0, 'land': 1, 'landAboveLat': LAND_M, 'offsetDm': OFFSET_DM},
    }
    OUT_JSON.write_text(json.dumps(meta, ensure_ascii=False, indent=1) + '\n')

    # The report.
    water = water_mask(coast, ny, nx)
    gap = water & ~have
    shallow = water & have & (elev >= SHALLOW_M) & (elev <= LAND_M)
    landish = water & have & (elev > LAND_M)
    print()
    print('Source      ', SOURCE)
    print('File        ', pathlib.Path(src).name, 'md5', md5, '(matches the record)' if md5 == MD5 else '(DIFFERS)')
    print('Projection   EPSG:%d, WGS 84 / Mercator 41, read from the file. %g m cells.' % (epsg, cell))
    print('Datum       ', DATUM)
    print('Chart datum  Depths are below LAT, with LAT taken as chart datum (LAT_ABOVE_CD = %g m).' % LAT_ABOVE_CD)
    print('Drying flats Heights at or above LAT raised by %g m, ramped in over the %g m below LAT.' % (DRY_RAISE_M, DRY_RAMP_M))
    print('Map grid     %d x %d cells of %.1f m, from %s.' % (nx, ny, cell_m, 'data/coast.json'))
    print('Output       %s, %d bytes%s; %s.' % (OUT_PNG.relative_to(ROOT), png_bytes,
          ' (over 1 MB)' if png_bytes > 1_000_000 else '', OUT_JSON.relative_to(ROOT)))
    km2 = (cell_m / 1000) ** 2
    n_w = int(water.sum())
    print()
    print('Coverage of the page\'s water (cells inside the coastline of data/coast.json): %d cells, %.0f km2.' % (n_w, n_w * km2))
    print('  No data:                            %7d cells  %5.1f%%' % (gap.sum(), 100 * gap.sum() / n_w))
    print('  Height %+.0f to %+.0f m above LAT:      %7d cells  %5.1f%%  dries, or under 2 m at LAT' % (SHALLOW_M, LAND_M, shallow.sum(), 100 * shallow.sum() / n_w))
    print('  More than %.0f m above LAT (land):    %7d cells  %5.1f%%' % (LAND_M, landish.sum(), 100 * landish.sum() / n_w))
    print('  Deeper than %.0f m below LAT:          %7d cells  %5.1f%%' % (-SHALLOW_M, (water & have & (elev < SHALLOW_M)).sum(),
          100 * (water & have & (elev < SHALLOW_M)).sum() / n_w))
    jj, ii = np.mgrid[0:ny, 0:nx]
    clon = coast['W'] + (ii + 0.5) / CELLS_PER_UNIT / (coast['k'] * coast['scale'])
    clat = coast['N'] - (jj + 0.5) / CELLS_PER_UNIT / coast['scale']
    print()
    print('By area: water cells, no data, dries or under 2 m at LAT.')
    for name, (w0, e0, s0, n0) in AREAS.items():
        m = water & (clon >= w0) & (clon <= e0) & (clat >= s0) & (clat <= n0)
        print('  %-26s %6d  %6d  %6d  %5.1f%%' % (name, m.sum(), (m & gap).sum(), (m & shallow).sum(), 100 * (m & shallow).sum() / max(1, m.sum())))


if __name__ == '__main__':
    main()
