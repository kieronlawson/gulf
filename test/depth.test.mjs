// Depth at a point and at a time, on a made-up grid laid over the map's north-west corner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, DATA, spot } from './engine.mjs';

// The engine runs in its own context, so its objects are compared as plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));

const C = DATA.coast, R = 4, OFF = 100;
// Three rows of four cells. Stored values: 0 no data, 1 land, otherwise decimeters below chart datum + 100.
const grid = {
  W: C.W, N: C.N, k: C.k, scale: C.scale, cellsPerUnit: R, nx: 4, ny: 3, offsetDm: OFF,
  v: Uint16Array.from([
    OFF + 157, OFF + 40, 1, 0,
    OFF + 23, OFF - 12, OFF + 300, 0,
    OFF + 80, OFF + 81, OFF + 82, OFF + 83,
  ]),
};
// The position of a point given in cells from the grid's north-west corner.
const at = (i, j) => ({ lon: C.W + i / R / (C.k * C.scale), lat: C.N - j / R / C.scale });

test('depthAt reads the cell under a point', () => {
  assert.deepEqual(plain(Engine.depthAt(grid, at(0.5, 0.5))), { chart: 15.7 });
  assert.deepEqual(plain(Engine.depthAt(grid, at(2.5, 1.5))), { chart: 30 });
  assert.deepEqual(plain(Engine.depthAt(grid, at(1.5, 1.5))), { chart: -1.2 }, 'a drying height is a negative depth');
});

test('depthAt on a cell edge takes the shallower side', () => {
  assert.deepEqual(plain(Engine.depthAt(grid, at(1, 0.5))), { chart: 4 }, 'between 15.7 m and 4.0 m');
  assert.deepEqual(plain(Engine.depthAt(grid, at(0.5, 1))), { chart: 2.3 }, 'between 15.7 m and 2.3 m');
  assert.deepEqual(plain(Engine.depthAt(grid, at(1, 1))), { chart: -1.2 }, 'a corner touches four cells');
  assert.deepEqual(plain(Engine.depthAt(grid, at(2, 1.5))), { chart: -1.2 }, 'between -1.2 m and 30 m');
});

test('depthAt reports land, and nothing where there is no data', () => {
  assert.deepEqual(plain(Engine.depthAt(grid, at(2.5, 0.5))), { land: true });
  assert.deepEqual(plain(Engine.depthAt(grid, at(2, 0.5))), { land: true }, 'land wins on an edge');
  assert.equal(Engine.depthAt(grid, at(3.5, 0.5)), null);
  assert.deepEqual(plain(Engine.depthAt(grid, at(3, 1.5))), { chart: 30 }, 'an edge beside no data uses the cell with data');
  assert.equal(Engine.depthAt(grid, at(4.5, 2.5)), null, 'off the grid');
  assert.equal(Engine.depthAt(grid, at(-0.1, 0.5)), null, 'off the grid');
  assert.equal(Engine.depthAt(null, at(0.5, 0.5)), null, 'no grid loaded');
  assert.deepEqual(plain(Engine.depthAt(grid, at(4, 3))), { chart: 8.3 }, 'the far corner belongs to the last cell');
});

test('depthAtTime adds the tide at the nearest spot', () => {
  const t = Date.UTC(2026, 10, 25, 1, 5);
  for (const id of ['auckland', 'thames']) {
    const s = spot(id);
    // A one-cell grid centered on the spot.
    const g = { ...grid, W: s.lon - 0.5 / R / (C.k * C.scale), N: s.lat + 0.5 / R / C.scale, nx: 1, ny: 1, v: Uint16Array.from([OFF + 57]) };
    const d = Engine.depthAtTime(g, { lat: s.lat, lon: s.lon }, t);
    const h = Engine.tideNow(s, t).h;
    assert.equal(d.spot.id, id);
    assert.equal(d.chart, 5.7);
    assert.equal(d.tide, h);
    assert.ok(Math.abs(d.depth - (5.7 + h)) < 1e-9);
  }
});

test('depthAtTime on land and where there is no data', () => {
  const t = Date.UTC(2026, 10, 25, 1, 5);
  const d = Engine.depthAtTime(grid, at(2.5, 0.5), t);
  assert.equal(d.land, true);
  assert.equal(typeof d.tide, 'number');
  assert.equal(Engine.depthAtTime(grid, at(3.5, 0.5), t), null);
});

test('nearestSpot picks the closest tide spot on the ground', () => {
  for (const s of DATA.spots) assert.equal(Engine.nearestSpot({ lat: s.lat + 0.001, lon: s.lon - 0.001 }).id, s.id);
});
