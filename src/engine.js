/* Gulf engine.
   Time handling, tides, sun, moon and solunar periods, windows, and comfort on a route.
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

  /* ---------- Week rows ---------- */

  /* The time under a point on a Week row, rounded to 5 minutes, as the Day screen pins it. share is the
     point's distance from the row's left edge as a share of its width, and a and b are the times at the two
     edges. The time stays inside the row's calendar day, which starts at d0: from midnight to 5 minutes before
     the next midnight, so the pin never moves to the next day. */
  function laneTime(share, a, b, d0) {
    var step = 5 * MIN, t = a + Math.min(1, Math.max(0, share)) * (b - a);
    return Math.min(Math.max(Math.round(t / step) * step, d0), addDays(d0, 1) - step);
  }

  /* ---------- Comfort on a route ---------- */

  /* Every number the route's scoring uses. They are a first guess, and the owner's own trip ratings will
     correct them, so they all sit here. Heights are in meters, speeds in knots, angles in degrees and
     distances in nautical miles. */
  var COMFORT = {
    legNm: 0.3,                          /* the longest leg */
    roll: 0.6,                           /* roll = 0.6 × h × sin² a */
    follow: 0.25,                        /* follow = 0.25 × h */
    slamOk: 0.30,                        /* the comfortable speed keeps slam at or under this */
    minKn: 8,                            /* the comfortable speed never drops under this */
    levels: [0.15, 0.30, 0.45, 0.65],    /* the scores at which Fair, Bumpy, Rough and Very rough start */
    names: ['Easy', 'Fair', 'Bumpy', 'Rough', 'Very rough'],
    sheltered: 0.15,                     /* under this chop height, the cause is "sheltered" */
    head: 50,                            /* a head sea up to this angle */
    beam: 130,                           /* a beam sea up to this angle, and a following sea above it */
    stretchNm: 0.5,                      /* the route panel leaves out stretches shorter than this */
    capShare: 0.6,                       /* over shallows, chop is at most this share of the depth */
    breakShare: 0.5                      /* chop over this share of the depth, before the cap, likely breaks */
  };

  /* Waves over shallow water. h is the chop height in deep water, depth the water's depth at the time, in
     meters, or null where it is not known. The height is capped at COMFORT.capShare of the depth, and breaking
     is likely where h is over COMFORT.breakShare of it. Ground that is dry at the time carries no waves. */
  function shallowWaves(h, depth) {
    if (depth == null || !(h > 0)) return { h: h, breaking: false };
    if (depth <= 0) return { h: 0, breaking: false };
    return { h: Math.min(h, COMFORT.capShare * depth), breaking: h > COMFORT.breakShare * depth };
  }

  /* The angle between the boat's course and the direction the wind comes from, 0 to 180 degrees.
     0 is a head sea and 180 a following sea. */
  function seaAngle(course, windFrom) {
    return Math.abs(((windFrom - course) % 360 + 540) % 360 - 180);
  }

  /* Three terms, each in meters, and the score is the largest. slam is the hull meeting waves: largest
     head-on, and it grows with the square of speed. roll is waves on the beam, whatever the speed. follow is
     a floor, so a large following sea never scores as flat water. */
  function comfortScore(h, a, v, cruise) {
    var c = Math.cos(a * RAD), s = Math.sin(a * RAD);
    var slam = h * (1 + c) / 2 * (v / cruise) * (v / cruise), roll = COMFORT.roll * h * s * s, follow = COMFORT.follow * h;
    return Math.max(slam, roll, follow);
  }
  function comfortLevel(score) {
    var n = 0;
    COMFORT.levels.forEach(function (x) { if (score >= x) n++; });
    return n;
  }
  function comfortCause(h, a) {
    return h < COMFORT.sheltered ? 'sheltered' : a <= COMFORT.head ? 'head sea' : a <= COMFORT.beam ? 'beam sea' : 'following sea';
  }
  /* The fastest speed, up to cruising speed, that keeps slam at or under COMFORT.slamOk. It never drops under
     COMFORT.minKn, or under cruising speed when that is slower still. */
  function comfortSpeed(h, a, cruise) {
    var head = h * (1 + Math.cos(a * RAD)) / 2, floor = Math.min(COMFORT.minKn, cruise);
    if (!(head > 0)) return cruise;
    return Math.max(floor, Math.min(cruise, cruise * Math.sqrt(COMFORT.slamOk / head)));
  }
  /* One leg with chop height h, in meters, at angle a. The level shows the leg at cruising speed. The
     comfortable speed shows what it takes to make the leg Fair. */
  function scoreLeg(h, a, cruise) {
    var score = comfortScore(h, a, cruise, cruise);
    return { score: score, level: comfortLevel(score), cause: comfortCause(h, a), v: comfortSpeed(h, a, cruise) };
  }

  /* ---------- A path over water ----------
     grid is a raster of the coastline: { w, h, water, seed }, where water[x + y * w] is 1 for water that counts.
     seed, when given, is the index of a cell in the open Gulf. Points are in cells: cell (x, y) covers the points
     that round to x and y. */

  /* A water cell next to land, or next to water that does not count, is closed. That keeps a path about one
     cell off the shore. Past the raster's edge lies open sea. */
  function openCells(grid) {
    if (grid.open) return grid.open;
    var w = grid.w, h = grid.h, water = grid.water, open = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (!water[x + y * w]) continue;
        var shut = false;
        for (var dy = -1; dy <= 1 && !shut; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var X = x + dx, Y = y + dy;
            if (X >= 0 && Y >= 0 && X < w && Y < h && !water[X + Y * w]) { shut = true; break; }
          }
        }
        open[x + y * w] = shut ? 0 : 1;
      }
    }
    grid.open = grid.seed != null && open[grid.seed] ? joinedTo(open, w, h, grid.seed) : open;
    return grid.open;
  }

  /* Closing the cells next to land can cut off an inlet behind a narrow entrance. Only open cells joined to the
     seed then count, so an end in such an inlet, or on land beside one, starts from the Gulf's nearest open cell.
     The cells join by the moves the search makes. */
  function joinedTo(open, w, h, seed) {
    var joined = new Uint8Array(w * h), stack = [seed];
    joined[seed] = 1;
    while (stack.length) {
      var i = stack.pop(), x = i % w, y = (i - x) / w;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var X = x + dx, Y = y + dy, q = X + Y * w;
          if ((!dx && !dy) || X < 0 || Y < 0 || X >= w || Y >= h || !open[q] || joined[q]) continue;
          if (dx && dy && (!open[X + y * w] || !open[x + Y * w])) continue;
          joined[q] = 1;
          stack.push(q);
        }
      }
    }
    return joined;
  }

  /* The open cell nearest a point, and how far the point is from it, in cells. */
  function nearestOpen(grid, p) {
    var open = openCells(grid), w = grid.w, h = grid.h, cx = Math.round(p.x), cy = Math.round(p.y), best = -1, bd = Infinity;
    function look(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h || !open[x + y * w]) return;
      var d = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y);
      if (d < bd) { bd = d; best = x + y * w; }
    }
    for (var r = 0, top = w + h; r <= top; r++) {
      /* Every cell on ring r lies at least r − 1 from the point. */
      if (best >= 0 && r - 1 > Math.sqrt(bd)) break;
      for (var k = -r; k <= r; k++) {
        look(cx + k, cy - r);
        if (r) look(cx + k, cy + r);
        if (Math.abs(k) < r) { look(cx - r, cy + k); look(cx + r, cy + k); }
      }
    }
    return best < 0 ? null : { i: best, x: best % w, y: Math.floor(best / w), moved: Math.sqrt(bd) };
  }

  /* A* over the open cells, with eight neighbors. A diagonal step needs both cells beside it open, so a path
     never squeezes between two closed cells. Returns the cells from s to g, or null. */
  function searchCells(grid, s, g) {
    var open = grid.open, w = grid.w, n = w * grid.h, SQ2 = Math.SQRT2;
    var cost = new Float64Array(n), from = new Int32Array(n), done = new Uint8Array(n);
    cost.fill(Infinity); from.fill(-1);
    var gx = g % w, gy = Math.floor(g / w), keys = [], vals = [];
    function guess(i) {
      var dx = Math.abs(i % w - gx), dy = Math.abs(Math.floor(i / w) - gy);
      return dx + dy + (SQ2 - 2) * Math.min(dx, dy);
    }
    function push(k, v) {
      var j = keys.length;
      keys.push(k); vals.push(v);
      while (j > 0) {
        var up = (j - 1) >> 1;
        if (keys[up] <= k) break;
        keys[j] = keys[up]; vals[j] = vals[up]; j = up;
      }
      keys[j] = k; vals[j] = v;
    }
    function pop() {
      var top = vals[0], k = keys.pop(), v = vals.pop(), j = 0, m = keys.length;
      if (!m) return top;
      for (;;) {
        var c = 2 * j + 1;
        if (c >= m) break;
        if (c + 1 < m && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[j] = keys[c]; vals[j] = vals[c]; j = c;
      }
      keys[j] = k; vals[j] = v;
      return top;
    }
    cost[s] = 0; push(guess(s), s);
    while (keys.length) {
      var i = pop();
      if (done[i]) continue;
      done[i] = 1;
      if (i === g) break;
      var x = i % w, y = Math.floor(i / w);
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= w || Y >= grid.h) continue;
          var q = X + Y * w;
          if (!open[q] || done[q]) continue;
          if (dx && dy && (!open[X + y * w] || !open[x + Y * w])) continue;
          var c2 = cost[i] + (dx && dy ? SQ2 : 1);
          if (c2 < cost[q]) { cost[q] = c2; from[q] = i; push(c2 + guess(q), q); }
        }
      }
    }
    if (!done[g]) return null;
    var cells = [];
    for (var at = g; at >= 0; at = from[at]) cells.push({ x: at % w, y: Math.floor(at / w) });
    return cells.reverse();
  }

  /* Whether a straight line between the centers of two cells crosses only open cells. The walk visits every
     cell the line passes through. Where the line passes exactly through a corner, both cells beside the
     corner must be open, as for a diagonal step. */
  function clearLine(grid, a, b) {
    var open = grid.open, w = grid.w, cx = a.x, cy = a.y, dx = b.x - a.x, dy = b.y - a.y;
    var sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, n = Math.abs(dx) + Math.abs(dy);
    /* The share of the line at which it next crosses a column or a row. Cell edges lie half a cell from centers. */
    var stepX = dx ? 1 / Math.abs(dx) : Infinity, stepY = dy ? 1 / Math.abs(dy) : Infinity;
    var tx = stepX / 2, ty = stepY / 2;
    if (!open[cx + cy * w]) return false;
    while (n > 0) {
      if (Math.abs(tx - ty) < 1e-9) {
        if (!open[cx + sx + cy * w] || !open[cx + (cy + sy) * w]) return false;
        cx += sx; cy += sy; tx += stepX; ty += stepY; n -= 2;
      } else if (tx < ty) { cx += sx; tx += stepX; n--; }
      else { cy += sy; ty += stepY; n--; }
      if (!open[cx + cy * w]) return false;
    }
    return true;
  }
  /* Keeps a point only where a straight line to a later point would touch closed cells. */
  function straighten(grid, cells) {
    var out = [cells[0]], i = 0;
    while (i < cells.length - 1) {
      var j = i + 1;
      while (j + 1 < cells.length && clearLine(grid, cells[i], cells[j + 1])) j++;
      out.push(cells[j]);
      i = j;
    }
    return out;
  }

  /* A path over open water from a to b, both in cells. An end on land, or on a closed cell, starts from the
     nearest open cell; from.moved and to.moved say how far that is. found is false when no open water joins
     the two ends, which a grid with a seed avoids. There is then no path, and no straight line stands in for one.
     reachA and reachB, when given, are the farthest each end may move, in cells. An end that would move farther
     gives no path, and cut names it, 'a' or 'b'. */
  function findPath(grid, a, b, reachA, reachB) {
    var s = nearestOpen(grid, a), g = nearestOpen(grid, b);
    if (!s || !g) return { found: false, from: s, to: g, points: [] };
    var cut = reachA != null && s.moved > reachA ? 'a' : reachB != null && g.moved > reachB ? 'b' : null;
    if (cut) return { found: false, from: s, to: g, points: [], cut: cut };
    var cells = searchCells(grid, s.i, g.i);
    if (!cells) return { found: false, from: s, to: g, points: [] };
    return { found: true, from: s, to: g, points: straighten(grid, cells) };
  }

  /* ---------- Depth in the path search ----------
     The path grid has R cells per map unit and the depth grid cellsPerUnit, four times as many at R = 2: so a grid
     cell, centered on a whole multiple of 1 / R, holds a block of depth cells two by two. Both grids start at the
     map's north-west corner. A grid cell's chart depth is the shallowest of its depth cells, land in the depth grid
     counts as -Infinity, and a cell whose depth cells all lack data has none (NaN). */

  /* The chart depth of each grid cell, and the index into DATA.spots of the tide spot nearest each water cell. */
  function cellDepths(depthGrid, grid) {
    var w = grid.w, h = grid.h, f = depthGrid.cellsPerUnit / grid.R, chart = new Float32Array(w * h), spot = new Uint8Array(w * h);
    var spots = DATA.spots, kx = depthGrid.k * depthGrid.scale * grid.R, ky = depthGrid.scale * grid.R;
    for (var y = 0; y < h; y++) {
      var r0 = Math.round(y * f - f / 2), lat = depthGrid.N - y / ky, cl = Math.cos(lat * RAD);
      for (var x = 0; x < w; x++) {
        var i = x + y * w, c0 = Math.round(x * f - f / 2), best = NaN;
        for (var r = r0; r < r0 + f; r++) {
          if (r < 0 || r >= depthGrid.ny) continue;
          for (var c = c0; c < c0 + f; c++) {
            if (c < 0 || c >= depthGrid.nx) continue;
            var v = depthGrid.v[r * depthGrid.nx + c];
            if (v === DEPTH_NO_DATA) continue;
            var m = v === DEPTH_LAND ? -Infinity : (v - depthGrid.offsetDm) / 10;
            if (!(best <= m)) best = m;
          }
        }
        chart[i] = best;
        if (!grid.water[i]) continue;
        var lon = depthGrid.W + x / kx, bd = Infinity;
        for (var s = 0; s < spots.length; s++) {
          var dx = (spots[s].lon - lon) * cl, dy = spots[s].lat - lat, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; spot[i] = s; }
        }
      }
    }
    return { chart: chart, spot: spot };
  }

  /* The lowest tide at each tide spot between t0 and t1, from heights every 10 minutes and at both ends; in the
     order of DATA.spots. */
  function lowestTides(t0, t1) {
    return DATA.spots.map(function (sp) {
      var low = null;
      for (var t = t0; ; t = Math.min(t + 10 * MIN, t1)) {
        var hgt = tideNow(sp, t).h;
        if (hgt != null && (low == null || hgt < low)) low = hgt;
        if (t >= t1) break;
      }
      return low;
    });
  }

  /* The path grid with the cells shallower than safe also closed: a cell is shallow when its chart depth plus the
     lowest tide at its nearest spot is under safe. A cell with no depth data stays open. As in openCells, only
     the open cells joined to the seed count. lowTide comes from lowestTides. */
  function shoalGrid(grid, cd, safe, lowTide) {
    var base = openCells(grid), w = grid.w, h = grid.h, open = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) {
      if (!base[i]) continue;
      var c = cd.chart[i], t = lowTide[cd.spot[i]] || 0;
      open[i] = c !== c || c + t >= safe ? 1 : 0;
    }
    return { R: grid.R, w: w, h: h, water: grid.water, land: grid.land, seed: grid.seed,
      open: grid.seed != null && open[grid.seed] ? joinedTo(open, w, h, grid.seed) : open };
  }

  /* The least depth along a path, given in grid cells, at the lowest tides lowTide: { depth, x, y } in grid
     cells, or null where the path crosses no cell with depth data. The path is sampled every quarter cell. */
  function leastDepth(grid, cd, lowTide, points) {
    var out = null;
    for (var k = 1; k < points.length; k++) {
      var p = points[k - 1], q = points[k], n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) * 4));
      for (var j = 0; j <= n; j++) {
        var x = Math.round(p.x + (q.x - p.x) * j / n), y = Math.round(p.y + (q.y - p.y) * j / n);
        if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
        var i = x + y * grid.w, c = cd.chart[i];
        if (c !== c || c === -Infinity) continue;
        var d = c + (lowTide[cd.spot[i]] || 0);
        if (!out || d < out.depth) out = { depth: d, x: x, y: y };
      }
    }
    return out;
  }

  /* ---------- Legs, the clock and stretches ---------- */

  /* Cuts a path into legs no longer than COMFORT.legNm. points have x toward east and y toward south, as on
     the map, with perNm units to the nautical mile. Each leg has its middle, its course in degrees true,
     its length and its distance from the start, in nautical miles. */
  function routeLegs(points, perNm) {
    var legs = [], at = 0;
    for (var k = 1; k < points.length; k++) {
      var p = points[k - 1], q = points[k], dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) / perNm;
      if (!(len > 0)) continue;
      var n = Math.ceil(len / COMFORT.legNm - 1e-9), course = (Math.atan2(dx, -dy) / RAD + 360) % 360;
      for (var j = 0; j < n; j++) {
        legs.push({ x0: p.x + dx * j / n, y0: p.y + dy * j / n, x1: p.x + dx * (j + 1) / n, y1: p.y + dy * (j + 1) / n,
          x: p.x + dx * (j + 0.5) / n, y: p.y + dy * (j + 0.5) / n, course: course, nm: len / n, at: at });
        at += len / n;
      }
    }
    return legs;
  }

  /* Scores the legs in order, each at the time the boat reaches it. The clock starts at t0. cond(x, y, t)
     gives the chop height h, the direction the wind comes from, breaking, true where waves likely break over
     shallows, and dry, true where the ground is dry at that time, at a leg's middle, or null where the forecast does
     not cover it. Each leg adds its time at its
     comfortable speed to the clock. A leg without a forecast gets no score, and the clock crosses it at
     cruising speed. */
  function scoreRoute(legs, t0, cruise, cond) {
    var t = t0, nm = 0, missing = 0, out = legs.map(function (L) {
      var r = {}, k;
      for (k in L) r[k] = L[k];
      var c = cond(L.x, L.y, t);
      r.t = t;
      if (c) {
        var a = seaAngle(L.course, c.from), s = scoreLeg(c.h, a, cruise);
        r.h = c.h; r.a = a; r.score = s.score; r.level = s.level; r.cause = s.cause; r.v = s.v;
        /* Where the ground is dry, or waves likely break over shallows, the leg is Very rough, whatever its score:
           dry ground carries no waves, so its score alone would read as calm. The leg then takes the score where
           Very rough starts, at least, and the lowest comfortable speed, so the clock agrees with the level. */
        if (c.dry || c.breaking) {
          r.level = COMFORT.names.length - 1; r.cause = c.dry ? 'dry ground' : 'breaking waves';
          r.score = Math.max(r.score, COMFORT.levels[COMFORT.levels.length - 1]); r.v = Math.min(COMFORT.minKn, cruise);
          if (c.dry) r.dry = true; else r.breaking = true;
        }
      } else {
        r.level = null; r.v = null;
        missing += L.nm;
      }
      r.ms = L.nm / (r.v || cruise) * HOUR;
      t += r.ms; nm += L.nm;
      return r;
    });
    return { legs: out, start: t0, end: t, ms: t - t0, cruiseMs: nm / cruise * HOUR, nm: nm, missingNm: missing };
  }

  /* Joins neighboring legs of one level into stretches. A stretch's cause is the one that covers most of its
     length, its height the highest chop on it, and its speed its length over its time. Legs without a score
     join into stretches whose level is null. */
  function joinStretches(legs) {
    var out = [];
    legs.forEach(function (L) {
      var s = out[out.length - 1];
      if (!s || s.level !== L.level) {
        s = { level: L.level, at: L.at, nm: 0, ms: 0, h: null, score: null, byCause: {} };
        out.push(s);
      }
      s.nm += L.nm; s.ms += L.ms;
      if (L.level == null) return;
      if (s.h == null || L.h > s.h) s.h = L.h;
      if (s.score == null || L.score > s.score) s.score = L.score;
      s.byCause[L.cause] = (s.byCause[L.cause] || 0) + L.nm;
    });
    return out.map(function (s) {
      var cause = null, most = 0;
      for (var k in s.byCause) if (s.byCause[k] > most) { most = s.byCause[k]; cause = k; }
      return { level: s.level, at: s.at, nm: s.nm, ms: s.ms, h: s.h, score: s.score, cause: cause,
        v: s.level == null ? null : s.nm / (s.ms / HOUR) };
    });
  }
  /* The stretch with the highest level, and of two at one level, the one with the higher score. */
  function worstStretch(stretches) {
    var w = null;
    stretches.forEach(function (s) {
      if (s.level != null && (!w || s.level > w.level || (s.level === w.level && s.score > w.score))) w = s;
    });
    return w;
  }

  /* ---------- Ferry lanes ---------- */

  /* Where a path crosses ferry lanes. points are the path's points, and each lane is { name, paths }, with
     each of its paths a list of points, all in one unit with perNm units to the nautical mile. Returns each
     crossing in order along the path: its distance from the start in nautical miles, and the lane's name.
     A lane often has a path for each direction, side by side, so crossings of one lane within
     LANE_JOIN_NM of each other count once, at the first. */
  var LANE_JOIN_NM = 0.3;
  function laneCrossings(points, lanes, perNm) {
    var out = [], at = 0;
    function cross(p, q, a, b) {
      var rx = q.x - p.x, ry = q.y - p.y, sx = b.x - a.x, sy = b.y - a.y, d = rx * sy - ry * sx;
      if (!d) return null;
      var t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / d, u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / d;
      return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
    }
    for (var k = 1; k < points.length; k++) {
      var p = points[k - 1], q = points[k], len = Math.hypot(q.x - p.x, q.y - p.y) / perNm, hits = [];
      lanes.forEach(function (lane) {
        lane.paths.forEach(function (path) {
          for (var j = 1; j < path.length; j++) {
            var t = cross(p, q, path[j - 1], path[j]);
            if (t != null) hits.push({ at: at + t * len, name: lane.name });
          }
        });
      });
      hits.sort(function (x, y) { return x.at - y.at; }).forEach(function (h) {
        var same = out.filter(function (o) { return o.name === h.name && h.at - o.at < LANE_JOIN_NM; });
        if (!same.length) out.push(h);
      });
      at += len;
    }
    return out;
  }

  /* ---------- Depth ----------
     The depth grid covers the map in cells of a quarter map unit, about 93 m. The page decodes data/depth.png into
     grid = { W, N, k, scale, cellsPerUnit, nx, ny, offsetDm, v }, where v holds nx * ny stored values, row by row
     from the north-west corner: 0 means no data, 1 means land, and any other value is the depth below chart datum
     in decimeters plus offsetDm. A negative depth is a drying height. Each cell already holds the shallowest water
     inside it; tools/depth.py made it so. */

  var DEPTH_NO_DATA = 0, DEPTH_LAND = 1;

  /* Chart depth at a point { lat, lon }: { chart } in meters below chart datum, { land: true } above any tide,
     or null where the grid has no data or the point is off the grid. A point on the edge between cells takes
     the shallowest of the cells it touches, so an edge never shows more water than either side. */
  function depthAt(grid, p) {
    if (!grid || !p || !isFinite(p.lat) || !isFinite(p.lon)) return null;
    var fx = (p.lon - grid.W) * grid.k * grid.scale * grid.cellsPerUnit;
    var fy = (grid.N - p.lat) * grid.scale * grid.cellsPerUnit;
    var EDGE = 1e-6;   /* a point this close to a cell edge, in cells, is on it */
    if (fx < -EDGE || fy < -EDGE || fx > grid.nx + EDGE || fy > grid.ny + EDGE) return null;
    function sides(f, n) {
      var r = Math.round(f), out = [];
      if (Math.abs(f - r) > EDGE) return [Math.min(Math.floor(f), n - 1)];
      if (r < n) out.push(r);
      if (r > 0) out.push(r - 1);
      return out;
    }
    var xs = sides(fx, grid.nx), ys = sides(fy, grid.ny), best = null;
    for (var a = 0; a < ys.length; a++) for (var b = 0; b < xs.length; b++) {
      var v = grid.v[ys[a] * grid.nx + xs[b]];
      if (v === DEPTH_NO_DATA) continue;
      if (v === DEPTH_LAND) return { land: true };
      var m = (v - grid.offsetDm) / 10;
      if (best === null || m < best) best = m;
    }
    return best === null ? null : { chart: best };
  }

  /* The depth grid's file, data/depth.png, read without a canvas. A canvas can change the bytes it gives back: some
     browsers add noise to canvas reads to resist fingerprinting, and one unit of red moves a depth by 25.6 m.
     pngChunks reads the header and joins the compressed data; the page inflates it with DecompressionStream; and
     pngValues undoes the row filters and returns each cell's stored value, red * 256 + green. Only the form
     tools/depth.py writes is read: 8-bit RGB, not interlaced. Anything else throws. */
  function pngChunks(bytes) {
    var b = bytes, sig = [137, 80, 78, 71, 13, 10, 26, 10], pos = 8, head = null, parts = [], size = 0;
    for (var i = 0; i < 8; i++) if (b[i] !== sig[i]) throw new Error('not a PNG file');
    function u32(o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
    while (pos + 8 <= b.length) {
      var n = u32(pos), kind = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]), at = pos + 8;
      if (at + n > b.length) throw new Error('PNG chunk runs past the file');
      if (kind === 'IHDR') head = { width: u32(at), height: u32(at + 4), bits: b[at + 8], color: b[at + 9], interlace: b[at + 12] };
      else if (kind === 'IDAT') { parts.push(b.subarray(at, at + n)); size += n; }
      else if (kind === 'IEND') break;
      pos = at + n + 4;
    }
    if (!head || head.bits !== 8 || head.color !== 2 || head.interlace !== 0) throw new Error('the PNG must be 8-bit RGB');
    var data = new Uint8Array(size), off = 0;
    parts.forEach(function (q) { data.set(q, off); off += q.length; });
    return { width: head.width, height: head.height, data: data };
  }

  function pngValues(raw, w, h) {
    var stride = w * 3, bpp = 3, out = new Uint16Array(w * h), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    if (raw.length !== h * (stride + 1)) throw new Error('the PNG data has the wrong length');
    for (var y = 0; y < h; y++) {
      var f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (var x = 0; x < stride; x++) {
        var a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0, pr;
        if (f === 0) pr = 0;
        else if (f === 1) pr = a;
        else if (f === 2) pr = up;
        else if (f === 3) pr = (a + up) >> 1;
        else if (f === 4) {
          var p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
          pr = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
        } else throw new Error('unknown PNG row filter ' + f);
        cur[x] = (row[x] + pr) & 255;
      }
      for (var i = 0; i < w; i++) out[y * w + i] = cur[i * 3] * 256 + cur[i * 3 + 1];
      var t = prev; prev = cur; cur = t;
    }
    return out;
  }

  /* The tide spot nearest a point { lat, lon }, by distance on the ground. */
  function nearestSpot(p) {
    var k = Math.cos(p.lat * Math.PI / 180), best = null, bd = Infinity;
    DATA.spots.forEach(function (s) {
      var dx = (s.lon - p.lon) * k, dy = s.lat - p.lat, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }

  /* Depth at a point at time t: chart depth plus the tide height at the nearest tide spot.
     Returns { depth, chart, tide, spot }, { land: true, tide, spot }, or null where depthAt has nothing. */
  /* The median chart depth of the water in a box of the map, from x0 to x1 and y0 to y1 in map units, with sides on
     the edges of depth cells. Land and cells with no data are left out. With an even count, the shallower of the two
     middle values stands. null where the box holds no water with a depth. */
  function medianDepth(grid, x0, y0, x1, y1) {
    var f = grid.cellsPerUnit, vals = [];
    var c0 = Math.max(0, Math.round(x0 * f)), c1 = Math.min(grid.nx, Math.round(x1 * f));
    var r0 = Math.max(0, Math.round(y0 * f)), r1 = Math.min(grid.ny, Math.round(y1 * f));
    for (var r = r0; r < r1; r++) {
      for (var c = c0; c < c1; c++) {
        var v = grid.v[r * grid.nx + c];
        if (v !== DEPTH_NO_DATA && v !== DEPTH_LAND) vals.push((v - grid.offsetDm) / 10);
      }
    }
    if (!vals.length) return null;
    vals.sort(function (a, b) { return a - b; });
    return vals[(vals.length - 1) >> 1];
  }

  function depthAtTime(grid, p, t) {
    var d = depthAt(grid, p);
    if (!d) return null;
    var spot = nearestSpot(p), h = tideNow(spot, t).h, tide = h == null ? null : h;
    if (d.land) return { land: true, tide: tide, spot: spot };
    return { depth: tide == null ? null : d.chart + tide, chart: d.chart, tide: tide, spot: spot };
  }

  /* ---------- Run home ---------- */

  /* The latest time to leave for home: last light, less the run, less the owner's margin. run is the trip time
     home in milliseconds: the page gives the route's time at comfortable speeds. The time is rounded down to
     the whole minute, so the page never shows a time later than the arithmetic gives. Returns null when any
     value is missing: the page does not guess a run or a margin. */
  function leaveBy(lastLight, run, marginMin) {
    function num(v) { return typeof v === 'number' && isFinite(v); }
    if (!num(lastLight) || !num(run) || run < 0 || !num(marginMin) || marginMin < 0) return null;
    return { run: run, at: Math.floor((lastLight - run - marginMin * MIN) / MIN) * MIN };
  }

  return {
    MIN: MIN, HOUR: HOUR, DAY: DAY,
    LIMITS: LIMITS, windows: windows, rankWindows: rankWindows, dayWindows: dayWindows, leaveBy: leaveBy,
    rampColor: rampColor, windColor: windColor, laneTime: laneTime,
    COMFORT: COMFORT, shallowWaves: shallowWaves, seaAngle: seaAngle, scoreLeg: scoreLeg, findPath: findPath, routeLegs: routeLegs,
    scoreRoute: scoreRoute, joinStretches: joinStretches, worstStretch: worstStretch, laneCrossings: laneCrossings,
    depthAt: depthAt, depthAtTime: depthAtTime, medianDepth: medianDepth, nearestSpot: nearestSpot, pngChunks: pngChunks, pngValues: pngValues,
    cellDepths: cellDepths, lowestTides: lowestTides, shoalGrid: shoalGrid, leastDepth: leastDepth,
    parts: parts, midnight: midnight, dayStart: dayStart, addDays: addDays,
    fmtTime: fmtTime, fmtDay: fmtDay, fmtDayLong: fmtDayLong, fmtDuration: fmtDuration, isoDate: isoDate, pad2: pad2,
    spotExtremes: spotExtremes, spotCurve: spotCurve, interp: interp,
    sunTimes: sunTimes, moonDay: moonDay, nextPhases: nextPhases, nextApsides: nextApsides,
    solunar: solunar, activityAt: activityAt, day: day, dayCurves: dayCurves, tideNow: tideNow,
    aklExtremes: aklExtremes
  };
})();
