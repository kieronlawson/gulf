"""Writes data/marks.json: rocks, wrecks, obstructions, buoys, beacons, lights, restricted areas and marine farms
from the LINZ electronic chart data, inside the map's bounds. Not for navigation.

Usage: python3 tools/chartmarks.py [cache directory]
It needs Python 3 and a LINZ Data Service key in the environment variable LDS_KEY. The script sends the key only
in its requests to data.linz.govt.nz and never prints it. With a cache directory, it keeps each layer there as
<layer id>.json and reads it from there on the next run.

Source: LINZ Data Service, the "Hydro" layers made from the official electronic charts, CC BY 4.0. LINZ paused
updates to these layers in May 2024. Not for navigation.

What the script does:
1. It fetches each layer of LAYERS at three scales: Harbour (1:4k to 1:22k), Approach (1:22k to 1:90k) and Coastal
   (1:90k to 1:350k), and the coverage polygons of each scale.
2. It keeps a Harbour object wherever it lies, an Approach object outside the Harbour coverage, and a Coastal
   object outside both. An area counts as inside a coverage when the mean of its outer ring's corners is.
   Where two scales still show one object of one group within SAME_M of each other, it keeps the larger scale.
3. It joins each light to a buoy or beacon within LIGHT_M of it, and keeps the other lights as marks of their own.
4. It writes each object's name and the facts the page shows in words, in map units of data/coast.json, and
   simplifies the outlines of areas to within TOLERANCE map units. Points keep 0.1 map unit, about 37 m.

The output holds { source, texts, points, areas }. texts lists each name and detail once. A point is
[kind, x, y, name, detail], where name and detail are indexes into texts. An area is [kind, name, detail, path],
where path is an SVG path in map units. A kind is one letter, from KINDS, to keep the file under 100 KB.
"""
import json, math, os, pathlib, sys, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'marks.json'
BBOX = (-37.26, 174.52, -35.97, 175.66)    # south, west, north, east
SAME_M = 40.0               # objects of one group this close on two scales are one object
LIGHT_M = 30.0              # a light this close to a buoy or beacon belongs to it
TOLERANCE = 0.1             # map units, about 37 m: the most a simplified outline moves
MAX_BYTES = 100_000
# The one-letter kinds in the output.
KINDS = {'rock': 'r', 'wreck': 'w', 'obstruction': 'o', 'buoy': 'b', 'beacon': 'c', 'light': 'l', 'farm': 'f',
         'restricted': 'R', 'farmArea': 'F', 'foul': 'O'}
SCALES = ['Harbour', 'Approach', 'Coastal']
COVERAGE = {'Harbour': 50704, 'Approach': 50581, 'Coastal': 50473}
# Layer ids at the Harbour, Approach and Coastal scales; None where LINZ has no layer.
LAYERS = {
    'rock': (50755, 50626, 50513),
    'wreck': (50763, 50633, 50518),
    'obstruction': (50709, 50586, 50478),
    'obstructionArea': (50710, 50587, 50479),
    'beaconCardinal': (50640, 50526, 50058), 'beaconIsolated': (50641, 50527, 50059), 'beaconLateral': (50642, 50528, 50060),
    'beaconSafe': (50643, 50529, 50061), 'beaconSpecial': (50644, 50530, 50425),
    'buoyCardinal': (50646, 50531, 50426), 'buoyIsolated': (51791, 50532, 50427), 'buoyLateral': (50647, 50533, 50428),
    'buoySafe': (50648, 50534, 50429), 'buoySpecial': (50649, 50535, 50430),
    'light': (50689, 50567, 50458),
    'restricted': (50807, 50598, 50490),
    'farm': (50701, 50579, 50469),
    'farmPoint': (50700, 50578, 50470),
}

# S-57 attribute values, in words.
WATLEV = {1: 'Partly submerged at high water', 2: 'Always dry', 3: 'Always under water', 4: 'Covers and uncovers',
          5: 'Awash', 6: 'Subject to flooding', 7: 'Floating'}
CATWRK = {1: 'Wreck, not dangerous', 2: 'Dangerous wreck', 3: 'Remains of a wreck', 4: 'Wreck showing its mast',
          5: 'Wreck showing part of its hull'}
CATOBS = {1: 'Snag', 2: 'Wellhead', 3: 'Diffuser', 4: 'Crib', 5: 'Fish haven', 6: 'Foul area', 7: 'Foul ground'}
CATLAM = {1: 'Port-hand', 2: 'Starboard-hand', 3: 'Preferred channel to starboard', 4: 'Preferred channel to port'}
CATCAM = {1: 'North cardinal', 2: 'East cardinal', 3: 'South cardinal', 4: 'West cardinal'}
CATSPM = {6: 'cable mark', 8: 'outfall mark', 16: 'leading mark', 17: 'measured distance mark', 18: 'notice mark',
          27: 'general warning mark'}
RESTRN = {1: 'Anchoring prohibited', 2: 'Anchoring restricted', 3: 'Fishing prohibited', 4: 'Fishing restricted',
          5: 'Trawling prohibited', 6: 'Trawling restricted', 7: 'Entry prohibited', 8: 'Entry restricted',
          9: 'Dredging prohibited', 10: 'Dredging restricted', 11: 'Diving prohibited', 12: 'Diving restricted',
          13: 'No wake', 14: 'Area to be avoided'}
LITCHR = {1: 'F', 2: 'Fl', 3: 'LFl', 4: 'Q', 5: 'VQ', 6: 'UQ', 7: 'Iso', 8: 'Oc', 9: 'IQ', 10: 'IVQ', 11: 'IUQ',
          12: 'Mo', 13: 'FFl', 14: 'Fl+LFl', 15: 'Oc+Fl', 16: 'FLFl', 17: 'Al.Oc', 18: 'Al.LFl', 19: 'Al.Fl',
          20: 'Al.Gr', 25: 'Q+LFl', 26: 'VQ+LFl', 27: 'UQ+LFl', 28: 'Al', 29: 'Al.FFl'}
COLOUR = {1: 'W', 2: 'Bl', 3: 'R', 4: 'G', 5: 'Bu', 6: 'Y', 7: 'Gy', 8: 'Br', 9: 'Am', 10: 'Vi', 11: 'Or', 12: 'Mg', 13: 'Pk'}


def fetch(key, layer, cache):
    """The GeoJSON features of one LDS layer inside BBOX."""
    path = cache / ('%d.json' % layer) if cache else None
    if path and path.exists():
        return json.loads(path.read_text())['features']
    q = urllib.parse.urlencode({'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': 'layer-%d' % layer,
                                'outputFormat': 'application/json', 'srsName': 'EPSG:4326',
                                'bbox': '%g,%g,%g,%g,urn:ogc:def:crs:EPSG::4326' % BBOX})
    try:
        raw = urllib.request.urlopen('https://data.linz.govt.nz/services;key=%s/wfs?%s' % (key, q), timeout=300).read()
    except Exception as e:  # the message could hold the request's address, and the address holds the key
        sys.exit('LDS request failed for layer %d: %s' % (layer, str(e).replace(key, '***')))
    if path:
        path.write_bytes(raw)
    return json.loads(raw)['features']


def codes(v):
    """An S-57 list attribute, such as '1,3', as a list of numbers."""
    if v is None or v == '':
        return []
    return [int(x) for x in str(v).replace(' ', '').split(',') if x.isdigit()]


def one(v):
    c = codes(v)
    return c[0] if c else None


def outer_rings(geom):
    """The outer ring of each part of a Polygon or MultiPolygon, as lists of (lon, lat)."""
    if geom['type'] == 'Polygon':
        return [[tuple(p[:2]) for p in geom['coordinates'][0]]]
    if geom['type'] == 'MultiPolygon':
        return [[tuple(p[:2]) for p in poly[0]] for poly in geom['coordinates']]
    return []


def rings(geom):
    """The rings of a Polygon or MultiPolygon, as lists of (lon, lat)."""
    if geom['type'] == 'Polygon':
        return [[tuple(p[:2]) for p in r] for r in geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return [[tuple(p[:2]) for p in r] for poly in geom['coordinates'] for r in poly]
    return []


def inside(pt, ring):
    """Even-odd test of a point (lon, lat) against one ring."""
    x, y, hit = pt[0], pt[1], False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def where(feature):
    """A feature's point, or the mean of its first ring's corners for an area."""
    g = feature['geometry']
    if g['type'] == 'Point':
        return tuple(g['coordinates'][:2])
    r = rings(g)[0]
    return (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r))


def meters(a, b):
    k = math.cos(math.radians(a[1]))
    return math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111_200


def sentence(text):
    """An all-capitals heading, such as 'MARINE RESERVE', in sentence case."""
    return text[:1].upper() + text[1:].lower() if text.isupper() or text.istitle() else text


def depth_words(valsou):
    if valsou is None or valsou == '':
        return ''
    v = float(valsou)
    return 'Dries %.1f m.' % -v if v < 0 else 'Depth %.1f m.' % v


def light_text(p):
    """A light's characteristic as a chart writes it, such as 'Fl(2) R 6s'."""
    ch = LITCHR.get(one(p.get('litchr')), '')
    grp = (p.get('siggrp') or '').strip()
    if grp in ('()', '(1)'):
        grp = ''
    col = ''.join(COLOUR.get(c, '') for c in codes(p.get('colour')))
    per = p.get('sigper')
    out = (ch + grp).strip()
    if col:
        out += ' ' + col
    if per not in (None, ''):
        out += ' %gs' % float(per)
    return out.strip()


def describe(kind, p):
    """The name and the detail the page shows for one object."""
    name = (p.get('objnam') or '').strip()
    if kind == 'rock':
        detail = ' '.join(x for x in [WATLEV.get(one(p.get('watlev')), '') + '.' if one(p.get('watlev')) else '', depth_words(p.get('valsou'))] if x)
        return name or 'Rock', detail
    if kind == 'wreck':
        return name or CATWRK.get(one(p.get('catwrk')), 'Wreck'), depth_words(p.get('valsou'))
    if kind in ('obstruction', 'foul'):
        cat = CATOBS.get(one(p.get('catobs')), 'Obstruction')
        detail = ' '.join(x for x in [depth_words(p.get('valsou')), (p.get('inform') or '').strip()] if x)
        return name or cat, detail
    if kind in ('buoy', 'beacon'):
        return name, ''
    if kind == 'restricted':
        inform = (p.get('inform') or '').strip()
        head, _, rest = inform.partition('. ')
        title = name or (sentence(head.rstrip('.')) if head else 'Restricted area')
        rules = '. '.join(RESTRN[c] for c in codes(p.get('restrn')) if c in RESTRN)
        # The note's heading repeats the title, unless the area has a name of its own that differs from it.
        keep_head = name and name.lower() != head.rstrip('.').lower()
        note = ((sentence(head.rstrip('.')) + '. ' if keep_head else '') + rest).strip() if rest else ''
        return title, ' '.join(x for x in [rules + '.' if rules else '', note] if x)
    if kind == 'farm':
        return name or 'Marine farm', ''
    return name, ''


def mark_name(group, p):
    """The name of a buoy or beacon: its kind, with its own name after it."""
    thing = 'buoy' if group.startswith('buoy') else 'beacon'
    sort = group[len(thing):]
    if sort == 'Lateral':
        kind = CATLAM.get(one(p.get('catlam')), 'Lateral') + ' ' + thing
    elif sort == 'Cardinal':
        kind = CATCAM.get(one(p.get('catcam')), 'Cardinal') + ' ' + thing
    elif sort == 'Isolated':
        kind = 'Isolated danger ' + thing
    elif sort == 'Safe':
        kind = 'Safe water ' + thing
    else:
        purpose = CATSPM.get(one(p.get('catspm')))
        kind = 'Special ' + thing + (', ' + purpose if purpose else '')
    name = (p.get('objnam') or '').strip()
    return kind + (', ' + name if name else '')


def simplify(pts, tol):
    """Ramer-Douglas-Peucker on a list of (x, y)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        (x1, y1), (x2, y2) = pts[s], pts[e]
        n = math.hypot(x2 - x1, y2 - y1)
        best, k = -1.0, -1
        for i in range(s + 1, e):
            x, y = pts[i]
            d = abs((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)) / n if n else math.hypot(x - x1, y - y1)
            if d > best:
                best, k = d, i
        if k >= 0 and best > tol:
            keep[k] = True
            stack += [(s, k), (k, e)]
    return [p for p, kp in zip(pts, keep) if kp]


def main():
    cache = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
    key = os.environ.get('LDS_KEY', '')
    if not key and not cache:
        sys.exit('Set LDS_KEY to a LINZ Data Service key.')
    coast = json.loads((ROOT / 'data' / 'coast.json').read_text())
    def mx(lon): return round((lon - coast['W']) * coast['k'] * coast['scale'], 1)
    def my(lat): return round((coast['N'] - lat) * coast['scale'], 1)

    cover = {s: [r for f in fetch(key, COVERAGE[s], cache) if one(f['properties'].get('catcov')) == 1 for r in outer_rings(f['geometry'])]
             for s in SCALES}
    def covered(pt, scales):
        return any(inside(pt, r) for s in scales for r in cover[s])

    kept = {}       # group -> list of (scale index, point, feature)
    report = []
    for group, ids in LAYERS.items():
        out = []
        for si, (scale, lid) in enumerate(zip(SCALES, ids)):
            if lid is None:
                continue
            feats = fetch(key, lid, cache)
            n0 = len(out)
            for f in feats:
                pt = where(f)
                if not (BBOX[1] <= pt[0] <= BBOX[3] and BBOX[0] <= pt[1] <= BBOX[2]):
                    continue
                if covered(pt, SCALES[:si]):
                    continue
                if any(o[0] < si and meters(o[1], pt) < SAME_M for o in out):
                    continue
                out.append((si, pt, f))
            report.append((group, scale, len(feats), len(out) - n0))
        kept[group] = out

    points, areas = [], []
    marks = []      # buoys and beacons, for the lights
    for group, items in kept.items():
        for si, pt, f in items:
            p = f['properties']
            if group.startswith('buoy') or group.startswith('beacon'):
                thing = 'buoy' if group.startswith('buoy') else 'beacon'
                row = [thing, mx(pt[0]), my(pt[1]), mark_name(group, p), '']
                marks.append((pt, row))
                points.append(row)
            elif group in ('rock', 'wreck', 'obstruction'):
                name, detail = describe(group, p)
                points.append([group, mx(pt[0]), my(pt[1]), name, detail])
            elif group == 'farmPoint':
                points.append(['farm', mx(pt[0]), my(pt[1]), (p.get('objnam') or '').strip() or 'Marine farm', ''])
    lights_alone = 0
    for si, pt, f in kept['light']:
        p = f['properties']
        text = light_text(p)
        near = min(marks, key=lambda m: meters(m[0], pt), default=None)
        if near and meters(near[0], pt) < LIGHT_M:
            if text and text not in near[1][4]:
                near[1][4] = (near[1][4] + ' ' if near[1][4] else '') + 'Light ' + text + '.'
            continue
        lights_alone += 1
        rng = p.get('valnmr')
        seen = '' if rng in (None, '') else ' Seen %g nautical mile%s.' % (float(rng), '' if float(rng) == 1 else 's')
        detail = ('Light ' + text + '.' if text else '') + seen
        points.append(['light', mx(pt[0]), my(pt[1]), (p.get('objnam') or '').strip() or 'Light', detail.strip()])
    for group, kind in (('restricted', 'restricted'), ('farm', 'farm'), ('obstructionArea', 'foul')):
        for si, pt, f in kept[group]:
            name, detail = describe(kind, f['properties'])
            d = ''
            for r in rings(f['geometry']):
                xy = simplify([(mx(lon), my(lat)) for lon, lat in r], TOLERANCE)
                if len(xy) >= 3:
                    d += 'M' + ' '.join('%.1f,%.1f' % q for q in xy[:-1]) + 'Z'
            if d:
                areas.append([kind, name, detail, d])

    texts, index = [], {}
    def ref(t):
        if t not in index:
            index[t] = len(texts)
            texts.append(t)
        return index[t]
    out = {
        'source': 'LINZ Data Service, Hydro layers from the official electronic charts, CC BY 4.0. LINZ paused '
                  'updates to these layers in May 2024. Not for navigation.',
        'texts': texts,
        'points': [[KINDS[k], x, y, ref(n), ref(d)] for k, x, y, n, d in points],
        'areas': [[KINDS['farmArea' if k == 'farm' else k], ref(n), ref(d), path] for k, n, d, path in areas],
    }
    text = json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n'
    OUT.write_text(text)
    for group, scale, n, k in report:
        if n:
            print('%-16s %-9s %4d in the bounds, %4d kept' % (group, scale, n, k))
    counts = {}
    for row in points:
        counts[row[0]] = counts.get(row[0], 0) + 1
    print('Points:', ', '.join('%s %d' % kv for kv in sorted(counts.items())), '| lights on their own: %d' % lights_alone)
    print('Areas: %d. %s, %d bytes%s.' % (len(areas), OUT.relative_to(ROOT), len(text.encode()),
          ' (over %d)' % MAX_BYTES if len(text.encode()) > MAX_BYTES else ''))


if __name__ == '__main__':
    main()
