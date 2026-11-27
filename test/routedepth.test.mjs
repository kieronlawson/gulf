// Depth in the path search: the chart depth of each grid cell, the lowest tide, and a path that avoids a made-up
// shoal at low tide and crosses it at high tide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, DATA, spot } from './engine.mjs';

const C = DATA.coast, OFF = 100, R = 2, F = 4;   // path grid cells and depth cells per map unit

// A path grid of w by h cells, all water, laid over the map's north-west corner, and a depth grid under it with
// F / R depth cells to each grid cell side. depthOf(x, y) gives the chart depth, in meters, of the grid cell (x, y).
function grids(w, h, depthOf) {
  const water = new Uint8Array(w * h).fill(1), land = new Uint8Array(w * h);
  const grid = { R, w, h, water, land, seed: Math.floor(w / 2) };
  const f = F / R, nx = w * f, ny = h * f, v = new Uint16Array(nx * ny);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    // Depth cells r and c belong to grid cell round((r + 1) / f - 0.5) ... the cell whose block holds them.
    const x = Math.min(w - 1, Math.floor((c + 1) / f)), y = Math.min(h - 1, Math.floor((r + 1) / f));
    v[r * nx + c] = OFF + Math.round(depthOf(x, y) * 10);
  }
  const depth = { W: C.W, N: C.N, k: C.k, scale: C.scale, cellsPerUnit: F, nx, ny, offsetDm: OFF, v };
  return { grid, depth };
}

test('a grid cell takes the shallowest of its depth cells, and land in the depth grid is -Infinity', () => {
  const { grid, depth } = grids(4, 3, () => 8);
  // Grid cell (2, 1) holds depth columns 3 and 4 and rows 1 and 2.
  depth.v[1 * depth.nx + 4] = OFF + 23;
  depth.v[2 * depth.nx + 3] = OFF + 12;
  const cd = Engine.cellDepths(depth, grid);
  assert.equal(cd.chart[1 * 4 + 2].toFixed(1), '1.2');
  assert.equal(cd.chart[1 * 4 + 1], 8);
  depth.v[2 * depth.nx + 4] = 1;
  assert.equal(Engine.cellDepths(depth, grid).chart[1 * 4 + 2], -Infinity);
  depth.v.fill(0);
  assert.ok(Number.isNaN(Engine.cellDepths(depth, grid).chart[0]), 'no data');
});

test('each water cell knows its nearest tide spot', () => {
  const { grid, depth } = grids(3, 3, () => 8);
  const cd = Engine.cellDepths(depth, grid);
  const p = { lat: C.N - 1 / (R * C.scale), lon: C.W + 1 / (R * C.k * C.scale) };
  assert.equal(DATA.spots[cd.spot[4]].id, Engine.nearestSpot(p).id);
});

test('the lowest tide over a window is no higher than the tide at either end', () => {
  const t0 = Date.UTC(2026, 10, 25, 1, 5), t1 = t0 + 3 * 3600000;
  const low = Engine.lowestTides(t0, t1);
  assert.equal(low.length, DATA.spots.length);
  DATA.spots.forEach((s, i) => {
    assert.ok(low[i] <= Engine.tideNow(s, t0).h + 1e-9);
    assert.ok(low[i] <= Engine.tideNow(s, t1).h + 1e-9);
  });
});

// A channel 9 cells wide and 7 tall, with a bar of 1.0 m chart depth across its middle column except for one
// cell of 6 m at the bottom, far round. The shortest way crosses the bar on the middle row.
const W = 9, H = 7;
const bar = (x, y) => (x === 4 ? (y === 6 ? 6 : 1.0) : 8);

test('a path avoids a made-up shoal at low tide and crosses it at high tide', () => {
  const { grid, depth } = grids(W, H, bar);
  const cd = Engine.cellDepths(depth, grid);
  const n = DATA.spots.length, safe = 1.5;
  const low = new Array(n).fill(0.2), high = new Array(n).fill(3.0);
  const atLow = Engine.findPath(Engine.shoalGrid(grid, cd, safe, low), { x: 0, y: 3 }, { x: 8, y: 3 });
  const atHigh = Engine.findPath(Engine.shoalGrid(grid, cd, safe, high), { x: 0, y: 3 }, { x: 8, y: 3 });
  const length = (pts) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - pts[i].x, q.y - pts[i].y), 0);
  assert.equal(atLow.found, true);
  assert.ok(length(atLow.points) > 9, 'at low tide the path goes round by the deep cell');
  const crossLow = Engine.leastDepth(grid, cd, low, atLow.points);
  assert.ok(crossLow.depth >= safe, 'the low-tide path keeps the safe depth');
  assert.equal(atHigh.found, true);
  assert.equal(length(atHigh.points), 8, 'at high tide the path runs straight across the bar');
  assert.equal(Engine.leastDepth(grid, cd, high, atHigh.points).depth.toFixed(1), '4.0');
});

test('with the bar closed everywhere, there is no path, and the least depth names what blocks it', () => {
  const { grid, depth } = grids(W, H, (x) => (x === 4 ? 1.0 : 8));
  const cd = Engine.cellDepths(depth, grid);
  const low = new Array(DATA.spots.length).fill(0.2);
  const r = Engine.findPath(Engine.shoalGrid(grid, cd, 1.5, low), { x: 0, y: 3 }, { x: 8, y: 3 });
  assert.equal(r.found, false);
  const plainPath = Engine.findPath(grid, { x: 0, y: 3 }, { x: 8, y: 3 });
  assert.equal(Engine.leastDepth(grid, cd, low, plainPath.points).depth.toFixed(1), '1.2');
});
