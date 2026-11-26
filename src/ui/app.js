/* State changes shared by all screens, and the event wiring. Runs last. */

  /* ---------- State changes ---------- */

  function renderPin() { renderTimebar(); }

  function renderAll() {
    $('spot').value = state.spot.id;
    $('date').value = E.isoDate(state.d0 + 12 * HOUR);
    $('tablesFor').textContent = state.spot.name + ', ' + E.fmtDay(state.d0 + 12 * HOUR);
    renderStatus(); renderPlace(); renderWindows(); renderWeek(); renderPin(); renderChart(); renderReadout(); renderCards(); renderWeather(); renderAhead(); markMap(); renderGulf();
  }

  function setSpot(sp) {
    if (!sp) return;
    state.spot = sp; state.cursor = null;
    store.set('gulf-almanac-spot', sp.id);
    if (view.preset === 'spot') setPreset('spot'); else markViewButtons();
    renderAll();
    loadWeather(false);
  }

  /* A pinned time keeps its time of day when the day changes. */
  function setDay(d0) {
    if (state.pin != null) state.pin = clamp(d0 + (state.pin - state.d0), d0, E.addDays(d0, 1) - 5 * MIN);
    state.d0 = d0; state.cursor = null;
    state.followToday = d0 === E.dayStart(Date.now());
    renderAll();
  }

  function pinTime(t) {
    state.pin = Math.round(t / (5 * MIN)) * 5 * MIN;
    state.cursor = null;
    var d0 = E.dayStart(state.pin);
    if (d0 !== state.d0) { state.d0 = d0; state.followToday = false; renderAll(); return; }
    renderPin(); renderChart(); renderReadout(); renderGulf();
  }

  function unpin() {
    stopPlay();
    state.pin = null; state.cursor = null;
    renderPin(); renderChart(); renderReadout(); renderGulf();
  }

  function toTop() {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var how = { top: 0, behavior: calm ? 'auto' : 'smooth' };
    window.scrollTo(how);
    var stack = document.querySelector('.stack');
    if (stack && stack.scrollTo) stack.scrollTo(how);
  }

  /* The three screens share the spot, the day and the pinned time. Switching only changes what is shown. */
  function setScreen(name) {
    if (SCREENS.indexOf(name) < 0) return;
    state.screen = name;
    store.set('gulf-almanac-screen', name);
    SCREENS.forEach(function (n) { $('screen-' + n).hidden = n !== name; });
    var bs = $('screens').querySelectorAll('button[data-screen]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-screen') === name ? 'true' : 'false');
    if (name === 'week') renderWeek();
  }

  /* Opens a day on the Day screen. With a time, the Day screen pins it. */
  function openDay(d0, t) {
    if (t != null) pinTime(t); else setDay(d0);
    setScreen('day'); toTop();
  }

  function openSheet(id) {
    var d = $(id);
    if (d.open) return;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  function closeSheet(id) {
    var d = $(id);
    if (d.close) d.close(); else d.removeAttribute('open');
  }

  /* ---------- Limits ---------- */

  function renderLimits() {
    var L = state.limits, R = LIMIT_RANGE;
    $('limWind').textContent = L.wind + ' kn';
    $('limHours').textContent = hoursWords(L.hours);
    var bs = $('limits').querySelectorAll('button[data-lim]');
    for (var i = 0; i < bs.length; i++) {
      var key = bs[i].getAttribute('data-lim'), dir = +bs[i].getAttribute('data-dir');
      bs[i].disabled = dir < 0 ? L[key] <= R[key][0] : L[key] >= R[key][1];
    }
    $('limitsReset').disabled = L.wind === E.LIMITS.wind && L.hours === E.LIMITS.hours;
  }

  function setLimits(L) {
    state.limits = L;
    store.set('gulf-almanac-limits', JSON.stringify(L));
    renderLimits(); renderWindows(); renderTimebar(); renderWeek();
  }

  function stepLimit(key, dir) {
    var R = LIMIT_RANGE[key], next = {};
    next.wind = state.limits.wind; next.hours = state.limits.hours;
    next[key] = clamp(Math.round((state.limits[key] + dir * R[2]) / R[2]) * R[2], R[0], R[1]);
    setLimits(next);
  }

  /* Sync loads the spot forecast and the map data now, whatever their age. */
  function sync() { loadWeather(true); syncField(true); }

  /* Once a minute, and when the page comes back to the foreground: move the now needle, roll over
     to the new day at midnight, update the forecast age, and load forecasts that are out of date. */
  function tick() {
    var today = E.dayStart(Date.now());
    if (state.followToday && state.d0 !== today) {
      setDay(today);
    } else {
      renderNow();
      if (state.d0 === today) { renderChart(); renderCards(); if (state.cursor == null) renderReadout(); }
      if (state.pin == null) renderGulf();
      renderStatus(); tickWeek(); renderTimebar();
    }
    loadWeather(false);
    syncField(false);
  }

  /* ---------- Wiring ---------- */

  function init() {
    var sel = $('spot'), groups = [], html = '';
    spots.forEach(function (s) { if (groups.indexOf(s.group) < 0) groups.push(s.group); });
    groups.forEach(function (g) {
      html += '<optgroup label="' + esc(g) + '">';
      spots.forEach(function (s) { if (s.group === g) html += '<option value="' + s.id + '">' + esc(s.name) + '</option>'; });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
    sel.addEventListener('change', function () { setSpot(byId[sel.value]); });
    $('prev').addEventListener('click', function () { setDay(E.addDays(state.d0, -1)); });
    $('next').addEventListener('click', function () { setDay(E.addDays(state.d0, 1)); });
    $('today').addEventListener('click', function () { setDay(E.dayStart(Date.now())); });
    $('date').addEventListener('change', function () {
      var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(this.value);
      if (m && +m[1] >= 1900 && +m[1] <= 2200) setDay(E.midnight(+m[1], +m[2], +m[3]));
    });

    /* Time bar. */
    $('tbNow').addEventListener('click', unpin);
    $('tbPlay').addEventListener('click', startPlay);
    $('tbBack').addEventListener('click', function () { stopPlay(); tbMove(-30 * MIN); });
    $('tbFwd').addEventListener('click', function () { stopPlay(); tbMove(30 * MIN); });
    var track = $('tbTrack'), dragging = false;
    function dragTo(e) {
      var t = tbTimeAt(e.clientX);
      renderTimebar(Math.round(t / (5 * MIN)) * 5 * MIN);
      if (t >= state.d0 && t < E.addDays(state.d0, 1)) { state.cursor = Math.round(t / MIN) * MIN; drawCursor(); renderReadout(); }
    }
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true; stopPlay();
      if (track.setPointerCapture) track.setPointerCapture(e.pointerId);
      dragTo(e);
    });
    track.addEventListener('pointermove', function (e) { if (dragging) dragTo(e); });
    track.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      pinTime(tbTimeAt(e.clientX));
    });
    track.addEventListener('pointercancel', function () { dragging = false; state.cursor = null; renderTimebar(); drawCursor(); renderReadout(); });
    track.addEventListener('keydown', function (e) {
      var step = (e.shiftKey ? 60 : 10) * MIN, R = tbRange();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); stopPlay(); tbMove(-step); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); stopPlay(); tbMove(step); }
      else if (e.key === 'Home') { e.preventDefault(); stopPlay(); pinTime(R.a); }
      else if (e.key === 'End') { e.preventDefault(); stopPlay(); pinTime(R.b); }
      else if (e.key === 'Escape') unpin();
    });

    $('screens').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-screen]') : null;
      if (b) setScreen(b.getAttribute('data-screen'));
    });
    $('sync').addEventListener('click', sync);

    /* Week: a window opens its day with the start pinned. A day name, or a part of a row outside
       any window, opens that day without a pin. */
    $('wkRows').addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.wk-win, .wk-day, .wk-lane') : null;
      if (!el) return;
      var d0 = +el.getAttribute('data-d0');
      if (el.classList.contains('wk-win')) { openDay(d0, +el.getAttribute('data-t')); return; }
      if (el.classList.contains('wk-lane')) {
        var r = el.getBoundingClientRect(), a = +el.getAttribute('data-a'), b = +el.getAttribute('data-b');
        var t = a + (e.clientX - r.left) / r.width * (b - a), wins = el.querySelectorAll('.wk-win');
        for (var i = 0; i < wins.length; i++) {
          if (t >= +wins[i].getAttribute('data-t') && t <= +wins[i].getAttribute('data-end')) { openDay(d0, +wins[i].getAttribute('data-t')); return; }
        }
      }
      openDay(d0, null);
    });
    $('wkBest').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.wk-open') : null;
      if (b) openDay(+b.getAttribute('data-d0'), +b.getAttribute('data-t'));
    });
    $('weekLimits').addEventListener('click', function () { renderLimits(); openSheet('limits'); });
    $('tablesOpen').addEventListener('click', function () { openSheet('tables'); });
    $('tablesClose').addEventListener('click', function () { closeSheet('tables'); });
    $('limitsOpen').addEventListener('click', function () { renderLimits(); openSheet('limits'); });
    $('limitsClose').addEventListener('click', function () { closeSheet('limits'); });
    $('limitsReset').addEventListener('click', function () { setLimits({ wind: E.LIMITS.wind, hours: E.LIMITS.hours }); });
    $('limits').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-lim]') : null;
      if (b) stepLimit(b.getAttribute('data-lim'), +b.getAttribute('data-dir'));
    });
    /* A tap outside a sheet lands on the dialog element itself, so it closes the sheet. */
    ['tables', 'limits'].forEach(function (id) {
      $(id).addEventListener('click', function (e) { if (e.target === this) closeSheet(id); });
    });

    /* Map: a lamp selects a spot, any other point on the water places the probe. A drag or a pinch does neither. */
    $('map').addEventListener('click', function (e) {
      if (mapGestured()) return;
      var g = e.target.closest ? e.target.closest('.pin') : null;
      if (g) { setSpot(byId[g.getAttribute('data-id')]); return; }
      var m = toMap(e.clientX, e.clientY), x = m.x, y = m.y;
      if (isWater(x, y)) { state.probe = { x: x, y: y, w: nearest(x, y), near: landWithin(x, y, NEAR_LAND_KM) }; state.probeMiss = false; }
      else { state.probeMiss = true; }
      renderProbeMark(); renderProbe();
    });
    $('map').addEventListener('keydown', function (e) {
      var g = e.target.closest ? e.target.closest('.pin') : null;
      if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSpot(byId[g.getAttribute('data-id')]); }
    });
    $('layers').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-layer]') : null;
      if (!b) return;
      var key = b.getAttribute('data-layer');
      state.layers[key] = !state.layers[key];
      b.setAttribute('aria-pressed', state.layers[key] ? 'true' : 'false');
      b.querySelector('.pip').className = 'pip' + (state.layers[key] ? ' on' : '');
      renderOverlay();
    });
    $('probe').addEventListener('click', function (e) {
      var tAttr = e.target.getAttribute ? e.target.getAttribute('data-t') : null;
      if (tAttr) { pinTime(+tAttr); return; }
      var act = e.target.closest ? e.target.closest('[data-act]') : null;
      if (act && act.getAttribute('data-act') === 'reload') sync();
      if (act && act.getAttribute('data-act') === 'clearprobe') { state.probe = null; state.probeMiss = false; renderProbeMark(); renderProbe(); }
    });

    /* A row in the days ahead opens that day on the Day screen. */
    $('ahead').addEventListener('click', function (e) {
      var tr = e.target.closest ? e.target.closest('tr[data-d0]') : null;
      if (!tr) return;
      setDay(+tr.getAttribute('data-d0'));
      closeSheet('tables'); setScreen('day'); toTop();
    });
    $('weather').addEventListener('click', function (e) {
      if (e.target.getAttribute && e.target.getAttribute('data-act') === 'reload') sync();
    });

    /* Day display: moving reads a time, selecting pins it. */
    var host = $('chart');
    function timeAt(e) {
      var G = state.geom;
      if (!G) return null;
      var r = host.getBoundingClientRect();
      var x = (e.clientX - r.left) * (G.W / r.width);
      return clamp(G.d0 + (x - G.x0) / G.pw * G.span, G.d0, G.d1 - 5 * MIN);
    }
    function onHover(e) {
      var t = timeAt(e);
      if (t == null) return;
      state.cursor = Math.round(t / MIN) * MIN;
      drawCursor(); renderReadout();
    }
    host.addEventListener('pointermove', onHover);
    host.addEventListener('pointerdown', onHover);
    host.addEventListener('pointerup', function (e) {
      var t = timeAt(e);
      if (t != null) pinTime(t);
    });
    host.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse') { state.cursor = null; drawCursor(); renderReadout(); }
    });
    host.addEventListener('keydown', function (e) {
      var G = state.geom, stepMs = (e.shiftKey ? 60 : 10) * MIN, now = Date.now();
      if (!G) return;
      var base = state.cursor != null ? state.cursor : (state.pin != null && state.pin >= G.d0 && state.pin < G.d1) ? state.pin :
        (now >= G.d0 && now < G.d1 ? Math.round(now / (10 * MIN)) * 10 * MIN : G.d0 + 12 * HOUR);
      if (e.key === 'Escape') { unpin(); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pinTime(base); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        state.cursor = clamp(base + (e.key === 'ArrowRight' ? stepMs : -stepMs), G.d0, G.d1 - 5 * MIN);
        e.preventDefault();
        drawCursor(); renderReadout();
      }
    });

    /* The display redraws when its width changes, or, in the wide layout, the height it is given. */
    var lastW = 0, lastH = 0, pending = false;
    function onResize() {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(function () {
        pending = false;
        var w = Math.floor(host.clientWidth), h = isWide() ? Math.floor(host.parentNode.clientHeight) : 0;
        if (w && (w !== lastW || h !== lastH)) { lastW = w; lastH = h; renderChart(); }
        renderTimebar();
      });
    }
    if (window.ResizeObserver) { new ResizeObserver(onResize).observe(host); new ResizeObserver(onResize).observe(host.parentNode); }
    window.addEventListener('resize', onResize);

    setInterval(tick, 60000);

    /* Safari on iPad pauses a page in the background. On return, or when the connection comes back,
       a load that failed earlier may try again at once. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      state.wxFailedAt = 0; field.failedAt = 0;
      tick();
    });
    window.addEventListener('online', function () {
      state.wxFailedAt = 0; field.failedAt = 0;
      loadWeather(false); syncField(false);
    });

    setScreen(state.screen);
    buildMask();
    buildSites();
    readCachedField();
    renderMap();
    wireMapGestures();
    renderAll();
    lastW = Math.floor(host.clientWidth);
    loadWeather(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
