// Week rows: the color of each hour's wind bar, and the time under the pointer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './engine.mjs';

// The light theme's stops, from src/style.css.
const LIGHT = ['#2E8B57', '#9DB23F', '#D8B31E', '#E59400', '#D9381E', '#8F2413'];
const color = (kn) => Engine.windColor(kn, 15, LIGHT);

test('the speed is rounded to whole knots before it is colored', () => {
  assert.equal(color(15.4), color(15));
  assert.equal(color(15.6), color(16));
  assert.notEqual(color(15), color(16));
});

test('yellow ends at the limit, and amber starts just over it', () => {
  assert.equal(color(15), 'rgb(216, 179, 30)');
  // 16 kn is about a fifth of the way from amber, at the limit, to red, at 1.33 times the limit.
  assert.equal(color(16), 'rgb(227, 129, 6)');
});

test('the stops fall at their shares of the limit', () => {
  assert.equal(color(0), 'rgb(46, 139, 87)');
  assert.equal(color(9), 'rgb(46, 139, 87)');     // 0.60 of the limit
  assert.equal(Engine.rampColor(0.87, LIGHT), 'rgb(157, 178, 63)');
  assert.equal(Engine.rampColor(1.33, LIGHT), 'rgb(217, 56, 30)');
  assert.equal(color(27), 'rgb(143, 36, 19)');    // 1.80 of the limit
  assert.equal(color(40), 'rgb(143, 36, 19)');
});

test('between two stops the color moves in a straight line in RGB', () => {
  // 0.735 of the limit is halfway from green to yellow-green.
  assert.equal(Engine.rampColor(0.735, LIGHT), 'rgb(102, 159, 75)');
});

// A row from 04:00 to 22:00 on 25 November 2026.
const d0 = Engine.midnight(2026, 11, 25), H = Engine.HOUR;
const a = d0 + 4 * H, b = d0 + 22 * H;

test("a click at a row's left edge gives the row's first hour", () => {
  assert.equal(Engine.laneTime(0, a, b, d0), a);
  assert.equal(Engine.fmtTime(Engine.laneTime(0, a, b, d0)), '04:00');
});

test('a click in the row gives the time under it, rounded to 5 minutes', () => {
  assert.equal(Engine.fmtTime(Engine.laneTime(0.5, a, b, d0)), '13:00');
  // 13:02:30 rounds up to 13:05, and 13:02 rounds down to 13:00.
  assert.equal(Engine.fmtTime(Engine.laneTime((9 * H + 2.5 * Engine.MIN) / (b - a), a, b, d0)), '13:05');
  assert.equal(Engine.fmtTime(Engine.laneTime((9 * H + 2 * Engine.MIN) / (b - a), a, b, d0)), '13:00');
});

test("a click at a row's right edge gives a time inside the same calendar day", () => {
  // A row that runs to the next midnight: its right edge is the next day's first instant.
  const end = Engine.addDays(d0, 1), t = Engine.laneTime(1, a, end, d0);
  assert.ok(t < end);
  assert.equal(Engine.dayStart(t), d0);
  assert.equal(Engine.fmtTime(t), '23:55');
  // A point on the row's border, a little past either edge, stays on the row.
  assert.equal(Engine.laneTime(1.01, a, b, d0), b);
  assert.equal(Engine.laneTime(-0.01, a, b, d0), a);
});
