/* Hauraki Gulf Almanac: page behavior. Needs Engine and DATA. */
(function () {
  'use strict';

  var E = Engine, MIN = E.MIN, HOUR = E.HOUR;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function f1(n) { return Number(n).toFixed(1); }
  function meters(h) { return Number(h).toFixed(1) + '\u00a0m'; }
  function ok(v) { return v != null && !isNaN(v); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage is optional */ } }
  };

  var spots = DATA.spots, byId = {};
  spots.forEach(function (s) { byId[s.id] = s; });

  var state = {
    spot: byId[store.get('gulf-almanac-spot')] || spots[0],
    d0: E.dayStart(Date.now()),
    followToday: true,
    cursor: null,
    geom: null,
    wx: {},
    wxBlocked: false,
    pin: null,
    probe: null,
    probeMiss: false,
    layers: { wind: true, flow: true, chop: true }
  };

  /* ---------- Small drawing helpers ---------- */

  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(deg) { return ok(deg) ? COMPASS[Math.round(deg / 22.5) % 16] : ''; }

  /* The arrow points the way the wind or swell is traveling. */
  function arrow(deg) {
    if (!ok(deg)) return '';
    return '<svg class="arrow" viewBox="-6 -6 12 12" aria-hidden="true"><path transform="rotate(' + (Number(deg) + 180).toFixed(0) + ')" d="M0 -6L4 5L0 2.6L-4 5Z"/></svg>';
  }

  function windBand(kn) { return !ok(kn) ? 0 : kn >= 25 ? 4 : kn >= 20 ? 3 : kn >= 15 ? 2 : kn >= 10 ? 1 : 0; }

  /* Moon disc. The lit limb is drawn pointing up, then turned to the angle the observer sees. */
  function moonShape(fraction, limb, r) {
    var k = clamp(fraction, 0, 1), b = (r * Math.abs(2 * k - 1)).toFixed(2);
    var lit = 'M' + (-r) + ' 0A' + r + ' ' + r + ' 0 0 1 ' + r + ' 0A' + r + ' ' + b + ' 0 0 ' + (k > 0.5 ? 1 : 0) + ' ' + (-r) + ' 0Z';
    return '<circle class="moon-dark" r="' + r + '"/><path class="moon-lit" transform="rotate(' + (-limb).toFixed(1) + ')" d="' + lit + '"/><circle class="moon-rim" r="' + r + '"/>';
  }
  /* On the chassis the disc sits in a small dark recess, so a full moon still reads as lit. */
  function moonSvg(fraction, limb, size) {
    var h = size / 2, inset = size >= 40 ? 4 : 1.6;
    return '<svg width="' + size + '" height="' + size + '" viewBox="' + (-h) + ' ' + (-h) + ' ' + size + ' ' + size + '" aria-hidden="true"><circle class="moon-recess" r="' + h + '"/>' +
      moonShape(fraction, limb, h - inset) + '</svg>';
  }

  function pips(level) {
    var s = '<span class="pips" aria-hidden="true">';
    for (var i = 0; i < 4; i++) s += '<i' + (i <= level ? ' class="on"' : '') + '></i>';
    return s + '</span>';
  }

  /* Dial from 0 to 100 with an amber needle. The needle starts at `from` and settles on `score`. */
  function gauge(score, from) {
    var cx = 66, cy = 64, s = '<svg width="132" height="72" viewBox="0 0 132 72" role="img" aria-label="Solunar rating ' + score + ' of 100">';
    for (var k = 0; k <= 20; k++) {
      var a = Math.PI - k * Math.PI / 20, major = k % 5 === 0, r2 = major ? 45 : 50.5;
      s += '<line class="' + (major ? 'g-major' : 'g-tick') + '" x1="' + (cx + 56 * Math.cos(a)).toFixed(1) + '" y1="' + (cy - 56 * Math.sin(a)).toFixed(1) +
        '" x2="' + (cx + r2 * Math.cos(a)).toFixed(1) + '" y2="' + (cy - r2 * Math.sin(a)).toFixed(1) + '"/>';
      if (major) s += '<text class="g-num" x="' + (cx + 36 * Math.cos(a)).toFixed(1) + '" y="' + (cy - 36 * Math.sin(a) + 2.8).toFixed(1) + '" text-anchor="middle">' + (k * 5) + '</text>';
    }
    return s + '<line class="g-needle" id="gNeedle" x1="' + cx + '" y1="' + cy + '" x2="' + (cx - 51) + '" y2="' + cy + '" style="transform-origin:' + cx + 'px ' + cy +
      'px;transform:rotate(' + (from * 1.8).toFixed(1) + 'deg)"/><circle class="g-hub" cx="' + cx + '" cy="' + cy + '" r="3.4"/></svg>';
  }

  function settle(id, prop, value) {
    var el = $(id);
    if (el) window.requestAnimationFrame(function () { el.style[prop] = value; });
  }

  var WMO = {
    0: 'Clear', 1: 'Mostly clear', 2: 'Part cloud', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
    51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 56: 'Drizzle', 57: 'Drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Rain', 67: 'Heavy rain',
    71: 'Snow', 73: 'Snow', 75: 'Snow', 77: 'Snow',
    80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow', 86: 'Snow',
    95: 'Thunder', 96: 'Thunder, hail', 99: 'Thunder, hail'
  };

  /* ---------- Weather: Open-Meteo, fetched by the reader's browser ---------- */

  var WX_TTL = 60 * 60 * 1000;

  function getJSON(url, ms) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms || 12000);
    return fetch(url, { signal: ctl.signal }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (err) { clearTimeout(timer); throw err; });
  }

  function buildRecs(fc, mar) {
    var H = fc.hourly, recs = {}, i, r;
    for (i = 0; i < H.time.length; i++) {
      if (!ok(H.wind_speed_10m[i])) continue;
      recs[H.time[i] * 1000] = {
        temp: H.temperature_2m[i], rain: H.precipitation[i],
        pop: H.precipitation_probability ? H.precipitation_probability[i] : null,
        code: H.weather_code[i], cloud: H.cloud_cover[i], p: H.pressure_msl[i],
        wind: H.wind_speed_10m[i], dir: H.wind_direction_10m[i], gust: H.wind_gusts_10m[i]
      };
    }
    if (mar && mar.hourly && mar.hourly.time) {
      var M = mar.hourly;
      var pick = function (key, k) { return M[key] ? M[key][k] : null; };
      for (i = 0; i < M.time.length; i++) {
        r = recs[M.time[i] * 1000];
        if (!r) continue;
        r.wave = pick('wave_height', i); r.wper = pick('wave_period', i); r.wdir = pick('wave_direction', i);
        r.swell = pick('swell_wave_height', i); r.sdir = pick('swell_wave_direction', i); r.sper = pick('swell_wave_period', i);
        r.sst = pick('sea_surface_temperature', i);
      }
    }
    return recs;
  }

  function readCachedWx(id) {
    try {
      var raw = store.get('gulf-almanac-wx-' + id);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.at || !o.recs || Date.now() - o.at > 3 * 24 * HOUR) return null;
      return o;
    } catch (e) { return null; }
  }

  function loadWeather(force) {
    var spot = state.spot, id = spot.id, cur = state.wx[id];
    if (cur && cur.status === 'loading') return;
    if (!force && cur && cur.status === 'ok' && Date.now() - cur.at < WX_TTL) return;
    var old = (cur && cur.recs) ? cur : readCachedWx(id);
    if (!force && state.wxBlocked) {
      state.wx[id] = { status: 'failed', at: old ? old.at : 0, recs: old ? old.recs : null };
      weatherChanged(id);
      return;
    }
    if (!force && old && Date.now() - old.at < WX_TTL) {
      state.wx[id] = { status: 'ok', at: old.at, recs: old.recs };
      weatherChanged(id);
      return;
    }
    state.wx[id] = { status: 'loading', at: old ? old.at : 0, recs: old ? old.recs : null };
    weatherChanged(id);

    var q = 'latitude=' + spot.lat.toFixed(3) + '&longitude=' + spot.lon.toFixed(3) +
      '&timeformat=unixtime&timezone=Pacific%2FAuckland&forecast_days=7';
    var fcUrl = 'https://api.open-meteo.com/v1/forecast?' + q + '&cell_selection=sea&wind_speed_unit=kn' +
      '&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
    var marUrl = 'https://marine-api.open-meteo.com/v1/marine?' + q +
      '&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature';

    Promise.all([getJSON(fcUrl), getJSON(marUrl).catch(function () { return null; })]).then(function (res) {
      var recs = buildRecs(res[0], res[1]);
      if (!Object.keys(recs).length) throw new Error('empty forecast');
      state.wx[id] = { status: 'ok', at: Date.now(), recs: recs };
      state.wxBlocked = false;
      store.set('gulf-almanac-wx-' + id, JSON.stringify({ at: state.wx[id].at, recs: recs }));
    }).catch(function () {
      state.wx[id] = { status: 'failed', at: old ? old.at : 0, recs: old ? old.recs : null };
      state.wxBlocked = true;
    }).then(function () { weatherChanged(id); });
  }

  function weatherChanged(id) {
    syncField(false);
    if (state.spot.id !== id) return;
    renderChart(); renderReadout(); renderWeather(); renderAhead();
  }

  function dayRecs(a, b) {
    var wx = state.wx[state.spot.id], out = [];
    if (!wx || !wx.recs) return out;
    for (var t = a; t < b; t += HOUR) { if (wx.recs[t]) out.push({ t: t, r: wx.recs[t] }); }
    return out;
  }

  function wxSpan() {
    var wx = state.wx[state.spot.id];
    if (!wx || !wx.recs) return null;
    var keys = Object.keys(wx.recs).map(Number);
    return { first: Math.min.apply(null, keys), last: Math.max.apply(null, keys) };
  }

  /* Daylight summary for one day: the hours between sunrise and sunset. */
  function daySummary(d) {
    var hrs = dayRecs(d.d0, d.d1), lit = hrs.filter(function (q) { return q.t >= d.sun.rise - HOUR && q.t <= d.sun.set; });
    if (lit.length < 6) return null;
    var sx = 0, sy = 0, lo = Infinity, hi = -Infinity, gust = -Infinity, wave = null, rain = 0;
    lit.forEach(function (q) {
      var a = q.r.dir * Math.PI / 180;
      sx += Math.sin(a) * q.r.wind; sy += Math.cos(a) * q.r.wind;
      lo = Math.min(lo, q.r.wind); hi = Math.max(hi, q.r.wind);
      if (ok(q.r.gust)) gust = Math.max(gust, q.r.gust);
      if (ok(q.r.wave)) wave = Math.max(wave == null ? 0 : wave, q.r.wave);
    });
    hrs.forEach(function (q) { if (ok(q.r.rain)) rain += q.r.rain; });
    return { lo: lo, hi: hi, gust: gust, wave: wave, rain: rain, dir: (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360 };
  }

  /* ---------- Day chart ---------- */

  /* Fish icon: Font Awesome Free "fish" (solid), CC BY 4.0. Its view box is 576 by 512. */
  var FISH = 'M180.5 141.5C219.7 108.5 272.6 80 336 80s116.3 28.5 155.5 61.5c39.1 33 66.9 72.4 81 99.8 4.7 9.2 4.7 20.1 0 29.3-14.1 27.4-41.9 66.8-81 99.8-39.2 33.1-92 61.5-155.5 61.5s-116.3-28.5-155.5-61.5c-16.2-13.7-30.5-28.5-42.7-43.1L48.1 379.6c-12.5 7.3-28.4 5.3-38.7-4.9s-12.4-26-5.3-38.6L50 256 4.2 175.9c-7.2-12.6-5-28.4 5.3-38.6s26.1-12.2 38.7-4.9l89.7 52.3c12.2-14.6 26.5-29.4 42.7-43.1zM448 256a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z', FISH_W = 576, FISH_H = 512;

  function renderChart() {
    var host = $('chart'), W = Math.max(300, Math.floor(host.clientWidth || 900));
    var d = E.day(state.spot, state.d0), c = E.dayCurves(state.spot, state.d0);
    var hrs = dayRecs(d.d0, d.d1), sun = d.sun, small = W < 560;
    var x0 = small ? 34 : 80, x1 = W - (small ? 10 : 22), pw = x1 - x0, span = d.d1 - d.d0;
    var bandTop = 18, yTop = 54, actH = 40, yAct = yTop + actH, skyH = small ? 92 : 118, yHor = yAct + skyH;
    var seaH = small ? 140 : 162, ySea = yHor + seaH, windH = hrs.length ? 58 : 0, yWind = ySea + windH, H = yWind + 32;
    var hat = (DATA.auckland.hat - DATA.auckland.msl) * state.spot.ratio + state.spot.msl;
    var hTop = Math.max(1, Math.ceil(hat * 2) / 2);
    function X(t) { return x0 + (t - d.d0) / span * pw; }
    function yAlt(a) { return yHor - a / 90 * (skyH - 8); }
    function yActv(v) { return yAct - v * (actH - 5); }
    function yTide(h) { return ySea - Math.max(0, h) / hTop * (seaH - 38); }
    function n(v) { return v.toFixed(1); }
    function hline(y, cls) { return '<line class="' + cls + '" x1="' + x0 + '" y1="' + y + '" x2="' + x1 + '" y2="' + y + '"/>'; }

    /* Ground: light by day, a darker tone of the same ground at night. The tone ramps from
       nautical twilight to just after sunrise, and the reverse at dusk. */
    var rampA = sun.nautDawn != null ? sun.nautDawn : d.d0 + 5 * HOUR, rampB = (sun.rise != null ? sun.rise : d.d0 + 6 * HOUR) + 15 * MIN;
    var rampC = (sun.set != null ? sun.set : d.d0 + 18 * HOUR) - 15 * MIN, rampD = sun.nautDusk != null ? sun.nautDusk : d.d0 + 19 * HOUR;
    var mid1 = (rampA + rampB) / 2, mid2 = (rampC + rampD) / 2;
    function halo(t) { return (t >= mid1 && t < mid2) ? 'hd' : 'hn'; }
    function off(t) { return clamp(X(t) / W, 0, 1).toFixed(4); }

    var s = [], i;
    s.push('<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">');
    s.push('<defs><linearGradient id="gSky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + W + '" y2="0">' +
      '<stop offset="0" class="s-n"/><stop offset="' + off(rampA) + '" class="s-n"/><stop offset="' + off(rampB) + '" class="s-d"/>' +
      '<stop offset="' + off(rampC) + '" class="s-d"/><stop offset="' + off(rampD) + '" class="s-n"/><stop offset="1" class="s-n"/></linearGradient>' +
      '<clipPath id="clipSky"><rect x="' + x0 + '" y="' + yAct + '" width="' + pw + '" height="' + skyH + '"/></clipPath></defs>');
    s.push('<rect class="c-sky" x="0" y="0" width="' + W + '" height="' + H + '"/>');

    /* A faint vertical line every six hours. */
    var hours = Math.round(span / HOUR);
    for (i = 1; i < hours; i++) {
      if (E.parts(d.d0 + i * HOUR).H % 6 === 0) s.push('<line class="c-grid" x1="' + n(X(d.d0 + i * HOUR)) + '" y1="' + yTop + '" x2="' + n(X(d.d0 + i * HOUR)) + '" y2="' + yWind + '"/>');
    }

    /* Lane titles in the margin, each with a sample of its line. Narrow screens use the legend under the display. */
    if (!small) {
      var title = function (y, text, cls) {
        return (cls ? '<line class="' + cls + '" x1="10" y1="' + y + '" x2="25" y2="' + y + '"/>' : '') +
          '<text class="c-title" x="' + (cls ? 31 : 10) + '" y="' + (y + 3.8) + '">' + text + '</text>';
      };
      s.push(title(yTop + 13, 'Solunar', 'c-sol') + title(yAct + 13, 'Sun', 'c-sun') + title(yAct + 28, 'Moon', 'c-moon') + title(yHor + 13, 'Tide', 'c-tide'));
      if (hrs.length) s.push(title(ySea + 14, 'Wind', ''));
    }
    [30, 60].forEach(function (a) {
      s.push(hline(n(yAlt(a)), 'c-grid'));
      s.push('<text class="c-ax" x="' + (x0 - 7) + '" y="' + n(yAlt(a) + 3.6) + '" text-anchor="end">' + a + '°</text>');
    });

    /* Solunar periods: a band through the solunar, sky and tide lanes. Above it, a row of four fish.
       The green fish give the level of the period. */
    var fw = small ? 12 : 15, fgap = small ? 2 : 3, fh = fw * FISH_H / FISH_W, rowW = 4 * fw + 3 * fgap;
    d.solunar.periods.forEach(function (p) {
      var a = Math.max(p.start, d.d0), b = Math.min(p.end, d.d1);
      if (b <= a) return;
      var xa = X(a), xb = X(b), bw = xb - xa, cx = (xa + xb) / 2;
      s.push('<rect class="' + (p.major ? 'c-major' : 'c-minor') + '" x="' + n(xa) + '" y="' + bandTop + '" width="' + n(bw) + '" height="' + (ySea - bandTop) + '"/>');
      if (p.start >= d.d0) s.push('<line class="c-edge" x1="' + n(xa) + '" y1="' + bandTop + '" x2="' + n(xa) + '" y2="' + ySea + '"/>');
      if (p.end <= d.d1) s.push('<line class="c-edge" x1="' + n(xb) + '" y1="' + bandTop + '" x2="' + n(xb) + '" y2="' + ySea + '"/>');
      if (bw >= 30) s.push('<text class="c-band" x="' + n(cx) + '" y="29" text-anchor="middle">' + (p.major ? 'Major' : 'Minor') + '</text>');
      if (bw >= 8) {
        /* Wide screens: one row of four. Narrow screens: two rows of two, so neighboring ratings do not touch. */
        var cols = small ? 2 : 4, gridW = cols * fw + (cols - 1) * fgap;
        var fx = clamp(cx - gridW / 2, x0 + 2, x1 - gridW - 2), fy = small ? 24 : (bw >= 30 ? 41 : 36) - fh / 2;
        for (var f = 0; f < 4; f++) {
          s.push('<path class="c-fish' + (f < p.fish ? '' : ' off') + '" transform="translate(' + n(fx + (f % cols) * (fw + fgap)) + ' ' + n(fy + Math.floor(f / cols) * (fh + fgap)) +
            ') scale(' + (fw / FISH_W).toFixed(5) + ')" d="' + FISH + '"/>');
        }
      }
    });

    /* Solunar lane. */
    var pa = '';
    c.activity.forEach(function (q, k) { pa += (k ? 'L' : 'M') + n(X(q.t)) + ' ' + n(yActv(q.v)); });
    s.push('<path class="c-solfill" d="' + pa + 'L' + n(x1) + ' ' + yAct + 'L' + x0 + ' ' + yAct + 'Z"/><path class="c-sol" d="' + pa + '"/>');

    /* Sky lane: sun and moon altitude, shown only above the horizon. Both discs are the same size. */
    function skyPath(key) {
      var p = '';
      c.sky.forEach(function (q, k) { p += (k ? 'L' : 'M') + n(X(q.t)) + ' ' + n(yAlt(q[key])); });
      return p;
    }
    var sp = skyPath('sun');
    s.push('<g clip-path="url(#clipSky)"><path class="c-sunfill" d="' + sp + 'L' + n(x1) + ' ' + (yHor + 40) + 'L' + x0 + ' ' + (yHor + 40) + 'Z"/>' +
      '<path class="c-moon" d="' + skyPath('moon') + '"/><path class="c-sun" d="' + sp + '"/></g>');
    var moonAt = null;
    d.moon.upper.forEach(function (u) { if (u.alt > 3) moonAt = { t: u.t, alt: u.alt }; });
    if (!moonAt) {
      c.sky.forEach(function (q) { if (q.moon > 3 && (!moonAt || q.moon > moonAt.alt)) moonAt = { t: q.t, alt: q.moon }; });
    }
    if (moonAt) {
      s.push('<g class="pm" transform="translate(' + n(clamp(X(moonAt.t), x0 + 9, x1 - 9)) + ' ' + n(yAlt(moonAt.alt)) + ')">' + moonShape(d.moon.fraction, d.moon.limb, 7.5) + '</g>');
    }
    if (sun.noon >= d.d0 && sun.noon < d.d1) {
      s.push('<circle class="c-sundisc" cx="' + n(X(sun.noon)) + '" cy="' + n(yAlt(sun.noonAlt)) + '" r="7.5"/>');
    }

    /* Tide lane. */
    var pt = '';
    c.tide.forEach(function (q, k) { pt += (k ? 'L' : 'M') + n(X(q.t)) + ' ' + n(yTide(q.h)); });
    s.push('<path class="c-tidefill" d="' + pt + 'L' + n(X(c.tide[c.tide.length - 1].t)) + ' ' + ySea + 'L' + n(X(c.tide[0].t)) + ' ' + ySea + 'Z"/>');
    for (i = 1; i <= hTop - 0.5; i++) {
      s.push(hline(n(yTide(i)), 'c-grid'));
      s.push('<text class="c-ax" x="' + (x0 - 7) + '" y="' + n(yTide(i) + 3.6) + '" text-anchor="end">' + i + (small ? '' : ' m') + '</text>');
    }
    s.push('<path class="c-tide" d="' + pt + '"/>');

    var now = Date.now();
    if (now >= d.d0 && now < d.d1) {
      var xn = X(now);
      s.push('<line class="c-now" x1="' + n(xn) + '" y1="16" x2="' + n(xn) + '" y2="' + yWind + '"/>');
      s.push('<path class="c-nowcap" d="M' + n(xn - 5) + ' 8h10l-5 8z"/>');
    }
    d.extremes.forEach(function (e) {
      var x = X(e.t), y = yTide(e.h), lx = clamp(x, x0 + 19, x1 - 19), hc = halo(e.t);
      s.push('<circle class="c-dot" cx="' + n(x) + '" cy="' + n(y) + '" r="3.6"/>');
      s.push('<text class="c-xt ' + hc + '" x="' + n(lx) + '" y="' + n(y - 21) + '" text-anchor="middle">' + E.fmtTime(e.t) + '</text>');
      s.push('<text class="c-xh ' + hc + '" x="' + n(lx) + '" y="' + n(y - 8) + '" text-anchor="middle">' + meters(e.h) + '</text>');
    });

    /* Wind lane, present only when a forecast covers this day. */
    if (hrs.length) {
      var perHour = pw / 24, step = perHour >= 30 ? 1 : perHour >= 15 ? 2 : 3;
      hrs.forEach(function (q) {
        var hour = E.parts(q.t).H;
        if (step === 1 ? hour === 0 : hour % step !== 1) return;
        var x = X(q.t), half = perHour * step / 2, r = q.r, b = windBand(r.wind);
        if (b) s.push('<rect class="c-w' + b + '" x="' + n(x - half) + '" y="' + ySea + '" width="' + n(half * 2) + '" height="' + windH + '"/>');
        if (ok(r.dir)) s.push('<path class="c-arrow" transform="translate(' + n(x) + ' ' + (ySea + 15) + ') rotate(' + (r.dir + 180).toFixed(0) + ')" d="M0 -8L4.6 5L0 2.2L-4.6 5Z"/>');
        s.push('<text class="c-ws" x="' + n(x) + '" y="' + (ySea + 38) + '" text-anchor="middle">' + Math.round(r.wind) + '</text>');
        if (ok(r.gust)) s.push('<text class="c-wg" x="' + n(x) + '" y="' + (ySea + 51) + '" text-anchor="middle">' + Math.round(r.gust) + '</text>');
      });
      s.push('<text class="c-ax" x="' + (x0 - 7) + '" y="' + (ySea + 38) + '" text-anchor="end">kn</text>');
      s.push('<text class="c-ax" x="' + (x0 - 7) + '" y="' + (ySea + 51) + '" text-anchor="end">gust</text>');
    }

    /* Lane rules and the ruled time axis. */
    s.push(hline(yTop, 'c-line') + hline(yAct, 'c-line') + hline(yHor, 'c-line') + hline(ySea, 'c-line'));
    var perH = pw / 24, every = perH >= 27 ? 2 : perH >= 15 ? 3 : 6, tickMin = perH >= 30 ? 10 : perH >= 12 ? 30 : 60;
    s.push(hline(yWind, 'c-rule'));
    for (var tt = d.d0; tt <= d.d1; tt += tickMin * MIN) {
      var tp = E.parts(tt), tx = X(tt), onHour = tp.M === 0, big = onHour && tp.H % every === 0;
      var len = big ? 9 : onHour ? 6.5 : tp.M === 30 ? 4.5 : 3;
      s.push('<line class="c-rule" x1="' + n(tx) + '" y1="' + yWind + '" x2="' + n(tx) + '" y2="' + (yWind + len) + '"/>');
      if (big && tt < d.d1) s.push('<text class="c-ax" x="' + n(tx) + '" y="' + (yWind + 22) + '" text-anchor="middle">' + E.pad2(tp.H) + '</text>');
    }

    if (state.pin != null && state.pin >= d.d0 && state.pin < d.d1) {
      var xp = X(state.pin), lp = clamp(xp, 20, W - 20);
      s.push('<line class="c-pin" x1="' + n(xp) + '" y1="15" x2="' + n(xp) + '" y2="' + yWind + '"/>');
      s.push('<rect class="c-pinflag" x="' + n(lp - 18) + '" y="2" width="36" height="13" rx="2"/>');
      s.push('<text class="c-pintext" x="' + n(lp) + '" y="12" text-anchor="middle">' + E.fmtTime(state.pin) + '</text>');
    }

    s.push('<g id="cur"></g></svg>');
    host.innerHTML = s.join('');
    var legend = $('dayLegend');
    if (legend) legend.hidden = !small;
    state.geom = { W: W, x0: x0, pw: pw, d0: d.d0, d1: d.d1, span: span, yTop: bandTop, yWind: yWind, X: X, yAlt: yAlt, yTide: yTide };
    drawCursor();
  }

  function drawCursor() {
    var g = $('chart').querySelector('#cur'), G = state.geom;
    if (!g || !G) return;
    if (state.cursor == null) { g.innerHTML = ''; return; }
    var t = state.cursor, x = G.X(t).toFixed(1), c = E.dayCurves(state.spot, state.d0);
    var h = E.interp(c.tide, t, 'h'), sa = E.interp(c.sky, t, 'sun'), ma = E.interp(c.sky, t, 'moon');
    var out = '<line class="c-cur" x1="' + x + '" y1="' + G.yTop + '" x2="' + x + '" y2="' + G.yWind + '"/>';
    if (h != null) out += '<circle class="c-curdot" cx="' + x + '" cy="' + G.yTide(h).toFixed(1) + '" r="4"/>';
    if (sa != null && sa > 0) out += '<circle class="c-curdot" cx="' + x + '" cy="' + G.yAlt(sa).toFixed(1) + '" r="3.5"/>';
    if (ma != null && ma > 0) out += '<circle class="c-curdot" cx="' + x + '" cy="' + G.yAlt(ma).toFixed(1) + '" r="3.5"/>';
    g.innerHTML = out;
  }

  /* ---------- Readout: the values at the cursor, or now ---------- */

  function renderReadout() {
    var el = $('readout'), d = E.day(state.spot, state.d0), c = E.dayCurves(state.spot, state.d0);
    var now = Date.now(), isToday = now >= d.d0 && now < d.d1;
    var pinned = state.pin != null && state.pin >= d.d0 && state.pin < d.d1;
    var t = state.cursor != null ? state.cursor : pinned ? state.pin : (isToday ? now : null);
    var tag = state.cursor != null ? '' : pinned ? ' pinned' : ' now';
    if (t == null) {
      el.innerHTML = '<div class="hint">Move across the display to read the tide, sun and moon at any time of this day. Select a time to pin it.</div>';
      return;
    }
    var h = E.interp(c.tide, t, 'h');
    var ha = E.interp(c.tide, Math.max(d.d0, t - 6 * MIN), 'h'), hb = E.interp(c.tide, Math.min(d.d1, t + 6 * MIN), 'h');
    var slope = (hb != null && ha != null) ? hb - ha : 0;
    var trend = slope > 0.006 ? 'rising' : slope < -0.006 ? 'falling' : 'at the turn';
    var sa = E.interp(c.sky, t, 'sun'), ma = E.interp(c.sky, t, 'moon');
    var period = null;
    d.solunar.periods.forEach(function (p) { if (t >= p.start && t <= p.end) period = p; });
    var act = Math.round(E.activityAt(t, d.solunar, d.sun) * 100);
    var cells = [
      ['Time', E.fmtTime(t) + tag],
      ['Tide', h == null ? '–' : meters(h) + ', ' + trend],
      ['Sun', sa == null ? '–' : sa >= 0 ? Math.round(sa) + '° up' : sa > -6 ? 'Twilight' : 'Down'],
      ['Moon', ma == null ? '–' : ma >= 0 ? Math.round(ma) + '° up' : 'Down'],
      ['Solunar activity', (period ? (period.major ? 'Major period' : 'Minor period') : 'No period') + ', ' + act + '%']
    ];
    var wx = state.wx[state.spot.id];
    if (wx && wx.recs) {
      var r = wx.recs[Math.round(t / HOUR) * HOUR];
      if (r) cells.push(['Wind, kn', compass(r.dir) + ' ' + Math.round(r.wind) + (ok(r.gust) ? ', gusts ' + Math.round(r.gust) : '')]);
    }
    el.style.setProperty('--cols', '0.9fr 1.2fr 0.8fr 0.8fr 1.45fr' + (cells.length > 5 ? ' 1.45fr' : ''));
    el.innerHTML = cells.map(function (x) { return '<div><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div></div>'; }).join('');
  }

  /* ---------- Place and now line ---------- */

  function renderPlace() {
    $('placeName').textContent = state.spot.name;
    $('placeSub').textContent = state.spot.sub || '';
    $('placeDate').textContent = E.fmtDayLong(state.d0 + 12 * HOUR);
    renderNow();
  }

  function renderNow() {
    var el = $('nowLine'), now = Date.now(), today = E.dayStart(now);
    if (state.d0 === today) {
      var tn = E.tideNow(state.spot, now);
      if (!tn.next || tn.h == null) { el.textContent = ''; return; }
      el.innerHTML = '<strong>Now ' + E.fmtTime(now) + '.</strong> <span>Tide ' + meters(tn.h) + ' and ' + (tn.rising ? 'rising' : 'falling') +
        '. ' + (tn.next.hi ? 'High' : 'Low') + ' water at ' + E.fmtTime(tn.next.t) + ', in ' + E.fmtDuration(tn.next.t - now) + '.</span>';
      return;
    }
    var days = Math.round((state.d0 - today) / E.DAY);
    var txt = days === 1 ? 'Tomorrow.' : days === -1 ? 'Yesterday.' : days > 0 ? 'In ' + days + ' days.' : (-days) + ' days ago.';
    el.innerHTML = '<span class="muted">' + txt + '</span>';
  }

  /* ---------- Day tables ---------- */

  function shiftWords(mins) {
    return mins === 0 ? 'at the same time' : Math.abs(mins) + ' min ' + (mins > 0 ? 'later' : 'earlier');
  }

  function renderCards() {
    var d = E.day(state.spot, state.d0), sp = state.spot, sun = d.sun, moon = d.moon, html;
    var now = Date.now(), isToday = now >= d.d0 && now < d.d1;
    var tn = isToday ? E.tideNow(sp, now) : null;
    function head(idx, text) { return '<h3 class="stage"><span class="idx">' + idx + '</span>' + text + '</h3>'; }
    function row(k, v, note) { return '<tr><th scope="row">' + k + (note ? ' <span class="note">' + note + '</span>' : '') + '</th><td>' + v + '</td></tr>'; }

    /* Tides */
    html = head('03', 'Tides') + '<table class="kv"><tbody>';
    d.extremes.forEach(function (e) {
      html += row(e.hi ? 'High water' : 'Low water', '<span class="strong">' + E.fmtTime(e.t) + '</span>&ensp;' + meters(e.h));
    });
    html += '</tbody></table><div class="trend" aria-hidden="true"><span><i class="pip' + (tn && tn.rising === true ? ' on' : '') + '"></i>Rising</span>' +
      '<span><i class="pip' + (tn && tn.rising === false ? ' on' : '') + '"></i>Falling</span></div>';
    var pos = null;
    if (d.range != null) {
      pos = clamp(25 + (d.range - d.neapRange) / (d.springRange - d.neapRange) * 55, 2, 98);
      var fromPos = state.prevPos == null ? pos : state.prevPos;
      html += '<div class="ruler" role="img" aria-label="Tidal range today ' + f1(d.range) + ' meters. Mean neap range ' + f1(d.neapRange) + ' meters, mean spring range ' + f1(d.springRange) + ' meters.">' +
        '<span class="ticks"></span><span class="base"></span><span class="mark" style="left:25%"></span><span class="mark" style="left:80%"></span>' +
        '<span class="needle" id="rNeedle" style="left:' + fromPos.toFixed(1) + '%"></span></div>' +
        '<div class="rulerkey" aria-hidden="true"><span style="left:25%">neap ' + f1(d.neapRange) + '</span><span style="left:80%">spring ' + f1(d.springRange) + '</span></div>' +
        '<p class="small">Range today ' + meters(d.range) + '. ' +
        (sp.std ? 'Auckland is the standard port for the Gulf.' :
          'Worked from Auckland: high water ' + shiftWords(sp.hw) + ', low water ' + shiftWords(sp.lw) + ', range times ' + sp.ratio.toFixed(2) + '.') + '</p>';
    }
    $('cardTides').innerHTML = html;
    if (pos != null) { settle('rNeedle', 'left', pos.toFixed(1) + '%'); state.prevPos = pos; }

    /* Solunar */
    var sol = d.solunar, fromScore = state.prevScore == null ? sol.score : state.prevScore;
    html = head('04', 'Solunar') + '<div class="gauge">' + gauge(sol.score, fromScore) + '<div><b>' + sol.label + '</b><span>' + sol.score + ' / 100</span></div></div><table class="kv"><tbody>';
    sol.periods.filter(function (p) { return p.inDay; }).forEach(function (p) {
      var live = isToday && now >= p.start && now <= p.end;
      html += '<tr><th scope="row"><i class="pip' + (live ? ' on' : '') + '" aria-hidden="true"></i><span class="strong">' + (p.major ? 'Major' : 'Minor') + '</span> <span class="note">' +
        p.cause.toLowerCase() + (p.sunEvent ? ', at ' + p.sunEvent : '') + '</span></th><td>' + E.fmtTime(p.start) + '–' + E.fmtTime(p.end) + '</td></tr>';
    });
    html += '</tbody></table><p class="small">A rule of thumb. Periods that fall on sunrise or sunset count for more. A lit lamp marks a period in progress.</p>';
    $('cardSolunar').innerHTML = html;
    settle('gNeedle', 'transform', 'rotate(' + (sol.score * 1.8).toFixed(1) + 'deg)');
    state.prevScore = sol.score;

    /* Sun */
    html = head('05', 'Sun') + '<table class="kv"><tbody>' +
      row('First light', E.fmtTime(sun.dawn), 'sun 6° below') +
      row('Sunrise', '<span class="strong">' + E.fmtTime(sun.rise) + '</span>') +
      row('Solar noon', E.fmtTime(sun.noon), Math.round(sun.noonAlt) + '° up') +
      row('Sunset', '<span class="strong">' + E.fmtTime(sun.set) + '</span>') +
      row('Last light', E.fmtTime(sun.dusk), 'sun 6° below') +
      row('Daylight', sun.dayLength == null ? '–' : E.fmtDuration(sun.dayLength)) +
      '</tbody></table>';
    $('cardSun').innerHTML = html;

    /* Moon */
    function times(list) { return list.length ? list.map(function (x) { return E.fmtTime(x.t != null ? x.t : x); }).join(', ') : 'None this day'; }
    var phases = E.nextPhases(d.d0, 3), aps = E.nextApsides(d.d0);
    html = head('06', 'Moon') + '<div class="moonhead">' + moonSvg(moon.fraction, moon.limb, 56) +
      '<div><b>' + moon.name + '</b><span>' + Math.round(moon.fraction * 100) + '% lit, ' + Math.round(moon.distanceKm / 1000) + ',000 km</span></div></div><table class="kv"><tbody>' +
      row('Moonrise', times(moon.rises)) + row('Moonset', times(moon.sets)) +
      row('Overhead', times(moon.upper), moon.upper.length ? Math.round(moon.upper[0].alt) + '° up' : '') +
      row('Underfoot', times(moon.lower));
    phases.forEach(function (ph) { html += row(ph.name, E.fmtDay(ph.t)); });
    html += row(aps[0].perigee ? 'Perigee' : 'Apogee', E.fmtDay(aps[0].t), aps[0].perigee ? 'moon nearest' : 'moon farthest') + '</tbody></table>';
    $('cardMoon').innerHTML = html;
  }

  /* ---------- Weather block ---------- */

  function setWxLamp(cls, text) {
    var lamp = $('pipWx'), label = $('pipWxText');
    if (lamp) lamp.className = 'pip' + (cls ? ' ' + cls : '');
    if (label) label.textContent = text;
  }

  function renderWeather() {
    var el = $('weather'), wx = state.wx[state.spot.id], d = E.day(state.spot, state.d0), sp = state.spot;
    var title = '<h3 class="stage"><span class="idx">07</span>Weather</h3>';
    if (!wx || (wx.status === 'loading' && !wx.recs)) {
      setWxLamp('busy', 'Forecast loading');
      el.innerHTML = title + '<div class="meta"><span>Loading the forecast from Open-Meteo.</span></div>';
      return;
    }
    if (wx.status === 'failed' && !wx.recs) {
      setWxLamp('alert', 'Forecast not loaded');
      el.innerHTML = title + '<div class="notice"><div class="grille" aria-hidden="true"></div><div class="notice-body">' +
        '<b><span class="pip alert" aria-hidden="true"></span>The forecast did not load.</b>' +
        '<p>This page gets its weather from Open-Meteo over the internet. A page published inside Claude is not allowed to make that connection, so there the weather stays empty. Tides, sun, moon and solunar periods are computed in the page and are not affected.</p>' +
        '<p>Open the downloaded file in a browser and the forecast loads. If you are already using the downloaded file, check your connection, then load the forecast again.</p>' +
        '<button type="button" data-act="reload">Load the forecast again</button></div></div>';
      return;
    }
    if (wx.status === 'ok') setWxLamp('on', 'Forecast loaded');
    else if (wx.status === 'loading') setWxLamp('busy', 'Forecast loading');
    else setWxLamp('alert', 'Forecast out of date');

    var hrs = dayRecs(d.d0, d.d1), span = wxSpan();
    var meta = 'Forecast for ' + Math.abs(sp.lat).toFixed(2) + '°S ' + sp.lon.toFixed(2) + '°E, loaded ' + E.fmtDay(wx.at) + ' at ' + E.fmtTime(wx.at) + '.';
    if (wx.status === 'failed') meta += ' A newer forecast did not load.';
    if (wx.status === 'loading') meta += ' Checking for a newer forecast.';
    var sst = null;
    hrs.forEach(function (q) { if (sst == null && ok(q.r.sst)) sst = q.r.sst; });
    if (sst != null) meta += ' Sea surface ' + f1(sst) + ' °C.';
    var head = title + '<div class="meta"><span>' + meta + '</span><button type="button" data-act="reload">Load again</button></div>';

    if (!hrs.length) {
      el.innerHTML = head + '<div class="notice"><div class="grille" aria-hidden="true"></div><div class="notice-body"><b>No forecast for this day.</b><p>The forecast covers ' +
        E.fmtDay(span.first) + ' to ' + E.fmtDay(span.last) + '. Choose a day in that range to see the weather hour by hour.</p></div></div>';
      return;
    }

    var step = window.innerWidth >= 1000 ? 2 : 3;
    var cols = hrs.filter(function (q) { return E.parts(q.t).H % step === 0; });
    function line(label, fn, cls) {
      var out = '<tr><th scope="row">' + label + '</th>';
      cols.forEach(function (q) { var c = cls ? cls(q.r) : ''; out += '<td' + (c ? ' class="' + c + '"' : '') + '>' + fn(q.r) + '</td>'; });
      return out + '</tr>';
    }
    function band(r) { var b = windBand(r.wind); return b ? 'w' + b : ''; }
    function gband(r) { var b = windBand(ok(r.gust) ? r.gust - 5 : null); return b ? 'w' + b : ''; }
    var hasWaves = hrs.some(function (q) { return ok(q.r.wave); });
    var t = '<div class="scrollx"><table class="grid"><thead><tr><th scope="col">Hour</th>';
    cols.forEach(function (q) { t += '<th scope="col">' + E.fmtTime(q.t) + '</th>'; });
    t += '</tr></thead><tbody>' +
      line('Sky', function (r) { return WMO[r.code] || '–'; }, function () { return 'txt'; }) +
      line('Wind, kn', function (r) { return arrow(r.dir) + compass(r.dir) + ' <b>' + Math.round(r.wind) + '</b>'; }, band) +
      line('Gusts, kn', function (r) { return ok(r.gust) ? Math.round(r.gust) : '–'; }, gband);
    if (hasWaves) {
      t += line('Waves, m', function (r) { return ok(r.wave) ? arrow(r.wdir) + f1(r.wave) : '–'; }) +
        line('Wave period, s', function (r) { return ok(r.wper) ? Math.round(r.wper) : '–'; }) +
        line('Swell, m', function (r) { return ok(r.swell) ? arrow(r.sdir) + f1(r.swell) : '–'; });
    }
    t += line('Rain, mm', function (r) { return ok(r.rain) ? (r.rain >= 0.05 ? f1(r.rain) : '0') : '–'; }) +
      line('Chance of rain', function (r) { return ok(r.pop) ? Math.round(r.pop) + '%' : '–'; }) +
      line('Cloud', function (r) { return ok(r.cloud) ? Math.round(r.cloud) + '%' : '–'; }) +
      line('Air, °C', function (r) { return ok(r.temp) ? Math.round(r.temp) : '–'; }) +
      line('Pressure, hPa', function (r) { return ok(r.p) ? Math.round(r.p) : '–'; }) +
      '</tbody></table></div>';
    var foot = '<p class="small">Arrows point the way the wind and waves are traveling. Grey tint marks wind from 10 and 15 knots. Red tint marks wind from 20 and 25 knots.' +
      (hasWaves ? '' : ' The wave model has no data for this spot.') + '</p>';
    el.innerHTML = head + t + foot;
  }

  /* ---------- Days ahead ---------- */

  function renderAhead() {
    var el = $('ahead'), today = E.dayStart(Date.now());
    var inWindow = state.d0 >= today && state.d0 < E.addDays(today, 14);
    var start = inWindow ? today : state.d0;
    var wx = state.wx[state.spot.id], hasWx = !!(wx && wx.recs);
    var h = '<h3 class="stage"><span class="idx">08</span>14 days from ' + E.fmtDay(start + 12 * HOUR) + '</h3>' +
      '<div class="meta"><span>Select a row to open that day.</span></div>' +
      '<div class="scrollx"><table class="ahead"><thead><tr><th scope="col">Day</th><th scope="col">Moon</th><th scope="col">High water, m</th><th scope="col">Range, m</th>' +
      '<th scope="col">Solunar</th><th scope="col">Major periods</th>' +
      (hasWx ? '<th scope="col">Wind in daylight, kn</th><th scope="col">Gusts</th><th scope="col">Waves, m</th><th scope="col">Rain, mm</th>' : '') + '</tr></thead><tbody>';
    var d0 = start;
    for (var i = 0; i < 14; i++) {
      var d = E.day(state.spot, d0), m = d.moon, on = d0 === state.d0;
      var highs = d.extremes.filter(function (e) { return e.hi; }).map(function (e) { return E.fmtTime(e.t) + ' ' + f1(e.h); }).join(', ');
      var majors = d.solunar.periods.filter(function (p) { return p.major && p.inDay; }).map(function (p) { return E.fmtTime(p.start) + '–' + E.fmtTime(p.end); }).join(', ');
      var fill = d.range == null ? 0 : clamp(d.range / (1.2 * d.springRange) * 100, 0, 100);
      h += '<tr data-d0="' + d0 + '"' + (on ? ' class="sel"' : '') + '>' +
        '<th scope="row"><button type="button" class="daybtn"' + (on ? ' aria-current="date"' : '') + '><i class="pip' + (on ? ' on' : '') + '" aria-hidden="true"></i>' + E.fmtDay(d0 + 12 * HOUR) + '</button></th>' +
        '<td><span class="mooncell">' + moonSvg(m.fraction, m.limb, 16) + Math.round(m.fraction * 100) + '%</span></td>' +
        '<td>' + highs + '</td>' +
        '<td><span class="bar"><i style="width:' + fill.toFixed(0) + '%"></i></span>' + (d.range == null ? '–' : f1(d.range)) + '</td>' +
        '<td class="txt">' + pips(d.solunar.level) + d.solunar.label + '</td>' +
        '<td>' + majors + '</td>';
      if (hasWx) {
        var su = daySummary(d);
        if (su) {
          var b = windBand(su.hi), gb = windBand(su.gust - 5);
          h += '<td' + (b ? ' class="w' + b + '"' : '') + '>' + arrow(su.dir) + compass(su.dir) + ' ' + Math.round(su.lo) + '–' + Math.round(su.hi) + '</td>' +
            '<td' + (gb ? ' class="w' + gb + '"' : '') + '>' + (isFinite(su.gust) ? Math.round(su.gust) : '–') + '</td>' +
            '<td>' + (su.wave == null ? '–' : f1(su.wave)) + '</td>' +
            '<td>' + (su.rain >= 0.05 ? f1(su.rain) : '0') + '</td>';
        } else {
          h += '<td class="muted">–</td><td class="muted">–</td><td class="muted">–</td><td class="muted">–</td>';
        }
      }
      h += '</tr>';
      d0 = E.addDays(d0, 1);
    }
    el.innerHTML = h + '</tbody></table></div>';
  }

  /* ---------- Map of the Gulf: geometry and water mask ---------- */

  var MAP = DATA.coast, RAD = Math.PI / 180;
  var KM = 111.2 / MAP.scale;                 /* kilometers per map unit */
  var OPEN_SEA_KM = 60, MAX_FETCH_KM = 150, NEAR_LAND_KM = 4;
  var MASK = null;

  function mapX(lon) { return (lon - MAP.W) * MAP.k * MAP.scale; }
  function mapY(lat) { return (MAP.N - lat) * MAP.scale; }
  function mapLon(x) { return MAP.W + x / (MAP.k * MAP.scale); }
  function mapLat(y) { return MAP.N - y / MAP.scale; }

  /* Raster of the coastline at two cells per map unit. `water` holds only water joined to the open Gulf,
     so the harbours on the west coast are left out. */
  function buildMask() {
    try {
      var R = 2, mw = Math.ceil(MAP.w * R), mh = Math.ceil(MAP.h * R);
      var cv = document.createElement('canvas');
      cv.width = mw; cv.height = mh;
      var cx = cv.getContext('2d', { willReadFrequently: true });
      cx.fillStyle = '#000'; cx.fillRect(0, 0, mw, mh);
      cx.scale(R, R); cx.fillStyle = '#fff'; cx.fill(new Path2D(MAP.path), 'evenodd');
      var px = cx.getImageData(0, 0, mw, mh).data, land = new Uint8Array(mw * mh), water = new Uint8Array(mw * mh), i;
      for (i = 0; i < mw * mh; i++) land[i] = px[i * 4] > 127 ? 1 : 0;
      var stack = [Math.round(mapX(175.1) * R) + Math.round(mapY(-36.5) * R) * mw];
      while (stack.length) {
        var p = stack.pop();
        if (water[p] || land[p]) continue;
        water[p] = 1;
        var x = p % mw, y = (p - x) / mw;
        if (x > 0) stack.push(p - 1);
        if (x < mw - 1) stack.push(p + 1);
        if (y > 0) stack.push(p - mw);
        if (y < mh - 1) stack.push(p + mw);
      }
      MASK = { R: R, w: mw, h: mh, land: land, water: water };
    } catch (e) { MASK = null; }
  }

  function isWater(x, y) {
    var m = MASK;
    if (!m) return false;
    var ix = Math.round(x * m.R), iy = Math.round(y * m.R);
    return ix >= 0 && iy >= 0 && ix < m.w && iy < m.h && m.water[ix + iy * m.w] === 1;
  }

  /* Open water from a point toward a compass bearing, in kilometers. Past the north and east edges of the
     map lies open sea, so a ray that leaves there gains a fixed allowance. */
  function rayKm(x, y, brg) {
    var m = MASK, a = brg * RAD, dx = Math.sin(a), dy = -Math.cos(a), d = 0;
    for (;;) {
      d += 1;
      var ix = Math.round((x + dx * d) * m.R), iy = Math.round((y + dy * d) * m.R);
      if (ix < 0 || iy < 0 || ix >= m.w || iy >= m.h) return d * KM + ((iy < 0 || ix >= m.w) ? OPEN_SEA_KM : 0);
      if (m.land[ix + iy * m.w]) return d * KM;
    }
  }

  /* Effective fetch: five rays spread 30 degrees either side of the wind, weighted by cosine. */
  function fetchKm(x, y, windFrom) {
    var sum = 0, wsum = 0;
    [-30, -15, 0, 15, 30].forEach(function (o) {
      var w = Math.cos(o * RAD);
      sum += w * Math.min(MAX_FETCH_KM, rayKm(x, y, windFrom + o));
      wsum += w;
    });
    return sum / wsum;
  }

  function landWithin(x, y, km) {
    var m = MASK, steps = Math.ceil(km / KM);
    for (var b = 0; b < 360; b += 30) {
      var a = b * RAD, dx = Math.sin(a), dy = -Math.cos(a);
      for (var d = 1; d <= steps; d++) {
        var ix = Math.round((x + dx * d) * m.R), iy = Math.round((y + dy * d) * m.R);
        if (ix < 0 || iy < 0 || ix >= m.w || iy >= m.h) break;
        if (m.land[ix + iy * m.w]) return true;
      }
    }
    return false;
  }

  /* ---------- Chop estimate ---------- */

  var GRAV = 9.81, KN = 0.514444;
  var CHOP_NAMES = ['Smooth', 'Light chop', 'Moderate chop', 'Rough chop', 'Very rough'];

  /* Step 1: wind waves at the end of a fetch, from the JONSWAP growth curves, capped at a fully developed sea.
     This assumes the wind has blown long enough to fill the fetch.
     Step 2: the change in height when those waves meet a current (Longuet-Higgins and Stewart, deep water).
     A current against the waves raises and shortens them. The factor is capped at 2. */
  function chop(windKn, windFrom, fetch, curKn, curToward) {
    var U = windKn * KN, out = { h: 0, base: 0, t: 0, level: 0, factor: 1, along: 0 };
    if (U < 0.5) return out;
    var F = fetch * 1000;
    out.base = Math.min(0.0016 * U * Math.sqrt(F / GRAV), 0.2433 * U * U / GRAV);
    out.t = Math.min(0.2857 * Math.pow(GRAV * F / (U * U), 1 / 3) * U / GRAV, 8.134 * U / GRAV);
    if (curKn != null && out.t > 0) {
      out.along = curKn * Math.cos((curToward - (windFrom + 180)) * RAD);   /* negative: flow against the waves */
      var c0 = GRAV * out.t / (2 * Math.PI), uc = out.along * KN, q = 1 + 4 * uc / c0;
      if (q <= 0.05) out.factor = 2;
      else {
        var c = 0.5 * c0 * (1 + Math.sqrt(q));
        out.factor = Math.min(2, c0 / Math.sqrt(c * (c + 2 * uc)));
      }
    }
    out.h = out.base * out.factor;
    out.level = out.h >= 0.8 ? 4 : out.h >= 0.5 ? 3 : out.h >= 0.3 ? 2 : out.h >= 0.15 ? 1 : 0;
    return out;
  }

  /* ---------- Wind and flow over the Gulf ---------- */

  var gridPts = [], cells = [], windSites = [], flowSites = [];
  var field = { status: 'idle', at: 0, wind: null, flow: null };

  /* The four nearest grid points, with inverse-distance weights. */
  function nearest(x, y) {
    var list = gridPts.map(function (p, i) { var dx = p.x - x, dy = p.y - y; return [i, dx * dx + dy * dy]; });
    list.sort(function (a, b) { return a[1] - b[1]; });
    return list.slice(0, 4).map(function (q) { return [q[0], 1 / (q[1] + 4)]; });
  }

  function buildSites() {
    var i, j, x, y;
    for (j = 0; j <= 12; j++) for (i = 0; i <= 10; i++) {
      var lat = Math.round((-37.2 + j * 0.1) * 100) / 100, lon = Math.round((174.6 + i * 0.1) * 100) / 100;
      x = mapX(lon); y = mapY(lat);
      if (isWater(x, y)) gridPts.push({ lat: lat, lon: lon, x: x, y: y });
    }
    if (!gridPts.length) return;
    for (y = 2.5; y < MAP.h; y += 5) for (x = 2.5; x < MAP.w; x += 5) {
      if (isWater(x, y)) cells.push({ x: x, y: y, w: nearest(x, y) });
    }
    for (y = 12; y < MAP.h; y += 22) for (x = 12; x < MAP.w; x += 22) {
      if (isWater(x, y)) windSites.push({ x: x, y: y, w: nearest(x, y) });
      if (isWater(x + 11, y + 11)) flowSites.push({ x: x + 11, y: y + 11, w: nearest(x + 11, y + 11), near: landWithin(x + 11, y + 11, NEAR_LAND_KM) });
    }
  }

  function r2(v) { return Math.round(v * 100) / 100; }
  function asList(j) { return Array.isArray(j) ? j : [j]; }
  function gridUrl(base, pts, extra) {
    return base + '?latitude=' + pts.map(function (p) { return p.lat.toFixed(2); }).join(',') +
      '&longitude=' + pts.map(function (p) { return p.lon.toFixed(2); }).join(',') +
      '&timeformat=unixtime&forecast_days=7' + extra;
  }

  /* Wind at each grid point. Resolves to { t0, n, u, v, gust } in knots. u and v give the motion of the
     air toward east and north. One array per grid point, one value per hour from t0. */
  function loadWindField(pts) {
    var url = gridUrl('https://api.open-meteo.com/v1/forecast', pts, '&cell_selection=sea&wind_speed_unit=kn&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m');
    return getJSON(url, 25000).then(function (j) {
      var list = asList(j);
      if (list.length !== pts.length) throw new Error('wind grid size');
      var out = { t0: list[0].hourly.time[0] * 1000, n: list[0].hourly.time.length, u: [], v: [], gust: [] };
      list.forEach(function (loc) {
        var H = loc.hourly, u = [], v = [], g = [];
        for (var i = 0; i < out.n; i++) {
          var s = H.wind_speed_10m[i], d = H.wind_direction_10m[i], gu = H.wind_gusts_10m ? H.wind_gusts_10m[i] : null;
          if (!ok(s) || !ok(d)) { u.push(null); v.push(null); g.push(null); continue; }
          u.push(r2(-s * Math.sin(d * RAD))); v.push(r2(-s * Math.cos(d * RAD))); g.push(ok(gu) ? r2(gu) : null);
        }
        out.u.push(u); out.v.push(v); out.gust.push(g);
      });
      return out;
    });
  }

  /* Tidal flow and other current at each grid point. This function is the only place that knows the source.
     The source today is the Open-Meteo marine service, whose current model has cells of about 8 km.
     To change the source, replace this function with one that resolves to the same shape:
     { t0, n, u, v } in knots, u toward east and v toward north, one array per grid point, one value per hour from t0. */
  function loadFlowField(pts) {
    var url = gridUrl('https://marine-api.open-meteo.com/v1/marine', pts, '&hourly=ocean_current_velocity,ocean_current_direction');
    return getJSON(url, 25000).then(function (j) {
      var list = asList(j);
      if (list.length !== pts.length) throw new Error('flow grid size');
      var unit = (list[0].hourly_units && list[0].hourly_units.ocean_current_velocity) || 'km/h';
      var toKn = unit === 'kn' ? 1 : unit === 'm/s' ? 1.94384 : unit === 'mph' ? 0.868976 : 1 / 1.852;
      var out = { t0: list[0].hourly.time[0] * 1000, n: list[0].hourly.time.length, u: [], v: [] };
      list.forEach(function (loc) {
        var H = loc.hourly, u = [], v = [];
        for (var i = 0; i < out.n; i++) {
          var s = H.ocean_current_velocity[i], d = H.ocean_current_direction[i];
          if (!ok(s) || !ok(d)) { u.push(null); v.push(null); continue; }
          u.push(r2(s * toKn * Math.sin(d * RAD))); v.push(r2(s * toKn * Math.cos(d * RAD)));
        }
        out.u.push(u); out.v.push(v);
      });
      return out;
    });
  }

  function loadField() {
    if (!gridPts.length) return;
    field.status = 'loading';
    renderGulf();
    Promise.all([loadWindField(gridPts), loadFlowField(gridPts).catch(function () { return null; })]).then(function (res) {
      field.wind = res[0]; field.flow = res[1]; field.at = Date.now(); field.status = 'ok';
      store.set('gulf-almanac-field', JSON.stringify({ at: field.at, npts: gridPts.length, wind: field.wind, flow: field.flow }));
    }).catch(function () {
      field.status = 'failed';
    }).then(renderGulf);
  }

  function readCachedField() {
    try {
      var o = JSON.parse(store.get('gulf-almanac-field') || 'null');
      if (!o || !o.wind || o.npts !== gridPts.length || Date.now() - o.at > 3 * 24 * HOUR) return;
      field.wind = o.wind; field.flow = o.flow; field.at = o.at; field.status = 'ok';
    } catch (e) { /* no usable cache */ }
  }

  /* Loads the Gulf field when it is missing or older than an hour. */
  function syncField(force) {
    if (field.status === 'loading' || !gridPts.length) return;
    if (!force && state.wxBlocked) {
      if (!field.wind) field.status = 'failed';
      renderGulf();
      return;
    }
    if (!force && field.wind && Date.now() - field.at < WX_TTL) return;
    loadField();
  }

  function fieldIndex(ds, t) {
    if (!ds) return null;
    var fi = (t - ds.t0) / HOUR;
    return (fi < 0 || fi > ds.n - 1) ? null : fi;
  }
  function lerp(arr, fi) {
    var i0 = Math.floor(fi), i1 = Math.min(i0 + 1, arr.length - 1), a = arr[i0], b = arr[i1];
    return (a == null || b == null) ? null : a + (b - a) * (fi - i0);
  }
  function blend(series, w, fi) {
    var s = 0, ws = 0;
    for (var k = 0; k < w.length; k++) {
      var v = series[w[k][0]] ? lerp(series[w[k][0]], fi) : null;
      if (v == null) continue;
      s += w[k][1] * v; ws += w[k][1];
    }
    return ws ? s / ws : null;
  }
  function windAt(w, t) {
    var fi = fieldIndex(field.wind, t);
    if (fi == null) return null;
    var u = blend(field.wind.u, w, fi), v = blend(field.wind.v, w, fi);
    if (u == null || v == null) return null;
    return { kn: Math.sqrt(u * u + v * v), from: (Math.atan2(u, v) / RAD + 540) % 360, gust: blend(field.wind.gust, w, fi) };
  }
  function flowAt(w, t) {
    var fi = fieldIndex(field.flow, t);
    if (fi == null) return null;
    var u = blend(field.flow.u, w, fi), v = blend(field.flow.v, w, fi);
    if (u == null || v == null) return null;
    return { kn: Math.sqrt(u * u + v * v), toward: (Math.atan2(u, v) / RAD + 360) % 360 };
  }
  /* Wind, flow, fetch and chop at one point and time. */
  function condAt(x, y, w, t) {
    var wi = windAt(w, t);
    if (!wi) return null;
    var fl = flowAt(w, t), f = fetchKm(x, y, wi.from);
    return { wind: wi, flow: fl, fetch: f, chop: chop(wi.kn, wi.from, f, fl ? fl.kn : null, fl ? fl.toward : null) };
  }

  /* ---------- Map drawing ---------- */

  function mapTime() { return state.pin != null ? state.pin : Date.now(); }

  function renderMap() {
    var c = MAP, k;
    function label(cls, lon, lat, dy, text) {
      return '<text class="' + cls + '" x="' + mapX(lon).toFixed(1) + '" y="' + (mapY(lat) + dy).toFixed(1) + '" text-anchor="middle">' + text + '</text>';
    }
    var s = '<svg viewBox="0 0 ' + c.w + ' ' + c.h + '" role="group" aria-label="Map of the Hauraki Gulf. Each lamp selects a tide spot. Select a point on the water to read wind, flow and chop there.">';
    s += '<defs><pattern id="landDots" width="3" height="3" patternUnits="userSpaceOnUse"><rect class="m-landbg" width="3" height="3"/><circle class="m-landdot" cx="1.5" cy="1.5" r=".42"/></pattern></defs>';
    s += '<g id="ovTint"></g><path class="m-land" d="' + c.path + '"/>';

    /* Calibration ticks every 10 minutes of arc along the frame. */
    for (k = Math.ceil(c.S * 6); k <= Math.floor(c.N * 6); k++) {
      var y = mapY(k / 6).toFixed(1), len = (k % 3 === 0) ? 6 : 3.5;
      s += '<line class="m-tick" x1="0" y1="' + y + '" x2="' + len + '" y2="' + y + '"/><line class="m-tick" x1="' + c.w + '" y1="' + y + '" x2="' + (c.w - len) + '" y2="' + y + '"/>';
    }
    for (k = Math.ceil(c.W * 6); k <= Math.floor(c.E * 6); k++) {
      var x = mapX(k / 6).toFixed(1), len2 = (k % 3 === 0) ? 6 : 3.5;
      s += '<line class="m-tick" x1="' + x + '" y1="0" x2="' + x + '" y2="' + len2 + '"/><line class="m-tick" x1="' + x + '" y1="' + c.h + '" x2="' + x + '" y2="' + (c.h - len2) + '"/>';
    }

    s += label('m-landname', 175.43, -36.215, 0, 'Aotea') + label('m-landname', 175.43, -36.215, 8.2, 'Great Barrier') +
      label('m-landname', 175.555, -36.94, 0, 'Coromandel');

    /* North mark and a ruled scale. */
    s += '<g transform="translate(16 ' + (c.h - 44) + ')"><line class="m-n" x1="0" y1="11" x2="0" y2="-7"/>' +
      '<path class="m-nfill" d="M0 -13L3 -6H-3Z"/><text class="m-ntext" x="0" y="-16" text-anchor="middle">N</text></g>';
    var sx = 30, sy = c.h - 22, tenNM = c.scale / 6;
    s += '<line class="m-scale" x1="' + sx.toFixed(1) + '" y1="' + sy.toFixed(1) + '" x2="' + (sx + tenNM).toFixed(1) + '" y2="' + sy.toFixed(1) + '"/>';
    for (k = 0; k <= 10; k++) {
      var tx = (sx + tenNM * k / 10).toFixed(1), th = k % 5 === 0 ? 4 : 2.2;
      s += '<line class="m-scale" x1="' + tx + '" y1="' + sy.toFixed(1) + '" x2="' + tx + '" y2="' + (sy - th).toFixed(1) + '"/>';
    }
    s += '<text class="m-scaletext" x="' + (sx + tenNM / 2).toFixed(1) + '" y="' + (sy + 9).toFixed(1) + '" text-anchor="middle">10 nautical miles</text>';

    s += '<g id="ovArrows"></g><g id="ovProbe"></g>';
    spots.forEach(function (sp) {
      var px = mapX(sp.lon), py = mapY(sp.lat), left = px > c.w * 0.6;
      s += '<g class="pin" data-id="' + sp.id + '" tabindex="0" role="button" aria-label="' + esc(sp.name) + '" transform="translate(' + px.toFixed(1) + ' ' + py.toFixed(1) + ')">' +
        '<circle class="hit" r="7"/><circle class="ring" r="5.2"/><circle class="dot" r="2.9"/>' +
        '<text x="' + (left ? -8 : 8) + '" y="2.6" text-anchor="' + (left ? 'end' : 'start') + '">' + esc(sp.name) + '</text></g>';
    });
    $('map').innerHTML = s + '</svg>';
  }

  function markMap() {
    var svg = $('map').querySelector('svg');
    if (!svg) return;
    Array.prototype.forEach.call(svg.querySelectorAll('.pin'), function (g) {
      var on = g.getAttribute('data-id') === state.spot.id;
      g.classList.toggle('sel', on);
      g.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on && g !== svg.lastElementChild) svg.appendChild(g);
    });
  }

  function renderOverlay() {
    var svg = $('map').querySelector('svg');
    if (!svg) return;
    var t = mapTime(), tint = '', arrows = '', n1 = function (v) { return v.toFixed(1); };
    if (field.wind && fieldIndex(field.wind, t) != null) {
      if (state.layers.chop) {
        cells.forEach(function (q) {
          var c = condAt(q.x, q.y, q.w, t);
          if (c && c.chop.level) tint += '<rect class="m-c' + c.chop.level + '" x="' + (q.x - 2.5) + '" y="' + (q.y - 2.5) + '" width="5.15" height="5.15"/>';
        });
      }
      if (state.layers.wind) {
        windSites.forEach(function (q) {
          var w = windAt(q.w, t);
          if (!w) return;
          var L = clamp(2.5 + w.kn * 0.33, 3.4, 9);
          arrows += '<path class="m-wind" transform="translate(' + q.x + ' ' + q.y + ') rotate(' + (w.from + 180).toFixed(0) + ')" d="M0 ' + n1(-L) + 'L2.5 ' + n1(-L + 4) +
            'L.55 ' + n1(-L + 3.2) + 'L.55 ' + n1(L) + 'L-.55 ' + n1(L) + 'L-.55 ' + n1(-L + 3.2) + 'L-2.5 ' + n1(-L + 4) + 'Z"/>';
        });
      }
      if (state.layers.flow) {
        flowSites.forEach(function (q) {
          var f = flowAt(q.w, t);
          if (!f) return;
          if (f.kn < 0.05) { arrows += '<circle class="m-flowdot" cx="' + q.x + '" cy="' + q.y + '" r=".9"/>'; return; }
          var L = clamp(1.5 + f.kn * 9, 2.2, 8);
          arrows += '<path class="m-flow' + (q.near ? ' near' : '') + '" transform="translate(' + q.x + ' ' + q.y + ') rotate(' + f.toward.toFixed(0) + ')" d="M0 ' + n1(L) + 'L0 ' + n1(-L) +
            'M-1.9 ' + n1(-L + 2.4) + 'L0 ' + n1(-L) + 'L1.9 ' + n1(-L + 2.4) + '"/>';
        });
      }
    }
    svg.querySelector('#ovTint').innerHTML = tint;
    svg.querySelector('#ovArrows').innerHTML = arrows;
    var p = state.probe;
    svg.querySelector('#ovProbe').innerHTML = !p ? '' :
      '<circle class="m-probe" cx="' + n1(p.x) + '" cy="' + n1(p.y) + '" r="4.6"/>' +
      '<path class="m-probe" d="M' + n1(p.x - 8) + ' ' + n1(p.y) + 'h4.6M' + n1(p.x + 3.4) + ' ' + n1(p.y) + 'h4.6M' + n1(p.x) + ' ' + n1(p.y - 8) + 'v4.6M' + n1(p.x) + ' ' + n1(p.y + 3.4) + 'v4.6"/>';
  }

  /* Degrees and decimal minutes, as written on a chart. */
  function degMin(v, pos, neg) {
    var a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    if (m >= 59.95) { d += 1; m = 0; }
    return d + '°' + (m < 9.95 ? '0' : '') + m.toFixed(1) + '′' + (v < 0 ? neg : pos);
  }

  function renderProbe() {
    var el = $('probe'), t = mapTime();
    if (!field.wind) {
      if (field.status === 'failed') {
        el.innerHTML = '<div class="notice"><div class="grille" aria-hidden="true"></div><div class="notice-body">' +
          '<b><span class="pip alert" aria-hidden="true"></span>Wind, flow and chop did not load.</b>' +
          '<p>The map gets them from Open-Meteo over the internet, as the weather table does. A page published inside Claude is not allowed to make that connection. Open the downloaded file in a browser and they load.</p>' +
          '<button type="button" data-act="reload">Load the forecast again</button></div></div>';
      } else {
        el.innerHTML = '<p class="probehint">Loading wind and flow for the Gulf from Open-Meteo.</p>';
      }
      return;
    }
    if (fieldIndex(field.wind, t) == null) {
      el.innerHTML = '<p class="probehint">The forecast does not cover this time. It runs from ' + E.fmtDay(field.wind.t0) + ' to ' +
        E.fmtDay(field.wind.t0 + (field.wind.n - 1) * HOUR) + '. Pin a time in that range.</p>';
      return;
    }
    if (!state.probe) {
      el.innerHTML = '<p class="probehint">' + (state.probeMiss ? 'That point is not on Gulf water. ' : '') + 'Select a point on the water to read wind, flow and chop there.</p>';
      return;
    }
    var p = state.probe, c = condAt(p.x, p.y, p.w, t);
    if (!c) { el.innerHTML = '<p class="probehint">No forecast values at this point.</p>'; return; }
    function row(k, v, note) { return '<tr><th scope="row">' + k + (note ? ' <span class="note">' + note + '</span>' : '') + '</th><td>' + v + '</td></tr>'; }
    var flowTxt = !c.flow ? 'No data' : c.flow.kn < 0.05 ? 'Slack' : c.flow.kn.toFixed(1) + ' kn toward ' + compass(c.flow.toward);
    var rel = (!c.flow || Math.abs(c.chop.along) < 0.05) ? '–' : Math.abs(c.chop.along).toFixed(1) + ' kn ' + (c.chop.along < 0 ? 'against the waves' : 'with the waves');
    var html = '<table class="kv"><tbody>' +
      row('Position', degMin(mapLat(p.y), 'N', 'S') + ' ' + degMin(mapLon(p.x), 'E', 'W')) +
      row('Wind', compass(c.wind.from) + ' ' + Math.round(c.wind.kn) + ' kn' + (ok(c.wind.gust) ? ', gusts ' + Math.round(c.wind.gust) : '')) +
      row('Flow', flowTxt, c.flow && p.near ? 'within 4 km of land, unreliable' : '') +
      row('Flow relative to waves', rel) +
      row('Fetch', c.fetch >= 100 ? 'over 100 km' : Math.round(c.fetch) + ' km') +
      row('Wind waves', c.chop.h < 0.05 ? 'None' : c.chop.h.toFixed(1) + ' m, ' + c.chop.t.toFixed(1) + ' s') +
      '</tbody></table>' +
      '<div class="chopline"><i class="sw sw' + c.chop.level + '"></i><b>' + CHOP_NAMES[c.chop.level] + '</b></div>';
    if (c.chop.factor >= 1.15) html += '<p class="small">Flow against the wind raises these waves by about ' + Math.round((c.chop.factor - 1) * 100) + '%.</p>';
    else if (c.chop.factor <= 0.87) html += '<p class="small">Flow with the wind lowers these waves by about ' + Math.round((1 - c.chop.factor) * 100) + '%.</p>';
    else html += '<p class="small">Flow changes these waves by less than 15%.</p>';

    /* Chop at this point for each hour of the day. Selecting a bar pins that hour. */
    var d0 = E.dayStart(t), d1 = E.addDays(d0, 1), hourNow = Math.floor(t / HOUR) * HOUR, bars = '', n = 0;
    for (var th = d0; th < d1; th += HOUR) {
      var cc = condAt(p.x, p.y, p.w, th), lv = cc ? cc.chop.level : -1, hgt = lv < 0 ? 2 : 5 + lv * 6, bx = n * 10;
      bars += '<rect class="s-bar s-c' + (lv < 0 ? 'x' : lv) + '" data-t="' + th + '" x="' + (bx + 1) + '" y="' + (36 - hgt) + '" width="8" height="' + hgt + '"><title>' +
        E.fmtTime(th) + (cc ? ', ' + CHOP_NAMES[lv].toLowerCase() : ', no forecast') + '</title></rect>';
      if (th === hourNow) bars += '<path class="s-mark" d="M' + (bx + 1.5) + ' 0h7l-3.5 4.6z"/>';
      if (E.parts(th).H % 6 === 0) bars += '<text class="s-ax" x="' + (bx + 1) + '" y="47">' + E.pad2(E.parts(th).H) + '</text>';
      n++;
    }
    html += '<p class="striphead">Chop at this point through ' + E.fmtDay(t) + '. Select a bar to pin that hour.</p>' +
      '<svg class="strip" viewBox="0 0 ' + (n * 10) + ' 49" role="img" aria-label="Chop at this point for each hour of the day">' + bars + '</svg>';
    el.innerHTML = html;
  }

  function renderGulf() {
    var t = mapTime(), el = $('mapTime');
    if (el) el.innerHTML = (state.pin != null ? 'Showing the pinned time: ' : 'Showing now: ') + '<b>' + E.fmtDay(t) + ' ' + E.fmtTime(t) + '</b>';
    renderOverlay(); renderProbe();
  }

  /* ---------- State changes ---------- */

  function renderPin() {
    var pinned = state.pin != null;
    $('pinLamp').className = 'pip' + (pinned ? '' : ' on');
    $('pinText').textContent = pinned ? 'Pinned at ' + E.fmtTime(state.pin) + ', ' + E.fmtDay(state.pin) + '.' : 'Following now.';
    $('unpin').disabled = !pinned;
  }

  function renderAll() {
    $('spot').value = state.spot.id;
    $('date').value = E.isoDate(state.d0 + 12 * HOUR);
    renderPlace(); renderPin(); renderChart(); renderReadout(); renderCards(); renderWeather(); renderAhead(); markMap(); renderGulf();
  }

  function setSpot(sp) {
    if (!sp) return;
    state.spot = sp; state.cursor = null;
    store.set('gulf-almanac-spot', sp.id);
    renderAll();
    loadWeather(false);
  }

  /* A pinned time keeps its time of day when the day changes. */
  function setDay(d0) {
    if (state.pin != null) state.pin = clamp(d0 + (state.pin - state.d0), d0, E.addDays(d0, 1) - 5 * MIN);
    state.d0 = d0; state.cursor = null;
    state.followToday = d0 === E.dayStart(Date.now());
    renderAll();
  }

  function pinTime(t) {
    state.pin = Math.round(t / (5 * MIN)) * 5 * MIN;
    state.cursor = null;
    var d0 = E.dayStart(state.pin);
    if (d0 !== state.d0) { state.d0 = d0; state.followToday = false; renderAll(); return; }
    renderPin(); renderChart(); renderReadout(); renderGulf();
  }

  function unpin() {
    state.pin = null; state.cursor = null;
    renderPin(); renderChart(); renderReadout(); renderGulf();
  }

  function toTop() {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  }

  /* ---------- Wiring ---------- */

  function init() {
    var sel = $('spot'), groups = [], html = '';
    spots.forEach(function (s) { if (groups.indexOf(s.group) < 0) groups.push(s.group); });
    groups.forEach(function (g) {
      html += '<optgroup label="' + esc(g) + '">';
      spots.forEach(function (s) { if (s.group === g) html += '<option value="' + s.id + '">' + esc(s.name) + '</option>'; });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
    sel.addEventListener('change', function () { setSpot(byId[sel.value]); });
    $('prev').addEventListener('click', function () { setDay(E.addDays(state.d0, -1)); });
    $('next').addEventListener('click', function () { setDay(E.addDays(state.d0, 1)); });
    $('today').addEventListener('click', function () { setDay(E.dayStart(Date.now())); });
    $('date').addEventListener('change', function () {
      var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(this.value);
      if (m && +m[1] >= 1900 && +m[1] <= 2200) setDay(E.midnight(+m[1], +m[2], +m[3]));
    });
    $('unpin').addEventListener('click', unpin);

    /* Map: a lamp selects a spot, any other point on the water places the probe. */
    $('map').addEventListener('click', function (e) {
      var g = e.target.closest ? e.target.closest('.pin') : null;
      if (g) { setSpot(byId[g.getAttribute('data-id')]); return; }
      var svg = $('map').querySelector('svg'), r = svg.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width * MAP.w, y = (e.clientY - r.top) / r.height * MAP.h;
      if (isWater(x, y)) { state.probe = { x: x, y: y, w: nearest(x, y), near: landWithin(x, y, NEAR_LAND_KM) }; state.probeMiss = false; }
      else { state.probeMiss = true; }
      renderOverlay(); renderProbe();
    });
    $('map').addEventListener('keydown', function (e) {
      var g = e.target.closest ? e.target.closest('.pin') : null;
      if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSpot(byId[g.getAttribute('data-id')]); }
    });
    $('layers').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-layer]') : null;
      if (!b) return;
      var key = b.getAttribute('data-layer');
      state.layers[key] = !state.layers[key];
      b.setAttribute('aria-pressed', state.layers[key] ? 'true' : 'false');
      b.querySelector('.pip').className = 'pip' + (state.layers[key] ? ' on' : '');
      renderOverlay();
    });
    $('probe').addEventListener('click', function (e) {
      var tAttr = e.target.getAttribute ? e.target.getAttribute('data-t') : null;
      if (tAttr) { pinTime(+tAttr); return; }
      if (e.target.getAttribute && e.target.getAttribute('data-act') === 'reload') { loadWeather(true); syncField(true); }
    });

    $('ahead').addEventListener('click', function (e) {
      var tr = e.target.closest ? e.target.closest('tr[data-d0]') : null;
      if (tr) { setDay(+tr.getAttribute('data-d0')); toTop(); }
    });
    $('weather').addEventListener('click', function (e) {
      if (e.target.getAttribute && e.target.getAttribute('data-act') === 'reload') { loadWeather(true); syncField(true); }
    });

    /* Day display: moving reads a time, selecting pins it. */
    var host = $('chart');
    function timeAt(e) {
      var G = state.geom;
      if (!G) return null;
      var r = host.getBoundingClientRect();
      var x = (e.clientX - r.left) * (G.W / r.width);
      return clamp(G.d0 + (x - G.x0) / G.pw * G.span, G.d0, G.d1 - 5 * MIN);
    }
    function onHover(e) {
      var t = timeAt(e);
      if (t == null) return;
      state.cursor = Math.round(t / MIN) * MIN;
      drawCursor(); renderReadout();
    }
    host.addEventListener('pointermove', onHover);
    host.addEventListener('pointerdown', onHover);
    host.addEventListener('pointerup', function (e) {
      var t = timeAt(e);
      if (t != null) pinTime(t);
    });
    host.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse') { state.cursor = null; drawCursor(); renderReadout(); }
    });
    host.addEventListener('keydown', function (e) {
      var G = state.geom, stepMs = (e.shiftKey ? 60 : 10) * MIN, now = Date.now();
      if (!G) return;
      var base = state.cursor != null ? state.cursor : (state.pin != null && state.pin >= G.d0 && state.pin < G.d1) ? state.pin :
        (now >= G.d0 && now < G.d1 ? Math.round(now / (10 * MIN)) * 10 * MIN : G.d0 + 12 * HOUR);
      if (e.key === 'Escape') { unpin(); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pinTime(base); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        state.cursor = clamp(base + (e.key === 'ArrowRight' ? stepMs : -stepMs), G.d0, G.d1 - 5 * MIN);
        e.preventDefault();
        drawCursor(); renderReadout();
      }
    });

    var lastW = 0, pending = false;
    function onResize() {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(function () {
        pending = false;
        var w = Math.floor(host.clientWidth);
        if (w && w !== lastW) { lastW = w; renderChart(); }
      });
    }
    if (window.ResizeObserver) { new ResizeObserver(onResize).observe(host); }
    window.addEventListener('resize', onResize);

    /* Once a minute: move the now needle, refresh stale forecasts, and roll over to the new day at midnight. */
    setInterval(function () {
      var today = E.dayStart(Date.now());
      if (state.followToday && state.d0 !== today) { setDay(today); return; }
      renderNow();
      if (state.d0 === today) { renderChart(); renderCards(); if (state.cursor == null) renderReadout(); }
      if (state.pin == null) renderGulf();
      loadWeather(false);
    }, 60000);

    buildMask();
    buildSites();
    readCachedField();
    renderMap();
    renderAll();
    lastW = Math.floor(host.clientWidth);
    loadWeather(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
