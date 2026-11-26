/* The Gulf map: coastline, water mask, fetch and chop, the wind and flow field, the overlay and the probe. */

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

