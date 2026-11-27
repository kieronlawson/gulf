/* Chart marks: rocks, wrecks, obstructions, buoys, beacons and lights, and the outlines of restricted areas, marine
   farms and foul ground, from the LINZ chart data that tools/chartmarks.py wrote to data/marks.json. The Marks
   button shows them. The probe reading names the mark nearest the probe and the areas around it. Not for
   navigation. */

  /* status: idle, loading, ok or failed. data holds the file, with each area's rings read once. */
  var chart = { status: 'idle', failedAt: 0, data: null, drawn: null };

  function loadChartMarks(force) {
    var file = DATA.marks;
    if (!file || chart.status === 'ok' || chart.status === 'loading') return;
    if (!force && recentlyFailed(chart.failedAt)) return;
    chart.status = 'loading';
    fetch(file).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !Array.isArray(j.points) || !Array.isArray(j.areas) || !Array.isArray(j.texts)) throw new Error('marks');
      j.areas.forEach(function (a) {
        a.rings = a[3].split('M').filter(Boolean).map(function (ring) {
          return ring.replace('Z', '').trim().split(' ').map(function (xy) { var q = xy.split(','); return [+q[0], +q[1]]; });
        });
      });
      chart.data = j; chart.status = 'ok'; chart.failedAt = 0;
    }).catch(function () {
      chart.status = 'failed'; chart.failedAt = Date.now();
    }).then(function () { renderChartMarks(true); renderProbe(); renderMapKey(mapTime(), !!(state.layers.chop && fieldShown())); });
  }

  /* Marks show from this zoom. Further out, about 1,500 of them would hide the water. The outlines of areas show
     at every zoom. */
  var MARK_ZOOM = 2;
  /* The probe reading names a mark within this many pixels of the probe. */
  var MARK_TAP_PX = 18;

  /* The symbols, drawn at one size on screen, in ink: a dotted ring with a cross for a rock, the hull and masts
     of a wreck, a dotted ring for an obstruction, a diamond for a buoy, a triangle for a beacon, a star for a light
     on its own, and a square for a marine farm. */
  var MARK_GLYPH = {
    r: '<circle class="cm-ring" r="3.4"/><path d="M-2.2 0h4.4M0 -2.2v4.4"/>',
    w: '<path d="M-4 .8h8M-2 -1.8v2.6M0 -2.6v3.4M2 -1.8v2.6"/>',
    o: '<circle class="cm-ring" r="3"/>',
    b: '<path class="cm-buoy" d="M0 -3.4L3 0 0 3.4-3 0Z"/>',
    c: '<path class="cm-fill" d="M0 -3.4L3 2.4H-3Z"/>',
    l: '<path class="cm-fill" d="M0 -3.6L.9 -.9 3.6 0 .9 .9 0 3.6-.9 .9-3.6 0-.9-.9Z"/>',
    f: '<rect x="-2.4" y="-2.4" width="4.8" height="4.8"/>'
  };
  var MARK_KIND = { r: 'rock', w: 'wreck', o: 'obstruction', b: 'buoy', c: 'beacon', l: 'light', f: 'marine farm' };

  function chartShown() { return !!(state.layers.marks && chart.data); }

  /* The outlines, drawn once while the layer shows. The marks in a box around the view, drawn again when the view
     leaves that box or the zoom changes, so a drag redraws them only now and then. */
  function renderChartMarks(force) {
    var areasEl = $('ovAreas'), marksEl = $('ovMarks');
    if (!areasEl || !marksEl) return;
    if (!chartShown()) { areasEl.innerHTML = ''; marksEl.innerHTML = ''; chart.drawn = null; return; }
    var C = chart.data;
    if (force || !areasEl.firstChild) {
      areasEl.innerHTML = C.areas.map(function (a) { return '<path class="cm-area cm-' + a[0] + '" d="' + a[3] + '"/>'; }).join('');
    }
    if (view.z < MARK_ZOOM) { marksEl.innerHTML = ''; chart.drawn = null; return; }
    /* The symbols keep one size on screen, so a new frame size at the same zoom also draws them again. */
    var vb = viewBox(), d = chart.drawn, s = glyph().toFixed(4);
    if (!force && d && d.z === view.z && d.s === s && vb.x >= d.x && vb.y >= d.y && vb.x + vb.w <= d.x + d.w && vb.y + vb.h <= d.y + d.h) return;
    var box = { x: vb.x - vb.w / 2, y: vb.y - vb.h / 2, w: vb.w * 2, h: vb.h * 2, z: view.z, s: s }, out = '';
    C.points.forEach(function (q) {
      if (q[1] < box.x || q[1] > box.x + box.w || q[2] < box.y || q[2] > box.y + box.h) return;
      out += '<g class="cm cm-' + q[0] + '" transform="translate(' + q[1] + ' ' + q[2] + ') scale(' + s + ')">' + MARK_GLYPH[q[0]] + '</g>';
    });
    marksEl.innerHTML = out;
    chart.drawn = box;
  }

  function insideRings(rings, x, y) {
    var hit = false;
    rings.forEach(function (r) {
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        if ((r[i][1] > y) !== (r[j][1] > y) && x < r[i][0] + (y - r[i][1]) * (r[j][0] - r[i][0]) / (r[j][1] - r[i][1])) hit = !hit;
      }
    });
    return hit;
  }

  /* The probe reading names marks by the layer and the zoom, so it is written again when the zoom changes, once
     the zoom has settled. */
  var chartZoom = { z: null, timer: 0 };
  function chartZoomChanged() {
    if (chartZoom.z === view.z) return;
    chartZoom.z = view.z;
    clearTimeout(chartZoom.timer);
    if (state.probe && chart.data) chartZoom.timer = setTimeout(renderProbe, 200);
  }

  /* The lines of the probe reading about the chart: the mark nearest the probe, within MARK_TAP_PX on screen,
     while the marks show; and each area that holds the probe. */
  function chartRows(x, y) {
    if (!chartShown()) return '';
    var C = chart.data, T = C.texts, rows = '';
    if (view.z >= MARK_ZOOM && frame.h) {
      var reach = MARK_TAP_PX * viewBox().h / frame.h, best = null, bd = reach;
      C.points.forEach(function (q) {
        var d = Math.hypot(q[1] - x, q[2] - y);
        if (d <= bd) { bd = d; best = q; }
      });
      if (best) {
        var name = T[best[3]] || '';
        if (best[0] === 'b' || best[0] === 'c') name = name || MARK_KIND[best[0]];
        rows += chartRow(name.charAt(0).toUpperCase() + name.slice(1), T[best[4]], Math.round(bd / NM * 1852));
      }
    }
    C.areas.forEach(function (a) { if (insideRings(a.rings, x, y)) rows += chartRow(T[a[1]], T[a[2]], null); });
    return rows ? '<div class="probechart">' + rows + '</div>' : '';
  }
  function chartRow(name, detail, meters) {
    return '<div><b>' + esc(name) + '</b>' + (meters != null ? '<span>' + (meters < 10 ? 'here' : meters + ' m away') + '</span>' : '<span>inside</span>') + '</div>' +
      (detail ? '<p>' + esc(detail) + '</p>' : '');
  }
