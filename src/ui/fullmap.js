/* The full-screen map: a layout of the page, not the browser's full-screen mode, in which the map fills the window
   on the Day or the Now screen. Exit sits at the top left with the map's time; the view buttons and zoom at the
   top right; the layer buttons and one key at the left; the probe reading as a card at the right; and the time
   bar, with the route's strip above it, in one panel along the bottom. The iPad stores the choice. */

  var full = { on: false, bar: null };
  var FULL_GAP = 12;   /* pixels kept between a panel and the probe or the selected spot */
  var NARROW_PX = 760;   /* the width up to which the layout of a narrow screen applies, as in style.css */

  function fullAllowed() { return state.screen === 'day' || state.screen === 'now'; }

  /* The Day screen's time bar, or the Now screen's step buttons, moves into the bottom panel, and the probe
     reading into the card. Leaving puts each back where it came from. */
  function setFull(on) {
    on = !!on && fullAllowed();
    if (on === full.on) return;
    full.on = on;
    store.set('gulf-almanac-fullmap', on ? '1' : '0');
    document.documentElement.classList.toggle('fullmap', on);
    if (on) {
      var bar = state.mapScreen === 'day' ? $('timebar') : $('nowSteps');
      full.bar = { el: bar, parent: bar.parentNode, next: bar.nextSibling };
      $('fmBottom').appendChild(bar);
      $('fmCard').appendChild($('probe'));
    } else {
      if (full.bar) full.bar.parent.insertBefore(full.bar.el, full.bar.next);
      full.bar = null;
      $(state.mapScreen + 'GoSlot').appendChild($('probe'));
      $('fmStrip').innerHTML = '';
      $('mapFrame').classList.remove('fm-card-open');
    }
    $('fmTop').hidden = !on; $('fmBottom').hidden = !on; $('fullOpen').hidden = on;
    $('fmCard').hidden = true;
    frame.w = 0; frame.h = 0;   /* the next measure applies the view at the frame's new size */
    measureMap();
    applyView();   /* in full screen a drag always moves the map, even at zoom 1, since no page scrolls under it */
    renderGulf(); renderRoute(); renderTimebar();
    if (on) fullKeepClear();
    (on ? $('fullExit') : $('fullOpen')).focus();
  }

  /* The map's time in the top bar: "Gulf at 14:05, pinned", or now, or a step ahead on the Now screen. */
  function renderFullTime() {
    var el = $('fmTime');
    if (!el || !full.on) return;
    var t = mapTime();
    el.textContent = state.mapScreen === 'now' ? (state.nowStep ? 'Gulf at ' + E.fmtTime(t) + ', in ' + state.nowStep + ' h' : 'Gulf now, ' + E.fmtTime(t)) :
      state.pin != null ? 'Gulf at ' + E.fmtTime(t) + ', pinned' + (E.dayStart(t) !== E.dayStart(Date.now()) ? ', ' + E.fmtDay(t) : '') : 'Gulf now, ' + E.fmtTime(t);
  }

  /* The panels never cover the probe or the selected spot: the map moves so both lie in the open part of the
     frame, by the least distance. Where both cannot, the probe wins. At zoom 1 the map cannot move. */
  function fullKeepClear() {
    if (!full.on || !frame.h) return;
    var fr = $('mapFrame').getBoundingClientRect();
    function box(id) {
      var el = $(id);
      if (!el || el.hidden || !el.offsetParent) return null;
      var r = el.getBoundingClientRect();
      return r.width && r.height ? r : null;
    }
    var L = fr.left, R = fr.right, T = fr.top, B = fr.bottom;
    ['layers', 'mapKey'].forEach(function (id) { var r = box(id); if (r) L = Math.max(L, r.right); });
    var top = box('fmTop'), views = box('mapCtl');
    if (top) T = Math.max(T, top.bottom);
    /* On a narrow screen the view buttons stand in a column at the right; on a wide one, in a row at the top. */
    if (views && fr.width <= NARROW_PX) R = Math.min(R, views.left);
    else if (views) T = Math.max(T, views.bottom);
    var card = box('fmCard'), bottom = box('fmBottom');
    /* The card sits at the right, or, on a narrow screen, across the width above the bottom panel. */
    if (card && card.width > fr.width / 2) B = Math.min(B, card.top);
    else if (card) R = Math.min(R, card.left);
    if (bottom) B = Math.min(B, bottom.top);
    L += FULL_GAP; R -= FULL_GAP; T += FULL_GAP; B -= FULL_GAP;
    if (R <= L || B <= T) return;
    var vb = viewBox(), sx = fr.width / vb.w, sy = fr.height / vb.h, pts = [];
    if (state.probe) pts.push(state.probe);
    pts.push({ x: mapX(state.spot.lon), y: mapY(state.spot.lat) });
    function range(p) {
      var px = fr.left + (p.x - vb.x) * sx, py = fr.top + (p.y - vb.y) * sy;
      return { x0: L - px, x1: R - px, y0: T - py, y1: B - py };
    }
    var want = range(pts[0]);
    if (pts.length > 1) {
      var s = range(pts[1]), both = { x0: Math.max(want.x0, s.x0), x1: Math.min(want.x1, s.x1), y0: Math.max(want.y0, s.y0), y1: Math.min(want.y1, s.y1) };
      if (both.x0 <= both.x1 && both.y0 <= both.y1) want = both;
    }
    var dx = clamp(0, want.x0, want.x1), dy = clamp(0, want.y0, want.y1);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    view.cx -= dx / sx; view.cy -= dy / sy; view.preset = null;
    applyView();
  }

  /* The probe card shows while there is a reading. Its height follows its content, so the map is checked again. */
  function renderFullCard() {
    if (!full.on) return;
    var open = !!(state.probe || state.moving != null);
    $('fmCard').hidden = !open;
    $('mapFrame').classList.toggle('fm-card-open', open);
    window.requestAnimationFrame(fullKeepClear);
  }

  function wireFull() {
    $('fullOpen').addEventListener('click', function () { setFull(true); });
    $('fullExit').addEventListener('click', function () { setFull(false); });
    /* Escape leaves, unless a sheet is open, where Escape closes the sheet, or the time bar or the day display has
       the focus, where Escape unpins the time. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !full.on || document.querySelector('dialog[open]')) return;
      if (e.target && e.target.closest && e.target.closest('#tbTrack, #chart')) return;
      e.preventDefault(); setFull(false);
    });
    /* The card's limit is the space above the bottom panel, whose height changes with the route's strip. */
    function fitPanels() {
      var b = $('fmBottom');
      $('mapFrame').style.setProperty('--fmb', (full.on && b ? b.offsetHeight : 0) + 'px');
    }
    if (window.ResizeObserver) new ResizeObserver(function () { fitPanels(); if (full.on) fullKeepClear(); }).observe($('fmBottom'));
    window.addEventListener('resize', function () { fitPanels(); if (full.on) window.requestAnimationFrame(fullKeepClear); });
  }
