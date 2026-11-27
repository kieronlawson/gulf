/* State changes shared by all screens, and the event wiring. Runs last. */

  /* ---------- State changes ---------- */

  function renderPin() { renderTimebar(); }

  function renderAll() {
    $('spot').value = state.spot.id;
    $('date').value = E.isoDate(state.d0 + 12 * HOUR);
    $('tablesFor').textContent = state.spot.name + ', ' + E.fmtDay(state.d0 + 12 * HOUR);
    renderStatus(); renderPlace(); renderWindows(); renderWeek(); renderPin(); renderChart(); renderReadout(); renderCards(); renderWeather(); renderAhead(); markMap(); renderGulf(); renderNowSide();
  }

  function setSpot(sp) {
    if (!sp) return;
    state.spot = sp; state.cursor = null;
    store.set('gulf-almanac-spot', sp.id);
    if (view.preset === 'spot') setPreset('spot'); else markViewButtons();
    renderAll();
    loadWeather(false);
  }

  /* A pinned time keeps its time of day when the day changes. A route on the Day screen leaves at a time on
     the day shown, so on a day other than today, with nothing pinned, the start of the bar is pinned. */
  function setDay(d0) {
    if (state.pin != null) state.pin = clamp(d0 + (state.pin - state.d0), d0, E.addDays(d0, 1) - 5 * MIN);
    state.d0 = d0; state.cursor = null;
    state.followToday = d0 === E.dayStart(Date.now());
    if (state.pin == null && state.routes.day && !state.followToday) state.pin = tbRange().a;
    renderAll();
  }

  function pinTime(t) {
    state.pin = Math.round(t / (5 * MIN)) * 5 * MIN;
    state.cursor = null;
    var d0 = E.dayStart(state.pin);
    if (d0 !== state.d0) { state.d0 = d0; state.followToday = false; renderAll(); return; }
    renderPin(); renderChart(); renderReadout(); renderDayMap();
  }

  /* With a route open, Now means leaving now, so the day returns to today. */
  function unpin() {
    stopPlay();
    state.pin = null; state.cursor = null;
    if (state.routes.day && state.d0 !== E.dayStart(Date.now())) { setDay(E.dayStart(Date.now())); return; }
    renderPin(); renderChart(); renderReadout(); renderDayMap();
  }

  /* The pinned time moves the map only while the map sits on the Day screen. On the Now screen the map
     shows now, or a step ahead, whatever is pinned. */
  function renderDayMap() { if (state.mapScreen === 'day') renderGulf(); }

  function toTop() {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var how = { top: 0, behavior: calm ? 'auto' : 'smooth' };
    window.scrollTo(how);
    var stack = document.querySelector('.stack');
    if (stack && stack.scrollTo) stack.scrollTo(how);
  }

  /* The three screens share the spot, the day and the pinned time. The Day and Now screens share the map,
     which moves to the one that shows. The Now screen opens at now, and asks the iPad for its position
     while it shows. */
  function setScreen(name) {
    if (SCREENS.indexOf(name) < 0) return;
    if (full.on && name !== state.screen) setFull(false);
    state.screen = name;
    store.set('gulf-almanac-screen', name);
    SCREENS.forEach(function (n) { $('screen-' + n).hidden = n !== name; });
    var bs = $('screens').querySelectorAll('button[data-screen]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-screen') === name ? 'true' : 'false');
    if (name !== 'day') stopPlay();   /* Play moves the Day screen's pinned time, so it stops when Day is left */
    if (name === 'now') state.nowStep = 0;
    if (name === 'day') fitChart();   /* a draw while the screen was hidden used default sizes */
    if (name !== 'week' && name !== state.mapScreen) moveMap(name);
    else if (name === 'now') renderGulf();
    if (name === 'now') { startPosition(); renderNowSide(); } else stopPosition();
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
    $('limSpeed').textContent = L.speed == null ? 'Not set' : L.speed + ' kn';
    $('limMargin').textContent = L.margin == null ? 'Not set' : L.margin + ' min';
    $('limSafe').textContent = L.safe == null ? 'Not set' : L.safe.toFixed(1) + ' m';
    /* A limit that can be unset steps below its lowest value to unset. */
    var bs = $('limits').querySelectorAll('button[data-lim]');
    for (var i = 0; i < bs.length; i++) {
      var key = bs[i].getAttribute('data-lim'), dir = +bs[i].getAttribute('data-dir'), v = L[key];
      bs[i].disabled = dir < 0 ? v == null || (v <= R[key][0] && !(key in LIMIT_START)) : v != null && v >= R[key][1];
    }
    $('limitsReset').disabled = L.wind === E.LIMITS.wind && L.hours === E.LIMITS.hours;
  }

  function setLimits(L) {
    state.limits = L;
    store.set('gulf-almanac-limits', JSON.stringify(L));
    renderLimits(); renderWindows(); renderTimebar(); renderWeek(); renderNowSide(); renderRoute(); renderDepthLayers();
  }

  function stepLimit(key, dir) {
    var R = LIMIT_RANGE[key], v = state.limits[key], next = {};
    for (var k in state.limits) next[k] = state.limits[k];
    if (v == null) { if (dir < 0) return; next[key] = LIMIT_START[key]; }
    else if (dir < 0 && v <= R[0] && key in LIMIT_START) next[key] = null;
    else next[key] = clamp(Math.round(Math.round((v + dir * R[2]) / R[2]) * R[2] * 100) / 100, R[0], R[1]);
    setLimits(next);
  }

  /* Sync loads the spot forecast and the map data now, whatever their age, and the depths and chart marks if they failed. */
  function sync() { loadWeather(true); syncField(true); loadDepth(true); loadChartMarks(true); }

  /* Once a minute, and when the page comes back to the foreground: move the now needle, roll over
     to the new day at midnight, update the forecast age, and load forecasts that are out of date. */
  function tick() {
    var today = E.dayStart(Date.now());
    if (state.followToday && state.d0 !== today) {
      setDay(today);
    } else {
      renderNow();
      if (state.d0 === today) { renderChart(); renderCards(); if (state.cursor == null) renderReadout(); }
      if (state.pin == null || state.mapScreen === 'now') renderGulf();
      renderNowSide();
      renderStatus(); tickWeek(); renderTimebar();
    }
    loadWeather(false);
    syncField(false);
    loadDepth(false);
    loadChartMarks(false);
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

    /* Week: a click or tap on a lane, inside a window or not, opens its day with the time under the pointer
       pinned. A mouse or a finger is released on the lane just before its click, however long it was held.
       A click with no such release, as from a key, has no real pointer position: on a window button it pins
       the window's start. A day name opens its day with no new pin. */
    var released = null;   /* the lane a pointer was last released on, and when */
    $('wkRows').addEventListener('pointerup', function (e) {
      var lane = e.target.closest ? e.target.closest('.wk-lane') : null;
      released = lane ? { lane: lane, at: e.timeStamp } : null;
    });
    $('wkRows').addEventListener('pointercancel', function () { released = null; });
    $('wkRows').addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.wk-win, .wk-day, .wk-lane') : null, up = released;
      released = null;
      if (!el) return;
      var d0 = +el.getAttribute('data-d0'), lane = el.closest('.wk-lane');
      if (el.classList.contains('wk-day')) { openDay(d0, null); return; }
      var pointed = e.detail > 0 && up && up.lane === lane && e.timeStamp - up.at < 1000;
      if (el.classList.contains('wk-win') && !pointed) { openDay(d0, +el.getAttribute('data-t')); return; }
      openDay(d0, laneTimeAt(lane, e.clientX));
    });
    /* A mouse gets a hairline and a time flag over the lanes. A touch screen gets neither. */
    $('wkRows').addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      weekHover(e.target.closest ? e.target.closest('.wk-lane') : null, e.clientX);
    });
    $('wkRows').addEventListener('pointerleave', function () { weekHover(null); });
    $('wkBest').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.wk-open') : null;
      if (b) openDay(+b.getAttribute('data-d0'), +b.getAttribute('data-t'));
    });
    $('weekLimits').addEventListener('click', function () { renderLimits(); openSheet('limits'); });
    $('tablesOpen').addEventListener('click', function () { openSheet('tables'); });
    $('tablesClose').addEventListener('click', function () { closeSheet('tables'); });
    $('limitsOpen').addEventListener('click', function () { renderLimits(); openSheet('limits'); });
    $('limitsClose').addEventListener('click', function () { closeSheet('limits'); });
    $('limitsReset').addEventListener('click', function () {
      setLimits({ wind: E.LIMITS.wind, hours: E.LIMITS.hours, speed: state.limits.speed, margin: state.limits.margin, safe: state.limits.safe });
    });
    $('limits').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-lim]') : null;
      if (b) stepLimit(b.getAttribute('data-lim'), +b.getAttribute('data-dir'));
    });
    /* A tap outside a sheet lands on the dialog element itself, so it closes the sheet. */
    ['tables', 'limits'].forEach(function (id) {
      $(id).addEventListener('click', function (e) { if (e.target === this) closeSheet(id); });
    });

    /* Map: a lamp selects a spot, any other point on the water places the probe. A drag or a pinch does neither. */
    /* Map taps: while a saved place moves, a tap gives its new position. Otherwise a saved place selects it,
       a lamp selects that tide spot, and any other point places the probe. */
    $('map').addEventListener('click', function (e) {
      if (mapGestured()) return;
      var m = toMap(e.clientX, e.clientY);
      if (state.moving != null) { movePlaceTo(m.x, m.y); return; }
      var pl = e.target.closest ? e.target.closest('.place') : null;
      if (pl) { selectPlace(pl.getAttribute('data-key')); return; }
      var g = e.target.closest ? e.target.closest('.pin') : null;
      if (g) { setSpot(byId[g.getAttribute('data-id')]); return; }
      if (m.x < 0 || m.y < 0 || m.x > MAP.w || m.y > MAP.h) return;
      confirmKey = null;
      probeAt(m.x, m.y, null);
      renderPlaces(); renderProbeMark(); renderProbe();
    });
    $('map').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var pl = e.target.closest ? e.target.closest('.place') : null, g = e.target.closest ? e.target.closest('.pin') : null;
      if (pl) { e.preventDefault(); selectPlace(pl.getAttribute('data-key')); }
      else if (g) { e.preventDefault(); setSpot(byId[g.getAttribute('data-id')]); }
    });

    /* The naming sheet for saved places. */
    $('placeForm').addEventListener('submit', function (e) { e.preventDefault(); savePlaceSheet(); });
    $('placeCancel').addEventListener('click', function () { sheetFor = null; closeSheet('placeSheet'); });
    $('placeSheet').addEventListener('click', function (e) { if (e.target === this) { sheetFor = null; closeSheet('placeSheet'); } });
    $('layers').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-layer]') : null;
      if (!b) return;
      var key = b.getAttribute('data-layer');
      state.layers[key] = !state.layers[key];
      b.setAttribute('aria-pressed', state.layers[key] ? 'true' : 'false');
      b.querySelector('.pip').className = 'pip' + (state.layers[key] ? ' on' : '');
      renderOverlay();
      if (key === 'marks') renderProbe();   /* the reading names marks only while they show */
      if (key === 'route') drawRouteMap();
    });
    $('probe').addEventListener('click', function (e) {
      var tAttr = e.target.getAttribute ? e.target.getAttribute('data-t') : null;
      if (tAttr) { pinTime(+tAttr); return; }
      var act = e.target.closest ? e.target.closest('[data-act]') : null;
      if (act && act.getAttribute('data-act') === 'reload') sync();
      if (act && act.getAttribute('data-act') === 'limits') { renderLimits(); openSheet('limits'); return; }
      if (act && act.getAttribute('data-act') === 'route-swap') { swapRoute(); return; }
      if (act && act.getAttribute('data-act') === 'clearprobe') { state.probe = null; confirmKey = null; renderPlaces(); renderProbeMark(); renderProbe(); }
      else if (act) placeAction(act.getAttribute('data-act'));
      var go = e.target.closest ? e.target.closest('[data-go]') : null;
      if (go) openGo(go.getAttribute('data-go'));
      var rt = e.target.closest ? e.target.closest('[data-route]') : null;
      if (rt) routeToPlace(rt.getAttribute('data-route'));
    });

    /* The route: Swap, Close route, and Limits when no boat speed is set. Show day display and Show route
       switch the right-hand column between the day display and the route panel. */
    $('routeUnit').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null, act = b && b.getAttribute('data-act');
      if (act === 'route-swap') swapRoute();
      else if (act === 'route-close') closeRoute();
      else if (act === 'reload') sync();
      else if (act === 'limits') { renderLimits(); openSheet('limits'); }
    });
    $('dayToggle').addEventListener('click', toggleDayDisplay);
    $('nowRouteClose').addEventListener('click', closeRoute);
    if (window.ResizeObserver) new ResizeObserver(fitStrip).observe($('probe'));
    window.addEventListener('resize', fitStrip);
    /* The collapsed day display: a tap or click pins the time under it, and a mouse gets the hairline and time flag. */
    $('dayLane').addEventListener('click', function (e) {
      var lane = e.target.closest ? e.target.closest('.wk-lane') : null;
      if (lane) pinTime(laneTimeAt(lane, e.clientX));
    });
    $('dayLane').addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var lane = e.target.closest ? e.target.closest('.wk-lane') : null;
      weekHover(lane, e.clientX);
    });
    $('dayLane').addEventListener('pointerleave', function () { weekHover(null); });

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

    /* The display redraws when its box no longer matches the size it was drawn for: a new width, or, in the
       wide layout, a new height. */
    var pending = false;
    function onResize() {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(function () {
        pending = false;
        fitChart();
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
      state.wxFailedAt = 0; field.failedAt = 0; depth.failedAt = 0; contours.failedAt = 0; chart.failedAt = 0;
      tick();
    });
    window.addEventListener('online', function () {
      state.wxFailedAt = 0; field.failedAt = 0; depth.failedAt = 0; contours.failedAt = 0; chart.failedAt = 0;
      loadWeather(false); syncField(false); loadDepth(false); loadChartMarks(false);
    });

    /* The Week rows and the depth tints take their colors from the theme, so a change of theme draws them again. */
    var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function themeChanged() { renderWeek(); renderDepthLayers(); }
    if (dark && dark.addEventListener) dark.addEventListener('change', themeChanged);
    else if (dark && dark.addListener) dark.addListener(themeChanged);

    setScreen(state.screen);
    buildMask();
    buildSites();
    readCachedField();
    readPlaces();
    renderMap();
    renderPlaces();
    wireMapGestures();
    wireNow();
    wireFull();
    renderAll();
    loadWeather(false);
    loadDepth(false);
    loadChartMarks(false);
    if (store.get('gulf-almanac-fullmap') === '1') setFull(true);

    /* The service worker keeps the page and its fonts on the device for use without a connection.
       Browsers allow it only on https or on this computer, so a page opened from a file runs without it. */
    if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* the page works without it */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
