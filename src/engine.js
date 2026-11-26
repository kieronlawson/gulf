/* Hauraki Gulf Almanac engine.
   Time handling, tides, sun, moon and solunar periods.
   Needs the globals Astronomy (astronomy-engine), Neaps (tide predictor) and DATA. */
var Engine = (function () {
  'use strict';

  var TZ = 'Pacific/Auckland';
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;
  var RAD = Math.PI / 180;

  /* ---------- New Zealand civil time ---------- */

  var dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  function parts(ms) {
    var o = {};
    dtf.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, H: (+o.hour) % 24, M: +o.minute, S: +o.second, wd: o.weekday };
  }

  function offsetMs(ms) {
    var p = parts(ms);
    return Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S) - Math.floor(ms / 1000) * 1000;
  }

  /* The instant of 00:00 New Zealand time on a calendar date. */
  function midnight(y, m, d) {
    var g = Date.UTC(y, m - 1, d);
    var t = g - offsetMs(g);
    return g - offsetMs(t);
  }

  function dayStart(ms) { var p = parts(ms); return midnight(p.y, p.m, p.d); }

  function addDays(start, n) { var p = parts(start + 12 * HOUR); return midnight(p.y, p.m, p.d + n); }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtTime(ms) {
    if (ms == null) return '–';
    var p = parts(Math.round(ms / MIN) * MIN);
    return pad2(p.H) + ':' + pad2(p.M);
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WD_LONG = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

  function fmtDay(ms) { var p = parts(ms); return p.wd + ' ' + p.d + ' ' + MONTHS[p.m - 1]; }
  function fmtDayLong(ms) { var p = parts(ms); return WD_LONG[p.wd] + ' ' + p.d + ' ' + MONTHS_LONG[p.m - 1] + ' ' + p.y; }
  function isoDate(ms) { var p = parts(ms); return p.y + '-' + pad2(p.m) + '-' + pad2(p.d); }

  function fmtDuration(ms) {
    var m = Math.round(Math.abs(ms) / MIN), h = Math.floor(m / 60);
    m -= h * 60;
    return h ? h + ' h ' + pad2(m) + ' min' : m + ' min';
  }

  /* ---------- Tides ---------- */

  var AKL_MSL = DATA.auckland.msl;
  var predictor = Neaps.createTidePredictor(DATA.constituents, { offset: AKL_MSL });

  function aklExtremes(t0, t1) {
    return predictor.getExtremesPrediction({ start: new Date(t0), end: new Date(t1) }).map(function (e) {
      return { t: e.time.getTime(), h: e.level, hi: !!e.high };
    });
  }

  /* High and low waters at a spot. Auckland comes straight from the harmonic prediction.
     Other spots apply the LINZ secondary-port method: add the time difference, then
     scale the height about mean sea level by the range ratio. */
  function spotExtremes(spot, t0, t1) {
    var padMs = 3 * HOUR;
    return aklExtremes(t0 - padMs, t1 + padMs).map(function (e) {
      return {
        t: e.t + (e.hi ? spot.hw : spot.lw) * MIN,
        h: (e.h - AKL_MSL) * spot.ratio + spot.msl,
        hi: e.hi
      };
    }).filter(function (e) { return e.t >= t0 && e.t < t1; });
  }

  /* Tide height every stepMs between t0 and t1. */
  function spotCurve(spot, t0, t1, stepMs) {
    var out = [], t;
    if (spot.std) {
      var tl = predictor.getTimelinePrediction({ start: new Date(t0), end: new Date(t1 + stepMs), timeFidelity: stepMs / 1000 });
      for (var k = 0; k < tl.length; k++) {
        t = tl[k].time.getTime();
        if (t <= t1) out.push({ t: t, h: tl[k].level });
      }
      return out;
    }
    var ex = spotExtremes(spot, t0 - 14 * HOUR, t1 + 14 * HOUR), i = 0;
    for (t = t0; t <= t1; t += stepMs) {
      while (i < ex.length - 2 && ex[i + 1].t <= t) i++;
      var a = ex[i], b = ex[i + 1];
      var u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
      out.push({ t: t, h: a.h + (b.h - a.h) * (1 - Math.cos(Math.PI * u)) / 2 });
    }
    return out;
  }

  function interp(curve, t, key) {
    if (!curve.length || t < curve[0].t || t > curve[curve.length - 1].t) return null;
    var step = curve[1].t - curve[0].t;
    var i = Math.min(curve.length - 2, Math.floor((t - curve[0].t) / step));
    var u = (t - curve[i].t) / step;
    return curve[i][key] + (curve[i + 1][key] - curve[i][key]) * u;
  }

  /* ---------- Sun and moon ---------- */

  function observer(spot) { return new Astronomy.Observer(spot.lat, spot.lon, 0); }
  function at(e) { return e ? e.date.getTime() : null; }

  function altAz(body, ms, obs) {
    var d = new Date(ms);
    var eq = Astronomy.Equator(body, d, obs, true, true);
    var hz = Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal');
    return { alt: hz.altitude, az: hz.azimuth };
  }

  function sunTimes(spot, d0, d1) {
    var o = observer(spot), S = Astronomy.Body.Sun, start = new Date(d0), span = (d1 - d0) / DAY + 0.02;
    var r = {
      nautDawn: at(Astronomy.SearchAltitude(S, o, +1, start, span, -12)),
      dawn: at(Astronomy.SearchAltitude(S, o, +1, start, span, -6)),
      rise: at(Astronomy.SearchRiseSet(S, o, +1, start, span)),
      noon: Astronomy.SearchHourAngle(S, o, 0, start).time.date.getTime(),
      set: at(Astronomy.SearchRiseSet(S, o, -1, start, span)),
      dusk: at(Astronomy.SearchAltitude(S, o, -1, start, span, -6)),
      nautDusk: at(Astronomy.SearchAltitude(S, o, -1, start, span, -12))
    };
    r.dayLength = (r.rise != null && r.set != null) ? r.set - r.rise : null;
    r.noonAlt = altAz(S, r.noon, o).alt;
    return r;
  }

  function riseSetEvents(body, o, dir, a, b) {
    var out = [], cursor = a, guard = 0;
    while (cursor < b && guard++ < 6) {
      var e = Astronomy.SearchRiseSet(body, o, dir, new Date(cursor), (b - cursor) / DAY + 0.01);
      if (!e) break;
      var t = e.date.getTime();
      if (t >= b) break;
      out.push(t);
      cursor = t + MIN;
    }
    return out;
  }

  function transitEvents(body, o, hourAngle, a, b) {
    var out = [], cursor = a, guard = 0;
    while (cursor < b && guard++ < 6) {
      var e = Astronomy.SearchHourAngle(body, o, hourAngle, new Date(cursor));
      var t = e.time.date.getTime();
      if (t >= b) break;
      out.push({ t: t, alt: e.hor.altitude });
      cursor = t + MIN;
    }
    return out;
  }

  var PHASE_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  var QUARTER_NAMES = ['New moon', 'First quarter', 'Full moon', 'Last quarter'];

  function phaseName(angle) {
    var w = 6.1; /* about half a day either side of the exact phase */
    if (angle < w || angle > 360 - w) return PHASE_NAMES[0];
    if (Math.abs(angle - 90) < w) return PHASE_NAMES[2];
    if (Math.abs(angle - 180) < w) return PHASE_NAMES[4];
    if (Math.abs(angle - 270) < w) return PHASE_NAMES[6];
    return PHASE_NAMES[angle < 90 ? 1 : angle < 180 ? 3 : angle < 270 ? 5 : 7];
  }

  /* Angle of the moon's bright limb, counter-clockwise from straight up, as the observer sees it. */
  function brightLimbAngle(ms, o) {
    var s = altAz(Astronomy.Body.Sun, ms, o), m = altAz(Astronomy.Body.Moon, ms, o);
    var hs = s.alt * RAD, hm = m.alt * RAD, dAz = (s.az - m.az) * RAD;
    return Math.atan2(Math.cos(hs) * Math.sin(-dAz), Math.sin(hs) * Math.cos(hm) - Math.cos(hs) * Math.sin(hm) * Math.cos(dAz)) / RAD;
  }

  function moonDay(spot, d0, d1) {
    var o = observer(spot), M = Astronomy.Body.Moon;
    var mid = d0 + (d1 - d0) / 2;
    var r = {
      rises: riseSetEvents(M, o, +1, d0, d1),
      sets: riseSetEvents(M, o, -1, d0, d1),
      upper: transitEvents(M, o, 0, d0, d1),
      lower: transitEvents(M, o, 12, d0, d1)
    };
    var illum = Astronomy.Illumination(M, new Date(mid));
    r.angle = Astronomy.MoonPhase(new Date(mid));
    r.fraction = illum.phase_fraction;
    r.name = phaseName(r.angle);
    r.distanceKm = illum.geo_dist * 149597870.7;
    r.viewTime = r.upper.length ? r.upper[0].t : mid;
    r.limb = brightLimbAngle(r.viewTime, o);
    return r;
  }

  function nextPhases(ms, count) {
    var out = [], q = Astronomy.SearchMoonQuarter(new Date(ms));
    for (var i = 0; i < count; i++) {
      out.push({ t: q.time.date.getTime(), quarter: q.quarter, name: QUARTER_NAMES[q.quarter] });
      q = Astronomy.NextMoonQuarter(q);
    }
    return out;
  }

  function nextApsides(ms) {
    var a = Astronomy.SearchLunarApsis(new Date(ms)), b = Astronomy.NextLunarApsis(a);
    return [a, b].map(function (x) { return { t: x.time.date.getTime(), perigee: x.kind === 0, km: x.dist_km }; });
  }

  /* Sun and moon altitude every stepMs, for the sky lane of the day chart. */
  function skyCurve(spot, t0, t1, stepMs) {
    var o = observer(spot), out = [];
    for (var t = t0; t <= t1; t += stepMs) {
      out.push({ t: t, sun: altAz(Astronomy.Body.Sun, t, o).alt, moon: altAz(Astronomy.Body.Moon, t, o).alt });
    }
    return out;
  }

  /* ---------- Solunar periods ---------- */

  var MAJOR_HALF = 60 * MIN, MINOR_HALF = 30 * MIN;

  /* Major periods are centered on the moon's upper and lower transits and last two hours.
     Minor periods are centered on moonrise and moonset and last one hour. */
  function solunar(spot, d0, d1, sun) {
    var o = observer(spot), M = Astronomy.Body.Moon;
    var a = d0 - 2 * HOUR, b = d1 + 2 * HOUR, list = [];
    transitEvents(M, o, 0, a, b).forEach(function (e) { list.push({ t: e.t, major: true, cause: 'Moon overhead' }); });
    transitEvents(M, o, 12, a, b).forEach(function (e) { list.push({ t: e.t, major: true, cause: 'Moon underfoot' }); });
    riseSetEvents(M, o, +1, a, b).forEach(function (t) { list.push({ t: t, major: false, cause: 'Moonrise' }); });
    riseSetEvents(M, o, -1, a, b).forEach(function (t) { list.push({ t: t, major: false, cause: 'Moonset' }); });
    list.forEach(function (p) {
      var half = p.major ? MAJOR_HALF : MINOR_HALF;
      p.start = p.t - half; p.end = p.t + half;
      p.inDay = p.t >= d0 && p.t < d1;
      p.sunEvent = null;
      if (sun.rise != null && p.start <= sun.rise + 30 * MIN && p.end >= sun.rise - 30 * MIN) p.sunEvent = 'sunrise';
      if (sun.set != null && p.start <= sun.set + 30 * MIN && p.end >= sun.set - 30 * MIN) p.sunEvent = 'sunset';
    });
    list.sort(function (x, y) { return x.t - y.t; });

    var angle = Astronomy.MoonPhase(new Date(d0 + (d1 - d0) / 2));
    var phaseScore = Math.abs(Math.cos(angle * RAD));
    var overlap = 0;
    list.forEach(function (p) { if (p.inDay && p.sunEvent) overlap += p.major ? 1 : 0.5; });
    var score = Math.round(100 * (0.8 * phaseScore + 0.2 * Math.min(1, overlap)));
    var level = score >= 75 ? 3 : score >= 50 ? 2 : score >= 25 ? 1 : 0;
    var res = {
      periods: list, score: score, level: level,
      label: ['Low', 'Average', 'High', 'Very high'][level],
      phaseScore: phaseScore
    };
    /* Each period gets one to four fish from the peak of the activity index inside it. */
    list.forEach(function (p) {
      var peak = 0;
      for (var t = p.start; t <= p.end; t += 5 * MIN) peak = Math.max(peak, activityAt(t, res, sun));
      p.peak = peak;
      p.fish = peak >= 0.62 ? 4 : peak >= 0.45 ? 3 : peak >= 0.3 ? 2 : 1;
    });
    return res;
  }

  /* Activity index from 0 to 1 at one instant. A rule of thumb, not a measurement:
     bumps at each solunar period and at sunrise and sunset, scaled by the moon phase. */
  function activityAt(t, sol, sun) {
    var v = 0;
    function bump(c, sigma, amp) { var x = (t - c) / sigma; v += amp * Math.exp(-0.5 * x * x); }
    sol.periods.forEach(function (p) { bump(p.t, (p.major ? 42 : 22) * MIN, p.major ? 1 : 0.6); });
    if (sun.rise != null) bump(sun.rise, 32 * MIN, 0.45);
    if (sun.set != null) bump(sun.set, 32 * MIN, 0.45);
    return Math.min(1, v * (0.55 + 0.45 * sol.phaseScore) / 1.45);
  }

  /* ---------- One day, assembled ---------- */

  var cache = {};

  function day(spot, d0) {
    var key = spot.id + '|' + d0;
    if (cache[key]) return cache[key];
    var d1 = addDays(d0, 1);
    var sun = sunTimes(spot, d0, d1);
    var sol = solunar(spot, d0, d1, sun);
    var extremes = spotExtremes(spot, d0, d1);
    var around = spotExtremes(spot, d0 - 9 * HOUR, d1 + 9 * HOUR);
    var highs = extremes.filter(function (e) { return e.hi; }), lows = extremes.filter(function (e) { return !e.hi; });
    var range = (highs.length && lows.length)
      ? Math.max.apply(null, highs.map(function (e) { return e.h; })) - Math.min.apply(null, lows.map(function (e) { return e.h; }))
      : null;
    var r = {
      spot: spot, d0: d0, d1: d1, sun: sun, moon: moonDay(spot, d0, d1), solunar: sol,
      extremes: extremes, around: around, range: range,
      springRange: DATA.auckland.springRange * spot.ratio, neapRange: DATA.auckland.neapRange * spot.ratio
    };
    cache[key] = r;
    return r;
  }

  /* Curves are heavier, so the page asks for them only for the day on screen. */
  function dayCurves(spot, d0) {
    var key = 'c|' + spot.id + '|' + d0;
    if (cache[key]) return cache[key];
    var d = day(spot, d0), step = 6 * MIN;
    var tide = spotCurve(spot, d0, d.d1, step);
    var sky = skyCurve(spot, d0, d.d1, 10 * MIN);
    var act = [];
    for (var t = d0; t <= d.d1; t += 10 * MIN) act.push({ t: t, v: activityAt(t, d.solunar, d.sun) });
    var r = { tide: tide, sky: sky, activity: act };
    cache[key] = r;
    return r;
  }

  /* Tide state at one instant: height, direction and the next turn. */
  function tideNow(spot, t) {
    var ex = spotExtremes(spot, t - 9 * HOUR, t + 9 * HOUR), prev = null, next = null;
    for (var i = 0; i < ex.length; i++) { if (ex[i].t <= t) prev = ex[i]; else { next = ex[i]; break; } }
    var c = spotCurve(spot, t - 6 * MIN, t + 6 * MIN, 6 * MIN);
    return { h: interp(c, t, 'h'), rising: next ? next.hi : null, prev: prev, next: next };
  }

  /* ---------- Windows ---------- */

  /* A window is a stretch between first light and last light when the sustained wind stays at or under
     a limit, for at least a minimum time. The owner sets the limit and the time; these are the defaults. */
  var LIMITS = { wind: 15, hours: 3 };

  /* hours: hourly forecast values, [{ t, wind, gust }], in time order.
     light: { from, to }, the times of first light and last light.
     limits: { wind, hours }.
     Each hourly value stands for the half hour either side of its time, so a window starts and ends
     on the half hour unless first or last light cuts it. A missing hour ends a window: the page does
     not assume calm where it has no forecast. Gusts do not close a window. The wind is compared in
     whole knots, as the page shows it, so 15.4 kn is inside a 15 kn limit and 15.5 kn is not. */
  function windows(hours, light, limits) {
    var out = [], run = null, half = HOUR / 2, minMs = limits.hours * HOUR - 1;
    function close() {
      if (!run) return;
      var a = Math.max(run.start, light.from), b = Math.min(run.end, light.to);
      if (b - a >= minMs) {
        var inside = run.hours.filter(function (h) { return h.t + half > a && h.t - half < b; });
        var gusts = inside.map(function (h) { return h.gust; }).filter(function (g) { return g != null && !isNaN(g); });
        out.push({
          start: a, end: b,
          maxWind: Math.max.apply(null, inside.map(function (h) { return h.wind; })),
          maxGust: gusts.length ? Math.max.apply(null, gusts) : null
        });
      }
      run = null;
    }
    if (light.from == null || light.to == null) return out;
    hours.forEach(function (h) {
      var calm = h.wind != null && !isNaN(h.wind) && Math.round(h.wind) <= limits.wind;
      if (run && (!calm || h.t - run.last !== HOUR)) close();
      if (!calm) return;
      if (!run) run = { start: h.t - half, end: h.t + half, last: h.t, hours: [h] };
      else { run.end = h.t + half; run.last = h.t; run.hours.push(h); }
    });
    close();
    return out;
  }

  /* Best first: the longest window, then the lower top wind, then the earlier start. */
  function rankWindows(list) {
    return list.slice().sort(function (p, q) {
      return (q.end - q.start) - (p.end - p.start) || p.maxWind - q.maxWind || p.start - q.start;
    });
  }

  /* The windows of one day at one spot. recs maps an hour's time to its forecast, { wind, gust }. */
  function dayWindows(spot, d0, recs, limits) {
    var d = day(spot, d0), hours = [];
    for (var t = d.d0; t < d.d1; t += HOUR) {
      var r = recs[t];
      if (r) hours.push({ t: t, wind: r.wind, gust: r.gust });
    }
    return windows(hours, { from: d.sun.dawn, to: d.sun.dusk }, limits || LIMITS);
  }

  /* ---------- Wind color ---------- */

  /* The Week rows color each hour's wind by its speed as a share of the owner's limit. colors holds six
     '#RRGGBB' stops, from the page's theme: green up to 0.60 of the limit, yellow-green at 0.87, yellow at
     the limit, amber just over it, red at 1.33, and dark red from 1.80. Between two stops the color moves
     in a straight line in RGB. Yellow ends at the limit and amber starts just over it, with no blend
     between them. */
  /* Each segment: up to this share, blend from one stop to the next. Past the last segment, the last stop. */
  var RAMP = [
    { to: 0.6, from: 0, a: 0, b: 0 },
    { to: 0.87, from: 0.6, a: 0, b: 1 },
    { to: 1, from: 0.87, a: 1, b: 2 },
    { to: 1.33, from: 1, a: 3, b: 4 },
    { to: 1.8, from: 1.33, a: 4, b: 5 }
  ];
  function rampColor(share, colors) {
    var rgb = colors.map(function (h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); });
    var seg = RAMP.filter(function (s) { return share <= s.to; })[0], c = rgb[5];
    if (seg) {
      var f = seg.a === seg.b ? 0 : (share - seg.from) / (seg.to - seg.from);
      c = rgb[seg.a].map(function (v, i) { return v + (rgb[seg.b][i] - v) * f; });
    }
    return 'rgb(' + c.map(Math.round).join(', ') + ')';
  }
  /* The speed is rounded to whole knots first, as the window rule compares it, so an hour inside a window
     is never amber or red. */
  function windColor(speed, limit, colors) {
    return rampColor(Math.round(speed) / limit, colors);
  }

  /* ---------- Run home ---------- */

  /* The latest time to leave for home: last light, less the run at the owner's speed, less the owner's margin.
     nm is the straight-line distance, so the real run is at least this long. The time is rounded down to the
     whole minute, so the page never shows a time later than the arithmetic gives. Returns null when any
     value is missing: the page does not guess a speed or a margin. */
  function leaveBy(lastLight, nm, speedKn, marginMin) {
    function num(v) { return typeof v === 'number' && isFinite(v); }
    if (!num(lastLight) || !num(nm) || nm < 0 || !num(speedKn) || speedKn <= 0 || !num(marginMin) || marginMin < 0) return null;
    var run = nm / speedKn * HOUR;
    return { run: run, at: Math.floor((lastLight - run - marginMin * MIN) / MIN) * MIN };
  }

  return {
    MIN: MIN, HOUR: HOUR, DAY: DAY,
    LIMITS: LIMITS, windows: windows, rankWindows: rankWindows, dayWindows: dayWindows, leaveBy: leaveBy,
    rampColor: rampColor, windColor: windColor,
    parts: parts, midnight: midnight, dayStart: dayStart, addDays: addDays,
    fmtTime: fmtTime, fmtDay: fmtDay, fmtDayLong: fmtDayLong, fmtDuration: fmtDuration, isoDate: isoDate, pad2: pad2,
    spotExtremes: spotExtremes, spotCurve: spotCurve, interp: interp,
    sunTimes: sunTimes, moonDay: moonDay, nextPhases: nextPhases, nextApsides: nextApsides,
    solunar: solunar, activityAt: activityAt, day: day, dayCurves: dayCurves, tideNow: tideNow,
    aklExtremes: aklExtremes
  };
})();
