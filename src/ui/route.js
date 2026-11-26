/* The route from A to B on the Day screen: a path over open water, scored for comfort leg by leg at the time
   the boat reaches each leg. The engine does the arithmetic; docs/route-comfort.md holds the design. */

  /* ---------- The path and its score ---------- */

  /* The last few paths, by the raster cells of their ends, so a new leave time, or a move of the iPad within
     one cell, does not search again. */
  var routePaths = [];
  /* The path between two points in map units, as map units. fromNm and toNm say how far each end moved to
     reach open water, in nautical miles. Null until the map's water raster exists. */
  function routePath(a, b) {
    if (!MASK) return null;
    var key = [a.x, a.y, b.x, b.y].map(function (v) { return Math.round(v * MASK.R); }).join(' ');
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

  /* ---------- Opening and closing ----------
     Each screen with the map keeps its own route, state.routes.day and state.routes.now, or null. A route
     holds its ends A and B, whether the day display shows in full, and the map view from before it opened.
     An end is { name, x, y } in map units, or { live: true }, which follows the iPad's position. trip is the
     shown route as last scored. */
  var trip = null;

  function curRoute() { return state.routes[state.mapScreen] || null; }
  /* Whether the screen that holds the map shows a route now. */
  function routeShown() { return !!curRoute(); }
  /* An end as a place. A live end is the Now screen's starting point: the iPad's position, or the selected
     spot while there is none. */
  function endAt(e) {
    if (!e.live) return e;
    var h = here();
    return { name: h.you ? 'Your position' : h.name, x: h.x, y: h.y };
  }

  /* A is the starting point of Where to go. On the Day screen it is home, or the selected spot until home is
     set. On the Now screen it is the iPad's position, and it follows the boat. */
  function openRoute(b) {
    var old = curRoute(), o = goOrigin();
    state.routes[state.mapScreen] = {
      a: state.mapScreen === 'now' ? { live: true } : { name: o.name === 'home' ? 'Home' : o.name, x: o.x, y: o.y },
      b: b, showDay: false,
      back: old ? old.back : { cx: view.cx, cy: view.cy, z: view.z, preset: view.preset }
    };
    state.probe = null; confirmKey = null;
    $('probe').scrollTop = 0;
    /* On the Day screen the route leaves at a time on the day shown: the pinned time, or now on today. On
       another day with nothing pinned, the start of the bar is pinned. */
    if (state.mapScreen === 'day' && state.pin == null && state.d0 !== E.dayStart(Date.now())) pinTime(tbRange().a);   /* pinTime draws the route */
    else renderRoute();
    setPreset('route');
    renderPlaces(); renderProbeMark(); renderProbe(); renderTimebar(); nowGoTitle();
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
    var r = curRoute();
    if (!r) return;
    state.routes[state.mapScreen] = null; trip = null;
    $('probe').scrollTop = 0;
    renderRoute();
    if (view.preset === 'route') {
      var v = r.back;
      if (v && v.preset && v.preset !== 'route') setPreset(v.preset);
      else if (v) { view.cx = v.cx; view.cy = v.cy; view.z = v.z; view.preset = null; applyView(); }
      else setPreset('whole');
    }
    renderProbe(); renderTimebar(); markViewButtons(); nowGoTitle();
  }
  function swapRoute() {
    var r = curRoute();
    if (!r) return;
    var a = r.a; r.a = r.b; r.b = a;
    renderRoute(); nowGoTitle();
  }
  function toggleDayDisplay() {
    var r = state.routes.day;
    if (!r) return;
    r.showDay = !r.showDay;
    renderRoute();
  }

  /* The map view that fits the path. The path keeps 60 px clear at the top and bottom of the map, where its
     buttons sit, and 24 px at the sides. A short path still shows at least a nautical mile each way. */
  function routeBox() {
    var r = curRoute();
    if (!r) return PRESETS.whole();
    var a = endAt(r.a), b = endAt(r.b), p = routePath(a, b), pts = p && p.found ? p.points : [a, b];
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
    var fw = frame.w || 400, fh = frame.h || 400;
    var w = Math.max(x1 - x0, 2 * NM) * fw / Math.max(fw - 48, fw / 2), h = Math.max(y1 - y0, 2 * NM) * fh / Math.max(fh - 120, fh / 2);
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return fitBox(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  }

  /* ---------- Drawing ---------- */

  /* Everything a route changes: the Day screen's layout, the view buttons, the path on the map, the panels and
     the one-row day. The Day screen's route leaves at the time on the bar; the Now screen's leaves now. */
  function renderRoute() {
    var r = curRoute(), onDay = state.mapScreen === 'day', dr = state.routes.day, compact = !!dr && !dr.showDay;
    $('dayView').classList.toggle('compact', compact);
    $('routeUnit').hidden = !compact;
    $('dayLane').hidden = !compact;
    $('dayNote').hidden = compact;
    $('dayToggle').hidden = !dr;
    $('dayToggle').textContent = compact ? 'Show day display' : 'Show route';
    $('viewRoute').hidden = !r;
    $('viewSpot').hidden = !!r;
    if (r) {
      var a = endAt(r.a), b = endAt(r.b);
      trip = scoreTrip(a, b, onDay ? mapTime() : Math.floor(Date.now() / MIN) * MIN);
      trip.a = a; trip.b = b;
    } else trip = null;
    drawRouteMap();
    /* The Day screen's panel draws only while the map is there, because trip is the shown route. */
    if (onDay && compact) { renderRoutePanel(); renderDayLane(); }
    else if (onDay) { $('routePanel').innerHTML = ''; $('dayLane').innerHTML = ''; }
    if (r && !state.probe && state.moving == null) renderStrip();
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
    var p = trip.path, s = '';
    function pt(x, y) { return x.toFixed(2) + ',' + y.toFixed(2); }
    var A = trip.a, B = trip.b;
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

  /* Why a route has no path to draw. The panel and the strip both say it. */
  function noPathWords(tr) {
    var p = tr.path;
    if (!p) return '<p class="probehint">The map has no coastline to search, so the page cannot find a path.</p>';
    if (!p.found) return '<p class="rt-warn"><span class="pip alert" aria-hidden="true"></span><span>The page found no path over open water from A to B. ' +
      'It keeps a path about 200 m off land, so a narrow entrance can close it.</span></p>';
    return '<p class="probehint">A and B are at the same point of open water.</p>';
  }
  /* Why part or all of a scored route is gray: how much the forecast misses, and why, with Load now after a
     failed load. Empty when every leg has a score. */
  function missingWords(tr) {
    if (!tr.score || !(tr.score.missingNm > 0)) return '';
    var all = tr.score.missingNm >= tr.nm - 1e-6, problem = fieldProblem(tr.t0);
    return '<p class="rt-warn"><span class="pip alert" aria-hidden="true"></span><span>Score incomplete. ' +
      (all ? 'The forecast does not cover this route at the leave time.' :
        'The forecast does not cover ' + tr.score.missingNm.toFixed(1) + ' nm of the route, drawn gray.') +
      ' The trip time counts ' + (all ? 'the route' : 'those legs') + ' at cruising speed.</span></p>' + (problem || '');
  }

  /* The route panel: A, B and Swap; the distance, the trip time and the worst stretch; then the stretches. */
  function renderRoutePanel() { $('routePanel').innerHTML = routePanelHtml(); }
  function routePanelHtml() {
    var r = trip, tr = trip, html = '', notes = [];
    function end(label, name) {
      return '<div class="rt-end"><span class="rt-badge" aria-hidden="true">' + label + '</span><span class="rt-name">' +
        '<span class="vh">' + label + ', </span>' + esc(name) + '</span></div>';
    }
    function row(k, v) { return '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }
    html += '<div class="rt-ends">' + end('A', r.a.name) +
      '<button type="button" data-act="route-swap" aria-label="Swap A and B">Swap</button>' + end('B', r.b.name) + '</div>';
    var p = tr.path;
    if (!p || !p.found || !tr.legs.length) {
      html += noPathWords(tr);
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
      html += missingWords(tr);
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
    return html + notes.map(function (n) { return '<p class="small">' + n + '</p>'; }).join('');
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

  /* ---------- The strip under the map ----------
     The route from A to B by distance: the level of each leg, the cause under each stretch wider than 70 px,
     the comfortable speed as a line with its value at each end, and a tick every 2 nautical miles. It takes
     the place of Where to go while a route is open, until a tap on the map opens a reading. */

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  var stripW = 0;
  /* On the Now screen the route panel comes first and the strip under it, in the place of Where to go, whose
     box there is short. */
  function renderStrip() {
    var el = $('probe');
    if (!trip) { el.innerHTML = ''; return; }
    var W = Math.floor(el.clientWidth);
    stripW = W;
    /* On the Day screen the strip says why it draws no route or no score. Once the day display shows again, the
       panel is hidden, so the strip also says why legs are gray. On the Now screen the panel above it says both. */
    var r = state.routes.day, panelHidden = !!(r && r.showDay);
    el.innerHTML = state.mapScreen === 'now' ? '<div class="routepanel">' + routePanelHtml() + '</div>' + stripHtml(W, false, false) : stripHtml(W, true, panelHidden);
  }
  /* The strip's markup at width W. With hints, it says why it draws no route or no score; with gaps, why legs are gray. */
  function stripHtml(W, hints, gaps) {
    var tr = trip;
    var head = '<div class="sthead"><b>From A to B, leaving ' + (state.mapScreen === 'now' ? 'now' : E.fmtTime(tr.t0) + (E.dayStart(tr.t0) !== E.dayStart(Date.now()) ? ', ' + E.fmtDay(tr.t0) : '')) + '</b>';
    var levels = '';
    if (tr.score) {
      var seen = {};
      tr.score.legs.forEach(function (L) { seen[L.level == null ? 'x' : L.level] = true; });
      LEVEL_NAMES.forEach(function (n, i) { levels += '<span><i class="lvb lvb' + i + '" aria-hidden="true"></i>' + n + '</span>'; });
      if (seen.x) levels += '<span><i class="lvb lvbx" aria-hidden="true"></i>No forecast</span>';
    }
    head += '<span class="stlegend">' + levels + '</span></div>';
    var p = tr.path;
    if (!p || !p.found || !tr.legs.length) return head + (hints ? noPathWords(tr) : '');
    if (!tr.score) return head + (hints ? '<p class="probehint">Set your boat speed under Limits to score this route. <button type="button" data-act="limits">Limits</button></p>' : '');
    if (!W) return head;

    var legs = tr.score.legs, total = tr.nm, x0 = 56, x1 = W - 4, s = [], n = function (v) { return v.toFixed(1); };
    function X(nm) { return x0 + nm / total * (x1 - x0); }
    var BAR = 4, BAR_H = 20, CAUSE = BAR + BAR_H + 13, SP_TOP = 58, SP_BOT = 78, AXIS = 88, H = 106;
    var vMin = Math.min(E.COMFORT.minKn, tr.cruise), vMax = tr.cruise;
    function Y(v) { return vMax > vMin ? SP_BOT - (v - vMin) / (vMax - vMin) * (SP_BOT - SP_TOP) : SP_TOP; }

    s.push('<text class="st-k" x="0" y="' + (BAR + 14) + '">Comfort</text><text class="st-k" x="0" y="' + ((SP_TOP + SP_BOT) / 2 + 4) + '">Speed</text>');
    /* One rectangle per stretch, which holds the legs of one level, a hair wider so no seam shows between neighbors. */
    tr.stretches.forEach(function (st) {
      var a = X(st.at), b = X(st.at + st.nm);
      s.push('<rect class="lvf' + (st.level == null ? 'x' : st.level) + '" x="' + n(a) + '" y="' + BAR + '" width="' + n(b - a + 0.4) + '" height="' + BAR_H + '"/>');
    });
    /* The cause under each stretch wider than 70 px. A label too long for its stretch drops its height. */
    tr.stretches.forEach(function (st) {
      var a = X(st.at), b = X(st.at + st.nm);
      if (b - a <= 70) return;
      var text = st.level == null ? 'No forecast' : cap(causeWords(st));
      if (text.length * 6 > b - a - 4 && st.level != null) text = cap(st.cause);
      s.push('<text class="st-cause" x="' + n(a + 2) + '" y="' + CAUSE + '">' + esc(text) + '</text>');
    });
    /* The comfortable speed: a line through each leg's middle, held level to the ends, with a gap where a leg
       has no score. */
    var runs = [], run = null;
    legs.forEach(function (L) {
      if (L.v == null) { run = null; return; }
      if (!run) { run = []; runs.push(run); run.push(n(X(L.at)) + ',' + n(Y(L.v))); }
      run.push(n(X(L.at + L.nm / 2)) + ',' + n(Y(L.v)));
      run.last = n(X(L.at + L.nm)) + ',' + n(Y(L.v));
    });
    runs.forEach(function (pts) { s.push('<polyline class="st-speed" points="' + pts.concat([pts.last]).join(' ') + '"/>'); });
    var first = legs[0], last = legs[legs.length - 1];
    if (first.v != null) s.push('<text class="st-v" x="' + n(x0) + '" y="' + n(Y(first.v) - 4) + '">' + Math.round(first.v) + ' kn</text>');
    if (last.v != null) s.push('<text class="st-v" x="' + n(x1) + '" y="' + n(Y(last.v) - 4) + '" text-anchor="end">' + Math.round(last.v) + ' kn</text>');
    /* The axis: a tick every 2 nautical miles, labeled as often as the width allows. */
    s.push('<line class="st-axis" x1="' + n(x0) + '" y1="' + AXIS + '" x2="' + n(x1) + '" y2="' + AXIS + '"/>');
    var per = (x1 - x0) / total, every = [2, 4, 10, 20, 50].filter(function (k) { return k * per >= 34; })[0] || 50;
    for (var nm = 0; nm <= total + 1e-9; nm += 2) {
      var tx = X(nm);
      s.push('<line class="st-axis" x1="' + n(tx) + '" y1="' + AXIS + '" x2="' + n(tx) + '" y2="' + (AXIS + 4) + '"/>');
      if (nm % every === 0 && x1 - tx > 14) s.push('<text class="st-ax" x="' + n(tx) + '" y="' + (AXIS + 15) + '"' + (nm ? ' text-anchor="middle"' : '') + '>' + (nm ? nm : '0 nm') + '</text>');
    }
    var said = tr.stretches.map(function (st) {
      return (st.level == null ? 'no forecast' : LEVEL_NAMES[st.level] + ', ' + causeWords(st)) + ' for ' + st.nm.toFixed(1) + ' nautical miles';
    }).join('; ');
    var label = 'Comfort from A to B by distance: ' + said + '.' + (first.v != null && last.v != null ? ' Comfortable speed ' + Math.round(first.v) + ' knots at A and ' + Math.round(last.v) + ' knots at B.' : '');
    return head + '<svg class="rstrip" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' + s.join('') + '</svg>' +
      (gaps ? missingWords(tr) : '');
  }
  /* The strip is drawn to its box's width, so it draws again when the box changes width. */
  function fitStrip() {
    if (!routeShown() || state.probe || state.moving != null) return;
    if (Math.floor($('probe').clientWidth) !== stripW) renderStrip();
  }
