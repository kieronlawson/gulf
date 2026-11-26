// Builds dist/: index.html, one self-contained page, and beside it the service worker, the web app manifest
// and two icons. The page inlines the styles, astronomy-engine, the Neaps tide predictor, the data and the
// two page scripts.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const neaps = (await build({
  stdin: { contents: 'export { createTidePredictor } from "@neaps/tide-predictor";', resolveDir: process.cwd() },
  bundle: true, format: 'iife', globalName: 'Neaps', minify: true, target: 'es2019', write: false,
})).outputFiles[0].text;

const data = {
  auckland: json('data/auckland.json'),
  constituents: json('data/constituents.json'),
  spots: json('data/spots.json'),
  coast: json('data/coast.json'),
};

/* The page script is split into files under src/ui/. They share one function scope, so the build
   joins them in this order inside a single function. Later files may use anything an earlier file declares. */
const UI_FILES = ['core', 'day', 'tables', 'map', 'marks', 'wheretogo', 'week', 'now', 'app'];
const ui = '/* Hauraki Gulf Almanac: page behavior. Needs Engine and DATA. */\n(function () {\n  \'use strict\';\n\n' +
  UI_FILES.map((f) => read(`src/ui/${f}.js`)).join('') + '})();\n';

const parts = {
  '/*__CSS__*/': read('src/style.css'),
  '/*__ASTRONOMY__*/': read('node_modules/astronomy-engine/astronomy.browser.min.js'),
  '/*__NEAPS__*/': neaps,
  '/*__DATA__*/': 'var DATA=' + JSON.stringify(data) + ';\n',
  '/*__ENGINE__*/': read('src/engine.js'),
  '/*__UI__*/': ui,
};

let html = read('src/template.html');
for (const [marker, text] of Object.entries(parts)) {
  if (html.split(marker).length !== 2) throw new Error('Marker must appear once in the template: ' + marker);
  if (/<\/script/i.test(text)) throw new Error('Inlined text must not close a script tag: ' + marker);
  html = html.replace(marker, () => text);
}

const out = (p) => new URL('dist/' + p, import.meta.url);
mkdirSync(out(''), { recursive: true });
writeFileSync(out('index.html'), html);
console.log('dist/index.html', Buffer.byteLength(html), 'bytes');

/* The service worker carries a hash of the page and of its own code, so each new page or worker installs
   a new worker, and the address of the font stylesheet, taken from the page so that the two cannot differ. */
const fontCss = /<link href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)" rel="stylesheet"/.exec(html);
if (!fontCss) throw new Error('The template must link the font stylesheet.');
const swSource = read('src/sw.js');
const version = createHash('sha256').update(html).update(swSource).digest('hex').slice(0, 12);
writeFileSync(out('sw.js'), swSource.replace("'__VERSION__'", JSON.stringify(version)).replace("'__FONT_CSS__'", JSON.stringify(fontCss[1])));

/* The manifest and icons let the page open from the Home Screen as its own app. */
writeFileSync(out('manifest.webmanifest'), JSON.stringify({
  name: 'Gulf Almanac', short_name: 'Gulf Almanac', start_url: './', scope: './', display: 'standalone',
  background_color: '#E7E6E1', theme_color: '#E7E6E1',
  icons: [{ src: 'icon-180.png', sizes: '180x180', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
}, null, 2) + '\n');
for (const f of ['icon-180.png', 'icon-512.png']) copyFileSync(new URL('src/icons/' + f, import.meta.url), out(f));
console.log('dist/sw.js', version, '| dist/manifest.webmanifest | dist/icon-180.png | dist/icon-512.png');
