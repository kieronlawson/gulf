import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './engine.mjs';
import { LINZ_AUCKLAND_2028, toUTC } from './linz-auckland-2028.mjs';

test('Auckland tides agree with the LINZ 2028 table', () => {
  const ex = Engine.aklExtremes(Date.UTC(2027, 11, 30), Date.UTC(2029, 0, 2));
  const dt = [], dh = [];
  for (const [m, d, hm, h] of LINZ_AUCKLAND_2028) {
    const t = toUTC(m, d, hm);
    assert.equal(Engine.fmtTime(t), hm, 'the engine clock must read the table time');
    let best = ex[0];
    for (const e of ex) if (Math.abs(e.t - t) < Math.abs(best.t - t)) best = e;
    dt.push(Math.abs(best.t - t) / 60000);
    dh.push(Math.abs(best.h - h));
  }
  dt.sort((a, b) => a - b);
  const median = dt[Math.floor(dt.length / 2)], p90 = dt[Math.floor(dt.length * 0.9)];
  // Measured when these limits were set: median 2.3 min, 90th percentile 6.1 min, largest 9.0 min, heights within 0.103 m.
  assert.ok(median <= 3, 'median time difference ' + median.toFixed(1) + ' min');
  assert.ok(p90 <= 7, '90th percentile ' + p90.toFixed(1) + ' min');
  assert.ok(dt[dt.length - 1] <= 10, 'largest time difference ' + dt[dt.length - 1].toFixed(1) + ' min');
  assert.ok(Math.max(...dh) <= 0.11, 'largest height difference ' + Math.max(...dh).toFixed(3) + ' m');
});

test('a calendar day is 23, 24 or 25 hours long in New Zealand', () => {
  const hours = (y, m, d) => (Engine.addDays(Engine.midnight(y, m, d), 1) - Engine.midnight(y, m, d)) / 3600000;
  assert.equal(hours(2026, 9, 27), 23);
  assert.equal(hours(2026, 11, 25), 24);
  assert.equal(hours(2027, 4, 4), 25);
});
