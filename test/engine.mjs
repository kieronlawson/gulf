// Loads src/engine.js the way the page does, with Astronomy, Neaps and DATA as globals.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createTidePredictor } from '@neaps/tide-predictor';

const require = createRequire(import.meta.url);
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const ctx = {
  Astronomy: require('astronomy-engine'),
  Neaps: { createTidePredictor },
  DATA: { auckland: json('../data/auckland.json'), constituents: json('../data/constituents.json'), spots: json('../data/spots.json'), coast: json('../data/coast.json') },
  Intl, Date, Math, console,
};
vm.createContext(ctx);
vm.runInContext(read('../src/engine.js') + '\nthis.Engine = Engine;', ctx);

export const Engine = ctx.Engine;
export const DATA = ctx.DATA;
export const spot = (id) => ctx.DATA.spots.find((s) => s.id === id);
