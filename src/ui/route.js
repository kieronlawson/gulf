/* The route from A to B on the Day screen: a path over open water, scored for comfort leg by leg at the time
   the boat reaches each leg. The engine does the arithmetic; docs/route-comfort.md holds the design. */

  /* ---------- The path and its score ---------- */

  /* The last few paths, by their ends, so a new leave time does not search again. */
  var routePaths = [];
  /* The path between two points in map units, as map units. fromNm and toNm say how far each end moved to
     reach open water, in nautical miles. Null until the map's water raster exists. */
  function routePath(a, b) {
    if (!MASK) return null;
    var key = [a.x, a.y, b.x, b.y].map(function (v) { return v.toFixed(3); }).join(' ');
    for (var i = 0; i < routePaths.length; i++) if (routePaths[i].key === key) return routePaths[i].res;
    var R = MASK.R, r = E.findPath(MASK, { x: a.x * R, y: a.y * R }, { x: b.x * R, y: b.y * R });
    var res = {
      found: r.found,
      points: r.points.map(function (p) { return { x: p.x / R, y: p.y / R }; }),
      fromNm: r.from ? r.from.moved / R / NM : null,
      toNm: r.to ? r.to.moved / R / NM : null
    };
    routePaths.unshift({ key: key, res: res });
    if (routePaths.length > 4) routePaths.length = 4;
    return res;
  }

  /* The chop height and the direction the wind comes from at a point and time, for the engine's clock. */
  function routeCond(x, y, t) {
    var c = condAt(x, y, nearest(x, y), t);
    return c ? { h: c.chop.h, from: c.wind.from } : null;
  }

  /* A route for a leave time: its path and legs, and, once the owner has set a boat speed, the scored legs,
     the stretches and the worst stretch. The page does not guess a speed. */
  function scoreTrip(a, b, t0) {
    var p = routePath(a, b), out = { path: p, t0: t0 };
    if (!p || !p.found) return out;
    out.legs = E.routeLegs(p.points, NM);
    out.nm = out.legs.reduce(function (s, L) { return s + L.nm; }, 0);
    var cruise = state.limits.speed;
    if (cruise == null || !out.legs.length) return out;
    out.cruise = cruise;
    out.score = E.scoreRoute(out.legs, t0, cruise, routeCond);
    out.stretches = E.joinStretches(out.score.legs);
    out.worst = E.worstStretch(out.stretches);
    return out;
  }

  /* ---------- Opening and closing ---------- */

  /* state.route is the open route, or null: its ends A and B, each { name, x, y } in map units, and whether
     the day display shows in full. trip is the route as last scored. */
  var trip = null, routeBack = null;

  /* A is the starting point of Where to go: home, or the selected spot until home is set. */
  function openRoute(b) {
    var o = goOrigin();
    if (!state.route) routeBack = { cx: view.cx, cy: view.cy, z: view.z, preset: view.preset };
    state.route = { a: { name: o.name === 'home' ? 'Home' : o.name, x: o.x, y: o.y }, b: b, showDay: false };
    state.probe = null; confirmKey = null;
    renderRoute();
    setPreset('route');
    renderPlaces(); renderProbeMark(); renderProbe(); renderTimebar();
  }
  function routeToPlace(key) {
    if (key.charAt(0) === 's') {
      var s = suggestions.filter(function (q) { return q.key === key; })[0];
      /* Named without its letter, which the suggestion loses once the route opens. */
      if (s) openRoute({ name: 'Calmest water' + (s.near ? ' near ' + s.near : ''), x: s.x, y: s.y });
      return;
    }
    var p = placeOf(key);
    if (p) openRoute({ name: placeTitle(key), x: mapX(p.lon), y: mapY(p.lat) });
  }
  function routeToProbe() {
    var p = state.probe;
    if (!p) return;
    if (p.key) routeToPlace(p.key);
    else openRoute({ name: 'Probe point', x: p.x, y: p.y });
  }
  /* The map returns to the view it had before the route opened, unless the owner has moved it since. */
  function closeRoute() {
    state.route = null; trip = null;
    var v = routeBack;
    routeBack = null;
    renderRoute();
    if (view.preset === 'route') {
      if (v && v.preset && v.preset !== 'route') setPreset(v.preset);
      else if (v) { view.cx = v.cx; view.cy = v.cy; view.z = v.z; view.preset = null; applyView(); }
      else setPreset('whole');
    }
    renderProbe(); renderTimebar(); markViewButtons();
  }
  function swapRoute() {
    var r = state.route;
    if (!r) return;
    var a = r.a; r.a = r.b; r.b = a;
    renderRoute();
  }
  function toggleDayDisplay() {
    if (!state.route) return;
    state.route.showDay = !state.route.showDay;
    renderRoute();
  }
  /* Whether the Day screen shows a route now. The route belongs to the Day screen's map. */
  function routeShown() { return !!state.route && state.mapScreen === 'day'; }

  /* The map view that fits the path. The path keeps 60 px clear at the top and bottom of the map, where its
     buttons sit, and 24 px at the sides. A short path still shows at least a nautical mile each way. */
  function routeBox() {
    var r = state.route, p = r ? routePath(r.a, r.b) : null, pts = p && p.found ? p.points : r ? [r.a, r.b] : [];
    if (!pts.length) return PRESETS.whole();
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
    var fw = frame.w || 400, fh = frame.h || 400;
    var w = Math.max(x1 - x0, 2 * NM) * fw / Math.max(fw - 48, fw / 2), h = Math.max(y1 - y0, 2 * NM) * fh / Math.max(fh - 120, fh / 2);
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return fitBox(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  }

  /* ---------- Drawing ---------- */

  /* Everything the route changes: the Day screen's layout, the view buttons, the path on the map, the route
     panel and the one-row day. The route is scored for the map's time, the leave time. */
  function renderRoute() {
    var shown = routeShown(), compact = shown && !state.route.showDay;
    $('dayView').classList.toggle('compact', compact);
    $('routeUnit').hidden = !compact;
    $('dayLane').hidden = !compact;
    $('dayNote').hidden = compact;
    $('dayToggle').hidden = !shown;
    $('dayToggle').textContent = compact ? 'Show day display' : 'Show route';
    $('viewRoute').hidden = !shown;
    $('viewSpot').hidden = shown;
    trip = shown ? scoreTrip(state.route.a, state.route.b, mapTime()) : null;
    drawRouteMap();
    if (compact) { renderRoutePanel(); renderDayLane(); }
    else { $('routePanel').innerHTML = ''; $('dayLane').innerHTML = ''; }
  }

  var LEVEL_NAMES = E.COMFORT.names;

  function endGlyph(label, x, y) {
    var at = x.toFixed(2) + ' ' + y.toFixed(2);
    return '<g class="m-end" data-at="' + at + '" transform="translate(' + at + ') scale(' + glyph().toFixed(4) + ')">' +
      '<circle r="6.4"/><text y="2.7" text-anchor="middle">' + label + '</text></g>';
  }

  /* The path: a dark line with the level's color on top, stretch by stretch, gray where the forecast gives no
     score. A and B mark the ends of the path, where the scoring starts and stops. */
  function drawRouteMap() {
    var layer = $('ovRoute'), ends = $('ovEnds');
    if (!layer || !ends) return;
    if (!trip) { layer.innerHTML = ''; ends.innerHTML = ''; return; }
    var r = state.route, p = trip.path, s = '';
    function pt(x, y) { return x.toFixed(2) + ',' + y.toFixed(2); }
    var A = r.a, B = r.b;
    if (p && p.found) {
      A = p.points[0]; B = p.points[p.points.length - 1];
      s += '<polyline class="m-route-under" points="' + p.points.map(function (q) { return pt(q.x, q.y); }).join(' ') + '"/>';
      var legs = trip.score ? trip.score.legs : trip.legs, run = null;
      function flush() { if (run) s += '<polyline class="m-route lv' + run.cls + '" points="' + run.pts.join(' ') + '"/>'; }
      legs.forEach(function (L) {
        var cls = trip.score && L.level != null ? L.level : 'x';
        if (!run || run.cls !== cls) { flush(); run = { cls: cls, pts: [pt(L.x0, L.y0)] }; }
        run.pts.push(pt(L.x1, L.y1));
      });
      flush();
    }
    layer.innerHTML = s;
    ends.innerHTML = endGlyph('A', A.x, A.y) + endGlyph('B', B.x, B.y);
  }

  /* The cause and height of a stretch, as the panel writes them. */
  function causeWords(s) {
    return s.cause === 'sheltered' ? 'sheltered' : s.cause + ', ' + s.h.toFixed(1) + ' m';
  }

  /* The route panel: A, B and Swap; the distance, the trip time and the worst stretch; then the stretches. */
  function renderRoutePanel() {
    var el = $('routePanel'), r = state.route, tr = trip, html = '', notes = [];
    function end(label, name) {
      return '<div class="rt-end"><span class="rt-badge" aria-hidden="true">' + label + '</span><span class="rt-name">' +
        '<span class="vh">' + label + ', </span>' + esc(name) + '</span></div>';
    }
    function row(k, v) { return '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }
    html += '<div class="rt-ends">' + end('A', r.a.name) +
      '<button type="button" data-act="route-swap" aria-label="Swap A and B">Swap</button>' + end('B', r.b.name) + '</div>';
    var p = tr.path;
    if (!p) {
      html += '<p class="probehint">The map has no coastline to search, so the page cannot find a path.</p>';
    } else if (!p.found) {
      html += '<p class="rt-warn"><span class="pip alert" aria-hidden="true"></span><span>The page found no path over open water from A to B. ' +
        'It keeps a path about 200 m off land, so a narrow entrance can close it.</span></p>';
    } else if (!tr.legs.length) {
      html += '<p class="probehint">A and B are at the same point of open water.</p>';
    } else {
      var rows = [row('Distance', tr.nm.toFixed(1) + ' nm')];
      if (!tr.score) {
        rows.push(row('Trip time', 'No boat speed set'));
        notes.push('Set your boat speed under Limits to score this route. <button type="button" data-act="limits">Limits</button>');
      } else {
        var sc = tr.score, w = tr.worst;
        rows.push(row('Trip time', E.fmtDuration(sc.ms) + ' <span class="muted">(' + E.fmtDuration(sc.cruiseMs) + ' at ' + tr.cruise + ' kn)</span>'));
        rows.push(row('Worst stretch', w ? LEVEL_NAMES[w.level] + ', ' + causeWords(w) : 'No forecast'));
      }
      html += '<dl class="rt-totals">' + rows.join('') + '</dl>';
      if (tr.score && tr.score.missingNm > 0) {
        var all = tr.score.missingNm >= tr.nm - 1e-6, problem = fieldProblem(tr.t0);
        html += '<p class="rt-warn"><span class="pip alert" aria-hidden="true"></span><span>Score incomplete. ' +
          (all ? 'The forecast does not cover this route at the leave time.' :
            'The forecast does not cover ' + tr.score.missingNm.toFixed(1) + ' nm of the route, drawn gray.') +
          ' The trip time counts ' + (all ? 'the route' : 'those legs') + ' at cruising speed.</span></p>';
        if (problem) html += problem;
      }
      if (tr.stretches) {
        var listed = tr.stretches.filter(function (s) { return s.nm >= E.COMFORT.stretchNm; });
        html += '<div class="rt-list">' + listed.map(function (s) {
          var named = s.level == null ? '<b>No forecast</b>' : '<b>' + LEVEL_NAMES[s.level] + '</b> <span class="muted">' + causeWords(s) + '</span>';
          return '<div class="rt-row"><i class="lvb lvb' + (s.level == null ? 'x' : s.level) + '" aria-hidden="true"></i><span>' + named + '</span>' +
            '<span class="mono">' + s.nm.toFixed(1) + ' nm</span><span class="mono rt-kn">' + (s.v == null ? '–' : Math.round(s.v) + ' kn') + '</span></div>';
        }).join('') + '</div>';
        if (listed.length < tr.stretches.length) notes.push('Stretches under ' + E.COMFORT.stretchNm + ' nm are left out of this list.');
      }
      [['fromNm', r.a.name, 'starts'], ['toNm', r.b.name, 'ends']].forEach(function (q) {
        if (p[q[0]] >= 0.2) notes.push('The line ' + q[2] + ' ' + p[q[0]].toFixed(1) + ' nm from ' + esc(q[1]) + ', at the nearest open water.');
      });
    }
    notes.push('A line for scoring. Not a route to steer.');
    el.innerHTML = html + notes.map(function (n) { return '<p class="small">' + n + '</p>'; }).join('');
  }

  /* The day display, collapsed: the selected day drawn as a Week row over the time bar's hours, with a line
     at the leave time once it is pinned. A tap or click on the row pins the time under it. */
  function renderDayLane() {
    var el = $('dayLane');
    if (!el || el.hidden) return;
    var R = tbRange(), wx = state.wx[state.spot.id], recs = wx && wx.recs ? wx.recs : null, pin = state.pin;
    var part = weekLane(R.d, R.a, R.b, recs, { stops: windStops(), hTop: tideTop(), now: Date.now(), buttons: false });
    var mark = pin != null && pin >= R.a && pin <= R.b ? '<i class="wk-pin" style="left:' + ((pin - R.a) / (R.b - R.a) * 100).toFixed(2) + '%"></i>' : '';
    el.innerHTML = '<div class="wk-lane" data-d0="' + R.d.d0 + '" data-a="' + R.a + '" data-b="' + R.b + '" role="img" aria-label="' +
      'The day in one row: wind by the hour, windows, major periods and the tide. Select a point on the row to set the leave time.">' + part.html + mark + '</div>';
  }
