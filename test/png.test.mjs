// The PNG decoder that reads the depth grid without a canvas, on made-up images with every row filter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { Engine } from './engine.mjs';

// Filters one row of RGB bytes as a PNG encoder would, given the row above it.
function filterRow(f, cur, prev) {
  const out = new Uint8Array(cur.length);
  for (let x = 0; x < cur.length; x++) {
    const a = x >= 3 ? cur[x - 3] : 0, b = prev[x], c = x >= 3 ? prev[x - 3] : 0;
    let pr = 0;
    if (f === 1) pr = a;
    else if (f === 2) pr = b;
    else if (f === 3) pr = (a + b) >> 1;
    else if (f === 4) {
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[x] = (cur[x] - pr) & 255;
  }
  return out;
}

function chunk(kind, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = kind.charCodeAt(i);
  out.set(data, 8);   // the CRC is left at zero: the decoder does not read it
  return out;
}

// A PNG of w by h cells holding the stored values v, with row y filtered by filters[y % 5].
function makePng(v, w, h, color = 2) {
  const stride = w * 3, raw = new Uint8Array(h * (stride + 1));
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const cur = new Uint8Array(stride);
    for (let i = 0; i < w; i++) { cur[i * 3] = v[y * w + i] >> 8; cur[i * 3 + 1] = v[y * w + i] & 255; cur[i * 3 + 2] = (i * 7 + y) & 255; }
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    raw.set(filterRow(f, cur, prev), y * (stride + 1) + 1);
    prev = cur;
  }
  const head = new Uint8Array(13), dv = new DataView(head.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); head[8] = 8; head[9] = color;
  const z = deflateSync(raw), parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head),
    chunk('IDAT', z.subarray(0, 40)), chunk('IDAT', z.subarray(40)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('pngValues undoes all five row filters', () => {
  const w = 13, h = 10, v = new Uint16Array(w * h);
  for (let i = 0; i < v.length; i++) v[i] = [0, 1, 2, 257, 1670, 65535, 100][i % 7] + (i % 3);
  const png = Engine.pngChunks(makePng(v, w, h));
  assert.equal(png.width, w);
  assert.equal(png.height, h);
  const got = Engine.pngValues(inflateSync(png.data), w, h);
  assert.deepEqual(Array.from(got), Array.from(v));
});

test('pngChunks refuses what tools/depth.py does not write', () => {
  assert.throws(() => Engine.pngChunks(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), /not a PNG/);
  const v = new Uint16Array(4);
  assert.throws(() => Engine.pngChunks(makePng(v, 2, 2, 6)), /8-bit RGB/);
  const png = Engine.pngChunks(makePng(v, 2, 2));
  assert.throws(() => Engine.pngValues(inflateSync(png.data), 3, 2), /wrong length/);
});

test('the depth grid decodes to the size data/depth.json gives', () => {
  const meta = JSON.parse(readFileSync(new URL('../data/depth.json', import.meta.url), 'utf8'));
  const png = Engine.pngChunks(new Uint8Array(readFileSync(new URL('../data/depth.png', import.meta.url))));
  const v = Engine.pngValues(inflateSync(png.data), png.width, png.height);
  assert.equal(png.width, meta.nx);
  assert.equal(png.height, meta.ny);
  assert.equal(v.length, meta.nx * meta.ny);
  assert.ok(v.every((x) => x <= 2000), 'no stored value beyond a 190 m depth');
});
