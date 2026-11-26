// Windows: stretches between first light and last light when the wind stays at or under the limit.
// The forecasts here are made up. Each test sets the wind hour by hour for 25 November 2026 at Auckland,
// where first light is 05:28 and last light is 20:48.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, spot } from './engine.mjs';

const akl = spot('auckland');
const d0 = Engine.midnight(2026, 11, 25);
const at = (h) => d0 + h * Engine.HOUR;
const limits = { wind: 15, hours: 3 };

// One day of hourly records, as the page stores them: an hour's time maps to { wind, gust }.
// windAt(h) gives the wind for hour h, from 0 to 23. It returns null for a missing hour.
function day(windAt) {
  const recs = {};
  for (let h = 0; h < 24; h++) {
    const w = windAt(h);
    if (w != null) recs[at(h)] = { wind: w, gust: w + 6 };
  }
  return recs;
}
// Arrays from the engine belong to another realm, so copy them before comparing.
const show = (list) => [...list].map((w) => Engine.fmtTime(w.start) + '–' + Engine.fmtTime(w.end));

test('a calm day is one window from first light to last light', () => {
  assert.deepEqual(show(Engine.dayWindows(akl, d0, day(() => 8), limits)), ['05:28–20:48']);
});

test('a two-hour lull is not a window, unless the minimum is two hours', () => {
  const recs = day((h) => (h === 10 || h === 11 ? 9 : 22));
  assert.deepEqual(show(Engine.dayWindows(akl, d0, recs, limits)), []);
  assert.deepEqual(show(Engine.dayWindows(akl, d0, recs, { wind: 15, hours: 2 })), ['09:30–11:30']);
});

test('wind the page shows as the limit is inside it, and wind it shows as more is outside', () => {
  // The page shows wind in whole knots, so 15.4 kn reads as 15 and 15.5 kn reads as 16.
  const base = (h) => (h >= 9 && h <= 12 ? 15 : 25);
  assert.deepEqual(show(Engine.dayWindows(akl, d0, day(base), limits)), ['08:30–12:30']);
  assert.deepEqual(show(Engine.dayWindows(akl, d0, day((h) => (h === 11 ? 15.4 : base(h))), limits)), ['08:30–12:30']);
  assert.deepEqual(show(Engine.dayWindows(akl, d0, day((h) => (h === 11 ? 15.5 : base(h))), limits)), []);
});

test('last light cuts a window, and a window it cuts too short is dropped', () => {
  assert.deepEqual(show(Engine.dayWindows(akl, d0, day((h) => (h >= 17 ? 10 : 20)), limits)), ['16:30–20:48']);
  assert.deepEqual(show(Engine.dayWindows(akl, d0, day((h) => (h >= 19 ? 10 : 20)), limits)), []);
});

test('a missing hour ends a window', () => {
  const recs = day((h) => (h === 12 ? null : 10));
  assert.deepEqual(show(Engine.dayWindows(akl, d0, recs, limits)), ['05:28–11:30', '12:30–20:48']);
});

test('gusts do not close a window, and the window reports its top wind and gust', () => {
  const recs = day((h) => (h >= 8 && h <= 13 ? 12 : 30));
  recs[at(10)].gust = 31;
  const w = [...Engine.dayWindows(akl, d0, recs, limits)];
  assert.deepEqual(show(w), ['07:30–13:30']);
  assert.equal(w[0].maxWind, 12);
  assert.equal(w[0].maxGust, 31);
});

test('ranking puts the longest window first, then the lower top wind, then the earlier start', () => {
  const H = Engine.HOUR;
  const list = [
    { start: at(6), end: at(9), maxWind: 10 },
    { start: at(13), end: at(19), maxWind: 14 },
    { start: at(10), end: at(13), maxWind: 8 },
    { start: at(14), end: at(17), maxWind: 8 },
  ];
  assert.deepEqual([...Engine.rankWindows(list)].map((w) => (w.end - w.start) / H + ' h from ' + Engine.fmtTime(w.start)),
    ['6 h from 13:00', '3 h from 10:00', '3 h from 14:00', '3 h from 06:00']);
});
