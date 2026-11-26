/* State changes shared by all screens, and the event wiring. Runs last. */

  /* ---------- State changes ---------- */

  function renderPin() {
    var pinned = state.pin != null;
    $('pinLamp').className = 'pip' + (pinned ? '' : ' on');
    $('pinText').textContent = pinned ? 'Pinned at ' + E.fmtTime(state.pin) + ', ' + E.fmtDay(state.pin) + '.' : 'Following now.';
    $('unpin').disabled = !pinned;
  }

  function renderAll() {
    $('spot').value = state.spot.id;
    $('date').value = E.isoDate(state.d0 + 12 * HOUR);
    $('tablesFor').textContent = state.spot.name + ', ' + E.fmtDay(state.d0 + 12 * HOUR);
    renderStatus(); renderPlace(); renderPin(); renderChart(); renderReadout(); renderCards(); renderWeather(); renderAhead(); markMap(); renderGulf();
  }

  function setSpot(sp) {
    if (!sp) return;
    state.spot = sp; state.cursor = null;
    store.set('gulf-almanac-spot', sp.id);
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
  }

  function openTables() {
    var d = $('tables');
    if (d.open) return;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  function closeTables() {
    var d = $('tables');
    if (d.close) d.close(); else d.removeAttribute('open');
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
      renderStatus();
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
    $('unpin').addEventListener('click', unpin);

    $('screens').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-screen]') : null;
      if (b) setScreen(b.getAttribute('data-screen'));
    });
    $('sync').addEventListener('click', sync);
    $('tablesOpen').addEventListener('click', openTables);
    $('tablesClose').addEventListener('click', closeTables);
    /* A tap outside the sheet lands on the dialog element itself, so it closes the sheet. */
    $('tables').addEventListener('click', function (e) { if (e.target === this) closeTables(); });

    /* Map: a lamp selects a spot, any other point on the water places the probe. */
    $('map').addEventListener('click', function (e) {
      var g = e.target.closest ? e.target.closest('.pin') : null;
      if (g) { setSpot(byId[g.getAttribute('data-id')]); return; }
      var svg = $('map').querySelector('svg'), r = svg.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width * MAP.w, y = (e.clientY - r.top) / r.height * MAP.h;
      if (isWater(x, y)) { state.probe = { x: x, y: y, w: nearest(x, y), near: landWithin(x, y, NEAR_LAND_KM) }; state.probeMiss = false; }
      else { state.probeMiss = true; }
      renderOverlay(); renderProbe();
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
      if (e.target.getAttribute && e.target.getAttribute('data-act') === 'reload') sync();
    });

    /* A row in the days ahead opens that day on the Day screen. */
    $('ahead').addEventListener('click', function (e) {
      var tr = e.target.closest ? e.target.closest('tr[data-d0]') : null;
      if (!tr) return;
      setDay(+tr.getAttribute('data-d0'));
      closeTables(); setScreen('day'); toTop();
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

    var lastW = 0, pending = false;
    function onResize() {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(function () {
        pending = false;
        var w = Math.floor(host.clientWidth);
        if (w && w !== lastW) { lastW = w; renderChart(); }
      });
    }
    if (window.ResizeObserver) { new ResizeObserver(onResize).observe(host); }
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
    renderAll();
    lastW = Math.floor(host.clientWidth);
    loadWeather(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
