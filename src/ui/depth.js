/* Depths: the depth grid that tools/depth.py made and the contours that tools/contours.py drew, fetched from the
   files beside the page; the depth lines of the probe reading and of Where to go; and the depth layers of the map:
   tints, contours, the hatching of water under the safe depth, and their key. Engine.depthAt and
   Engine.depthAtTime read the grid. */

  /* ---------- The depth grid ---------- */

  /* status: idle, loading, ok or failed. grid holds what Engine.depthAt reads once the file is decoded. */
  var depth = { status: 'idle', failedAt: 0, grid: null };

  /* The tide of a spot at time t. Code that reads many points at one time, such as the suggestions of Where to go,
     takes the tide from here, so each spot's tide is worked out once for each time. */
  var tideMemo = { t: null, h: {} };
  function spotTide(sp, t) {
    if (tideMemo.t !== t) { tideMemo.t = t; tideMemo.h = {}; }
    if (!(sp.id in tideMemo.h)) tideMemo.h[sp.id] = E.tideNow(sp, t).h;
    return tideMemo.h[sp.id];
  }
  /* The depth at a point at time t, as Engine.depthAtTime gives it, with the tide from spotTide. Null before the
     grid loads, and where the grid has no value. */
  function depthAtTimeMemo(p, t) {
    var d = depth.status === 'ok' ? E.depthAt(depth.grid, p) : null;
    if (!d) return null;
    var sp = E.nearestSpot(p), h = spotTide(sp, t);
    if (d.land) return { land: true, tide: h, spot: sp };
    return { depth: h == null ? null : d.chart + h, chart: d.chart, tide: h, spot: sp };
  }

  /* The file's stored values, decoded in script by Engine.pngChunks and Engine.pngValues. The compressed data is
     inflated by DecompressionStream, which also checks it. No canvas sits in the path, so no browser can change the
     values on the way. A browser without DecompressionStream gets no depths. */
  function decodeDepth(buf, D) {
    if (!window.DecompressionStream || !window.Response) return Promise.reject(new Error('no DecompressionStream'));
    var png = E.pngChunks(new Uint8Array(buf));
    if (png.width !== D.nx || png.height !== D.ny) return Promise.reject(new Error('depth image size'));
    var stream = new Blob([png.data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(stream).arrayBuffer().then(function (raw) { return E.pngValues(new Uint8Array(raw), png.width, png.height); });
  }

  /* Loads the grid and the contours once each. After a failed load, automatic loads wait RETRY_MS, as the
     forecasts do. */
  function loadDepth(force) {
    loadContours(force);
    var D = DATA.depth;
    if (!D || depth.status === 'ok' || depth.status === 'loading') return;
    if (!force && recentlyFailed(depth.failedAt)) return;
    depth.status = 'loading';
    fetch(D.file).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) { return decodeDepth(buf, D); }).then(function (v) {
      depth.grid = { W: D.W, N: D.N, k: D.k, scale: D.scale, cellsPerUnit: D.cellsPerUnit, nx: D.nx, ny: D.ny, offsetDm: D.offsetDm, v: v };
      depth.status = 'ok'; depth.failedAt = 0;
    }).catch(function () {
      depth.status = 'failed'; depth.failedAt = Date.now();
    }).then(function () { renderProbe(); renderDepthLayers(); renderRoute(); renderNowSide(); });
  }

  /* status: idle, loading, ok or failed. data holds { depths, paths, labels } from data/contours.json. */
  var contours = { status: 'idle', failedAt: 0, data: null };
  function loadContours(force) {
    var D = DATA.depth;
    if (!D || !D.contours || contours.status === 'ok' || contours.status === 'loading') return;
    if (!force && recentlyFailed(contours.failedAt)) return;
    contours.status = 'loading';
    fetch(D.contours).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !j.paths || !Array.isArray(j.labels)) throw new Error('contours');
      contours.data = j; contours.status = 'ok'; contours.failedAt = 0;
    }).catch(function () {
      contours.status = 'failed'; contours.failedAt = Date.now();
    }).then(function () { renderDepthLayers(); });
  }

  /* ---------- Depth in words ---------- */

  function depthM(m) { return Math.abs(m).toFixed(1) + ' m'; }
  /* A height with its sign, as a tide below chart datum needs. */
  function signedM(m) { return (m < 0 ? '\u2212' : '') + depthM(m); }

  /* The depth at a map point at time t, as { value, sub, grid }: value for the right of the row, sub for the
     sentences under it, which name the tide spot, and grid when the value comes from the depth grid.
     A point the grid has no value for gives "No depth here". */
  function depthWords(x, y, t) {
    if (depth.status === 'failed') return { value: 'Not loaded', sub: 'Depths did not load. The page tries again every 10 minutes, and when you return to it.' };
    if (depth.status !== 'ok') return { value: 'Loading', sub: 'Loading depths.' };
    var d = E.depthAtTime(depth.grid, { lat: mapLat(y), lon: mapLon(x) }, t);
    if (!d) return { value: 'No depth here', sub: 'The depth grid has no value at this point.' };
    if (d.land) return { value: 'Land', sub: 'The depth grid puts this point above high water.', grid: true };
    var at = ' at ' + d.spot.name;
    if (d.tide == null) {
      return { value: d.chart < 0 ? 'Dries ' + depthM(d.chart) : depthM(d.chart) + ' at chart datum', sub: 'No tide height' + at + ' for this time.', grid: true };
    }
    var tide = signedM(d.tide) + at;
    if (d.chart < 0) {
      /* A drying height: the ground stands above chart datum. */
      if (d.depth <= 0) return { value: 'Dry', sub: 'The ground dries ' + depthM(d.chart) + '. The tide of ' + tide + ' is below it.', grid: true };
      return { value: depthM(d.depth), sub: 'The tide of ' + tide + ' covers ground that dries ' + depthM(d.chart) + '.', grid: true };
    }
    var sum = 'Chart ' + depthM(d.chart) + (d.tide < 0 ? ' \u2212 ' : ' + ') + 'tide ' + depthM(d.tide) + at;
    /* A tide below chart datum can leave a cell at or above the water. */
    if (d.depth <= 0) return { value: 'Dry', sub: sum + ' leaves no water.', grid: true };
    return { value: depthM(d.depth), sub: sum + '.', grid: true };
  }

  /* The depth row of the probe reading, at the map's time. */
  function depthRow(x, y, t) {
    if (!DATA.depth) return '';
    var w = depthWords(x, y, t);
    return '<div class="probedepth"><div><span>Depth at ' + E.fmtTime(t) + '</span><b>' + esc(w.value) + '</b></div>' +
      '<p>' + esc(w.sub) + (w.grid ? ' Not for navigation.' : '') + '</p></div>';
  }

  /* The depth of a place for its line in Where to go, or an empty string. */
  function depthShort(x, y, t) {
    if (depth.status !== 'ok') return '';
    var d = E.depthAtTime(depth.grid, { lat: mapLat(y), lon: mapLon(x) }, t);
    if (!d) return '';
    if (d.land) return 'land';
    if (d.depth == null) return '';
    return d.depth <= 0 ? 'dry' : depthM(d.depth) + ' deep';
  }

  /* ---------- Depths on the map ---------- */

  var SVGNS = 'http://www.w3.org/2000/svg';
  /* Contour labels show once a line's labels are about 160 px apart on screen: every other label from zoom 1.8,
     all of them from zoom 3.6. tools/contours.py puts them 45 map units apart along each line. */
  var LABEL_ZOOM = [1.8, 3.6];

  /* A color token of the theme as [red, green, blue, alpha], each from 0 to 255. A canvas reads the token's
     text, so any CSS color works. */
  function tokenRGBA(name) {
    var text = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    var cx = document.createElement('canvas').getContext('2d'), m;
    cx.fillStyle = '#000000'; cx.fillStyle = text;
    var f = String(cx.fillStyle);
    if ((m = /^#([0-9a-f]{6})$/i.exec(f))) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 255];
    if ((m = /^rgba?\(([^)]+)\)$/.exec(f))) {
      var q = m[1].split(',').map(Number);
      return [q[0], q[1], q[2], Math.round((q.length > 3 ? q[3] : 1) * 255)];
    }
    return [0, 0, 0, 0];
  }

  /* A canvas the size of the depth grid, one pixel per cell. */
  function gridCanvas() {
    var g = depth.grid, cv = document.createElement('canvas');
    cv.width = g.nx; cv.height = g.ny;
    return cv;
  }
  /* An SVG image that lays a grid canvas's picture over the map, in map units. */
  function placeImage(el, url) {
    var g = depth.grid;
    el.setAttribute('x', 0); el.setAttribute('y', 0);
    el.setAttribute('width', g.nx / g.cellsPerUnit); el.setAttribute('height', g.ny / g.cellsPerUnit);
    el.setAttribute('preserveAspectRatio', 'none');
    el.setAttribute('href', url);
  }

  /* The tints: chart depth under 5 m, 5 to 10 m and 10 to 20 m, in the theme's three tints. A drying height counts
     as under 5 m. The picture is drawn again only when the theme's colors change. */
  var tint = { key: null, url: null };
  function tintUrl() {
    var cols = ['--depth-1', '--depth-2', '--depth-3'].map(tokenRGBA), key = JSON.stringify(cols);
    if (key === tint.key) return tint.url;
    var g = depth.grid, cv = gridCanvas(), cx = cv.getContext('2d'), im = cx.createImageData(g.nx, g.ny), px = im.data;
    for (var i = 0, n = g.nx * g.ny; i < n; i++) {
      var v = g.v[i];
      if (v < 2) continue;
      var d = (v - g.offsetDm) / 10, c = d < 5 ? cols[0] : d < 10 ? cols[1] : d < 20 ? cols[2] : null;
      if (!c) continue;
      px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = c[3];
    }
    cx.putImageData(im, 0, 0);
    tint.key = key; tint.url = cv.toDataURL('image/png');
    return tint.url;
  }

  /* The cells that can be shallower than any safe depth: chart depth under the highest safe depth plus 0.5 m,
     which allows for a tide below chart datum. Each keeps its chart depth and the index of its nearest tide spot,
     found once, by distance on the ground as Engine.nearestSpot finds it. */
  var shallow = null;
  function shallowCells() {
    if (shallow) return shallow;
    var g = depth.grid, top = (LIMIT_RANGE.safe[1] + 0.5) * 10 + g.offsetDm, idx = [], chart = [], near = [];
    var ux = g.cellsPerUnit * g.k * g.scale, uy = g.cellsPerUnit * g.scale;
    var sp = spots.map(function (s) { return { lat: s.lat, lon: s.lon }; });
    for (var j = 0; j < g.ny; j++) {
      var lat = g.N - (j + 0.5) / uy, kx = Math.cos(lat * RAD);
      for (var i = 0; i < g.nx; i++) {
        var v = g.v[j * g.nx + i];
        if (v < 2 || v >= top) continue;
        var lon = g.W + (i + 0.5) / ux, best = 0, bd = Infinity;
        for (var s = 0; s < sp.length; s++) {
          var dx = (sp[s].lon - lon) * kx, dy = sp[s].lat - lat, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = s; }
        }
        idx.push(j * g.nx + i); chart.push((v - g.offsetDm) / 10); near.push(best);
      }
    }
    shallow = { idx: Int32Array.from(idx), chart: Float32Array.from(chart), spot: Uint8Array.from(near) };
    return shallow;
  }

  /* The hatching: water whose depth at time t, chart depth plus the tide at the cell's nearest spot, is under the
     safe depth. The picture is a mask, white where the hatching shows. It is drawn again only when the safe depth
     or a spot's tide, to the centimeter, changes. */
  var hatch = { key: null, cv: null, url: null, seq: 0 };
  function renderHatch(t) {
    var el = $('ovHatch'), img = $('hatchImg'), safe = state.limits.safe;
    if (!el || !img) return;
    if (!state.layers.depth || safe == null || depth.status !== 'ok') { el.innerHTML = ''; hatch.key = null; return; }
    var tides = spots.map(function (s) { return E.tideNow(s, t).h; });
    var key = safe + '|' + tides.map(function (h) { return h == null ? 'x' : h.toFixed(2); }).join(',');
    if (!el.firstChild) el.innerHTML = '<rect class="m-hatchbg" x="0" y="0" width="' + MAP.w + '" height="' + MAP.h + '" mask="url(#hatchMask)"/>';
    if (key === hatch.key) return;
    hatch.key = key;
    var g = depth.grid, sh = shallowCells();
    if (!hatch.cv) hatch.cv = gridCanvas();
    var cx = hatch.cv.getContext('2d'), im = cx.createImageData(g.nx, g.ny), px = im.data;
    for (var k = 0; k < sh.idx.length; k++) {
      var h = tides[sh.spot[k]];
      if (h == null || sh.chart[k] + h >= safe) continue;
      var o = sh.idx[k] * 4;
      px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = 255;
    }
    cx.putImageData(im, 0, 0);
    var seq = ++hatch.seq;
    hatch.cv.toBlob(function (blob) {
      if (seq !== hatch.seq || !blob) return;
      if (hatch.url) URL.revokeObjectURL(hatch.url);
      hatch.url = URL.createObjectURL(blob);
      placeImage(img, hatch.url);
    });
  }

  /* The contours, drawn once: one path for each depth, and the labels, which keep one size on screen. */
  function renderContours() {
    var el = $('ovContours');
    if (!el) return;
    if (!state.layers.depth || !contours.data) { el.innerHTML = ''; return; }
    if (el.firstChild) return;
    var C = contours.data, s = glyph().toFixed(4), out = '';
    C.depths.forEach(function (d) { if (C.paths[d]) out += '<path class="m-cont c' + d + '" d="' + C.paths[d] + '"/>'; });
    C.labels.forEach(function (q) {
      var at = q[0] + ' ' + q[1];
      out += '<g class="m-clab t' + q[4] + '" data-at="' + at + '" transform="translate(' + at + ') scale(' + s + ')"><text transform="rotate(' + q[3] + ')" text-anchor="middle" y="2">' + q[2] + '</text></g>';
    });
    el.innerHTML = out;
    markContourLabels();
  }
  function markContourLabels() {
    var el = $('ovContours');
    if (!el) return;
    el.classList.toggle('lab0', view.z >= LABEL_ZOOM[0]);
    el.classList.toggle('lab1', view.z >= LABEL_ZOOM[1]);
  }

  /* The key, under the scale: the time the hatching is drawn for, the tints while they show, the hatching once
     a safe depth is set, the contour line, and the words "Not for navigation". With only the chart marks shown, it
     names them and keeps the words "Not for navigation". */
  function renderMapKey(t, chop) {
    var el = $('mapKey');
    if (!el) return;
    if (full.on) { renderFullKey(el, t, chop); return; }
    var deep = state.layers.depth && (depth.status === 'ok' || contours.status === 'ok'), shown = deep || chartShown();
    el.hidden = !shown;
    if (!shown) return;
    var safe = state.limits.safe, rows = [], marks = '';
    if (!deep) {
      el.classList.remove('chopon');
      el.innerHTML = '<b>Chart marks</b><span class="nav">Not for navigation</span>';
      return;
    }
    rows.push('<b>' + (safe != null && depth.status === 'ok' ? 'Depth at ' + E.fmtTime(t) : 'Chart depth') + '</b>');
    if (!chop && depth.status === 'ok') {
      rows.push('<div><span><i class="k1"></i>0\u20135</span><span><i class="k2"></i>5\u201310</span><span><i class="k3"></i>10\u201320 m</span></div>');
    }
    if (safe != null && depth.status === 'ok') marks += '<span><i class="kh"></i>under ' + safe.toFixed(1) + ' m</span>';
    if (contours.status === 'ok') marks += '<span><i class="kc"></i>contour, m</span>';
    if (marks) rows.push('<div>' + marks + '</div>');
    rows.push('<span class="nav">Not for navigation</span>');
    el.classList.toggle('chopon', chop);
    el.innerHTML = rows.join('');
  }

  /* The full-screen map's key, one item to a line, under the layer buttons: the chop scale while the chop tint
     shows, otherwise the depth tints; then the hatching and the contour line in both. */
  function renderFullKey(el, t, chop) {
    var deep = state.layers.depth && depth.status === 'ok', lines = state.layers.depth && contours.status === 'ok';
    var safe = state.limits.safe, rows = [];
    el.hidden = !(chop || deep || lines || chartShown());
    if (el.hidden) return;
    rows.push('<b>' + (chop ? 'Chop at ' + E.fmtTime(t) : deep && safe != null ? 'Depth at ' + E.fmtTime(t) : deep ? 'Chart depth' : 'Map') + '</b>');
    if (chop) {
      [['q1', 'light, from 0.15 m'], ['q2', 'moderate, 0.3 m'], ['q3', 'rough, 0.5 m'], ['q4', 'very rough, 0.8 m']].forEach(function (q) {
        rows.push('<span><i class="' + q[0] + '"></i>' + q[1] + '</span>');
      });
    } else if (deep) {
      rows.push('<span><i class="k1"></i>under 5 m</span>', '<span><i class="k2"></i>5 to 10 m</span>', '<span><i class="k3"></i>10 to 20 m</span>');
    }
    if (deep && safe != null) rows.push('<span><i class="kh"></i>depth under ' + safe.toFixed(1) + ' m</span>');
    if (lines) rows.push('<span><i class="kc"></i>chart depth, m</span>');
    if (deep || lines || chartShown()) rows.push('<span class="nav">Not for navigation</span>');
    el.classList.toggle('chopon', chop);
    el.innerHTML = rows.join('');
  }

  /* Every depth layer of the map, at the map's time. With Chop on and a forecast shown, the tints give way to the
     chop tint, and the contours take a stronger blue. */
  function renderDepthLayers() {
    var svg = $('mapSvg');
    if (!svg || !DATA.depth) return;
    var t = mapTime(), chop = !!(state.layers.chop && fieldShown());
    svg.classList.toggle('chopon', chop);
    var layer = $('ovDepthTint');
    if (state.layers.depth && !chop && depth.status === 'ok') {
      var url = tintUrl(), im = layer.firstChild;
      if (!im) { im = document.createElementNS(SVGNS, 'image'); layer.appendChild(im); }
      if (im.getAttribute('href') !== url) placeImage(im, url);
    } else layer.innerHTML = '';
    renderContours(); renderHatch(t); renderMapKey(t, chop);
  }
