// Route comfort: the scoring rules, the path search on a made-up raster, the legs and the clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './engine.mjs';

const { COMFORT, HOUR, MIN } = Engine;
const name = (level) => COMFORT.names[level];
// The engine runs in its own context, so its arrays and objects are compared as plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));

// The worked examples in docs/route-comfort.md, with a cruising speed of 22 kn.
const EXAMPLES = [
  // h,   a,   score,  level,        cause,           comfortable speed
  [0.6, 0, '0.60', 'Rough', 'head sea', '15.6'],
  [0.6, 90, '0.36', 'Bumpy', 'beam sea', '22.0'],
  [0.6, 180, '0.15', 'Fair', 'following sea', '22.0'],
  [0.2, 0, '0.20', 'Fair', 'head sea', '22.0'],
  [1.0, 0, '1.00', 'Very rough', 'head sea', '12.0'],
  [2.5, 0, '2.50', 'Very rough', 'head sea', '8.0'],
  [0.1, 0, '0.10', 'Easy', 'sheltered', '22.0'],
];

for (const [h, a, score, level, cause, v] of EXAMPLES) {
  test(`a leg with ${h} m of chop at ${a} degrees scores ${score}, ${level}, ${cause}, ${v} kn`, () => {
    const s = Engine.scoreLeg(h, a, 22);
    assert.equal(s.score.toFixed(2), score);
    assert.equal(name(s.level), level);
    assert.equal(s.cause, cause);
    assert.equal(s.v.toFixed(1), v);
  });
}

test('the level steps fall at 0.15, 0.30, 0.45 and 0.65 m', () => {
  // Head-on at cruising speed, the score is the chop height.
  const at = (h) => name(Engine.scoreLeg(h, 0, 22).level);
  assert.deepEqual([0.14, 0.15, 0.29, 0.3, 0.44, 0.45, 0.64, 0.65].map(at),
    ['Easy', 'Fair', 'Fair', 'Bumpy', 'Bumpy', 'Rough', 'Rough', 'Very rough']);
});

test('the cause turns from head sea to beam sea after 50 degrees, and to following sea after 130', () => {
  const at = (a) => Engine.scoreLeg(0.4, a, 22).cause;
  assert.deepEqual([50, 51, 130, 131].map(at), ['head sea', 'beam sea', 'beam sea', 'following sea']);
});

test('the comfortable speed never rises over a slow cruising speed', () => {
  // Under 8 kn of cruising speed, the floor is the cruising speed.
  assert.equal(Engine.scoreLeg(2.5, 0, 6).v, 6);
});

test('the angle runs from 0 for a head sea to 180 for a following sea', () => {
  assert.equal(Engine.seaAngle(0, 0), 0);
  assert.equal(Engine.seaAngle(0, 180), 180);
  assert.equal(Engine.seaAngle(350, 10), 20);
  assert.equal(Engine.seaAngle(90, 0), 90);
  assert.equal(Engine.seaAngle(270, 0), 90);
});

// A made-up raster: '#' is land, '.' is water. seed, when given, is a cell in the open Gulf.
function raster(rows, seed) {
  const h = rows.length, w = rows[0].length, water = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { water[x + y * w] = c === '.' ? 1 : 0; }));
  return seed ? { w, h, water, seed: seed[0] + seed[1] * w } : { w, h, water };
}
// Every cell a straight segment touches, sampled finely.
function touched(p, q) {
  const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) * 8) || 1, out = [];
  for (let k = 0; k <= n; k++) out.push([Math.round(p.x + (q.x - p.x) * k / n), Math.round(p.y + (q.y - p.y) * k / n)]);
  return out;
}
function landNear(grid, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = x + dx, Y = y + dy;
    if (X >= 0 && Y >= 0 && X < grid.w && Y < grid.h && !grid.water[X + Y * grid.w]) return true;
  }
  return false;
}
function length(points) {
  let L = 0;
  for (let k = 1; k < points.length; k++) L += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
  return L;
}

const ISLAND = raster([
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '.............####.............',
  '...........########...........',
  '...........#########..........',
  '..........##########..........',
  '...........#########..........',
  '............#######...........',
  '..............###.............',
  '..............................',
  '..............................',
  '..............................',
]);

test('a path goes around an island and keeps a cell off its shore', () => {
  const r = Engine.findPath(ISLAND, { x: 2, y: 7 }, { x: 27, y: 7 });
  assert.equal(r.found, true);
  assert.deepEqual(plain(r.points[0]), { x: 2, y: 7 });
  assert.deepEqual(plain(r.points[r.points.length - 1]), { x: 27, y: 7 });
  for (let k = 1; k < r.points.length; k++) {
    for (const [x, y] of touched(r.points[k - 1], r.points[k])) {
      assert.ok(!landNear(ISLAND, x, y), `cell ${x},${y} is next to land`);
    }
  }
  // Longer than the straight line, which crosses the island, and straightened to a few points.
  assert.ok(length(r.points) > 25);
  assert.ok(r.points.length <= 5, `${r.points.length} points`);
});

// A straight coast: land from x = 0 to 9 in every row.
const COAST = raster(Array(8).fill('##########....................'));

test('an end on land starts from the nearest open cell', () => {
  const r = Engine.findPath(COAST, { x: 3, y: 4 }, { x: 25, y: 4 });
  assert.equal(r.found, true);
  // The water cell at x = 10 is next to land, so the nearest open cell is at x = 11.
  assert.deepEqual(plain(r.points), [{ x: 11, y: 4 }, { x: 25, y: 4 }]);
  assert.equal(r.from.moved, 8);
  assert.equal(r.to.moved, 0);
});

const TWO_LAKES = raster([
  '...........#####...........',
  '...........#####...........',
  '...........#####...........',
  '...........#####...........',
  '...........#####...........',
  '...........#####...........',
]);

test('two ends with no water between them have no path, and no straight line stands in for one', () => {
  const r = Engine.findPath(TWO_LAKES, { x: 3, y: 3 }, { x: 23, y: 3 });
  assert.equal(r.found, false);
  assert.equal(r.points.length, 0);
});

test('a narrow passage closes, because the path keeps a cell off the land on both sides', () => {
  const r = Engine.findPath(raster([
    '..........#####..........',
    '..........#####..........',
    '.........................',
    '..........#####..........',
    '..........#####..........',
  ]), { x: 3, y: 2 }, { x: 21, y: 2 });
  assert.equal(r.found, false);
});

// An inlet joined to the Gulf by an entrance one cell wide, which closes. Open water in the inlet lies from
// x = 2 to 7 and y = 2 to 4; in the Gulf, from y = 9 down.
const INLET = [
  '####################',
  '#........###########',
  '#........###########',
  '#........###########',
  '#........###########',
  '#........###########',
  '#####.##############',
  '#####.##############',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
];

test('an end on land beside a cut-off inlet starts from open water joined to the Gulf', () => {
  // The inlet's open water, at (2, 4), is nearer than the Gulf's, at (2, 9). Without a seed the end goes there,
  // and finds no path.
  assert.equal(Engine.findPath(raster(INLET), { x: 2, y: 6 }, { x: 15, y: 11 }).found, false);
  const r = Engine.findPath(raster(INLET, [10, 11]), { x: 2, y: 6 }, { x: 15, y: 11 });
  assert.equal(r.found, true);
  assert.deepEqual(plain(r.points[0]), { x: 2, y: 9 });
  assert.equal(r.from.moved, 3);
});

test('an end on open water in a cut-off inlet moves out to the Gulf', () => {
  const r = Engine.findPath(raster(INLET, [10, 11]), { x: 4, y: 3 }, { x: 15, y: 11 });
  assert.equal(r.found, true);
  assert.deepEqual(plain(r.points[0]), { x: 4, y: 9 });
  assert.equal(r.from.moved, 6);
});

test('a path is cut into legs no longer than 0.3 nautical miles', () => {
  // 10 units to the mile: a 1 mile run north, then 0.5 miles east.
  const legs = Engine.routeLegs([{ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 5, y: 0 }], 10);
  assert.equal(legs.length, 4 + 2);
  legs.forEach((L) => assert.ok(L.nm <= 0.3 + 1e-9));
  assert.deepEqual(plain(legs.map((L) => Math.round(L.course))), [0, 0, 0, 0, 90, 90]);
  assert.equal(legs[4].at.toFixed(2), '1.00');
  assert.deepEqual([legs[0].x, legs[0].y], [0, 8.75]);
});

// The clock. A 6 mile run due north at 20 kn, leaving at 10:00, with a north wind.
const t0 = Engine.midnight(2026, 11, 25) + 10 * HOUR;
const NORTH = Engine.routeLegs([{ x: 0, y: 60 }, { x: 0, y: 0 }], 10);

test('the clock scores a later leg with the later wind', () => {
  // The chop is 0.1 m until 10:08:30 and 0.8 m from then on: Easy, then Very rough.
  const cond = (x, y, t) => ({ h: t < t0 + 8.5 * MIN ? 0.1 : 0.8, from: 0 });
  const r = Engine.scoreRoute(NORTH, t0, 20, cond);
  // At 20 kn a 0.3 mile leg takes 54 seconds, so the 10th leg starts at 10:08:06 and the 11th at 10:09.
  assert.equal(name(r.legs[9].level), 'Easy');
  assert.ok(Math.abs(r.legs[10].t - (t0 + 9 * MIN)) < 1);
  assert.equal(name(r.legs[10].level), 'Very rough');
  // The rough legs go at the comfortable speed, so the run takes longer than at cruising speed.
  assert.equal(r.legs[10].v.toFixed(1), (20 * Math.sqrt(0.3 / 0.8)).toFixed(1));
  assert.equal(Math.round(r.cruiseMs), 18 * MIN);
  assert.equal(Math.round(r.ms), Math.round(10 * 54000 + 10 * 0.3 / r.legs[10].v * HOUR));
});

test('each leg reads the wind at its middle, at the time the boat reaches it', () => {
  const seen = [];
  Engine.scoreRoute(NORTH.slice(0, 2), t0, 20, (x, y, t) => { seen.push([x, y, t]); return { h: 0.1, from: 0 }; });
  assert.deepEqual(seen, [[0, 58.5, t0], [0, 55.5, t0 + NORTH[0].nm / 20 * HOUR]]);
});

test('legs past the end of the forecast get no score, and the clock crosses them at cruising speed', () => {
  // A following sea leaves the boat at cruising speed. The forecast ends at 10:08:30.
  const cond = (x, y, t) => (t < t0 + 8.5 * MIN ? { h: 0.6, from: 180 } : null);
  const r = Engine.scoreRoute(NORTH, t0, 20, cond);
  assert.equal(r.legs.filter((L) => L.level == null).length, 10);
  assert.equal(r.missingNm.toFixed(1), '3.0');
  assert.equal(Math.round(r.ms), Math.round(r.cruiseMs));
});

test('a path crosses each ferry lane once, and the two directions of one lane count once', () => {
  // A path due north for 2 miles, 10 units to the mile. Lane X crosses it at 0.5 miles with a path for each
  // direction 0.1 miles apart; lane Y crosses at 1.5 miles; lane Z runs beside it and never crosses.
  const path = [{ x: 0, y: 20 }, { x: 0, y: 10 }, { x: 0, y: 0 }];
  const lanes = [
    { name: 'X', paths: [[{ x: -5, y: 15 }, { x: 5, y: 15 }], [{ x: -5, y: 14 }, { x: 5, y: 14 }]] },
    { name: 'Y', paths: [[{ x: -5, y: 4 }, { x: 5, y: 6 }]] },
    { name: 'Z', paths: [[{ x: 2, y: 20 }, { x: 2, y: 0 }]] },
  ];
  const c = plain(Engine.laneCrossings(path, lanes, 10));
  assert.deepEqual(c.map((h) => h.name), ['X', 'Y']);
  assert.equal(c[0].at.toFixed(2), '0.50');
  assert.equal(c[1].at.toFixed(2), '1.50');
});

test('neighboring legs of one level join into one stretch', () => {
  // Easy for 1.2 miles, Rough for 0.6, Easy for 0.3, then no forecast.
  const legs = [
    { level: 0, at: 0, nm: 0.6, ms: 0.6 / 20 * HOUR, h: 0.1, score: 0.1, cause: 'sheltered' },
    { level: 0, at: 0.6, nm: 0.6, ms: 0.6 / 20 * HOUR, h: 0.12, score: 0.12, cause: 'sheltered' },
    { level: 3, at: 1.2, nm: 0.3, ms: 0.3 / 12 * HOUR, h: 0.5, score: 0.5, cause: 'head sea' },
    { level: 3, at: 1.5, nm: 0.3, ms: 0.3 / 15 * HOUR, h: 0.6, score: 0.48, cause: 'beam sea' },
    { level: 3, at: 1.8, nm: 0.3, ms: 0.3 / 12 * HOUR, h: 0.45, score: 0.45, cause: 'head sea' },
    { level: 0, at: 2.1, nm: 0.3, ms: 0.3 / 20 * HOUR, h: 0.1, score: 0.1, cause: 'sheltered' },
    { level: null, at: 2.4, nm: 0.3, ms: 0.3 / 20 * HOUR },
  ];
  const s = Engine.joinStretches(legs);
  assert.deepEqual(plain(s.map((x) => [x.level, x.nm.toFixed(1)])), [[0, '1.2'], [3, '0.9'], [0, '0.3'], [null, '0.3']]);
  // The Rough stretch: the cause over most of its length, its highest chop, and its length over its time.
  assert.equal(s[1].cause, 'head sea');
  assert.equal(s[1].h, 0.6);
  assert.equal(s[1].v.toFixed(1), (0.9 / (0.3 / 12 + 0.3 / 15 + 0.3 / 12)).toFixed(1));
  assert.equal(s[3].v, null);
  assert.equal(Engine.worstStretch(s), s[1]);
});
