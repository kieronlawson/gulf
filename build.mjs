// Builds dist/: index.html, one self-contained page, and beside it the service worker, the web app manifest,
// two icons and the depth grid. The page inlines the styles, astronomy-engine, the Neaps tide predictor, the
// data and the two page scripts. The depth grid is too large to inline, so the page fetches it.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const out = (p) => new URL('dist/' + p, import.meta.url);
mkdirSync(out(''), { recursive: true });

/* Data files that the page fetches. Each is copied under a name that holds a hash of its content, so a new
   file gets a new name, and the page and the service worker, which both carry the name, change with it.
   Copies under older names are removed. */
function shipData(src, stem, ext) {
  const bytes = readFileSync(new URL(src, import.meta.url));
  const name = `${stem}.${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}.${ext}`;
  for (const f of readdirSync(out(''))) if (f !== name && f.startsWith(stem + '.') && f.endsWith('.' + ext)) rmSync(out(f));
  copyFileSync(new URL(src, import.meta.url), out(name));
  return name;
}

/* The depth grid: data/depth.png, with the numbers from data/depth.json that place and decode its cells. */
const depthMeta = json('data/depth.json');
const depth = { file: shipData('data/depth.png', 'depth', 'png') };
for (const k of ['W', 'N', 'k', 'scale', 'cellsPerUnit', 'nx', 'ny']) depth[k] = depthMeta[k];
depth.offsetDm = depthMeta.encoding.offsetDm;
const DATA_FILES = [depth.file];

const neaps = (await build({
  stdin: { contents: 'export { createTidePredictor } from "@neaps/tide-predictor";', resolveDir: process.cwd() },
  bundle: true, format: 'iife', globalName: 'Neaps', minify: true, target: 'es2019', write: false,
})).outputFiles[0].text;

const data = {
  auckland: json('data/auckland.json'),
  constituents: json('data/constituents.json'),
  spots: json('data/spots.json'),
  coast: json('data/coast.json'),
  ferries: json('data/ferries.json'),
  depth,
};

/* The page script is split into files under src/ui/. They share one function scope, so the build
   joins them in this order inside a single function. Later files may use anything an earlier file declares. */
const UI_FILES = ['core', 'day', 'tables', 'map', 'depth', 'marks', 'wheretogo', 'week', 'route', 'now', 'app'];
const ui = '/* Gulf: page behavior. Needs Engine and DATA. */\n(function () {\n  \'use strict\';\n\n' +
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

writeFileSync(out('index.html'), html);
console.log('dist/index.html', Buffer.byteLength(html), 'bytes');

/* The service worker carries a hash of the page and of its own code, so each new page or worker installs
   a new worker; the address of the font stylesheet, taken from the page so that the two cannot differ; and
   the names of the data files, which it stores on install. */
const fontCss = /<link href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)" rel="stylesheet"/.exec(html);
if (!fontCss) throw new Error('The template must link the font stylesheet.');
const swSource = read('src/sw.js');
const version = createHash('sha256').update(html).update(swSource).digest('hex').slice(0, 12);
const sw = swSource.replace("'__VERSION__'", JSON.stringify(version)).replace("'__FONT_CSS__'", JSON.stringify(fontCss[1]))
  .replace("'__DATA_FILES__'", JSON.stringify(DATA_FILES));
if (sw.includes('__')) throw new Error('A marker is left in the service worker.');
writeFileSync(out('sw.js'), sw);

/* The manifest and icons let the page open from the Home Screen as its own app. */
writeFileSync(out('manifest.webmanifest'), JSON.stringify({
  name: 'Gulf', short_name: 'Gulf', start_url: './', scope: './', display: 'standalone',
  background_color: '#E7E6E1', theme_color: '#E7E6E1',
  icons: [{ src: 'icon-180.png', sizes: '180x180', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
}, null, 2) + '\n');
for (const f of ['icon-180.png', 'icon-512.png']) copyFileSync(new URL('src/icons/' + f, import.meta.url), out(f));
console.log('dist/sw.js', version, '| dist/manifest.webmanifest | dist/icon-180.png | dist/icon-512.png |', DATA_FILES.map((f) => 'dist/' + f).join(' | '));
