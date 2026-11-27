"""Tests for tools/depth.py on made-up grids. Run: python3 test/depth_tool_test.py (needs numpy)."""
import pathlib, struct, sys, tempfile, unittest, zlib
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'tools'))
import depth as D


def geotiff(path, a, west, north, cell, epsg, tile=None, nodata=None):
    """A little-endian GeoTIFF of 32-bit floats, tiled when tile is given, else one strip per row."""
    h, w = a.shape
    tags, blobs = [], []
    if tile:
        across, down = -(-w // tile), -(-h // tile)
        pad = np.full((down * tile, across * tile), 0, np.float32)
        pad[:h, :w] = a
        for r in range(down):
            for c in range(across):
                blobs.append(pad[r * tile:(r + 1) * tile, c * tile:(c + 1) * tile].astype('<f4').tobytes())
    else:
        blobs = [a[r].astype('<f4').tobytes() for r in range(h)]
    data = b''.join(blobs)
    base = 8
    offsets, o = [], base
    for b in blobs:
        offsets.append(o)
        o += len(b)
    extra = bytearray()
    def ext(fmt, vals):
        at = base + len(data) + len(extra)
        extra.extend(struct.pack('<' + fmt * len(vals), *vals))
        return at
    keys = [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, epsg]
    entries = [(256, 3, 1, w), (257, 3, 1, h), (258, 3, 1, 32), (259, 3, 1, 1), (277, 3, 1, 1), (339, 3, 1, 3)]
    if tile:
        entries += [(322, 3, 1, tile), (323, 3, 1, tile),
                    (324, 4, len(offsets), ext('I', offsets) if len(offsets) > 1 else offsets[0]),
                    (325, 4, len(blobs), ext('I', [len(b) for b in blobs]) if len(blobs) > 1 else len(blobs[0]))]
    else:
        entries += [(273, 4, h, ext('I', offsets) if h > 1 else offsets[0]), (278, 3, 1, 1),
                    (279, 4, h, ext('I', [len(b) for b in blobs]) if h > 1 else len(blobs[0]))]
    entries += [(33550, 12, 3, ext('d', [cell, cell, 0.0])), (33922, 12, 6, ext('d', [0, 0, 0, west, north, 0])),
                (34735, 3, len(keys), ext('H', keys))]
    if nodata is not None:
        s = ('%r' % nodata).encode() + b'\0'
        at = base + len(data) + len(extra)
        extra.extend(s)
        entries.append((42113, 2, len(s), at))
    entries.sort()
    ifd_at = base + len(data) + len(extra)
    ifd = struct.pack('<H', len(entries))
    for tag, typ, cnt, val in entries:
        packed = struct.pack('<H', val) + b'\0\0' if typ == 3 and cnt == 1 else struct.pack('<I', val)
        ifd += struct.pack('<HHI', tag, typ, cnt) + packed
    ifd += b'\0\0\0\0'
    pathlib.Path(path).write_bytes(b'II' + struct.pack('<HI', 42, ifd_at) + data + bytes(extra) + ifd)


def unpng(raw):
    """Decodes an 8-bit RGB PNG with any of the five row filters."""
    assert raw[:8] == b'\x89PNG\r\n\x1a\n'
    i, idat = 8, b''
    while i < len(raw):
        n = struct.unpack('>I', raw[i:i + 4])[0]
        kind, body = raw[i + 4:i + 8], raw[i + 8:i + 8 + n]
        if kind == b'IHDR':
            w, h = struct.unpack('>II', body[:8])
        if kind == b'IDAT':
            idat += body
        i += 12 + n
    rows, stride, out = zlib.decompress(idat), w * 3, []
    prev = bytearray(stride)
    for r in range(h):
        f, line = rows[r * (stride + 1)], bytearray(rows[r * (stride + 1) + 1:(r + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - 3] if x >= 3 else 0
            b, c = prev[x], prev[x - 3] if x >= 3 else 0
            p = a + b - c
            pr = a if abs(p - a) <= abs(p - b) and abs(p - a) <= abs(p - c) else (b if abs(p - b) <= abs(p - c) else c)
            line[x] = (line[x] + [0, a, b, (a + b) // 2, pr][f]) % 256
        out.append(bytes(line))
        prev = line
    return np.frombuffer(b''.join(out), np.uint8).reshape(h, w, 3)


class Shallowest(unittest.TestCase):
    def test_one_shoal_survives(self):
        a = np.full((20, 20), -12.0, np.float32)
        a[13, 6] = -1.2                       # one 20 m shoal, 1.2 m below LAT, in cell (2, 1)
        idx = np.arange(20) // 5              # five 20 m cells to each map cell
        r = D.shallowest(a, idx, idx, 4, 4)
        self.assertAlmostEqual(float(r[2, 1]), -1.2, places=5)
        r[2, 1] = -12.0
        self.assertTrue(np.all(r == -12.0))

    def test_cell_edge(self):
        a = np.full((10, 10), -8.0, np.float32)
        a[4, 4], a[5, 5] = -2.0, -3.0         # rows and columns 4 and 5 sit either side of a cell edge
        idx = np.arange(10) // 5
        r = D.shallowest(a, idx, idx, 2, 2)
        self.assertEqual(r[0, 0], -2.0)
        self.assertEqual(r[1, 1], -3.0)
        self.assertEqual(r[0, 1], -8.0)

    def test_no_data(self):
        a = np.full((4, 4), np.nan, np.float32)
        a[0, 0] = -5.0
        idx = np.arange(4) // 2
        r = D.shallowest(a, idx, idx, 2, 2)
        self.assertEqual(r[0, 0], -5.0)
        self.assertTrue(np.isnan(r[1, 1]))

    def test_drying_flats_raised(self):
        a = np.array([-5.0, -0.5, -0.25, 0.0, 1.2, np.nan], np.float32)
        r = D.raise_drying(a)
        self.assertEqual(float(r[0]), -5.0, 'deeper water keeps its value')
        self.assertAlmostEqual(float(r[1]), -0.5, places=5)
        self.assertAlmostEqual(float(r[2]), -0.25 + D.DRY_RAISE_M / 2, places=5, msg='half way down the ramp, half the raise')
        self.assertAlmostEqual(float(r[3]), D.DRY_RAISE_M, places=5)
        self.assertAlmostEqual(float(r[4]), 1.2 + D.DRY_RAISE_M, places=5)
        self.assertTrue(np.isnan(r[5]))

    def test_outside_the_map(self):
        a = np.arange(16, dtype=np.float32).reshape(4, 4)
        idx = np.array([-1, 0, 0, 1])         # the first row and column fall outside the map
        r = D.shallowest(a, idx, idx, 2, 2)
        self.assertEqual(r.tolist(), [[10.0, 11.0], [14.0, 15.0]])


class Files(unittest.TestCase):
    def test_tiled_and_striped(self):
        a = np.arange(30 * 21, dtype=np.float32).reshape(30, 21) - 300
        a[3, 4] = -9999
        with tempfile.TemporaryDirectory() as d:
            for tile in (16, None):
                p = pathlib.Path(d) / 'g.tif'
                geotiff(p, a, 6260000.0, -3200000.0, 20.0, 3994, tile=tile, nodata=-9999.0)
                b, west, north, cell, epsg = D.read_tiff(p)
                self.assertEqual((west, north, cell, epsg), (6260000.0, -3200000.0, 20.0, 3994))
                self.assertTrue(np.isnan(b[3, 4]))
                b[3, 4] = -9999
                self.assertTrue(np.array_equal(a, b))

    def test_mercator_41(self):
        # The grid's own record gives its corners in EPSG:3994 and in degrees.
        lon, lat = D.mercator41_to_lonlat(np.array([6253995.5, 6380275.5]), np.array([-3196936.5, -3368976.5]))
        self.assertAlmostEqual(lon[0], 174.332700, places=5)
        self.assertAlmostEqual(lon[1], 175.833618, places=5)
        self.assertAlmostEqual(lat[0], -35.666214, places=5)
        self.assertAlmostEqual(lat[1], -37.317161, places=5)

    def test_png_round_trip(self):
        rng = np.random.default_rng(3)
        v = np.cumsum(rng.integers(-3, 4, (37, 23)), axis=1) + 2000
        rgb = np.stack([v >> 8, v & 255, np.zeros_like(v)], axis=-1).astype(np.uint8)
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / 'd.png'
            D.write_png(p, rgb)
            self.assertTrue(np.array_equal(unpng(p.read_bytes()), rgb))

    def test_water_mask(self):
        coast = {'path': 'M1,1 3,1 3,3 1,3Z'}   # one square of land, 2 by 2 map units
        water = D.water_mask(coast, 20, 20)
        n = D.CELLS_PER_UNIT
        self.assertFalse(water[2 * n, 2 * n])
        self.assertTrue(water[0, 0])
        self.assertEqual((~water).sum(), (2 * n) ** 2)


if __name__ == '__main__':
    unittest.main()
