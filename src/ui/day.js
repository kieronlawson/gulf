/* The day display, the readout under the cursor, and the place and now line. */

  /* ---------- Day chart ---------- */

  /* Fish icon: Font Awesome Free "fish" (solid), CC BY 4.0. Its view box is 576 by 512. */
  var FISH = 'M180.5 141.5C219.7 108.5 272.6 80 336 80s116.3 28.5 155.5 61.5c39.1 33 66.9 72.4 81 99.8 4.7 9.2 4.7 20.1 0 29.3-14.1 27.4-41.9 66.8-81 99.8-39.2 33.1-92 61.5-155.5 61.5s-116.3-28.5-155.5-61.5c-16.2-13.7-30.5-28.5-42.7-43.1L48.1 379.6c-12.5 7.3-28.4 5.3-38.7-4.9s-12.4-26-5.3-38.6L50 256 4.2 175.9c-7.2-12.6-5-28.4 5.3-38.6s26.1-12.2 38.7-4.9l89.7 52.3c12.2-14.6 26.5-29.4 42.7-43.1zM448 256a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z', FISH_W = 576, FISH_H = 512;

  function renderChart() {
    var host = $('chart'), W = Math.max(300, Math.floor(host.clientWidth || 900));
    var d = E.day(state.spot, state.d0), c = E.dayCurves(state.spot, state.d0);
    var hrs = dayRecs(d.d0, d.d1), sun = d.sun, small = W < 560;
    var x0 = small ? 34 : 80, x1 = W - (small ? 10 : 22), pw = x1 - x0, span = d.d1 - d.d0;
    var bandTop = 18, yTop = 54, actH = 40, yAct = yTop + actH, skyH = small ? 92 : 118, yHor = yAct + skyH;
    var seaH = small ? 140 : 162, ySea = yHor + seaH, windH = hrs.length ? 58 : 0, yWind = ySea + windH, H = yWind + 32;
    var hat = (DATA.auckland.hat - DATA.auckland.msl) * state.spot.ratio + state.spot.msl;
    var hTop = Math.max(1, Math.ceil(hat * 2) / 2);
    function X(t) { return x0 + (t - d.d0) / span * pw; }
    function yAlt(a) { return yHor - a / 90 * (skyH - 8); }
    function yActv(v) { return yAct - v * (actH - 5); }
    function yTide(h) { return ySea - Math.max(0, h) / hTop * (seaH - 38); }
    function n(v) { return v.toFixed(1); }
    function hline(y, cls) { return '<line class="' + cls + '" x1="' + x0 + '" y1="' + y + '" x2="' + x1 + '" y2="' + y + '"/>'; }

    /* Ground: light by day, a darker tone of the same ground at night. The tone ramps from
       nautical twilight to just after sunrise, and the reverse at dusk. */
    var rampA = sun.nautDawn != null ? sun.nautDawn : d.d0 + 5 * HOUR, rampB = (sun.rise != null ? sun.rise : d.d0 + 6 * HOUR) + 15 * MIN;
    var rampC = (sun.set != null ? sun.set : d.d0 + 18 * HOUR) - 15 * MIN, rampD = sun.nautDusk != null ? sun.nautDusk : d.d0 + 19 * HOUR;
    var mid1 = (rampA + rampB) / 2, mid2 = (rampC + rampD) / 2;
    function halo(t) { return (t >= mid1 && t < mid2) ? 'hd' : 'hn'; }
    function off(t) { return clamp(X(t) / W, 0, 1).toFixed(4); }

    var s = [], i;
    s.push('<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">');
    s.push('<defs><linearGradient id="gSky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + W + '" y2="0">' +
      '<stop offset="0" class="s-n"/><stop offset="' + off(rampA) + '" class="s-n"/><stop offset="' + off(rampB) + '" class="s-d"/>' +
      '<stop offset="' + off(rampC) + '" class="s-d"/><stop offset="' + off(rampD) + '" class="s-n"/><stop offset="1" class="s-n"/></linearGradient>' +
      '<clipPath id="clipSky"><rect x="' + x0 + '" y="' + yAct + '" width="' + pw + '" height="' + skyH + '"/></clipPath></defs>');
    s.push('<rect class="c-sky" x="0" y="0" width="' + W + '" height="' + H + '"/>');

    /* A faint vertical line every six hours. */
    var hours = Math.round(span / HOUR);
    for (i = 1; i < hours; i++) {
      if (E.parts(d.d0 + i * HOUR).H % 6 === 0) s.push('<line class="c-grid" x1="' + n(X(d.d0 + i * HOUR)) + '" y1="' + yTop + '" x2="' + n(X(d.d0 + i * HOUR)) + '" y2="' + yWind + '"/>');
    }

    /* Lane titles in the margin, each with a sample of its line. Narrow screens use the legend under the display. */
    if (!small) {
      var title = function (y, text, cls) {
        return (cls ? '<line class="' + cls + '" x1="10" y1="' + y + '" x2="25" y2="' + y + '"/>' : '') +
          '<text class="c-title" x="' + (cls ? 31 : 10) + '" y="' + (y + 3.8) + '">' + text + '</text>';
      };
      s.push(title(yTop + 13, 'Solunar', 'c-sol') + title(yAct + 13, 'Sun', 'c-sun') + title(yAct + 28, 'Moon', 'c-moon') + title(yHor + 13, 'Tide', 'c-tide'));
      if (hrs.length) s.push(title(ySea + 14, 'Wind', ''));
    }
    [30, 60].forEach(function (a) {
      s.push(hline(n(yAlt(a)), 'c-grid'));
      s.push('<text class="c-ax" x="' + (x0 - 7) + '" y="' + n(yAlt(a) + 3.6) + '" text-anchor="end">' + a + '°</text>');
    });

    /* Solunar periods: a band through the solunar, sky and tide lanes. Above it, a row of four fish.
       The green fish give the level of the period. */
    var fw = small ? 12 : 15, fgap = small ? 2 : 3, fh = fw * FISH_H / FISH_W, rowW = 4 * fw + 3 * fgap;
    d.solunar.periods.forEach(function (p) {
      var a = Math.max(p.start, d.d0), b = Math.min(p.end, d.d1);
      if (b <= a) return;
      var xa = X(a), xb = X(b), bw = xb - xa, cx = (xa + xb) / 2;
      s.push('<rect class="' + (p.major ? 'c-major' : 'c-minor') + '" x="' + n(xa) + '" y="' + bandTop + '" width="' + n(bw) + '" height="' + (ySea - bandTop) + '"/>');
      if (p.start >= d.d0) s.push('<line class="c-edge" x1="' + n(xa) + '" y1="' + bandTop + '" x2="' + n(xa) + '" y2="' + ySea + '"/>');
      if (p.end <= d.d1) s.push('<line class="c-edge" x1="' + n(xb) + '" y1="' + bandTop + '" x2="' + n(xb) + '" y2="' + ySea + '"/>');
      if (bw >= 30) s.push('<text class="c-band" x="' + n(cx) + '" y="29" text-anchor="middle">' + (p.major ? 'Major' : 'Minor') + '</text>');
      if (bw >= 8) {
        /* Wide screens: one row of four. Narrow screens: two rows of two, so neighboring ratings do not touch. */
        var cols = small ? 2 : 4, gridW = cols * fw + (cols - 1) * fgap;
        var fx = clamp(cx - gridW / 2, x0 + 2, x1 - gridW - 2), fy = small ? 24 : (bw >= 30 ? 41 : 36) - fh / 2;
        for (var f = 0; f < 4; f++) {
          s.push('<path class="c-fish' + (f < p.fish ? '' : ' off') + '" transform="translate(' + n(fx + (f % cols) * (fw + fgap)) + ' ' + n(fy + Math.floor(f / cols) * (fh + fgap)) +
            ') scale(' + (fw / FISH_W).toFixed(5) + ')" d="' + FISH + '"/>');
        }
      }
    });

    /* Solunar lane. */
    var pa = '';
    c.activity.forEach(function (q, k) { pa += (k ? 'L' : 'M') + n(X(q.t)) + ' ' + n(yActv(q.v)); });
    s.push('<path class="c-solfill" d="' + pa + 'L' + n(x1) + ' ' + yAct + 'L' + x0 + ' ' + yAct + 'Z"/><path class="c-sol" d="' + pa + '"/>');

    /* Sky lane: sun and moon altitude, shown only above the horizon. Both discs are the same size. */
    function skyPath(key) {
      var p = '';
      c.sky.forEach(function (q, k) { p += (k ? 'L' : 'M') + n(X(q.t)) + ' ' + n(yAlt(q[key])); });
      return p;
    }
    var sp = skyPath('sun');
    s.push('<g clip-path="url(#clipSky)"><path class="c-sunfill" d="' + sp + 'L' + n(x1) + ' ' + (yHor + 40) + 'L' + x0 + ' ' + (yHor + 40) + 'Z"/>' +
      '<path class="c-moon" d="' + skyPath('moon') + '"/><path class="c-sun" d="' + sp + '"/></g>');
    var moonAt = null;
    d.moon.upper.forEach(function (u) { if (u.alt > 3) moonAt = { t: u.t, alt: u.alt }; });
    if (!moonAt) {
      c.sky.forEach(function (q) { if (q.moon > 3 && (!moonAt || q.moon > moonAt.alt)) moonAt = { t: q.t, alt: q.moon }; });
    }
    if (moonAt) {
      s.push('<g class="pm" transform="translate(' + n(clamp(X(moonAt.t), x0 + 9, x1 - 9)) + ' ' + n(yAlt(moonAt.alt)) + ')">' + moonShape(d.moon.fraction, d.moon.limb, 7.5) + '</g>');
    }
    if (sun.noon >= d.d0 && sun.noon < d.d1) {
      s.push('<circle class="c-sundisc" cx="' + n(X(sun.noon)) + '" cy="' + n(yAlt(sun.noonAlt)) + '" r="7.5"/>');
    }

    /* Tide lane. */
    var pt = '';
    c.tide.forEach(function (q, k) { pt += (k ? 'L' : 'M') + n(X(q.t)) + ' ' + n(yTide(q.h)); });
    s.push('<path class="c-tidefill" d="' + pt + 'L' + n(X(c.tide[c.tide.length - 1].t)) + ' ' + ySea + 'L' + n(X(c.tide[0].t)) + ' ' + ySea + 'Z"/>');
    for (i = 1; i <= hTop - 0.5; i++) {
      s.push(hline(n(yTide(i)), 'c-grid'));
      s.push('<text class="c-ax" x="' + (x0 - 7) + '" y="' + n(yTide(i) + 3.6) + '" text-anchor="end">' + i + (small ? '' : ' m') + '</text>');
    }
    s.push('<path class="c-tide" d="' + pt + '"/>');

    var now = Date.now();
    if (now >= d.d0 && now < d.d1) {
      var xn = X(now);
      s.push('<line class="c-now" x1="' + n(xn) + '" y1="16" x2="' + n(xn) + '" y2="' + yWind + '"/>');
      s.push('<path class="c-nowcap" d="M' + n(xn - 5) + ' 8h10l-5 8z"/>');
    }
    d.extremes.forEach(function (e) {
      var x = X(e.t), y = yTide(e.h), lx = clamp(x, x0 + 19, x1 - 19), hc = halo(e.t);
      s.push('<circle class="c-dot" cx="' + n(x) + '" cy="' + n(y) + '" r="3.6"/>');
      s.push('<text class="c-xt ' + hc + '" x="' + n(lx) + '" y="' + n(y - 21) + '" text-anchor="middle">' + E.fmtTime(e.t) + '</text>');
      s.push('<text class="c-xh ' + hc + '" x="' + n(lx) + '" y="' + n(y - 8) + '" text-anchor="middle">' + meters(e.h) + '</text>');
    });

    /* Wind lane, present only when a forecast covers this day. */
    if (hrs.length) {
      var perHour = pw / 24, step = perHour >= 30 ? 1 : perHour >= 15 ? 2 : 3;
      hrs.forEach(function (q) {
        var hour = E.parts(q.t).H;
        if (step === 1 ? hour === 0 : hour % step !== 1) return;
        var x = X(q.t), half = perHour * step / 2, r = q.r, b = windBand(r.wind);
        if (b) s.push('<rect class="c-w' + b + '" x="' + n(x - half) + '" y="' + ySea + '" width="' + n(half * 2) + '" height="' + windH + '"/>');
        if (ok(r.dir)) s.push('<path class="c-arrow" transform="translate(' + n(x) + ' ' + (ySea + 15) + ') rotate(' + (r.dir + 180).toFixed(0) + ')" d="M0 -8L4.6 5L0 2.2L-4.6 5Z"/>');
        s.push('<text class="c-ws" x="' + n(x) + '" y="' + (ySea + 38) + '" text-anchor="middle">' + Math.round(r.wind) + '</text>');
        if (ok(r.gust)) s.push('<text class="c-wg" x="' + n(x) + '" y="' + (ySea + 51) + '" text-anchor="middle">' + Math.round(r.gust) + '</text>');
      });
      s.push('<text class="c-ax" x="' + (x0 - 7) + '" y="' + (ySea + 38) + '" text-anchor="end">kn</text>');
      s.push('<text class="c-ax" x="' + (x0 - 7) + '" y="' + (ySea + 51) + '" text-anchor="end">gust</text>');
    }

    /* Lane rules and the ruled time axis. */
    s.push(hline(yTop, 'c-line') + hline(yAct, 'c-line') + hline(yHor, 'c-line') + hline(ySea, 'c-line'));
    var perH = pw / 24, every = perH >= 27 ? 2 : perH >= 15 ? 3 : 6, tickMin = perH >= 30 ? 10 : perH >= 12 ? 30 : 60;
    s.push(hline(yWind, 'c-rule'));
    for (var tt = d.d0; tt <= d.d1; tt += tickMin * MIN) {
      var tp = E.parts(tt), tx = X(tt), onHour = tp.M === 0, big = onHour && tp.H % every === 0;
      var len = big ? 9 : onHour ? 6.5 : tp.M === 30 ? 4.5 : 3;
      s.push('<line class="c-rule" x1="' + n(tx) + '" y1="' + yWind + '" x2="' + n(tx) + '" y2="' + (yWind + len) + '"/>');
      if (big && tt < d.d1) s.push('<text class="c-ax" x="' + n(tx) + '" y="' + (yWind + 22) + '" text-anchor="middle">' + E.pad2(tp.H) + '</text>');
    }

    if (state.pin != null && state.pin >= d.d0 && state.pin < d.d1) {
      var xp = X(state.pin), lp = clamp(xp, 20, W - 20);
      s.push('<line class="c-pin" x1="' + n(xp) + '" y1="15" x2="' + n(xp) + '" y2="' + yWind + '"/>');
      s.push('<rect class="c-pinflag" x="' + n(lp - 18) + '" y="2" width="36" height="13" rx="2"/>');
      s.push('<text class="c-pintext" x="' + n(lp) + '" y="12" text-anchor="middle">' + E.fmtTime(state.pin) + '</text>');
    }

    s.push('<g id="cur"></g></svg>');
    host.innerHTML = s.join('');
    var legend = $('dayLegend');
    if (legend) legend.hidden = !small;
    state.geom = { W: W, x0: x0, pw: pw, d0: d.d0, d1: d.d1, span: span, yTop: bandTop, yWind: yWind, X: X, yAlt: yAlt, yTide: yTide };
    drawCursor();
  }

  function drawCursor() {
    var g = $('chart').querySelector('#cur'), G = state.geom;
    if (!g || !G) return;
    if (state.cursor == null) { g.innerHTML = ''; return; }
    var t = state.cursor, x = G.X(t).toFixed(1), c = E.dayCurves(state.spot, state.d0);
    var h = E.interp(c.tide, t, 'h'), sa = E.interp(c.sky, t, 'sun'), ma = E.interp(c.sky, t, 'moon');
    var out = '<line class="c-cur" x1="' + x + '" y1="' + G.yTop + '" x2="' + x + '" y2="' + G.yWind + '"/>';
    if (h != null) out += '<circle class="c-curdot" cx="' + x + '" cy="' + G.yTide(h).toFixed(1) + '" r="4"/>';
    if (sa != null && sa > 0) out += '<circle class="c-curdot" cx="' + x + '" cy="' + G.yAlt(sa).toFixed(1) + '" r="3.5"/>';
    if (ma != null && ma > 0) out += '<circle class="c-curdot" cx="' + x + '" cy="' + G.yAlt(ma).toFixed(1) + '" r="3.5"/>';
    g.innerHTML = out;
  }

  /* ---------- Readout: the values at the cursor, or now ---------- */

  function renderReadout() {
    var el = $('readout'), d = E.day(state.spot, state.d0), c = E.dayCurves(state.spot, state.d0);
    var now = Date.now(), isToday = now >= d.d0 && now < d.d1;
    var pinned = state.pin != null && state.pin >= d.d0 && state.pin < d.d1;
    var t = state.cursor != null ? state.cursor : pinned ? state.pin : (isToday ? now : null);
    var tag = state.cursor != null ? '' : pinned ? ' pinned' : ' now';
    if (t == null) {
      el.innerHTML = '<div class="hint">Move across the display to read the tide, sun and moon at any time of this day. Select a time to pin it.</div>';
      return;
    }
    var h = E.interp(c.tide, t, 'h');
    var ha = E.interp(c.tide, Math.max(d.d0, t - 6 * MIN), 'h'), hb = E.interp(c.tide, Math.min(d.d1, t + 6 * MIN), 'h');
    var slope = (hb != null && ha != null) ? hb - ha : 0;
    var trend = slope > 0.006 ? 'rising' : slope < -0.006 ? 'falling' : 'at the turn';
    var sa = E.interp(c.sky, t, 'sun'), ma = E.interp(c.sky, t, 'moon');
    var period = null;
    d.solunar.periods.forEach(function (p) { if (t >= p.start && t <= p.end) period = p; });
    var act = Math.round(E.activityAt(t, d.solunar, d.sun) * 100);
    var cells = [
      ['Time', E.fmtTime(t) + tag],
      ['Tide', h == null ? '–' : meters(h) + ', ' + trend],
      ['Sun', sa == null ? '–' : sa >= 0 ? Math.round(sa) + '° up' : sa > -6 ? 'Twilight' : 'Down'],
      ['Moon', ma == null ? '–' : ma >= 0 ? Math.round(ma) + '° up' : 'Down'],
      ['Solunar activity', (period ? (period.major ? 'Major period' : 'Minor period') : 'No period') + ', ' + act + '%']
    ];
    var wx = state.wx[state.spot.id];
    if (wx && wx.recs) {
      var r = wx.recs[Math.round(t / HOUR) * HOUR];
      if (r) cells.push(['Wind, kn', compass(r.dir) + ' ' + Math.round(r.wind) + (ok(r.gust) ? ', gusts ' + Math.round(r.gust) : '')]);
    }
    el.style.setProperty('--cols', '0.9fr 1.2fr 0.8fr 0.8fr 1.45fr' + (cells.length > 5 ? ' 1.45fr' : ''));
    el.innerHTML = cells.map(function (x) { return '<div><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div></div>'; }).join('');
  }

  /* ---------- Windows of the day on screen ---------- */

  function renderWindows() {
    var el = $('winLine'), wx = state.wx[state.spot.id], L = state.limits;
    var rule = 'Your limits: wind up to ' + L.wind + ' kn for ' + hoursWords(L.hours) + ' or longer, between first light and last light.';
    function line(lamp, body) {
      el.innerHTML = '<span class="pip' + (lamp ? ' ' + lamp : '') + '" aria-hidden="true"></span>' + body;
    }
    if (!wx || !wx.recs) { line('', '<span>Windows need the forecast. It is not loaded.</span>'); return; }
    var d = E.day(state.spot, state.d0), sun = d.sun, lit = 0, missing = 0;
    for (var t = d.d0; t < d.d1; t += HOUR) {
      if (sun.dawn == null || t + 30 * MIN <= sun.dawn || t - 30 * MIN >= sun.dusk) continue;
      lit++;
      if (!wx.recs[t]) missing++;
    }
    if (!lit || missing === lit) { line('', '<span>The forecast does not cover this day, so the page cannot find windows.</span>'); return; }
    var part = missing ? ' <span class="muted">The forecast covers only part of this day.</span>' : '';
    var list = E.dayWindows(state.spot, state.d0, wx.recs, L);
    if (!list.length) {
      line('', '<span>No window. The wind does not stay at or under ' + L.wind + ' kn for ' + hoursWords(L.hours) +
        ' between first light and last light.</span>' + part);
      return;
    }
    line('on', '<span>' + (list.length > 1 ? 'Windows' : 'Window') + '</span>' + list.map(function (w) {
      return '<span class="win"><b>' + E.fmtTime(w.start) + '–' + E.fmtTime(w.end) + '</b>' + E.fmtDuration(w.end - w.start) +
        ', highest wind ' + Math.round(w.maxWind) + ' kn</span>';
    }).join('') + '<span class="muted">' + rule + '</span>' + part);
  }

  /* ---------- Place and now line ---------- */

  function renderPlace() {
    $('placeName').textContent = state.spot.name;
    $('placeSub').textContent = state.spot.sub || '';
    $('placeDate').textContent = E.fmtDayLong(state.d0 + 12 * HOUR);
    renderNow();
  }

  function renderNow() {
    var el = $('nowLine'), now = Date.now(), today = E.dayStart(now);
    if (state.d0 === today) {
      var tn = E.tideNow(state.spot, now);
      if (!tn.next || tn.h == null) { el.textContent = ''; return; }
      el.innerHTML = '<strong>Now ' + E.fmtTime(now) + '.</strong> <span>Tide ' + meters(tn.h) + ' and ' + (tn.rising ? 'rising' : 'falling') +
        '. ' + (tn.next.hi ? 'High' : 'Low') + ' water at ' + E.fmtTime(tn.next.t) + ', in ' + E.fmtDuration(tn.next.t - now) + '.</span>';
      return;
    }
    var days = Math.round((state.d0 - today) / E.DAY);
    var txt = days === 1 ? 'Tomorrow.' : days === -1 ? 'Yesterday.' : days > 0 ? 'In ' + days + ' days.' : (-days) + ' days ago.';
    el.innerHTML = '<span class="muted">' + txt + '</span>';
  }

