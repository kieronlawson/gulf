/* Where to go: the owner's marks and suggested water within reach, lowest chop first, at the map's time.
   A suggestion is the calmest water within reach of the starting point. It makes no claim about fish. */

  /* ---------- Where to go ---------- */

  var REACH_NM = 10, SUGGEST = 3, SPACING_NM = 3, NAMED_NM = 3;
  var suggestions = [];

  /* The starting point. On the Day screen: home, or the selected tide spot until home is set.
     On the Now screen: the iPad's position, or the selected tide spot while there is none. */
  function goOrigin() {
    if (state.mapScreen === 'now') return here();
    if (state.home) return { x: mapX(state.home.lon), y: mapY(state.home.lat), name: 'home' };
    return { x: mapX(state.spot.lon), y: mapY(state.spot.lat), name: state.spot.name };
  }
  function distNm(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) / NM; }
  function bearingFrom(a, b) { return (Math.atan2(b.x - a.x, a.y - b.y) / RAD + 360) % 360; }
  function nearSpotName(x, y) {
    var best = null, bd = Infinity;
    spots.forEach(function (s) { var d = Math.hypot(mapX(s.lon) - x, mapY(s.lat) - y); if (d < bd) { bd = d; best = s; } });
    return best && bd / NM <= NAMED_NM ? best.name : null;
  }

  /* The calmest chop cells within reach, kept apart from each other and from the marks. */
  function findSuggestions(origin, t) {
    var cand = [], out = [];
    cells.forEach(function (q) {
      var d = distNm(q, origin);
      if (d > REACH_NM) return;
      var c = condAt(q.x, q.y, q.w, t);
      if (c) cand.push({ x: q.x, y: q.y, w: q.w, c: c, d: d });
    });
    cand.sort(function (a, b) { return a.c.chop.h - b.c.chop.h || a.d - b.d; });
    var marksXY = state.marks.map(function (m) { return { x: mapX(m.lon), y: mapY(m.lat) }; });
    for (var i = 0; i < cand.length && out.length < SUGGEST; i++) {
      var q = cand[i];
      if (out.some(function (o) { return distNm(o, q) < SPACING_NM; })) continue;
      if (marksXY.some(function (m) { return distNm(m, q) < 1; })) continue;
      out.push(q);
    }
    return out.map(function (q, i) {
      var L = 'ABC'.charAt(i);
      return { key: 's' + L, label: L, x: q.x, y: q.y, w: q.w, c: q.c, near: nearSpotName(q.x, q.y) };
    });
  }

  /* The suggestions for the starting point, the map's time and the forecast, with the reach ring around
     the same starting point. The reading under the map calls this each time it redraws, so the discs and
     the ring always move together, and match the map's time. */
  /* While a route is open, the suggestions leave the map and the list: their letters would read as the
     route's A and B. */
  function updateSuggestions() {
    var t = mapTime();
    suggestions = fieldProblem(t) || routeShown() ? [] : findSuggestions(goOrigin(), t);
    renderSuggestions(); renderReach();
  }

  var CHOP_SHORT = ['Smooth', 'Light', 'Moderate', 'Rough', 'Very rough'];
  function chopText(c) { return CHOP_NAMES[c.chop.level] + (c.chop.h >= 0.05 ? ', ' + c.chop.h.toFixed(1) + ' m' : ''); }

  /* The list under the map, shown while no point is selected. */
  function renderGo() {
    var el = $('probe'), t = mapTime(), o = goOrigin(), problem = fieldProblem(t);
    var rows = state.marks.map(function (m) {
      var x = mapX(m.lon), y = mapY(m.lat), water = isWater(x, y);
      return { key: String(m.n), badge: m.n, kind: 'mark', name: m.name || 'Mark ' + m.n, x: x, y: y, c: water && !problem ? condAt(x, y, nearest(x, y), t) : null, water: water };
    });
    suggestions.forEach(function (s) {
      rows.push({ key: s.key, badge: s.label, kind: 'sugg', name: 'Calmest water' + (s.near ? ' near ' + s.near : ''), x: s.x, y: s.y, c: s.c, water: true });
    });
    rows.sort(function (a, b) { return (a.c ? a.c.chop.h : 99) - (b.c ? b.c.chop.h : 99); });

    /* The Now screen's heading already says where to go from, so its line gives only the time. */
    var title = state.mapScreen === 'now' ? (state.nowStep ? 'In ' + state.nowStep + ' h, at ' + E.fmtTime(t) : 'Now') :
      'Where to go ' + (state.pin != null ? 'at ' + E.fmtTime(t) + ', ' + E.fmtDay(t) : 'now');
    var html = '<div class="gohead"><b>' + title + '</b><span>From ' + esc(o.name) + ', lowest chop first</span></div>';
    if (!rows.length) {
      html += problem || '';
      html += routeShown() ? '<p class="probehint">Save marks from the map to list them here. Close the route to see the calmest water within ' + REACH_NM + ' nautical miles.</p>' :
        '<p class="probehint">Save marks from the map, and the calmest water within ' + REACH_NM + ' nautical miles shows here. Tap the map to read any point.</p>';
      el.innerHTML = html;
      return;
    }
    html += '<div class="golist">' + rows.map(function (r) {
      var d = distNm(o, r), dir = compass(bearingFrom(o, r));
      var wind = r.c ? compass(r.c.wind.from) + ' ' + Math.round(r.c.wind.kn) + ' kn' : '';
      var chopCell = r.c ? '<b><i class="sw sw' + r.c.chop.level + '"></i>' + CHOP_SHORT[r.c.chop.level] + '</b><span>' + (r.c.chop.h >= 0.05 ? r.c.chop.h.toFixed(1) + ' m' : 'under 0.1 m') + '</span>' :
        '<b>' + (r.water ? 'No forecast' : 'No estimate') + '</b>';
      var label = r.name + ', ' + d.toFixed(1) + ' nautical miles ' + dir + ' of ' + o.name + (r.c ? ', wind ' + wind + ', ' + chopText(r.c) : '');
      /* On the Day screen each row has a Route button: a route from the starting point to the place. */
      var route = state.mapScreen === 'day' ? '<button type="button" class="goroute" data-route="' + r.key + '" aria-label="' + esc('Route from ' + o.name + ' to ' + r.name) + '">Route</button>' : '';
      return '<div class="goitem"><button type="button" class="gorow" data-go="' + r.key + '" aria-label="' + esc(label) + '">' +
        '<span class="badge ' + r.kind + '">' + r.badge + '</span>' +
        '<span class="gomid"><b>' + esc(r.name) + '</b><span>' + d.toFixed(1) + ' nm ' + dir + (wind ? ', wind ' + wind : '') + '</span></span>' +
        '<span class="gochop">' + chopCell + '</span></button>' + route + '</div>';
    }).join('') + '</div>';
    if (problem) html += problem;
    html += routeShown() ? '<p class="small">Close the route to see the calmest water within ' + REACH_NM + ' nautical miles. Tap the map to read any point.</p>' :
      '<p class="small">Suggestions are the calmest water within ' + REACH_NM + ' nautical miles. They say nothing about fish. Tap the map to read any point.</p>';
    el.innerHTML = html;
  }

  /* A row selects its place: a mark opens as a saved place, a suggestion as a probe that can be saved. */
  function openGo(key) {
    if (key.charAt(0) === 's') {
      var s = suggestions.filter(function (q) { return q.key === key; })[0];
      if (!s) return;
      confirmKey = null;
      probeAt(s.x, s.y, null);
      renderPlaces(); renderProbeMark(); renderProbe();
    } else selectPlace(key);
  }
