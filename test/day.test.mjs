// Regression values. These are the engine's own results for one day, recorded on 26 November 2026.
// They guard against accidental change. They are not an independent check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, spot } from './engine.mjs';

const d = Engine.day(spot('auckland'), Engine.midnight(2026, 11, 25));

test('Auckland, 25 November 2026: sun', () => {
  assert.equal(Engine.fmtTime(d.sun.rise), '05:57');
  assert.equal(Engine.fmtTime(d.sun.set), '20:19');
  assert.equal(Engine.fmtTime(d.sun.dawn), '05:28');
});

test('Auckland, 25 November 2026: moon and solunar', () => {
  assert.equal(d.moon.name, 'Full moon');
  assert.equal(d.solunar.label, 'Very high');
  // Arrays from the engine belong to another realm, so copy them before comparing.
  const inDay = [...d.solunar.periods].filter((p) => p.inDay);
  assert.deepEqual(inDay.map((p) => (p.major ? 'major' : 'minor') + ' ' + Engine.fmtTime(p.start) + ' ' + p.fish),
    ['major 23:56 4', 'minor 05:12 4', 'major 12:28 4', 'minor 20:50 3']);
});

test('Auckland, 25 November 2026: tides', () => {
  assert.deepEqual([...d.extremes].map((e) => (e.hi ? 'H' : 'L') + ' ' + Engine.fmtTime(e.t) + ' ' + e.h.toFixed(1)),
    ['L 01:58 0.4', 'H 08:25 3.3', 'L 14:27 0.6', 'H 20:44 3.3']);
});

test('a secondary spot shifts and scales the Auckland tide', () => {
  const m = Engine.day(spot('matiatia'), Engine.midnight(2026, 11, 25));
  assert.deepEqual([...m.extremes].map((e) => Engine.fmtTime(e.t) + ' ' + e.h.toFixed(1)), ['01:56 0.3', '08:14 3.0', '14:25 0.4', '20:33 3.0']);
});
