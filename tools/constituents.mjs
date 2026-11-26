// Rebuilds data/constituents.json from the Neaps tide database.
// Station: TICON-4 "auckland-070a-nzl-uhslc_rq" (records 1984 to 1988).
// Five constituents are left out because they made the fit to the LINZ table worse: M3, T3, R3, 3L2, 3N2.
// Run: node tools/constituents.mjs, then npm test.
import { stationsById } from '@neaps/tide-database';
import { writeFileSync } from 'node:fs';

const station = stationsById.get('ticon/auckland-070a-nzl-uhslc_rq');
const dropped = ['M3', 'T3', 'R3', '3L2', '3N2'];
const constituents = station.harmonic_constituents
  .filter((c) => !dropped.includes(c.name))
  .map((c) => ({ name: c.name, amplitude: +c.amplitude.toFixed(4), phase: +c.phase.toFixed(2) }))
  .filter((c) => c.amplitude >= 0.0005);
writeFileSync(new URL('../data/constituents.json', import.meta.url), JSON.stringify(constituents));
console.log(constituents.length, 'constituents written');
