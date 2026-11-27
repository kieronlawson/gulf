"""Render dist/index.html in headless Chromium and save a screenshot.

The forecast is mocked with made-up numbers, so the page can be checked where Open-Meteo is out of reach.
Needs: pip install playwright, then: playwright install chromium

Environment variables:
  MODE    wx (mock forecast, default) or nowx (forecast requests fail)
  DEVICE  a screen size in points, landscape unless noted:
            ipad (1180 by 820, default), ipad-9 (1080 by 810), ipad-mini (1133 by 744),
            ipad-pro-13 (1376 by 1032), ipad-portrait (820 by 1180), phone (390 by 844)
  W, VH   viewport width and height. Either one overrides the DEVICE value.
  SCALE   device pixel ratio (default 1). Use 2 for a screenshot a person will look at.
  SCREEN  week, day (default) or now: the screen the page opens on
  LAT, LON  position the page receives from the browser. Without them, the page gets no position.
  INIT    JavaScript to run before the page's own scripts, for example to store saved marks
  SCHEME  light (default) or dark
  FULL    1 (default) captures the whole page, 0 only the viewport
  SEL     CSS selector to capture instead of the whole page
  OUT     output file (default shot.png)
  URL     the page's address, such as http://localhost:8000/ for dist/ served by python3 -m http.server.
          Without it, the page opens from dist/index.html as a file, and the depths do not load, because a
          page opened from a file cannot fetch the files beside it. The browser blocks the service worker.
Arguments: JavaScript snippets to run in the page before the capture.
"""
import json, math, os, sys, pathlib
from playwright.sync_api import sync_playwright

DEVICES = {'ipad': (1180, 820), 'ipad-9': (1080, 810), 'ipad-mini': (1133, 744), 'ipad-pro-13': (1376, 1032),
           'ipad-portrait': (820, 1180), 'phone': (390, 844)}
env = os.environ.get
mode = env('MODE', 'wx'); dev_w, dev_h = DEVICES[env('DEVICE', 'ipad')]
width = int(env('W', dev_w)); vh = int(env('VH', dev_h)); scale = float(env('SCALE', '1'))
screen = env('SCREEN', 'day'); lat = env('LAT'); lon = env('LON'); full = env('FULL', '1') != '0'
scheme = env('SCHEME', 'light'); sel = env('SEL'); out = env('OUT', 'shot.png')
page_url = env('URL') or (pathlib.Path(__file__).resolve().parent.parent / 'dist' / 'index.html').as_uri()

def fake(kind, n_loc):
    """Made-up hourly values in the Open-Meteo response shape. For layout tests only."""
    t0 = 1795518000; n = 168; times = [t0 + i * 3600 for i in range(n)]  # 25 Nov 2026 00:00 NZDT
    res = []
    for k in range(n_loc):
        if kind == 'forecast':
            res.append({"hourly": {"time": times,
                "temperature_2m": [17 + 4 * math.sin((i - 9) / 24 * 2 * math.pi) for i in range(n)],
                "precipitation": [(0.6 if 30 < i < 40 else 0) for i in range(n)],
                "precipitation_probability": [(70 if 28 < i < 42 else 5) for i in range(n)],
                "weather_code": [(61 if 30 < i < 40 else (2 if i % 7 else 0)) for i in range(n)],
                "cloud_cover": [(90 if 28 < i < 42 else 30) for i in range(n)],
                "pressure_msl": [1014 - 0.05 * i for i in range(n)],
                "wind_speed_10m": [9 + 8 * abs(math.sin(i / 17 + k * 0.05)) + (8 if 60 < i < 90 else 0) for i in range(n)],
                "wind_direction_10m": [(215 + i * 2 + k * 0.6) % 360 for i in range(n)],
                "wind_gusts_10m": [13 + 12 * abs(math.sin(i / 17)) + (11 if 60 < i < 90 else 0) for i in range(n)]}})
        else:
            res.append({"hourly_units": {"ocean_current_velocity": "km/h"}, "hourly": {"time": times,
                "wave_height": [0.4 + 0.3 * abs(math.sin(i / 20)) for i in range(n)],
                "wave_direction": [(40 + i) % 360 for i in range(n)],
                "wave_period": [4 + abs(math.sin(i / 30)) * 3 for i in range(n)],
                "swell_wave_height": [0.2 + 0.1 * abs(math.sin(i / 25)) for i in range(n)],
                "swell_wave_direction": [30] * n, "swell_wave_period": [8] * n, "sea_surface_temperature": [18.6] * n,
                "ocean_current_velocity": [0.25 + 1.3 * abs(math.sin(2 * math.pi * (i + k * 0.1) / 12.42)) for i in range(n)],
                "ocean_current_direction": [(200 + k * 2 if math.sin(2 * math.pi * (i + k * 0.1) / 12.42) > 0 else 20 + k * 2) for i in range(n)]}})
    return res[0] if n_loc == 1 else res

with sync_playwright() as p:
    browser = p.chromium.launch()
    opts = dict(viewport={'width': width, 'height': vh}, device_scale_factor=scale, color_scheme=scheme,
                timezone_id='Asia/Singapore', has_touch=width <= 1400, service_workers='block')
    if lat and lon: opts.update(geolocation={'latitude': float(lat), 'longitude': float(lon)}, permissions=['geolocation'])
    ctx = browser.new_context(**opts)
    ctx.add_init_script('try { localStorage.setItem("gulf-almanac-screen", %s); } catch (e) {}' % json.dumps(screen))
    if env('INIT'): ctx.add_init_script(env('INIT'))
    page = ctx.new_page(); logs = []
    page.on('console', lambda m: logs.append(m.type + ': ' + m.text))
    page.on('pageerror', lambda e: logs.append('PAGE ERROR: ' + str(e)))
    def route(r):
        u = r.request.url
        if 'open-meteo' in u:
            if mode != 'wx': return r.abort()
            n_loc = u.split('latitude=')[1].split('&')[0].count(',') + 1
            body = json.dumps(fake('marine' if 'marine-api' in u else 'forecast', n_loc))
            return r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=body)
        return r.continue_()
    page.route('**/*', route)
    page.clock.install(time='2026-11-25T01:05:00Z')  # 14:05 in Auckland
    page.goto(page_url); page.wait_for_timeout(900)
    for snippet in sys.argv[1:]:
        page.evaluate(snippet); page.wait_for_timeout(400)
    if sel: page.locator(sel).screenshot(path=out)
    else: page.screenshot(path=out, full_page=full)
    errors = [l for l in logs if l.startswith('PAGE ERROR')]
    print('saved', out, '| page errors:', errors or 'none')
    browser.close()
    sys.exit(1 if errors else 0)
