/* Saved places: the owner's numbered marks, and home, where the boat goes into and comes out of the water.
   The iPad stores them. A place is saved from the probe, and selected, renamed, moved or deleted on the map. */

  /* ---------- Saved places ---------- */

  var confirmKey = null;    /* the place whose Delete button now asks for confirmation */
  var sheetFor = null;      /* what the naming sheet will do: { kind: 'mark' | 'home' | 'rename', key, x, y } */

  function onMap(p) {
    return !!p && isFinite(p.lat) && isFinite(p.lon) && p.lat >= MAP.S && p.lat <= MAP.N && p.lon >= MAP.W && p.lon <= MAP.E;
  }
  function readPlaces() {
    var marks = [], home = null;
    try {
      var m = JSON.parse(store.get('gulf-almanac-marks') || '[]');
      if (Array.isArray(m)) marks = m.filter(function (q) { return onMap(q) && q.n >= 1 && typeof q.name === 'string'; });
      var h = JSON.parse(store.get('gulf-almanac-home') || 'null');
      if (onMap(h) && typeof h.name === 'string') home = h;
    } catch (e) { /* start with no saved places */ }
    state.marks = marks; state.home = home;
  }
  /* Every change to a saved place passes through here. The Now screen measures the run home from home,
     so it redraws too; off the Now screen that call does nothing. */
  function savePlaces() {
    store.set('gulf-almanac-marks', JSON.stringify(state.marks));
    store.set('gulf-almanac-home', JSON.stringify(state.home));
    renderNowSide();
  }
  function markByN(n) {
    for (var i = 0; i < state.marks.length; i++) if (state.marks[i].n === n) return state.marks[i];
    return null;
  }
  /* A key names a saved place: 'home', or a mark's number as text. */
  function placeOf(key) { return key === 'home' ? state.home : markByN(+key); }
  function placeTitle(key) {
    var p = placeOf(key);
    if (!p) return '';
    return (key === 'home' ? 'Home' : 'Mark ' + p.n) + (p.name ? ', ' + p.name : '');
  }
  /* The lowest number no mark uses, so a deleted mark's number is used again. */
  function nextMarkNumber() { for (var n = 1; ; n++) if (!markByN(n)) return n; }

  /* The probe can sit anywhere on the map. Off Gulf water it gives a position and no estimates. */
  function probeAt(x, y, key) {
    var water = isWater(x, y);
    state.probe = { x: x, y: y, w: nearest(x, y), water: water, near: water && landWithin(x, y, NEAR_LAND_KM), key: key == null ? null : String(key) };
  }
  function selectPlace(key) {
    if (key.charAt(0) === 's') { openGo(key); return; }   /* a suggestion from Where to go */
    var p = placeOf(key);
    if (!p) return;
    confirmKey = null;
    probeAt(mapX(p.lon), mapY(p.lat), key);
    renderPlaces(); renderProbeMark(); renderProbe();
  }

  /* ---------- Saved places on the map ---------- */

  /* One place on the map: a numbered disc for a mark or a suggestion, a square H for home. */
  function placeGlyph(key, mx, my, label, cls, title, sel) {
    var x = mx.toFixed(2), y = my.toFixed(2);
    return '<g class="place ' + cls + (sel ? ' sel' : '') + '" data-key="' + key + '" data-at="' + x + ' ' + y + '" transform="translate(' + x + ' ' + y + ') scale(' + glyph().toFixed(4) + ')"' +
      ' tabindex="0" role="button" aria-label="' + esc(title) + '"><circle class="hit" r="12"/><circle class="ring" r="8.6"/>' +
      (cls === 'home' ? '<rect class="disc" x="-5.6" y="-5.6" width="11.2" height="11.2" rx="1.6"/>' : '<circle class="disc" r="5.9"/>') +
      '<text y="2.5" text-anchor="middle">' + label + '</text></g>';
  }

  /* The saved places. Only the owner's own actions redraw them, so a timer never removes a disc that has
     the keyboard's focus or is under a finger. */
  function renderPlaces() {
    var svg = $('mapSvg');
    if (!svg) return;
    var sel = state.probe && state.probe.key, out = '';
    state.marks.forEach(function (m) { var k = String(m.n); out += placeGlyph(k, mapX(m.lon), mapY(m.lat), m.n, 'mark', placeTitle(k), sel === k); });
    if (state.home) out += placeGlyph('home', mapX(state.home.lon), mapY(state.home.lat), 'H', 'home', placeTitle('home'), sel === 'home');
    svg.querySelector('#ovPlaces').innerHTML = out;
    renderReach();
  }

  /* The layers that follow the starting point, none of which takes a tap: the reach of Where to go, a dashed
     ring around its starting point; and on the Now screen the iPad's position, an ink dot, with a ring for
     its accuracy once that is over 50 m, and the line of the run home. A new position redraws only these.
     They take no taps, so they can redraw whenever the starting point may have moved. */
  function renderReach() {
    var svg = $('mapSvg');
    if (!svg) return;
    var o = goOrigin(), ring = '', you = '', x = o.x.toFixed(2), y = o.y.toFixed(2);
    if (o.you) {
      you = '<g class="you" data-at="' + x + ' ' + y + '" transform="translate(' + x + ' ' + y + ') scale(' + glyph().toFixed(4) + ')">' +
        '<circle class="dot" r="4.4"/><text x="7.5" y="2.6">You</text></g>';
      if (geo.pos.acc > 50) ring = '<circle class="m-acc" cx="' + x + '" cy="' + y + '" r="' + (geo.pos.acc / 1852 * NM).toFixed(2) + '"/>';
    }
    /* On the Now screen, the run home: a straight line from the starting point to home. */
    if (state.mapScreen === 'now' && state.home) {
      ring += '<line class="m-run" x1="' + x + '" y1="' + y + '" x2="' + mapX(state.home.lon).toFixed(2) + '" y2="' + mapY(state.home.lat).toFixed(2) + '"/>';
    }
    /* The reach belongs to the suggestions, so it goes while a route is open. */
    if (!routeShown()) ring += '<circle class="m-reach" cx="' + x + '" cy="' + y + '" r="' + (REACH_NM * NM).toFixed(2) + '"/>';
    svg.querySelector('#ovReach').innerHTML = ring;
    svg.querySelector('#ovYou').innerHTML = you;
  }

  /* The suggestions, redrawn only when the set changes. */
  function renderSuggestions() {
    var layer = $('ovSugg');
    if (!layer) return;
    var sig = suggestions.map(function (q) { return q.key + ' ' + q.x + ' ' + q.y; }).join('|');
    if (layer.getAttribute('data-sig') === sig) return;
    layer.setAttribute('data-sig', sig);
    layer.innerHTML = suggestions.map(function (q) { return placeGlyph(q.key, q.x, q.y, q.label, 'sugg', 'Calmest water ' + q.label, false); }).join('');
  }

  /* ---------- The probe reading's head: the place and what can be done with it ---------- */

  function probeHead() {
    var p = state.probe, key = p.key, acts;
    var pos = degMin(mapLat(p.y), 'N', 'S') + ' ' + degMin(mapLon(p.x), 'E', 'W');
    if (key && confirmKey === key) {
      acts = '<span class="ask">' + (key === 'home' ? 'Remove home?' : 'Delete mark ' + key + '?') + '</span>' +
        '<button type="button" data-act="delete-yes">' + (key === 'home' ? 'Remove' : 'Delete') + '</button>' +
        '<button type="button" data-act="delete-no">Keep</button>';
    } else if (key) {
      acts = routeButton(key) + '<button type="button" data-act="rename">Rename</button><button type="button" data-act="move">Move</button>' +
        '<button type="button" data-act="delete">' + (key === 'home' ? 'Remove' : 'Delete') + '</button>';
    } else {
      acts = routeButton(null) + '<button type="button" data-act="savemark">Save mark</button><button type="button" data-act="sethome">Set home</button>';
    }
    /* Four buttons leave the name too little room on one line, so they take a line of their own. */
    var many = (acts.match(/<button/g) || []).length >= 4;
    return '<div class="probehead' + (many ? ' many' : '') + '"><div class="probename"><b>' + (key ? esc(placeTitle(key)) : 'Probe') + '</b><span>' + pos + '</span></div>' +
      '<button type="button" class="probex" data-act="clearprobe" aria-label="Close the reading">&times;</button>' +
      '<div class="probeacts">' + acts + '</div></div>';
  }

  /* The Route button opens a route from the starting point of Where to go to this point. The Day screen has it.
     Home has none while home is the starting point. */
  function routeButton(key) {
    if (state.mapScreen !== 'day' || (key === 'home' && state.home)) return '';
    return '<button type="button" data-act="route">Route</button>';
  }

  /* While a place moves, the next tap on the map gives its new position. */
  function movingPanel() {
    return '<div class="probehead"><div class="probename"><b>Move ' + esc(placeTitle(state.moving)) + '</b>' +
      '<span>Tap the map at the new position.</span></div><div class="probeacts"><button type="button" data-act="move-cancel">Cancel</button></div></div>';
  }
  function movePlaceTo(x, y) {
    var p = placeOf(state.moving), key = state.moving;
    state.moving = null;
    if (p && x >= 0 && y >= 0 && x <= MAP.w && y <= MAP.h) {
      p.lat = +mapLat(y).toFixed(5); p.lon = +mapLon(x).toFixed(5);
      savePlaces();
      if (key === 'home' && view.preset === 'spot') setPreset('spot');
    }
    selectPlace(key);
  }

  /* ---------- Probe actions ---------- */

  function placeAction(act) {
    var p = state.probe, key = p && p.key;
    if (act === 'savemark' && p) openPlaceSheet({ kind: 'mark', x: p.x, y: p.y });
    else if (act === 'sethome' && p) openPlaceSheet({ kind: 'home', x: p.x, y: p.y });
    else if (act === 'rename' && key) openPlaceSheet({ kind: 'rename', key: key });
    else if (act === 'route' && p) routeToProbe();
    else if (act === 'move' && key) { state.moving = key; confirmKey = null; renderProbe(); }
    else if (act === 'move-cancel') { var k = state.moving; state.moving = null; if (k) selectPlace(k); else renderProbe(); }
    else if (act === 'delete' && key) { confirmKey = key; renderProbe(); }
    else if (act === 'delete-no') { confirmKey = null; renderProbe(); }
    else if (act === 'delete-yes' && key) {
      if (key === 'home') state.home = null;
      else state.marks = state.marks.filter(function (m) { return String(m.n) !== key; });
      savePlaces();
      confirmKey = null; state.probe = null;
      if (key === 'home' && view.preset === 'spot') setPreset('spot');
      renderPlaces(); renderProbeMark(); renderProbe(); markViewButtons();
    }
  }

  /* ---------- The naming sheet ---------- */

  function openPlaceSheet(what) {
    sheetFor = what;
    var title = { mark: 'Save mark ' + nextMarkNumber(), home: state.home ? 'Move home here' : 'Set home here', rename: 'Rename ' + placeTitle(what.key) }[what.kind];
    $('placeSheetTitle').textContent = title;
    var input = $('placeNameInput');
    input.value = what.kind === 'rename' ? placeOf(what.key).name : what.kind === 'home' && state.home ? state.home.name : '';
    input.placeholder = what.kind === 'home' || what.key === 'home' ? 'For example, the ramp or marina' : 'For example, the reef or channel';
    $('placeHomeNote').hidden = !(what.kind === 'home' && state.home);
    openSheet('placeSheet');
    input.focus();
  }
  function savePlaceSheet() {
    var what = sheetFor, name = $('placeNameInput').value.replace(/\s+/g, ' ').trim().slice(0, 40), key;
    sheetFor = null;
    closeSheet('placeSheet');
    if (!what) return;
    if (what.kind === 'rename') {
      var p = placeOf(what.key);
      if (p) p.name = name;
      key = what.key;
    } else {
      var spot = { name: name, lat: +mapLat(what.y).toFixed(5), lon: +mapLon(what.x).toFixed(5) };
      if (what.kind === 'home') { state.home = spot; key = 'home'; }
      else { spot.n = nextMarkNumber(); state.marks.push(spot); key = String(spot.n); }
    }
    savePlaces();
    if (key === 'home' && view.preset === 'spot') setPreset('spot');
    markViewButtons();
    selectPlace(key);
  }
