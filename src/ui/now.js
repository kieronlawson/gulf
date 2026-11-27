/* The Now screen, for the boat: the iPad's position, the tide, bite, wind and chop there, the next six hours,
   the places to go from there, and the run home. The Day and Now screens share one map, which moves to
   whichever of the two shows. */

  /* ---------- The iPad's position ---------- */

  /* The page asks the iPad for its position only while the Now screen shows and the page is in the foreground. */
  var geo = { watch: null, pos: null, err: null, drawn: null, drawnAt: 0 };

  function startPosition() {
    if (geo.watch != null) return;
    if (!navigator.geolocation) { geo.err = 'none'; return; }
    geo.watch = navigator.geolocation.watchPosition(gotPosition, positionFailed,
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 60000 });
  }
  function stopPosition() {
    if (geo.watch == null) return;
    navigator.geolocation.clearWatch(geo.watch);
    geo.watch = null;
  }
  function retryPosition() { stopPosition(); geo.err = null; startPosition(); renderNowSide(); }

  function gotPosition(p) {
    var c = p.coords, x = mapX(c.longitude), y = mapY(c.latitude);
    geo.pos = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, at: p.timestamp || Date.now(),
      inMap: x >= 0 && y >= 0 && x <= MAP.w && y <= MAP.h };
    geo.err = null;
    /* A small move redraws only the position on the map. The whole screen redraws after a move of a tenth
       of a mile or more, a minute after the last full redraw, or when the screen switches between the
       selected spot and the iPad's position. */
    var last = geo.drawn, moved = !last || last.you !== geo.pos.inMap || Math.hypot(x - last.x, y - last.y) / NM >= 0.1;
    if (moved || Date.now() - geo.drawnAt > MIN) nowPositionChanged();
    else { renderReach(); renderPosLine(); }
  }
  function positionFailed(e) {
    geo.err = e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable';
    nowPositionChanged();
  }

  /* Where the Now screen measures from: the iPad's position, or the selected spot while there is none. */
  function here() {
    var p = geo.pos;
    if (p && p.inMap) return { x: mapX(p.lon), y: mapY(p.lat), you: true, name: 'you', at: 'here' };
    var s = state.spot;
    return { x: mapX(s.lon), y: mapY(s.lat), you: false, name: s.name, at: 'at ' + s.name };
  }

  function nearestSpot(x, y) {
    var best = spots[0], bd = Infinity;
    spots.forEach(function (s) { var d = Math.hypot(mapX(s.lon) - x, mapY(s.lat) - y); if (d < bd) { bd = d; best = s; } });
    return best;
  }

  /* The water that the wind and chop estimates use. A marina or a ramp often sits on land in the simplified
     coastline, so a point on land uses the nearest water cell within 1.5 nautical miles. */
  var SNAP_NM = 1.5;
  function hereWater(h) {
    if (isWater(h.x, h.y)) return { x: h.x, y: h.y, w: nearest(h.x, h.y), off: 0 };
    var best = null, bd = Infinity;
    cells.forEach(function (q) { var d = Math.hypot(q.x - h.x, q.y - h.y); if (d < bd) { bd = d; best = q; } });
    return best && bd / NM <= SNAP_NM ? { x: best.x, y: best.y, w: best.w, off: bd / NM } : null;
  }

  /* ---------- The shared map ---------- */

  /* Each of the two screens keeps its own map view. The Now screen opens around the owner. */
  var views = { day: null, now: { preset: 'spot' } };
  function moveMap(to) {
    views[state.mapScreen] = { cx: view.cx, cy: view.cy, z: view.z, preset: view.preset };
    state.mapScreen = to;
    $(to + 'MapSlot').appendChild($('mapFrame'));
    $(to + 'GoSlot').appendChild($('probe'));
    var v = views[to] || { preset: 'whole' };
    view.preset = v.preset || null;
    if (!v.preset) { view.cx = v.cx; view.cy = v.cy; view.z = v.z; }
    frame.w = 0; frame.h = 0;   /* the next measure applies the view at the new frame's size */
    measureMap();
    renderPlaces(); renderGulf();
  }

  /* The map on the Now screen shows now, or one, two or three hours ahead. */
  function setNowStep(n) {
    state.nowStep = clamp(n, 0, 3);
    renderGulf();
  }
  function markNowSteps() {
    var bs = $('nowSteps').querySelectorAll('button[data-step]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', +bs[i].getAttribute('data-step') === state.nowStep ? 'true' : 'false');
    var t = mapTime();
    $('nowMapTime').textContent = (state.nowStep ? '+' + state.nowStep + ' h, ' : 'Now, ') + E.fmtTime(t);
  }

  /* ---------- The screen ---------- */

  function nowPositionChanged() {
    if (state.screen !== 'now') return;
    renderNowSide();
    if (view.preset === 'spot') setPreset('spot'); else markViewButtons();
    /* An open route starts at the iPad's position, so it follows the move. */
    if (state.routes.now) renderRoute();
    renderReach(); renderProbe();
  }

  /* Everything beside the map. Each part measures from here(). */
  function renderNowSide() {
    if (state.screen !== 'now' || !$('mapSvg')) return;
    var h = here();
    geo.drawn = { x: h.x, y: h.y, you: h.you }; geo.drawnAt = Date.now();
    $('nowMapTitle').textContent = h.you ? 'Gulf around you' : 'Gulf around ' + h.name;
    $('hereTitle').textContent = h.you ? 'Here, now' : h.name + ', now';
    $('next6Title').textContent = 'Next 6 hours ' + h.at;
    nowGoTitle();
    renderPosLine(); renderHere(h); renderNext6(h); renderRunHome(h); markNowSteps();
  }

  /* The fourth part lists the places to go, or, while a route is open, shows the route from here. */
  function nowGoTitle() {
    var h = here(), r = state.routes.now, where = h.you ? 'here' : h.name;
    /* After Swap the route runs to the iPad's position, so the title follows the live end. */
    $('goTitle').textContent = !r ? 'Where to go from ' + where : r.b.live ? 'Route to ' + where : 'Route from ' + where;
    $('nowRouteClose').hidden = !r;
  }

  /* The line that says where the position comes from. */
  function renderPosLine() {
    var el = $('posLine'), p = geo.pos, lamp = 'busy', retry = false, txt;
    var instead = ' This screen shows ' + state.spot.name + ', the selected spot.';
    if (p && p.inMap) {
      /* The accuracy is a radius in meters. A browser that gives none, or zero, gets no claim. */
      var acc = !(p.acc > 0) ? '' : ', within ' + (p.acc >= 1000 ? (p.acc / 1852).toFixed(1) + ' nautical miles' : Math.round(p.acc) + ' m');
      var old = Date.now() - p.at > 2 * MIN;
      lamp = old ? 'busy' : 'on';
      txt = old ? 'Last position from the iPad at ' + E.fmtTime(p.at) + acc + '.' : 'Position from the iPad' + acc + '.';
      retry = old && !!geo.err;
    } else if (p) {
      lamp = 'alert'; txt = 'The iPad is outside the map.' + instead;
    } else if (geo.err === 'denied') {
      lamp = 'alert'; retry = true;
      txt = 'The iPad did not share its position.' + instead + ' To share it, allow location for this page in the iPad’s settings.';
    } else if (geo.err === 'none') {
      lamp = 'alert'; txt = 'This browser gives no position.' + instead;
    } else if (geo.err) {
      lamp = 'alert'; retry = true; txt = 'The iPad has no position fix.' + instead;
    } else {
      txt = 'Waiting for the iPad’s position.' + instead;
    }
    el.innerHTML = '<span class="pip ' + lamp + '" aria-hidden="true"></span><span>' + esc(txt) + '</span>' +
      (retry ? '<button type="button" data-act="retrypos">Try again</button>' : '');
  }

  /* Four cards: the tide at the nearest tide spot, the next solunar period, and the wind and chop. */
  function renderHere(h) {
    var t = Date.now(), sp = nearestSpot(h.x, h.y);
    var cards = [tideCard(h, sp, t), biteCard(sp, t)].concat(windChopCards(h, t));
    $('hereTime').textContent = E.fmtTime(t) + ', ' + E.fmtDay(t);
    $('hereCards').innerHTML = cards.map(function (c) {
      return '<div class="hcard' + (c.alert ? ' alert' : '') + '"><span class="hk">' + esc(c.k) + '</span><b class="hv">' + c.v + '</b><span class="hs">' + esc(c.s) + '</span></div>';
    }).join('');
  }

  function tideCard(h, sp, t) {
    var d = distNm(h, { x: mapX(sp.lon), y: mapY(sp.lat) }), tn = E.tideNow(sp, t);
    var k = 'Tide at ' + sp.name + (d >= 2 ? ', ' + d.toFixed(1) + ' nm away' : '');
    if (tn.h == null || tn.rising == null) return { k: k, v: 'No data', s: 'The page found no turn of the tide near this time.' };
    return { k: k, v: tn.rising ? 'Rising' : 'Falling',
      s: meters(tn.h) + ' now. ' + (tn.next.hi ? 'High' : 'Low') + ' water ' + E.fmtTime(tn.next.t) + ', ' + meters(tn.next.h) + '.' };
  }

  /* The solunar period under way, or the next one. Today's list ends two hours into tomorrow, so the
     search goes on into tomorrow's list. */
  function periodNow(sp, t) {
    var d0 = E.dayStart(t), lists = [E.day(sp, d0).solunar.periods, E.day(sp, E.addDays(d0, 1)).solunar.periods];
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) { var p = lists[i][j]; if (p.end > t) return p; }
    }
    return null;
  }
  function biteCard(sp, t) {
    var p = periodNow(sp, t), kind = p && p.major ? 'Major' : 'Minor';
    if (!p) return { k: 'Bite', v: 'No data', s: 'No solunar period in the next day.' };
    if (p.start <= t) return { k: 'Bite', v: kind + ' now', s: 'Until ' + E.fmtTime(p.end) + '. ' + p.cause + ', ' + p.fish + ' fish.' };
    return { k: 'Bite', v: kind + ' ' + E.fmtTime(p.start), s: 'In ' + E.fmtDuration(p.start - t) + '. ' + p.cause + ', ' + p.fish + ' fish.' };
  }

  function windChopCards(h, t) {
    var wk = 'Wind ' + h.at, ck = 'Chop ' + h.at, none;
    if (!field.wind) none = field.status === 'failed' ? 'The Gulf forecast did not load.' : 'Loading the Gulf forecast.';
    else if (fieldIndex(field.wind, t) == null) none = 'The forecast does not cover this time.';
    if (none) return [{ k: wk, v: 'No data', s: none }, { k: ck, v: 'No data', s: none }];
    var w = hereWater(h);
    if (!w) {
      var land = 'This point is on land in the map, with no water within ' + SNAP_NM + ' nautical miles.';
      return [{ k: wk, v: 'No estimate', s: land }, { k: ck, v: 'No estimate', s: land }];
    }
    if (w.off) {
      var where = ' ' + w.off.toFixed(1) + ' nm ' + compass(bearingFrom(h, w)) + ' of ' + h.name;
      wk = 'Wind' + where; ck = 'Chop' + where;
    }
    var c = condAt(w.x, w.y, w.w, t);
    if (!c) return [{ k: wk, v: 'No data', s: 'No forecast values here.' }, { k: ck, v: 'No data', s: 'No forecast values here.' }];
    var kn = Math.round(c.wind.kn), lim = state.limits.wind, over = kn > lim;
    var flow = !c.flow ? '' : c.flow.kn < 0.05 ? ' Slack.' : ' Flow ' + c.flow.kn.toFixed(1) + ' kn toward ' + compass(c.flow.toward) + '.';
    return [
      { k: wk, v: compass(c.wind.from) + ' ' + kn + ' kn', alert: over,
        s: (ok(c.wind.gust) ? 'Gusts ' + Math.round(c.wind.gust) + ' kn. ' : '') + (over ? 'Over' : 'Within') + ' your ' + lim + ' kn limit.' },
      c.chop.dry ? { k: ck, v: 'Dry', alert: true, s: 'The ground here is dry at this time' + (c.chop.depth <= -0.05 ? ', ' + (-c.chop.depth).toFixed(1) + ' m above the water.' : '.') } :
      c.chop.breaking ? { k: ck, v: 'Breaking likely', alert: true,
        s: 'The waves in open water, ' + c.chop.deep.toFixed(1) + ' m, would be over half the depth of ' + c.chop.depth.toFixed(1) + ' m here.' + flow } :
      { k: ck, v: '<i class="sw sw' + c.chop.level + '" aria-hidden="true"></i>' + CHOP_SHORT[c.chop.level],
        s: (c.chop.h < 0.05 ? 'Waves under 0.1 m.' : 'Waves ' + c.chop.h.toFixed(1) + ' m, ' + c.chop.t.toFixed(1) + ' s.') + flow }
    ];
  }

  /* ---------- The next six hours ----------
     One slot per hour, from the current hour to six hours on. Each slot holds the wind in knots and a chop bar
     for its hour. Behind them: night, the solunar periods, the turns of the tide and last light. */
  function renderNext6(h) {
    var el = $('next6'), W = Math.floor(el.clientWidth);
    if (!W) return;
    var now = Date.now(), h0 = Math.floor(now / HOUR) * HOUR, a = h0 - HOUR / 2, b = h0 + 6.5 * HOUR;
    var sp = nearestSpot(h.x, h.y), d0 = E.dayStart(now), days = [E.day(sp, d0), E.day(sp, E.addDays(d0, 1))];
    var fieldOk = field.wind && fieldIndex(field.wind, now) != null, w = fieldOk ? hereWater(h) : null;
    var H = 136, TOP = 18, BASE = 86, s = [], said = [];
    function x(t) { return (t - a) / (b - a) * W; }
    function n(v) { return v.toFixed(1); }
    function band(t0, t1, cls, y0, y1) {
      if (t0 == null || t1 == null) return;
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t1 > t0) s.push('<rect class="' + cls + '" x="' + n(x(t0)) + '" y="' + y0 + '" width="' + n(x(t1) - x(t0)) + '" height="' + (y1 - y0) + '"/>');
    }
    function anchor(px) { return px < 40 ? ' text-anchor="start"' : px > W - 40 ? ' text-anchor="end"' : ' text-anchor="middle"'; }

    /* The ground: light by day, darker from last light to first light. */
    s.push('<rect class="n6-day" x="0" y="0" width="' + W + '" height="' + BASE + '"/>');
    band(a, days[0].sun.dawn, 'n6-night', 0, BASE);
    band(days[0].sun.dusk, days[1].sun.dawn, 'n6-night', 0, BASE);
    band(days[1].sun.dusk, b, 'n6-night', 0, BASE);

    /* Solunar periods along the top. */
    var seen = {};
    days.forEach(function (d) {
      d.solunar.periods.forEach(function (p) {
        var key = Math.round(p.t / (10 * MIN));
        if (seen[key] || p.end <= a || p.start >= b) return;
        seen[key] = true;
        band(p.start, p.end, p.major ? 'n6-major' : 'n6-minor', 0, TOP);
        var mid = x(clamp((Math.max(p.start, a) + Math.min(p.end, b)) / 2, a, b));
        s.push('<text class="n6-sol" x="' + n(mid) + '" y="13"' + anchor(mid) + '>' + (p.major ? 'Major' : 'Minor') + '</text>');
        said.push((p.major ? 'Major' : 'Minor') + ' period ' + E.fmtTime(p.start) + ' to ' + E.fmtTime(p.end) + '.');
      });
    });

    /* One slot per hour: the wind above a chop bar, and the hour below. */
    var lim = state.limits.wind, hours = [];
    for (var i = 0; i < 7; i++) {
      var th = h0 + i * HOUR, cx = x(th), c = w ? condAt(w.x, w.y, w.w, th) : null, lv = c ? c.chop.level : -1;
      /* An hour when waves likely break, or the ground is dry, gets the tallest bar, in the alert color, with a
         dashed outline. */
      var brk = !!(c && (c.chop.breaking || c.chop.dry)), bh = brk ? 6 + 4 * 9 : lv < 0 ? 3 : 6 + lv * 9, bw = Math.min(26, W / 7 * 0.5);
      s.push('<rect class="s-c' + (brk ? 4 : lv < 0 ? 'x' : lv) + '" x="' + n(cx - bw / 2) + '" y="' + (BASE - bh) + '" width="' + n(bw) + '" height="' + bh + '"/>');
      if (brk) s.push('<rect class="s-break" x="' + n(cx - bw / 2 - 2) + '" y="' + (BASE - bh - 2) + '" width="' + n(bw + 4) + '" height="' + (bh + 2) + '"/>');
      /* The wind: an arrow that points the way the wind blows, as on the map, and the speed in knots. */
      var kn = c ? Math.round(c.wind.kn) : null, cls = 'n6-wind' + (kn != null && kn > lim ? ' over' : '');
      if (c) {
        s.push('<path class="' + cls + '" transform="translate(' + n(cx - 8) + ' ' + (TOP + 12) + ') rotate(' + (c.wind.from + 180).toFixed(0) + ')" d="M0 -5.5L3.6 4.5L0 2.2L-3.6 4.5Z"/>');
        s.push('<text class="' + cls + '" x="' + n(cx - 1) + '" y="' + (TOP + 16) + '">' + kn + '</text>');
      } else s.push('<text class="n6-wind" x="' + n(cx) + '" y="' + (TOP + 16) + '" text-anchor="middle">–</text>');
      s.push('<text class="n6-hour" x="' + n(cx) + '" y="' + (BASE + 14) + '" text-anchor="middle">' + E.fmtTime(th) + '</text>');
      hours.push(E.fmtTime(th) + (c ? ', wind ' + compass(c.wind.from) + ' ' + kn + ' knots, ' + (c.chop.dry ? 'dry ground' : brk ? 'breaking likely' : CHOP_NAMES[lv].toLowerCase()) : ', no forecast'));
    }

    /* Events along the bottom: the turns of the tide, and last light. A label that would run into the one
       before it drops to a second line. */
    var events = E.spotExtremes(sp, a, b).map(function (e) {
      return { t: e.t, cls: 'n6-tide', text: (e.hi ? 'High ' : 'Low ') + E.fmtTime(e.t) };
    });
    days.forEach(function (d) { if (d.sun.dusk != null && d.sun.dusk > a && d.sun.dusk < b) events.push({ t: d.sun.dusk, cls: 'n6-light', text: 'Last light ' + E.fmtTime(d.sun.dusk) }); });
    events.sort(function (p, q) { return p.t - q.t; });
    var end0 = -Infinity;
    events.forEach(function (e) {
      var ex = x(e.t), half = e.text.length * 3.4, start = clamp(ex - half, 0, W - 2 * half), line = start < end0 + 8 ? 1 : 0;
      if (!line) end0 = start + 2 * half;
      s.push('<line class="' + e.cls + '" x1="' + n(ex) + '" y1="' + TOP + '" x2="' + n(ex) + '" y2="' + BASE + '"/>');
      s.push('<text class="' + e.cls + '" x="' + n(start + half) + '" y="' + (BASE + 30 + line * 14) + '" text-anchor="middle">' + e.text + '</text>');
      said.push(e.text.replace(/^High/, 'High water at').replace(/^Low/, 'Low water at').replace(/^Last light/, 'Last light at') + '.');
    });

    /* Now, below the solunar lane so that the lane's label stays clear. */
    s.push('<line class="n6-now" x1="' + n(x(now)) + '" y1="' + TOP + '" x2="' + n(x(now)) + '" y2="' + BASE + '"/>');

    var label = 'Next 6 hours ' + h.at + '. ' + hours.join('. ') + '. ' + said.join(' ') + (w ? '' : ' No wind or chop estimate.');
    el.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' + s.join('') + '</svg>';
  }

  /* ---------- Run home ----------
     The run home is the route over open water from the Now screen's starting point to home, leaving now. The
     leave-by time is last light, less the trip at comfortable speeds, less the owner's margin. */

  /* The trip home leaving at t0: the path's legs at comfortable speeds, and the water between the path's ends
     and the places themselves at the owner's boat speed. A home at a marina, or a position beside one, sits off
     the path, which keeps about 200 m from land, and the boat still covers that water. run is null without a
     path or a boat speed. */
  function homeTrip(h, home, t0) {
    var tr = scoreTrip(h, home, t0), p = tr.path, speed = state.limits.speed;
    if (!p || !p.found || speed == null) return { tr: tr, run: null };
    var off = (p.fromNm || 0) + (p.toNm || 0);
    return { tr: tr, nm: tr.nm + off, run: (tr.score ? tr.score.ms : 0) + off / speed * HOUR };
  }

  /* The path of the run home that the leave-by time measures, leaving now, which the map draws dotted. null
     without a path. */
  var runLine = null;

  function renderRunHome(h) {
    var el = $('runHome'), t = Date.now(), now = Math.floor(t / MIN) * MIN, sp = nearestSpot(h.x, h.y), sun = E.day(sp, E.dayStart(t)).sun, L = state.limits;
    var home = state.home ? { name: 'Home', x: mapX(state.home.lon), y: mapY(state.home.lat) } : null;
    var trip = home ? homeTrip(h, home, now) : null, tr = trip && trip.tr, p = tr && tr.path, found = !!(p && p.found);
    /* The sea at the leave-by time can differ from the sea now. The trip is scored again leaving at the leave-by
       time, up to three times, and the earliest leave-by time stands. Once that time has passed, leaving now is
       the trip. */
    var lv = trip && trip.run != null ? E.leaveBy(sun.dusk, trip.run, L.margin) : null;
    for (var i = 0, cur = lv; cur && cur.at > now && i < 3; i++) {
      var again = homeTrip(h, home, cur.at), next = again.run != null ? E.leaveBy(sun.dusk, again.run, L.margin) : null;
      if (!next) break;
      if (i === 0 || next.at < lv.at) lv = next;
      if (Math.abs(next.at - cur.at) < MIN) break;
      cur = next;
    }
    /* The trip leaving at the leave-by time, for the note under it. With a safe depth, the tide then can close
       every way home that the trip leaving now has; shut is that trip. */
    var later = lv && lv.at > now ? homeTrip(h, home, lv.at) : null;
    var shut = later && later.run == null && later.tr.depth && later.tr.path && !later.tr.path.found ? later.tr : null;
    var rows = [], notes = [], where = h.you ? 'here' : h.name;
    function row(k, v, cls) { return '<div' + (cls ? ' class="' + cls + '"' : '') + '><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }

    if (!home) {
      rows.push(row('Leave by', 'No home set', 'lead'));
      notes.push('To set home, tap the map where the boat comes out of the water, then select Set home.');
    } else if (!p) {
      rows.push(row('Leave by', 'No path', 'lead'));
      notes.push('The map has no coastline to search, so the page cannot find a path home.');
    } else if (!found) {
      rows.push(row('Leave by', 'No path', 'lead'));
      notes.push(tr.depth ? depthBlockWords(tr, h.you ? 'your position' : h.name, 'home') : 'The page found no path over open water from ' + where + ' to home.');
    } else if (!lv) {
      rows.push(row('Leave by', 'Not set', 'lead'));
      notes.push('Set your boat speed and margin under Limits. <button type="button" data-act="limits">Limits</button>');
    } else if (shut) {
      rows.push(row('Leave by', E.fmtTime(lv.at) + '<span>No path then</span>', 'lead alert'));
      notes.push('The leave-by time comes from the trip leaving now. For a trip leaving at ' + E.fmtTime(lv.at) + ': ' + depthBlockWords(shut, h.you ? 'your position' : h.name, 'home'));
    } else {
      var late = lv.at <= t;
      rows.push(row('Leave by', E.fmtTime(lv.at) + '<span>' + (late ? E.fmtDuration(t - lv.at) + ' ago' : 'in ' + E.fmtDuration(lv.at - t)) + '</span>', 'lead' + (late ? ' alert' : '')));
      if (late) notes.push('The leave-by time has passed. Leaving now, at comfortable speeds, you reach home ' + E.fmtDuration(Math.abs(t + trip.run - sun.dusk)) + (t + trip.run > sun.dusk ? ' after' : ' before') + ' last light.');
      else if (later && later.run != null && Math.abs(later.run - trip.run) >= MIN) notes.push('Leaving at ' + E.fmtTime(lv.at) + ', the trip takes ' + E.fmtDuration(later.run) + ' at comfortable speeds, for the sea forecast then. The leave-by time allows for that trip.');
    }
    rows.push(row('Home', !home ? 'Not set' : found ? (trip.nm != null ? trip.nm : tr.nm).toFixed(1) + ' nm ' + compass(bearingFrom(h, home)) : '–'));
    if (home && found) rows.push(row('Trip now', L.speed == null ? 'No speed set' : E.fmtDuration(trip.run)));
    rows.push(row('Sunset', E.fmtTime(sun.set)), row('Last light', E.fmtTime(sun.dusk)));
    if (tr && tr.score) {
      var w = tr.worst;
      rows.push(row('Worst stretch now', w ? '<i class="lvb lvb' + w.level + '" aria-hidden="true"></i>' + E.COMFORT.names[w.level] + ', ' + causeWords(w) : 'No forecast', 'wide'));
      if (tr.score.missingNm > 0) notes.push('The forecast does not cover ' + (tr.score.missingNm >= tr.nm - 1e-6 ? 'the trip' : tr.score.missingNm.toFixed(1) + ' nm of the trip') + ', so the trip time counts that part at your boat speed.');
    }
    /* The water between the path's ends and the places, when it is 0.2 nautical miles or more. */
    if (found) {
      var off = [];
      if (p.fromNm >= 0.2) off.push((h.you ? 'Your position' : h.name) + ' is ' + p.fromNm.toFixed(1) + ' nm');
      if (p.toNm >= 0.2) off.push('Home is ' + p.toNm.toFixed(1) + ' nm');
      if (off.length) notes.push(off.join(', and ') + (tr.depth ? ' from the nearest water that keeps the safe depth.' : ' from the nearest open water on the map.') +
        ' The trip counts that water at your boat speed.');
    }
    var skip = tr ? depthSkipWords(tr) : '';
    if (skip) notes.push(skip);
    el.innerHTML = '<dl class="runrows">' + rows.join('') + '</dl>' + notes.map(function (n) { return '<p class="small">' + n + '</p>'; }).join('');
    runLine = found ? p.points : null;
    renderReach();
  }

  /* ---------- Wiring ---------- */

  function wireNow() {
    $('nowSteps').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-step]') : null;
      if (b) setNowStep(+b.getAttribute('data-step'));
    });
    $('runHome').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act="limits"]') : null;
      if (b) { renderLimits(); openSheet('limits'); }
    });
    $('posLine').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act="retrypos"]') : null;
      if (b) retryPosition();
    });
    var lastW = 0;
    function onResize() {
      var w = Math.floor($('next6').clientWidth);
      if (w && w !== lastW) { lastW = w; if (state.screen === 'now') renderNext6(here()); }
    }
    if (window.ResizeObserver) new ResizeObserver(onResize).observe($('next6'));
    window.addEventListener('resize', onResize);
    /* Safari pauses a page in the background, so the position stops there and starts again on return. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') stopPosition();
      else if (state.screen === 'now') startPosition();
    });
  }
