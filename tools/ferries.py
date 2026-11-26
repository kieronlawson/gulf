"""Writes data/ferries.json: the paths of Auckland Transport's ferry routes inside the map.

Source: Auckland Transport's GTFS feed, https://gtfs.at.govt.nz/gtfs.zip, CC BY 4.0.
Usage: python3 tools/ferries.py [path to gtfs.zip]
Without a path, the script downloads the feed, about 32 MB. It needs only the Python standard library.

Each lane is named after the two ends of its route's most common trip, as "Downtown – Waiheke". Routes with
the same name, such as the three Downtown to Waiheke services, share one lane. The paths are simplified to
about TOLERANCE_M and rounded to 4 decimal places, about 10 m. A lane carries no timetable.
"""
import collections, csv, io, json, math, pathlib, re, sys, urllib.request, zipfile

W, E, S, N = 174.52, 175.66, -37.26, -35.97   # map bounds, degrees, as in tools/coast.py
TOLERANCE_M = 40                              # simplification, meters
URL = 'https://gtfs.at.govt.nz/gtfs.zip'
OUT = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'ferries.json'
M_PER_DEG = 111_200.0
COS_LAT = math.cos(math.radians((S + N) / 2))


def rows(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), 'utf-8-sig'))


def place(stop_name):
    """A terminal's name without the words that every terminal shares: "Downtown Ferry Terminal Pier 1" is Downtown."""
    s = re.sub(r'\s+(Sealink\s+)?Ferry Terminal.*$', '', stop_name.strip())
    return re.sub(r'\s+Wharf$', '', s)


def simplify(pts, tol):
    """Douglas-Peucker on [lon, lat] points, with the tolerance in meters."""
    if len(pts) < 3:
        return pts
    def xy(p):
        return (p[0] * COS_LAT * M_PER_DEG, p[1] * M_PER_DEG)
    a, b = xy(pts[0]), xy(pts[-1])
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    far, at = -1.0, 0
    for i in range(1, len(pts) - 1):
        p = xy(pts[i])
        d = abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / L if L else math.hypot(p[0] - a[0], p[1] - a[1])
        if d > far:
            far, at = d, i
    if far <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:at + 1], tol)[:-1] + simplify(pts[at:], tol)


def inside(p):
    return W <= p[0] <= E and S <= p[1] <= N


def clip(pts):
    """The runs of a path inside the map. A run that leaves the map ends at its last point inside."""
    runs, cur = [], []
    for p in pts:
        if inside(p):
            cur.append(p)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    data = open(src, 'rb').read() if src else urllib.request.urlopen(URL, timeout=120).read()
    z = zipfile.ZipFile(io.BytesIO(data))
    feed = next(rows(z, 'feed_info.txt'))
    routes = {r['route_id']: r for r in rows(z, 'routes.txt') if r['route_type'] == '4'}
    stops = {s['stop_id']: s['stop_name'] for s in rows(z, 'stops.txt')}

    shapes_of, trip_route, heads = collections.defaultdict(set), {}, collections.defaultdict(collections.Counter)
    for t in rows(z, 'trips.txt'):
        if t['route_id'] in routes:
            trip_route[t['trip_id']] = t['route_id']
            heads[t['route_id']][t.get('trip_headsign', '')] += 1
            if t.get('shape_id'):
                shapes_of[t['route_id']].add(t['shape_id'])

    # The first and last stop of every ferry trip.
    ends = {}
    for st in rows(z, 'stop_times.txt'):
        tid = st['trip_id']
        if tid not in trip_route:
            continue
        seq = int(st['stop_sequence'])
        e = ends.setdefault(tid, [None, math.inf, None, -math.inf])
        if seq < e[1]:
            e[0], e[1] = st['stop_id'], seq
        if seq > e[3]:
            e[2], e[3] = st['stop_id'], seq
    pairs = collections.defaultdict(collections.Counter)
    for tid, e in ends.items():
        pairs[trip_route[tid]][(place(stops[e[0]]), place(stops[e[2]]))] += 1

    def lane_name(rid):
        a, b = pairs[rid].most_common(1)[0][0]
        if a == b:   # a round trip, such as a harbor cruise: its headsign names it
            return heads[rid].most_common(1)[0][0]
        if b == 'Downtown':
            a, b = b, a
        return a + ' – ' + b

    wanted = {sid for rid in routes for sid in shapes_of[rid]}
    raw = collections.defaultdict(list)
    for p in rows(z, 'shapes.txt'):
        if p['shape_id'] in wanted:
            raw[p['shape_id']].append((int(p['shape_pt_sequence']), float(p['shape_pt_lon']), float(p['shape_pt_lat'])))

    lanes = {}
    for rid in sorted(routes):
        if not pairs[rid]:   # a route with no trips in the feed's period, such as a seasonal service, has no lane
            print('  skipped', routes[rid]['route_short_name'], '(no trips)')
            continue
        name = lane_name(rid)
        lane = lanes.setdefault(name, {'name': name, 'routes': [], 'paths': []})
        lane['routes'].append(routes[rid]['route_short_name'])
        for sid in sorted(shapes_of[rid]):
            pts = [[lon, lat] for _, lon, lat in sorted(raw[sid])]
            for run in clip(pts):
                path = [[round(q[0], 4), round(q[1], 4)] for q in simplify(run, TOLERANCE_M)]
                if path not in lane['paths']:
                    lane['paths'].append(path)

    out = {
        'source': 'Auckland Transport GTFS feed ' + feed.get('feed_version', '') + ', valid ' + feed.get('feed_start_date', '') +
                  ' to ' + feed.get('feed_end_date', '') + '. CC BY 4.0.',
        'lanes': sorted(lanes.values(), key=lambda l: l['name'])
    }
    OUT.write_text(json.dumps(out, separators=(',', ':')) + '\n')
    n = sum(len(p) for l in out['lanes'] for p in l['paths'])
    print(f"{len(out['lanes'])} lanes, {sum(len(l['paths']) for l in out['lanes'])} paths, {n} points, {OUT.stat().st_size} bytes")
    for l in out['lanes']:
        print(' ', l['name'], l['routes'], len(l['paths']), 'paths')


if __name__ == '__main__':
    main()
