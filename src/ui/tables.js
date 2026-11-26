/* The tables behind the Tables button: tides, solunar, sun, moon, weather and the days ahead. */

  /* ---------- Day tables ---------- */

  function shiftWords(mins) {
    return mins === 0 ? 'at the same time' : Math.abs(mins) + ' min ' + (mins > 0 ? 'later' : 'earlier');
  }

  function renderCards() {
    var d = E.day(state.spot, state.d0), sp = state.spot, sun = d.sun, moon = d.moon, html;
    var now = Date.now(), isToday = now >= d.d0 && now < d.d1;
    var tn = isToday ? E.tideNow(sp, now) : null;
    function head(idx, text) { return '<h3 class="stage"><span class="idx">' + idx + '</span>' + text + '</h3>'; }
    function row(k, v, note) { return '<tr><th scope="row">' + k + (note ? ' <span class="note">' + note + '</span>' : '') + '</th><td>' + v + '</td></tr>'; }

    /* Tides */
    html = head('01', 'Tides') + '<table class="kv"><tbody>';
    d.extremes.forEach(function (e) {
      html += row(e.hi ? 'High water' : 'Low water', '<span class="strong">' + E.fmtTime(e.t) + '</span>&ensp;' + meters(e.h));
    });
    html += '</tbody></table><div class="trend" aria-hidden="true"><span><i class="pip' + (tn && tn.rising === true ? ' on' : '') + '"></i>Rising</span>' +
      '<span><i class="pip' + (tn && tn.rising === false ? ' on' : '') + '"></i>Falling</span></div>';
    var pos = null;
    if (d.range != null) {
      pos = clamp(25 + (d.range - d.neapRange) / (d.springRange - d.neapRange) * 55, 2, 98);
      var fromPos = state.prevPos == null ? pos : state.prevPos;
      html += '<div class="ruler" role="img" aria-label="Tidal range today ' + f1(d.range) + ' meters. Mean neap range ' + f1(d.neapRange) + ' meters, mean spring range ' + f1(d.springRange) + ' meters.">' +
        '<span class="ticks"></span><span class="base"></span><span class="mark" style="left:25%"></span><span class="mark" style="left:80%"></span>' +
        '<span class="needle" id="rNeedle" style="left:' + fromPos.toFixed(1) + '%"></span></div>' +
        '<div class="rulerkey" aria-hidden="true"><span style="left:25%">neap ' + f1(d.neapRange) + '</span><span style="left:80%">spring ' + f1(d.springRange) + '</span></div>' +
        '<p class="small">Range today ' + meters(d.range) + '. ' +
        (sp.std ? 'Auckland is the standard port for the Gulf.' :
          'Worked from Auckland: high water ' + shiftWords(sp.hw) + ', low water ' + shiftWords(sp.lw) + ', range times ' + sp.ratio.toFixed(2) + '.') + '</p>';
    }
    $('cardTides').innerHTML = html;
    if (pos != null) { settle('rNeedle', 'left', pos.toFixed(1) + '%'); state.prevPos = pos; }

    /* Solunar */
    var sol = d.solunar, fromScore = state.prevScore == null ? sol.score : state.prevScore;
    html = head('02', 'Solunar') + '<div class="gauge">' + gauge(sol.score, fromScore) + '<div><b>' + sol.label + '</b><span>' + sol.score + ' / 100</span></div></div><table class="kv"><tbody>';
    sol.periods.filter(function (p) { return p.inDay; }).forEach(function (p) {
      var live = isToday && now >= p.start && now <= p.end;
      html += '<tr><th scope="row"><i class="pip' + (live ? ' on' : '') + '" aria-hidden="true"></i><span class="strong">' + (p.major ? 'Major' : 'Minor') + '</span> <span class="note">' +
        p.cause.toLowerCase() + (p.sunEvent ? ', at ' + p.sunEvent : '') + '</span></th><td>' + E.fmtTime(p.start) + '–' + E.fmtTime(p.end) + '</td></tr>';
    });
    html += '</tbody></table><p class="small">A rule of thumb. Periods that fall on sunrise or sunset count for more. A lit lamp marks a period in progress.</p>';
    $('cardSolunar').innerHTML = html;
    settle('gNeedle', 'transform', 'rotate(' + (sol.score * 1.8).toFixed(1) + 'deg)');
    state.prevScore = sol.score;

    /* Sun */
    html = head('03', 'Sun') + '<table class="kv"><tbody>' +
      row('First light', E.fmtTime(sun.dawn), 'sun 6° below') +
      row('Sunrise', '<span class="strong">' + E.fmtTime(sun.rise) + '</span>') +
      row('Solar noon', E.fmtTime(sun.noon), Math.round(sun.noonAlt) + '° up') +
      row('Sunset', '<span class="strong">' + E.fmtTime(sun.set) + '</span>') +
      row('Last light', E.fmtTime(sun.dusk), 'sun 6° below') +
      row('Daylight', sun.dayLength == null ? '–' : E.fmtDuration(sun.dayLength)) +
      '</tbody></table>';
    $('cardSun').innerHTML = html;

    /* Moon */
    function times(list) { return list.length ? list.map(function (x) { return E.fmtTime(x.t != null ? x.t : x); }).join(', ') : 'None this day'; }
    var phases = E.nextPhases(d.d0, 3), aps = E.nextApsides(d.d0);
    html = head('04', 'Moon') + '<div class="moonhead">' + moonSvg(moon.fraction, moon.limb, 56) +
      '<div><b>' + moon.name + '</b><span>' + Math.round(moon.fraction * 100) + '% lit, ' + Math.round(moon.distanceKm / 1000) + ',000 km</span></div></div><table class="kv"><tbody>' +
      row('Moonrise', times(moon.rises)) + row('Moonset', times(moon.sets)) +
      row('Overhead', times(moon.upper), moon.upper.length ? Math.round(moon.upper[0].alt) + '° up' : '') +
      row('Underfoot', times(moon.lower));
    phases.forEach(function (ph) { html += row(ph.name, E.fmtDay(ph.t)); });
    html += row(aps[0].perigee ? 'Perigee' : 'Apogee', E.fmtDay(aps[0].t), aps[0].perigee ? 'moon nearest' : 'moon farthest') + '</tbody></table>';
    $('cardMoon').innerHTML = html;
  }

  /* ---------- Weather block ---------- */

  function renderWeather() {
    var el = $('weather'), wx = state.wx[state.spot.id], d = E.day(state.spot, state.d0), sp = state.spot;
    var title = '<h3 class="stage"><span class="idx">05</span>Weather</h3>';
    if (!wx || (wx.status === 'loading' && !wx.recs)) {
      el.innerHTML = title + '<div class="meta"><span>Loading the forecast from Open-Meteo.</span></div>';
      return;
    }
    if (wx.status === 'failed' && !wx.recs) {
      el.innerHTML = title + '<div class="notice"><div class="grille" aria-hidden="true"></div><div class="notice-body">' +
        '<b><span class="pip alert" aria-hidden="true"></span>The forecast did not load.</b>' +
        '<p>This page gets its weather from Open-Meteo over the internet, and that request failed. The page tries again every 10 minutes, and when you return to it. Sync tries at once.</p>' +
        '<p>Tides, sun, moon and solunar periods are computed in the page. They do not need the forecast.</p>' +
        '<button type="button" data-act="reload">Load the forecast now</button></div></div>';
      return;
    }
    var hrs = dayRecs(d.d0, d.d1), span = wxSpan();
    var meta = 'Forecast for ' + Math.abs(sp.lat).toFixed(2) + '°S ' + sp.lon.toFixed(2) + '°E, loaded ' + E.fmtDay(wx.at) + ' at ' + E.fmtTime(wx.at) + '.';
    if (wx.status === 'failed') meta += ' A newer forecast did not load.';
    if (wx.status === 'loading') meta += ' Checking for a newer forecast.';
    var sst = null;
    hrs.forEach(function (q) { if (sst == null && ok(q.r.sst)) sst = q.r.sst; });
    if (sst != null) meta += ' Sea surface ' + f1(sst) + ' °C.';
    var head = title + '<div class="meta"><span>' + meta + '</span><button type="button" data-act="reload">Load again</button></div>';

    if (!hrs.length) {
      el.innerHTML = head + '<div class="notice"><div class="grille" aria-hidden="true"></div><div class="notice-body"><b>No forecast for this day.</b><p>The forecast covers ' +
        E.fmtDay(span.first) + ' to ' + E.fmtDay(span.last) + '. Choose a day in that range to see the weather hour by hour.</p></div></div>';
      return;
    }

    var step = window.innerWidth >= 1000 ? 2 : 3;
    var cols = hrs.filter(function (q) { return E.parts(q.t).H % step === 0; });
    function line(label, fn, cls) {
      var out = '<tr><th scope="row">' + label + '</th>';
      cols.forEach(function (q) { var c = cls ? cls(q.r) : ''; out += '<td' + (c ? ' class="' + c + '"' : '') + '>' + fn(q.r) + '</td>'; });
      return out + '</tr>';
    }
    function band(r) { var b = windBand(r.wind); return b ? 'w' + b : ''; }
    function gband(r) { var b = windBand(ok(r.gust) ? r.gust - 5 : null); return b ? 'w' + b : ''; }
    var hasWaves = hrs.some(function (q) { return ok(q.r.wave); });
    var t = '<div class="scrollx"><table class="grid"><thead><tr><th scope="col">Hour</th>';
    cols.forEach(function (q) { t += '<th scope="col">' + E.fmtTime(q.t) + '</th>'; });
    t += '</tr></thead><tbody>' +
      line('Sky', function (r) { return WMO[r.code] || '–'; }, function () { return 'txt'; }) +
      line('Wind, kn', function (r) { return arrow(r.dir) + compass(r.dir) + ' <b>' + Math.round(r.wind) + '</b>'; }, band) +
      line('Gusts, kn', function (r) { return ok(r.gust) ? Math.round(r.gust) : '–'; }, gband);
    if (hasWaves) {
      t += line('Waves, m', function (r) { return ok(r.wave) ? arrow(r.wdir) + f1(r.wave) : '–'; }) +
        line('Wave period, s', function (r) { return ok(r.wper) ? Math.round(r.wper) : '–'; }) +
        line('Swell, m', function (r) { return ok(r.swell) ? arrow(r.sdir) + f1(r.swell) : '–'; });
    }
    t += line('Rain, mm', function (r) { return ok(r.rain) ? (r.rain >= 0.05 ? f1(r.rain) : '0') : '–'; }) +
      line('Chance of rain', function (r) { return ok(r.pop) ? Math.round(r.pop) + '%' : '–'; }) +
      line('Cloud', function (r) { return ok(r.cloud) ? Math.round(r.cloud) + '%' : '–'; }) +
      line('Air, °C', function (r) { return ok(r.temp) ? Math.round(r.temp) : '–'; }) +
      line('Pressure, hPa', function (r) { return ok(r.p) ? Math.round(r.p) : '–'; }) +
      '</tbody></table></div>';
    var foot = '<p class="small">Arrows point the way the wind and waves are traveling. Gray tint marks wind from 10 and 15 knots. Red tint marks wind from 20 and 25 knots.' +
      (hasWaves ? '' : ' The wave model has no data for this spot.') + '</p>';
    el.innerHTML = head + t + foot;
  }

  /* ---------- Days ahead ---------- */

  function renderAhead() {
    var el = $('ahead'), today = E.dayStart(Date.now());
    var inWindow = state.d0 >= today && state.d0 < E.addDays(today, 14);
    var start = inWindow ? today : state.d0;
    var wx = state.wx[state.spot.id], hasWx = !!(wx && wx.recs);
    var h = '<h3 class="stage"><span class="idx">06</span>14 days from ' + E.fmtDay(start + 12 * HOUR) + '</h3>' +
      '<div class="meta"><span>Select a row to open that day.</span></div>' +
      '<div class="scrollx"><table class="ahead"><thead><tr><th scope="col">Day</th><th scope="col">Moon</th><th scope="col">High water, m</th><th scope="col">Range, m</th>' +
      '<th scope="col">Solunar</th><th scope="col">Major periods</th>' +
      (hasWx ? '<th scope="col">Wind in daylight, kn</th><th scope="col">Gusts</th><th scope="col">Waves, m</th><th scope="col">Rain, mm</th>' : '') + '</tr></thead><tbody>';
    var d0 = start;
    for (var i = 0; i < 14; i++) {
      var d = E.day(state.spot, d0), m = d.moon, on = d0 === state.d0;
      var highs = d.extremes.filter(function (e) { return e.hi; }).map(function (e) { return E.fmtTime(e.t) + ' ' + f1(e.h); }).join(', ');
      var majors = d.solunar.periods.filter(function (p) { return p.major && p.inDay; }).map(function (p) { return E.fmtTime(p.start) + '–' + E.fmtTime(p.end); }).join(', ');
      var fill = d.range == null ? 0 : clamp(d.range / (1.2 * d.springRange) * 100, 0, 100);
      h += '<tr data-d0="' + d0 + '"' + (on ? ' class="sel"' : '') + '>' +
        '<th scope="row"><button type="button" class="daybtn"' + (on ? ' aria-current="date"' : '') + '><i class="pip' + (on ? ' on' : '') + '" aria-hidden="true"></i>' + E.fmtDay(d0 + 12 * HOUR) + '</button></th>' +
        '<td><span class="mooncell">' + moonSvg(m.fraction, m.limb, 16) + Math.round(m.fraction * 100) + '%</span></td>' +
        '<td>' + highs + '</td>' +
        '<td><span class="bar"><i style="width:' + fill.toFixed(0) + '%"></i></span>' + (d.range == null ? '–' : f1(d.range)) + '</td>' +
        '<td class="txt">' + pips(d.solunar.level) + d.solunar.label + '</td>' +
        '<td>' + majors + '</td>';
      if (hasWx) {
        var su = daySummary(d);
        if (su) {
          var b = windBand(su.hi), gb = windBand(su.gust - 5);
          h += '<td' + (b ? ' class="w' + b + '"' : '') + '>' + arrow(su.dir) + compass(su.dir) + ' ' + Math.round(su.lo) + '–' + Math.round(su.hi) + '</td>' +
            '<td' + (gb ? ' class="w' + gb + '"' : '') + '>' + (isFinite(su.gust) ? Math.round(su.gust) : '–') + '</td>' +
            '<td>' + (su.wave == null ? '–' : f1(su.wave)) + '</td>' +
            '<td>' + (su.rain >= 0.05 ? f1(su.rain) : '0') + '</td>';
        } else {
          h += '<td class="muted">–</td><td class="muted">–</td><td class="muted">–</td><td class="muted">–</td>';
        }
      }
      h += '</tr>';
      d0 = E.addDays(d0, 1);
    }
    el.innerHTML = h + '</tbody></table></div>';
  }

