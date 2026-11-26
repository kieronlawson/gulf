// Run home: the leave-by time is last light, less the trip home, less the owner's margin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './engine.mjs';

const { MIN, HOUR } = Engine;
const d0 = Engine.midnight(2026, 11, 25);
const lastLight = d0 + 20 * HOUR + 48 * MIN;   // 20:48 on 25 November 2026

test('a trip of 22.8 min with a 30 min margin leaves at 19:55', () => {
  const r = Engine.leaveBy(lastLight, 22.8 * MIN, 30);
  assert.equal(r.run, 22.8 * MIN);
  assert.equal(Engine.fmtTime(r.at), '19:55');
});

test('the time rounds down to the minute, never up', () => {
  // A trip of 1 min 30 s gives 20:46:30.
  const r = Engine.leaveBy(lastLight, 1.5 * MIN, 0);
  assert.equal(r.at, d0 + 20 * HOUR + 46 * MIN);
});

test('a missing trip time, margin or last light gives no time', () => {
  assert.equal(Engine.leaveBy(lastLight, 22.8 * MIN, null), null);
  assert.equal(Engine.leaveBy(lastLight, null, 30), null);
  assert.equal(Engine.leaveBy(lastLight, -MIN, 30), null);
  assert.equal(Engine.leaveBy(null, 22.8 * MIN, 30), null);
});

test('at home already, the leave-by time is last light less the margin', () => {
  assert.equal(Engine.fmtTime(Engine.leaveBy(lastLight, 0, 30).at), '20:18');
});

test('the trip time from a scored route sets the leave-by time', () => {
  // 6 nautical miles at 20 kn into 0.8 m of head sea: the comfortable speed is 12.2 kn, so the trip is longer than 18 min.
  const legs = Engine.routeLegs([{ x: 0, y: 60 }, { x: 0, y: 0 }], 10);
  const trip = Engine.scoreRoute(legs, lastLight - 2 * HOUR, 20, () => ({ h: 0.8, from: 0 }));
  const r = Engine.leaveBy(lastLight, trip.ms, 30);
  assert.equal(Math.round(trip.ms / MIN), Math.round(6 / (20 * Math.sqrt(0.3 / 0.8)) * 60));
  assert.equal(Engine.fmtTime(r.at), Engine.fmtTime(Math.floor((lastLight - trip.ms - 30 * MIN) / MIN) * MIN));
});
