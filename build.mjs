// Builds dist/index.html: one self-contained page.
// It inlines the styles, astronomy-engine, the Neaps tide predictor, the data and the two page scripts.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

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
const UI_FILES = ['core', 'day', 'tables', 'map', 'app'];
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

mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('dist/index.html', import.meta.url), html);
console.log('dist/index.html', Buffer.byteLength(html), 'bytes');
