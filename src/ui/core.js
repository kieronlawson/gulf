/* Shared by every screen: small helpers, page state, drawing helpers, and the Open-Meteo forecast for a spot. */

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

  var SCREENS = ['week', 'day', 'now'];

  /* The owner's limits, stored on the device. The wind and the hours set a window, and values out of range
     fall back to the defaults. The boat speed and the margin set the leave-by time for the run home. They
     start unset, and a value out of range reads as unset: the page does not guess them. */
  var LIMIT_RANGE = { wind: [5, 30, 1], hours: [1, 8, 0.5], speed: [5, 40, 1], margin: [0, 120, 5] };   /* lowest, highest, step */
  /* The first value of a limit that was unset, when the owner presses its plus button. */
  var LIMIT_START = { speed: 15, margin: 30 };
  function inRange(v, key) { return typeof v === 'number' && v >= LIMIT_RANGE[key][0] && v <= LIMIT_RANGE[key][1]; }
  function readLimits() {
    var L = { wind: E.LIMITS.wind, hours: E.LIMITS.hours, speed: null, margin: null };
    try {
      var o = JSON.parse(store.get('gulf-almanac-limits') || 'null');
      if (o && inRange(o.wind, 'wind') && inRange(o.hours, 'hours')) { L.wind = o.wind; L.hours = o.hours; }
      if (o && inRange(o.speed, 'speed')) L.speed = o.speed;
      if (o && inRange(o.margin, 'margin')) L.margin = o.margin;
    } catch (e) { /* use the defaults */ }
    return L;
  }
  /* The wide layout: an iPad in landscape, or larger. The same test as the wide-screen rule in style.css. */
  function isWide() { return !!(window.matchMedia && window.matchMedia('(min-width: 1000px) and (min-height: 700px)').matches); }
  function hoursWords(h) { return (h % 1 ? h.toFixed(1) : String(h)) + ' h'; }

  var state = {
    screen: SCREENS.indexOf(store.get('gulf-almanac-screen')) >= 0 ? store.get('gulf-almanac-screen') : 'day',
    spot: byId[store.get('gulf-almanac-spot')] || spots[0],
    limits: readLimits(),
    d0: E.dayStart(Date.now()),
    followToday: true,
    cursor: null,
    geom: null,
    wx: {},
    wxFailedAt: 0,
    pin: null,
    probe: null,
    marks: [],          /* saved marks, read from storage at start */
    home: null,         /* the saved home, or null */
    moving: null,       /* the key of a saved place that the next map tap moves */
    mapScreen: 'day',   /* the screen that holds the map: day or now */
    nowStep: 0,         /* hours ahead that the map shows on the Now screen: 0 to 3 */
    layers: { wind: true, flow: true, chop: true },
    routes: { day: null, now: null }   /* the open route on each screen with the map: see route.js */
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

  /* Four rating lamps. With a label, VoiceOver reads it in place of the lamps. */
  function pips(level, label) {
    var s = '<span class="pips"' + (label ? ' role="img" aria-label="' + label + '"' : ' aria-hidden="true"') + '>';
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
  /* After a failed load, automatic loads wait this long before they try again.
     Sync, a return to the page and a restored connection try at once. */
  var RETRY_MS = 10 * 60 * 1000;
  function recentlyFailed(at) { return at > 0 && Date.now() - at < RETRY_MS; }

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
    if (!force && old && Date.now() - old.at < WX_TTL) {
      state.wx[id] = { status: 'ok', at: old.at, recs: old.recs };
      weatherChanged(id);
      return;
    }
    if (!force && recentlyFailed(state.wxFailedAt)) {
      if (!cur || cur.status !== 'failed') {
        state.wx[id] = { status: 'failed', at: old ? old.at : 0, recs: old ? old.recs : null };
        weatherChanged(id);
      }
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
      state.wxFailedAt = 0;
      store.set('gulf-almanac-wx-' + id, JSON.stringify({ at: state.wx[id].at, recs: recs }));
    }).catch(function () {
      state.wx[id] = { status: 'failed', at: old ? old.at : 0, recs: old ? old.recs : null };
      state.wxFailedAt = Date.now();
    }).then(function () { weatherChanged(id); });
  }

  function weatherChanged(id) {
    syncField(false);
    if (state.spot.id !== id) return;
    renderStatus(); renderWindows(); renderTimebar(); renderWeek(); renderChart(); renderReadout(); renderWeather(); renderAhead();
  }

  /* The lamp and line under the title: whether a forecast is loaded for the spot, and how old it is. */
  function ageWords(at) {
    var mins = Math.floor((Date.now() - at) / MIN);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    if (mins < 48 * 60) return Math.floor(mins / 60) + ' h ' + E.pad2(mins % 60) + ' min ago';
    return Math.floor(mins / (24 * 60)) + ' days ago';
  }
  function renderStatus() {
    var wx = state.wx[state.spot.id], lamp = 'busy', text = 'Loading the forecast';
    if (wx && wx.recs) {
      var age = ageWords(wx.at);
      if (wx.status === 'ok') { lamp = 'on'; text = 'Forecast loaded ' + age; }
      else if (wx.status === 'loading') { lamp = 'busy'; text = 'Updating. Forecast loaded ' + age; }
      else { lamp = 'alert'; text = 'Update failed. Forecast loaded ' + age; }
    } else if (wx && wx.status === 'failed') {
      lamp = 'alert'; text = 'No forecast. The last load failed.';
    }
    $('wxLamp').className = 'pip ' + lamp;
    $('wxText').textContent = text;
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

  /* Summary of one day's weather. By default it covers the hours between sunrise and sunset, and needs six of
     them with a forecast. inside(t) chooses other hours, and min another least number of them. */
  function daySummary(d, inside, min) {
    inside = inside || function (t) { return t >= d.sun.rise - HOUR && t <= d.sun.set; };
    var hrs = dayRecs(d.d0, d.d1), lit = hrs.filter(function (q) { return inside(q.t); });
    if (lit.length < (min || 6)) return null;
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

