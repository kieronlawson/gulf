/* The Week screen: the next seven days from first light to last light, with the wind by the hour, the windows
   inside the owner's limits, the major solunar periods and the tide. The best windows are ranked beside them. */

  /* ---------- Week ---------- */

  var WEEK_DAYS = 7;
  var weekStart = null;   /* the first day of the rows on screen */

  /* Whether an hour's forecast counts between first light and last light. As in Engine.windows, each hourly
     value stands for the half hour either side of its time. */
  function inLight(d, t) { return d.sun.dawn != null && t + 30 * MIN > d.sun.dawn && t - 30 * MIN < d.sun.dusk; }

  /* How much of a day's light the forecast covers: 'all', 'part' or 'none'. */
  function coverage(d, recs) {
    var lit = 0, missing = 0;
    for (var t = d.d0; t < d.d1; t += HOUR) {
      if (!inLight(d, t)) continue;
      lit++;
      if (!recs[t]) missing++;
    }
    return !missing ? 'all' : missing === lit ? 'none' : 'part';
  }
  function joinWords(list) {
    return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }
  /* A sentence or two on the days the forecast misses. Empty when it covers the whole week. */
  function gapWords(gaps) {
    var none = gaps.filter(function (g) { return g.cover === 'none'; }).map(function (g) { return g.label; });
    var part = gaps.filter(function (g) { return g.cover === 'part'; }).map(function (g) { return g.label; });
    var s = [];
    if (none.length) s.push('The forecast does not cover ' + joinWords(none) + '.');
    if (part.length) s.push('The forecast covers only part of ' + joinWords(part) + '.');
    return s.join(' ');
  }

  /* The instant of a local hour on the day that starts at d0. A clock change earlier that day moves it by an hour. */
  function atLocalHour(d0, h) {
    var t = d0 + h * HOUR;
    return t - (E.parts(t).H - h) * HOUR;
  }

  /* The seven days, and one local hour range shared by every row: from the hour before the earliest first light
     to the hour after the latest last light. */
  function weekModel() {
    var today = E.dayStart(Date.now()), days = [], d0 = today, lo = 24, hi = 0;
    for (var i = 0; i < WEEK_DAYS; i++) {
      var d = E.day(state.spot, d0);
      days.push(d);
      if (d.sun.dawn != null) { var a = E.parts(d.sun.dawn); lo = Math.min(lo, a.H); }
      if (d.sun.dusk != null) { var b = E.parts(d.sun.dusk); hi = Math.max(hi, b.H + (b.M > 0 ? 1 : 0)); }
      d0 = E.addDays(d0, 1);
    }
    return { today: today, days: days, h0: Math.max(0, lo - 1), h1: Math.min(24, hi + 1) };
  }

  /* Each hourly value stands for the half hour either side of its time, as in Engine.windows. */
  function hourSpans(d, recs, test) {
    var out = [], half = HOUR / 2;
    for (var t = d.d0; t < d.d1; t += HOUR) {
      if (!test(recs[t])) continue;
      var last = out[out.length - 1];
      if (last && last.end === t - half) last.end = t + half;
      else out.push({ start: t - half, end: t + half });
    }
    return out;
  }

  /* The window that overlaps a major period the most, and the high and low waters inside a window. */
  function majorIn(d, w) {
    var best = null, most = 0;
    d.solunar.periods.forEach(function (p) {
      var o = Math.min(p.end, w.end) - Math.max(p.start, w.start);
      if (p.major && o > most) { most = o; best = p; }
    });
    return best;
  }
  function turnsIn(d, w) {
    return d.extremes.filter(function (e) { return e.t >= w.start && e.t <= w.end; });
  }

  /* A bar is 46% of an hour wide, centered on its hour. */
  var BAR = 0.46 * HOUR;

  /* The six colors of the wind ramp, from the theme's tokens in style.css. */
  function windStops() {
    var cs = getComputedStyle(document.documentElement), out = [];
    for (var k = 0; k < 6; k++) out.push(cs.getPropertyValue('--wind-' + k).trim());
    return out;
  }

  /* The wind between first light and last light: direction, lowest to highest speed, and top gust. */
  function windWords(d, recs) {
    var su = recs ? daySummary(d, function (t) { return inLight(d, t); }, 1) : null;
    if (!su) return 'No forecast';
    var lo = Math.round(su.lo), hi = Math.round(su.hi);
    return compass(su.dir) + ' ' + (lo === hi ? hi : lo + '–' + hi) + ' kn' + (isFinite(su.gust) ? ', gusts ' + Math.round(su.gust) : '');
  }

  /* One day drawn as a Week row, from a to b. From its top: the major periods with their rating lamps, the
     wind, the windows' brackets and the tide. o holds the wind colors (stops), the top of the tide scale (hTop),
     now, and whether to add the window buttons. Returns the lane's markup, the day's windows, whether any hour
     between first light and last light has no forecast, and how much of the day's light the forecast covers. */
  function weekLane(d, a, b, recs, o) {
    var L = state.limits, w = b - a, sun = d.sun, lane = '', wins = [], holes = [], cover = null;
    function X(t) { return clamp((t - a) / w * 100, 0, 100); }
    function box(cls, s, e) {
      var x0 = X(s), x1 = X(e);
      if (x1 - x0 <= 0) return '';
      return '<i class="' + cls + '" style="left:' + x0.toFixed(2) + '%;width:' + (x1 - x0).toFixed(2) + '%"></i>';
    }
    /* Left and width as shares of the lane, without clamping: the lane clips what falls outside it. */
    function place(s, e) { return 'left:' + ((s - a) / w * 100).toFixed(2) + '%;width:' + ((e - s) / w * 100).toFixed(2) + '%'; }
    /* A speed as a share of the lane's height, in whole knots: calm at the foot of the wind field, twice the
       limit at its top. The field is half the lane tall, and faster wind stops at its top. */
    function windHeight(kn) { return Math.min(1, Math.round(kn) / (2 * L.wind)) * 50; }
    var lit = function (t) { return sun.dawn != null && t >= sun.dawn && t <= sun.dusk; };
    /* Ground: darker before first light and after last light. */
    if (sun.dawn != null) lane += box('wk-night', a, sun.dawn);
    if (sun.dusk != null) lane += box('wk-night', sun.dusk, b);

    if (recs) {
      wins = E.dayWindows(state.spot, d.d0, recs, L);
      /* The windows, as a wash behind the wind. */
      wins.forEach(function (win) { lane += box('wk-wash', win.start, win.end); });
      /* Hours with no forecast matter only between first light and last light. */
      holes = hourSpans(d, recs, function (r) { return !r; }).map(function (s) {
        return { start: Math.max(s.start, sun.dawn), end: Math.min(s.end, sun.dusk) };
      }).filter(function (s) { return s.end > s.start; });
      holes.forEach(function (s) { lane += box('wk-nofc grille', s.start, s.end); });
      /* One bar for each forecast hour, with a tick at the gust. Speeds are in whole knots, as the
         window rule compares them, so an hour inside a window never rises over the limit line. */
      for (var t = d.d0; t < d.d1; t += HOUR) {
        var r = recs[t];
        if (!r || t + BAR / 2 < a || t - BAR / 2 > b) continue;
        var dim = lit(t) ? '' : ' dim', where = place(t - BAR / 2, t + BAR / 2);
        lane += '<i class="wk-bar' + dim + '" style="' + where + ';height:' + windHeight(r.wind).toFixed(2) + '%;background:' + E.windColor(r.wind, L.wind, o.stops) + '"></i>';
        if (ok(r.gust)) lane += '<i class="wk-gust' + dim + '" style="' + where + ';bottom:' + (27 + windHeight(r.gust)).toFixed(2) + '%"></i>';
      }
      lane += '<i class="wk-limit"></i><span class="wk-limtext" aria-hidden="true">' + L.wind + '</span>';
      cover = coverage(d, recs);
    }
    /* Major periods: a bracket with the rating lamps above it. */
    d.solunar.periods.forEach(function (p) {
      if (!p.major || p.end <= a || p.start >= b) return;
      if (Math.min(p.end, b) - Math.max(p.start, a) < 15 * MIN) return;   /* too little of it shows to read */
      var lamps = '';
      for (var k = 0; k < 4; k++) lamps += '<b' + (k < p.fish ? ' class="on"' : '') + '></b>';
      var x0 = X(p.start), x1 = X(p.end), at = 'left:' + x0.toFixed(2) + '%;width:' + (x1 - x0).toFixed(2) + '%';
      lane += '<i class="wk-maj" style="' + at + '"></i><i class="wk-lamps" style="' + at + '">' + lamps + '</i>';
    });
    /* The windows' brackets, under the wind field. */
    wins.forEach(function (win) { lane += box('wk-wb', win.start, win.end); });
    /* The tide, on one scale for all rows. */
    var c = E.spotCurve(state.spot, a, b, 15 * MIN), pts = c.map(function (q) {
      return X(q.t).toFixed(2) + ',' + (100 - Math.max(0, q.h) / o.hTop * 100).toFixed(2);
    }).join(' ');
    lane += '<svg class="wk-tide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '"/></svg>';
    /* The windows: buttons that open the day with the window's start pinned. Each draws only its focus ring. */
    if (o.buttons) {
      wins.forEach(function (win) {
        var x0 = X(win.start), x1 = X(win.end);
        lane += '<button type="button" class="wk-win" data-d0="' + d.d0 + '" data-t="' + win.start + '" data-end="' + win.end + '" style="left:' + x0.toFixed(2) + '%;width:' + (x1 - x0).toFixed(2) + '%"' +
          ' aria-label="Window ' + E.fmtDay(d.d0 + 12 * HOUR) + ', ' + E.fmtTime(win.start) + ' to ' + E.fmtTime(win.end) + '. Open this day."></button>';
      });
    }
    if (o.now >= a && o.now <= b) lane += '<i class="wk-now" style="left:' + X(o.now).toFixed(2) + '%"></i>';
    if (!recs) lane += '<span class="wk-msg">No forecast</span>';
    return { html: lane, wins: wins, holes: holes.length > 0, cover: cover };
  }

  /* The top of the tide scale for the selected spot, shared by every row: highest astronomical tide, in half meters. */
  function tideTop() {
    var hat = (DATA.auckland.hat - DATA.auckland.msl) * state.spot.ratio + state.spot.msl;
    return Math.max(1, Math.ceil(hat * 2) / 2);
  }

  /* Drawn only while the Week screen is shown. setScreen draws it when the owner switches to it. */
  function renderWeek() {
    if (state.screen !== 'week') return;
    var M = weekModel(), wx = state.wx[state.spot.id], recs = wx && wx.recs ? wx.recs : null, L = state.limits;
    var now = Date.now(), hTop = tideTop(), anyMissing = false, all = [], gaps = [];
    var stops = windStops();
    weekStart = M.today;

    $('wkLimWind').textContent = 'Wind up to ' + L.wind + ' kn';
    $('wkLimHours').textContent = hoursWords(L.hours) + ' or longer';

    /* Hour labels, every two hours, as a share of the row. */
    var span = M.h1 - M.h0, ax = '';
    for (var h = M.h0 + (M.h0 % 2); h <= M.h1; h += 2) {
      ax += '<span style="left:' + ((h - M.h0) / span * 100).toFixed(2) + '%">' + E.pad2(h % 24) + '</span>';
    }
    $('wkAxis').innerHTML = ax;

    var rows = M.days.map(function (d, i) {
      var a = atLocalHour(d.d0, M.h0), b = atLocalHour(d.d0, M.h1);
      var part = weekLane(d, a, b, recs, { stops: stops, hTop: hTop, now: now, buttons: true });
      if (part.holes) anyMissing = true;
      if (part.cover && part.cover !== 'all') gaps.push({ label: i === 0 ? 'today' : E.fmtDay(d.d0 + 12 * HOUR), cover: part.cover });
      part.wins.forEach(function (win) { all.push({ d: d, w: win }); });
      var highs = d.extremes.filter(function (e) { return e.hi; }).map(function (e) { return E.fmtTime(e.t); });
      var sel = d.d0 === state.d0;
      return '<div class="wk-row">' +
        '<button type="button" class="wk-day" data-d0="' + d.d0 + '"' + (sel ? ' aria-current="date"' : '') + '>' +
          '<span class="wk-head"><span class="wk-name"><span class="pip' + (sel ? ' on' : '') + '" aria-hidden="true"></span>' + (i === 0 ? 'Today' : E.fmtDay(d.d0 + 12 * HOUR)) + '</span>' +
            pips(d.solunar.level, 'Solunar rating ' + d.solunar.label.toLowerCase()) + '</span>' +
          '<span class="wk-wind">' + windWords(d, recs) + '</span>' +
          '<span class="wk-high">High ' + (highs.join(', ') || '–') + '</span>' +
        '</button>' +
        '<div class="wk-lane" data-d0="' + d.d0 + '" data-a="' + a + '" data-b="' + b + '">' + part.html + '</div>' +
      '</div>';
    });
    var keep = focusKey();
    $('wkRows').innerHTML = rows.join('');

    /* The ramp in 18 steps of a tenth of the limit. The tenth step is yellow, at the limit, and the
       eleventh amber, just over it. */
    var ramp = '';
    for (var k = 0; k < 18; k++) ramp += '<b style="background:' + E.rampColor(k < 10 ? (k + 1) / 10 : k / 10 + 0.001, stops) + '"></b>';
    $('wkLegend').innerHTML =
      '<span><span class="k">0</span><i class="lg-ramp" aria-hidden="true">' + ramp + '</i><span class="k">' + Math.round(1.8 * L.wind) + ' kn</span>' +
        'Wind. Yellow ends at your limit, ' + L.wind + ' kn.</span>' +
      '<span><i class="lg-gust"></i>Gusts</span>' +
      '<span><i class="lg-win"></i>Window: wind up to ' + L.wind + ' kn for ' + hoursWords(L.hours) + ' or longer</span>' +
      '<span><i class="lg-major"></i>Major period, rated in fish</span>' +
      '<span><i class="lg-tide"></i>Tide</span>' +
      (anyMissing ? '<span><i class="lg-nofc grille"></i>No forecast</span>' : '') +
      '<span><i class="lg-now"></i>Now</span>';

    renderBest(all, recs, gaps);
    refocus(keep);
  }

  /* The time under a pointer on a lane, rounded to 5 minutes and kept inside the lane's day. The lane's
     drawing fills the area inside its border, so the share is measured there. */
  function laneTimeAt(lane, clientX) {
    var left = lane.getBoundingClientRect().left + lane.clientLeft;
    return E.laneTime((clientX - left) / lane.clientWidth, +lane.getAttribute('data-a'), +lane.getAttribute('data-b'), +lane.getAttribute('data-d0'));
  }

  /* With a mouse, a hairline follows the pointer over a lane, with a flag that gives the time a click would pin.
     Without a lane, both go. */
  var hoverLine = null, hoverFlag = null;
  function weekHover(lane, clientX) {
    if (!lane) {
      if (hoverLine && hoverLine.parentNode) hoverLine.parentNode.removeChild(hoverLine);
      if (hoverFlag && hoverFlag.parentNode) hoverFlag.parentNode.removeChild(hoverFlag);
      return;
    }
    if (!hoverLine) {
      hoverLine = document.createElement('i'); hoverLine.className = 'wk-hover';
      hoverFlag = document.createElement('span'); hoverFlag.className = 'wk-flag'; hoverFlag.setAttribute('aria-hidden', 'true');
    }
    if (hoverLine.parentNode !== lane) { lane.appendChild(hoverLine); lane.appendChild(hoverFlag); }
    var x = clientX - lane.getBoundingClientRect().left - lane.clientLeft;
    hoverLine.style.left = x.toFixed(1) + 'px';
    hoverFlag.textContent = E.fmtTime(laneTimeAt(lane, clientX));
    hoverFlag.style.left = x.toFixed(1) + 'px';
    hoverFlag.classList.toggle('flip', x > lane.clientWidth - 48);   /* near the right edge, the flag sits left of the line */
  }

  /* A redraw replaces the buttons. These two put focus back on the button that had it, so a keyboard or
     VoiceOver user keeps their place. */
  function focusKey() {
    var f = document.activeElement;
    if (!f || !f.closest || !f.closest('#wkRows, #wkBest')) return null;
    return '.' + f.className.split(' ')[0] + '[data-d0="' + f.getAttribute('data-d0') + '"]' +
      (f.getAttribute('data-t') ? '[data-t="' + f.getAttribute('data-t') + '"]' : '');
  }
  function refocus(key) {
    var g = key ? document.querySelector('#screen-week ' + key) : null;
    if (g) g.focus();
  }

  /* Once a minute: move the now line. The rows are drawn again only when a new day starts. */
  function tickWeek() {
    if (state.screen !== 'week') return;
    if (E.dayStart(Date.now()) !== weekStart) { renderWeek(); return; }
    var now = Date.now(), lanes = $('wkRows').querySelectorAll('.wk-lane');
    for (var i = 0; i < lanes.length; i++) {
      var a = +lanes[i].getAttribute('data-a'), b = +lanes[i].getAttribute('data-b'), line = lanes[i].querySelector('.wk-now');
      if (now < a || now > b) { if (line) line.parentNode.removeChild(line); continue; }
      if (!line) { line = document.createElement('i'); line.className = 'wk-now'; lanes[i].appendChild(line); }
      line.style.left = ((now - a) / (b - a) * 100).toFixed(2) + '%';
    }
  }

  /* ---------- Best windows ---------- */

  function renderBest(all, recs, gaps) {
    var el = $('wkBest'), L = state.limits, gap = gapWords(gaps);
    if (!recs) {
      el.innerHTML = '<p class="hint">Windows need the forecast. It is not loaded.</p>';
      return;
    }
    if (!all.length) {
      var whole = gaps.length === WEEK_DAYS && gaps.every(function (g) { return g.cover === 'none'; });
      el.innerHTML = '<p class="hint">' + (whole ? 'The stored forecast does not cover the next 7 days. Sync loads a new one.' :
        'No window ' + (gaps.length ? 'on the days the forecast covers' : 'in the next 7 days') + '. The wind does not stay at or under ' +
        L.wind + ' kn for ' + hoursWords(L.hours) + ' between first light and last light.' + (gap ? ' ' + gap : '')) + '</p>';
      return;
    }
    var ranked = E.rankWindows(all.map(function (x) { var w = x.w; return { start: w.start, end: w.end, maxWind: w.maxWind, maxGust: w.maxGust, d: x.d }; }));
    el.innerHTML = ranked.map(function (w, i) {
      var d = w.d, p = majorIn(d, w), turns = turnsIn(d, w), rows = [];
      rows.push(['Wind', 'up to ' + Math.round(w.maxWind) + ' kn' + (w.maxGust != null ? ', gusts ' + Math.round(w.maxGust) : '')]);
      if (p) rows.push([p.major ? 'Major period' : 'Minor period', E.fmtTime(p.start) + '–' + E.fmtTime(p.end) + ', ' + p.fish + ' fish']);
      if (turns.length) {
        turns.forEach(function (e) { rows.push([e.hi ? 'High water' : 'Low water', E.fmtTime(e.t) + ' ' + f1(e.h) + ' m']); });
      } else {
        var h0 = E.interp(E.spotCurve(state.spot, w.start, w.start + 6 * MIN, 6 * MIN), w.start, 'h');
        var h1 = E.interp(E.spotCurve(state.spot, w.end - 6 * MIN, w.end, 6 * MIN), w.end, 'h');
        if (h0 != null && h1 != null) rows.push(['Tide', h1 > h0 ? 'rising throughout' : 'falling throughout']);
      }
      return '<article class="wk-card">' +
        '<div class="wk-cardhead"><b>' + (d.d0 === E.dayStart(Date.now()) ? 'Today' : E.fmtDay(d.d0 + 12 * HOUR)) + '</b><span>' + (i + 1) + ' of ' + ranked.length + '</span></div>' +
        '<div class="wk-when">' + E.fmtTime(w.start) + '–' + E.fmtTime(w.end) + '<span>' + E.fmtDuration(w.end - w.start) + '</span></div>' +
        rows.map(function (r) { return '<div class="wk-kv"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>'; }).join('') +
        '<button type="button" class="wk-open" data-d0="' + d.d0 + '" data-t="' + w.start + '">Open day</button>' +
      '</article>';
    }).join('') + (gap ? '<p class="hint">' + gap + ' Windows on those days do not show here.</p>' : '');
  }
