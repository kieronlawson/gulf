// Run home: the leave-by time is last light, less the run at the owner's speed, less the owner's margin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './engine.mjs';

const d0 = Engine.midnight(2026, 11, 25);
const lastLight = d0 + 20 * Engine.HOUR + 48 * Engine.MIN;   // 20:48 on 25 November 2026

test('7.6 nm at 20 kn with a 30 min margin leaves at 19:55', () => {
  const r = Engine.leaveBy(lastLight, 7.6, 20, 30);
  assert.equal(r.run, 22.8 * Engine.MIN);
  assert.equal(Engine.fmtTime(r.at), '19:55');
});

test('the time rounds down to the minute, never up', () => {
  // 1 nm at 40 kn is a run of 1 min 30 s, so the arithmetic gives 20:46:30.
  const r = Engine.leaveBy(lastLight, 1, 40, 0);
  assert.equal(r.at, d0 + 20 * Engine.HOUR + 46 * Engine.MIN);
});

test('a missing speed, margin, distance or last light gives no time', () => {
  assert.equal(Engine.leaveBy(lastLight, 7.6, null, 30), null);
  assert.equal(Engine.leaveBy(lastLight, 7.6, 20, null), null);
  assert.equal(Engine.leaveBy(lastLight, 7.6, 0, 30), null);
  assert.equal(Engine.leaveBy(lastLight, null, 20, 30), null);
  assert.equal(Engine.leaveBy(null, 7.6, 20, 30), null);
});

test('at home already, the leave-by time is last light less the margin', () => {
  assert.equal(Engine.fmtTime(Engine.leaveBy(lastLight, 0, 20, 30).at), '20:18');
});
