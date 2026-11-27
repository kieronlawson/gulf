"""Writes data/contours.json: depth contours at 2, 5, 10, 20, 30 and 50 m below chart datum, drawn from
data/depth.png, so the lines agree with the depths the page gives. Not for navigation.

Usage: python3 tools/contours.py
It needs Python 3 and numpy, and reads data/depth.png and data/depth.json, which tools/depth.py writes.

What the script does:
1. It reads the chart depth of every cell. A land cell counts as shallower than any contour.
2. For each depth, it traces the line between the cells shallower than it and the cells as deep or deeper, by
   marching squares through the cells' centers. Where the line crosses between two centers, it lies where the
   depth between them, taken in a straight line, equals the contour's depth.
3. It drops closed lines shorter than MIN_LOOP map units, which ring one or two cells and would only clutter
   the map. The page's hatching still shows those shoals.
4. It simplifies each line so that no point moves more than TOLERANCE map units from it.
5. It chooses label points along each line, LABEL_STEP map units apart, each with the line's angle.
6. It writes one SVG path per depth, in map units, and the label points.

The output holds { depths, paths, labels, source }. paths maps a depth to an SVG path. Each label is
[x, y, depth, angle in degrees, tier]: tier 0 labels lie 2 * LABEL_STEP apart along a line, and tier 1 labels
fill the gaps between them, so the page can show more labels as it zooms in.
"""
import json, math, pathlib, sys
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import depth  # noqa: E402  tools/depth.py: the PNG reader

DEPTHS = [2, 5, 10, 20, 30, 50]
LAND_M = -10.0              # the depth a land cell counts as: above every contour
TOLERANCE = 0.12            # map units, about 45 m: the most a simplified line moves from the traced one
MIN_LOOP = 2.0              # map units, about 740 m: closed lines shorter than this are dropped
LABEL_STEP = 45.0           # map units along a line between labels of either tier
LABEL_MIN = 12.0            # map units: a line shorter than this gets no label
MAX_BYTES = 300_000
ROOT = depth.ROOT
OUT = ROOT / 'data' / 'contours.json'

# For each case of marching squares, the edges the line joins. Corners: top left 8, top right 4, bottom right 2,
# bottom left 1, set where the cell is shallower than the contour. Edges: T top, R right, B bottom, L left.
# Cases 5 and 10 are saddles; the depth at the square's center decides them.
SEGMENTS = {1: [('L', 'B')], 2: [('B', 'R')], 3: [('L', 'R')], 4: [('T', 'R')], 6: [('T', 'B')], 7: [('L', 'T')],
            8: [('T', 'L')], 9: [('T', 'B')], 11: [('T', 'R')], 12: [('L', 'R')], 13: [('B', 'R')], 14: [('L', 'B')]}
SADDLE = {(5, True): [('T', 'L'), ('B', 'R')], (5, False): [('T', 'R'), ('L', 'B')],
          (10, True): [('T', 'R'), ('L', 'B')], (10, False): [('T', 'L'), ('B', 'R')]}


def trace(f, level):
    """Lines of f at level, as lists of (x, y) in cell units from the first cell's center. f holds one value per
    cell; a cell shallower than level is inside."""
    ny, nx = f.shape
    inside = f < level
    case = (inside[:-1, :-1] * 8 + inside[:-1, 1:] * 4 + inside[1:, 1:] * 2 + inside[1:, :-1] * 1).astype(np.int8)
    center = (f[:-1, :-1] + f[:-1, 1:] + f[1:, 1:] + f[1:, :-1]) / 4 < level
    js, is_ = np.nonzero((case != 0) & (case != 15))

    def edge(e, j, i):
        """An edge's id: a horizontal edge joins cells (j, i) and (j, i + 1), a vertical edge (j, i) and (j + 1, i)."""
        if e == 'T': return 2 * (j * nx + i)
        if e == 'B': return 2 * ((j + 1) * nx + i)
        if e == 'L': return 2 * (j * nx + i) + 1
        return 2 * (j * nx + i + 1) + 1

    def point(eid):
        k, vert = divmod(eid, 2)
        j, i = divmod(k, nx)
        if vert:
            a, b = f[j, i], f[j + 1, i]
            return (i, j + (level - a) / (b - a))
        a, b = f[j, i], f[j, i + 1]
        return (i + (level - a) / (b - a), j)

    links = {}
    for j, i in zip(js.tolist(), is_.tolist()):
        c = int(case[j, i])
        segs = SADDLE[(c, bool(center[j, i]))] if c in (5, 10) else SEGMENTS[c]
        for a, b in segs:
            ea, eb = edge(a, j, i), edge(b, j, i)
            links.setdefault(ea, []).append(eb)
            links.setdefault(eb, []).append(ea)

    lines, seen = [], set()
    def walk(start):
        line, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [e for e in links[cur] if e != prev and e not in seen]
            if not nxt:
                if len(line) > 2 and start in links[cur] and prev is not None:
                    line.append(start)       # a closed line
                return line
            prev, cur = cur, nxt[0]
            seen.add(cur)
            line.append(cur)
    for e, nb in links.items():          # open lines first: they end at the edge of the grid
        if len(nb) == 1 and e not in seen:
            lines.append(walk(e))
    for e in links:
        if e not in seen:
            lines.append(walk(e))
    return [[point(e) for e in line] for line in lines]


def simplify(pts, tol):
    """Ramer-Douglas-Peucker: the points of pts that keep the line within tol of every point."""
    if len(pts) < 3:
        return pts
    a = np.asarray(pts, float)
    keep = np.zeros(len(a), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(a) - 1)]
    while stack:
        s, e = stack.pop()
        if e - s < 2:
            continue
        p, q = a[s], a[e]
        seg = a[s + 1:e]
        d = q - p
        n = math.hypot(d[0], d[1])
        if n == 0:
            dist = np.hypot(seg[:, 0] - p[0], seg[:, 1] - p[1])
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / n
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = s + 1 + k
            keep[m] = True
            stack.append((s, m))
            stack.append((m, e))
    return [tuple(x) for x in a[keep]]


def length(pts):
    return sum(math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) for k in range(len(pts) - 1))


def labels_along(pts, level):
    """Label points along a line: one every LABEL_STEP map units, starting half a step in, alternating tiers."""
    out, total = [], length(pts)
    if total < LABEL_MIN:
        return out
    n = max(1, int(total // LABEL_STEP))
    first = (total - (n - 1) * LABEL_STEP) / 2
    targets = [first + k * LABEL_STEP for k in range(n)]
    run, k, t = 0.0, 0, 0
    while t < len(targets) and k < len(pts) - 1:
        (x0, y0), (x1, y1) = pts[k], pts[k + 1]
        seg = math.hypot(x1 - x0, y1 - y0)
        if run + seg >= targets[t] and seg > 0:
            u = (targets[t] - run) / seg
            ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
            if ang > 90: ang -= 180            # keep the text upright
            if ang < -90: ang += 180
            out.append([round(x0 + u * (x1 - x0), 1), round(y0 + u * (y1 - y0), 1), level, round(ang), t % 2])
            t += 1
        else:
            run += seg
            k += 1
    return out


def main():
    meta = json.loads((ROOT / 'data' / 'depth.json').read_text())
    v = depth.read_png(ROOT / 'data' / 'depth.png')
    off, R = meta['encoding']['offsetDm'], meta['cellsPerUnit']
    f = np.where(v >= 2, (v - off) / 10.0, LAND_M)          # chart depth; land and no data count as land
    paths, labels, report = {}, [], []
    for level in DEPTHS:
        lines = trace(f, level)
        kept, dropped = [], 0
        for line in lines:
            pts = [((x + 0.5) / R, (y + 0.5) / R) for x, y in line]   # cell centers to map units
            closed = pts[0] == pts[-1]
            if closed and length(pts) < MIN_LOOP:
                dropped += 1
                continue
            pts = simplify(pts, TOLERANCE)
            if len(pts) < 2:
                continue
            kept.append(pts)
            labels.extend(labels_along(pts, level))
        paths[str(level)] = ''.join('M' + ' '.join('%.1f,%.1f' % p for p in pts) for pts in kept)
        report.append((level, len(kept), dropped, sum(len(p) for p in kept)))
    out = {
        'source': 'Drawn by tools/contours.py from data/depth.png: ' + meta['source'],
        'depths': DEPTHS,
        'paths': paths,
        'labels': labels,
    }
    text = json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n'
    OUT.write_text(text)
    for level, n, dropped, npts in report:
        print('%3d m  %5d lines  %6d points  %5d small loops dropped' % (level, n, npts, dropped))
    print('%d labels. %s, %d bytes%s.' % (len(labels), OUT.relative_to(ROOT), len(text.encode()),
          ' (over %d)' % MAX_BYTES if len(text.encode()) > MAX_BYTES else ''))


if __name__ == '__main__':
    main()
