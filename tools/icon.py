"""Render src/icons/icon.svg to the PNG icons that the build copies beside the page.

Needs: pip install playwright, then: playwright install chromium
Run from the repository root: python3 tools/icon.py
Writes src/icons/icon-180.png, for the iPad's Home Screen, and src/icons/icon-512.png, for the web app manifest.
"""
import pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'icons'
svg = (root / 'icon.svg').read_text()
with sync_playwright() as p:
    browser = p.chromium.launch()
    for size in (180, 512):
        page = browser.new_page(viewport={'width': size, 'height': size})
        page.set_content('<html><body style="margin:0">' + svg.replace('width="180" height="180"', f'width="{size}" height="{size}"') + '</body></html>')
        page.screenshot(path=str(root / f'icon-{size}.png'), clip={'x': 0, 'y': 0, 'width': size, 'height': size})
        page.close()
        print('wrote', root / f'icon-{size}.png')
    browser.close()
