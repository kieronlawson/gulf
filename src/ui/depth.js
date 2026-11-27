/* Depths: the depth grid that tools/depth.py made, fetched from the file beside the page, and the depth lines
   of the probe reading and of Where to go. Engine.depthAt and Engine.depthAtTime read the grid. */

  /* ---------- The depth grid ---------- */

  /* status: idle, loading, ok or failed. grid holds what Engine.depthAt reads once the file is decoded. */
  var depth = { status: 'idle', failedAt: 0, grid: null };

  /* The file is an RGB PNG with no color profile: a cell's stored value is red * 256 + green. The decode
     asks the browser not to convert colors or premultiply, so each byte comes back as written. */
  function decodeDepth(blob, D) {
    function viaImage() {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(blob), img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('depth image')); };
        img.src = url;
      });
    }
    var picture = window.createImageBitmap ?
      window.createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }).catch(viaImage) : viaImage();
    return picture.then(function (img) {
      if (img.width !== D.nx || img.height !== D.ny) throw new Error('depth image size');
      var cv = document.createElement('canvas');
      cv.width = D.nx; cv.height = D.ny;
      var cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      if (img.close) img.close();
      var px = cx.getImageData(0, 0, D.nx, D.ny).data, n = D.nx * D.ny, v = new Uint16Array(n);
      for (var i = 0; i < n; i++) v[i] = px[i * 4] * 256 + px[i * 4 + 1];
      return v;
    });
  }

  /* Loads the grid once. After a failed load, automatic loads wait RETRY_MS, as the forecasts do. */
  function loadDepth(force) {
    var D = DATA.depth;
    if (!D || depth.status === 'ok' || depth.status === 'loading') return;
    if (!force && recentlyFailed(depth.failedAt)) return;
    depth.status = 'loading';
    fetch(D.file).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) { return decodeDepth(blob, D); }).then(function (v) {
      depth.grid = { W: D.W, N: D.N, k: D.k, scale: D.scale, cellsPerUnit: D.cellsPerUnit, nx: D.nx, ny: D.ny, offsetDm: D.offsetDm, v: v };
      depth.status = 'ok'; depth.failedAt = 0;
    }).catch(function () {
      depth.status = 'failed'; depth.failedAt = Date.now();
    }).then(function () { renderProbe(); });
  }

  /* ---------- Depth in words ---------- */

  function depthM(m) { return Math.abs(m).toFixed(1) + ' m'; }

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
    var tide = 'tide ' + depthM(d.tide) + at;
    if (d.chart < 0) {
      /* A drying height: the ground stands above chart datum. */
      if (d.depth <= 0) return { value: 'Dry', sub: 'The ground dries ' + depthM(d.chart) + '. The ' + tide + ' is below it.', grid: true };
      return { value: depthM(d.depth), sub: 'The ' + tide + ' covers ground that dries ' + depthM(d.chart) + '.', grid: true };
    }
    return { value: depthM(d.depth), sub: 'Chart ' + depthM(d.chart) + (d.tide < 0 ? ' \u2212 ' : ' + ') + tide + '.', grid: true };
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
