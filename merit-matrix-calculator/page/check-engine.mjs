// Checks the page engine against build/reference_calc.py — the reference the Excel
// model is checked against — on the demo and on a small subset of it under several settings.
// Exit 1 on any difference above a cent (money) or 1e-6 (percent, compa-ratio).
//   node check-engine.mjs            all scenarios
//   node check-engine.mjs --selftest proves the check can fail
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, loadBands, loadEmployees, parseCsv } from './src/engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, '..', 'build');
const ROOT = join(HERE, '..');
const selftest = process.argv.includes('--selftest');
const dir = mkdtempSync(join(tmpdir(), 'merit-check-'));

// a small file of the reader's size: every eighth employee of the demo
const demoRows = readFileSync(join(ROOT, 'sample-employees.csv'), 'utf8').trim().split(/\r?\n/);
writeFileSync(join(dir, 'subset-employees.csv'), [demoRows[0], ...demoRows.slice(1).filter((_, i) => i % 8 === 0)].join('\n') + '\n');
const DATA = join(ROOT, 'sample-employees.csv'), BANDS = join(ROOT, 'sample-salary-ranges.csv');

const SCENARIOS = [
  { name: 'demo, defaults', data: DATA, bands: BANDS, settings: {} },
  { name: 'demo, January, no cap, no clip, 3%', data: DATA, bands: BANDS,
    settings: { effective: { year: 2027, month: 1 }, max_increase: null, clip_at_max: false, pool_pct: 3 } },
  { name: 'demo, Dec 2028, no eligibility limits, policy 105%, own ratings', data: DATA, bands: BANDS,
    settings: { effective: { year: 2028, month: 12 }, min_months_hire: 0, min_months_change: 0, company_target: 1.05,
      ratings: { 1: [0, 0], 2: [0.9, 0], 3: [1.0, 0.01], 4: [1.08, 0.02], 5: [1.15, 0.03] }, max_increase: 0.1 } },
  { name: 'demo, Nov 2026, other contributions', data: DATA, bands: BANDS,
    settings: { effective: { year: 2026, month: 11 }, rate_below: 28, ceiling: 50000,
      above_ceiling: [[1.1, 0], [1.5, 0.5], [null, 2]], min_months_hire: 1, min_months_change: 1 } },
  { name: 'subset, defaults', data: join(dir, 'subset-employees.csv'), bands: BANDS, settings: {} },
];

writeFileSync(join(dir, 's.json'), JSON.stringify(SCENARIOS));
const ref = JSON.parse(execFileSync('python', [join(BUILD, 'dump_reference.py'), join(dir, 's.json')], { encoding: 'utf8' }));

let fails = 0, checked = 0;
function same(where, a, b, tol) {
  checked++;
  const ok = typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
  if (!ok) { fails++; if (fails <= 20) console.log(`FAIL ${where}: page ${a} vs reference ${b}`); }
}

SCENARIOS.forEach((sc, i) => {
  const R = ref[i];
  const { emp, hasCategory, hasGender } = loadEmployees(parseCsv(readFileSync(sc.data, 'utf8')));
  const bands = loadBands(parseCsv(readFileSync(sc.bands, 'utf8')));
  const settings = selftest && i === 0 ? { ...sc.settings, rate_below: 32.16 } : sc.settings;
  const r = analyse(emp, bands, settings, { hasCategory, hasGender });
  const p = sc.name + ' · ';
  for (const k of ['pay_before', 'contrib_before', 'payroll', 'eligible_base', 'dev_eur', 'cost_annual', 'cost_in_year'])
    same(p + k, r[k], R[k], 0.01);
  for (const k of ['merit_pct', 'dev_pp', 'load_full_pct', 'load_in_year_pct']) same(p + k, r[k], R[k], 1e-6);
  for (const k of ['flag_equity_over_max', 'below_min_after', 'red_circled']) same(p + k, r[k], R[k], 0);
  for (const t of ['step1', 'step2', 'target'])
    for (const k of ['base', 'bonus', 'contrib', 'annual', 'in_year']) same(`${p}${t}.${k}`, r[t][k], R[t][k], 0.01);
  same(p + 'categories', [...r.cats.keys()].join('|'), Object.keys(R.cats).join('|'));
  for (const [n, c] of Object.entries(R.cats))
    for (const [k, v] of Object.entries(c)) same(`${p}${n}.${k}`, r.cats.get(n)[k], v, k === 'median' || k === 'need' ? 0.01 : 1e-6);
  for (const e of r.emp) {
    const x = R.emp[e.id];
    for (const k of ['uplift_base', 'aligned', 'increase', 'new_base']) same(`${p}${e.id}.${k}`, e[k], x[k], 0.01);
    same(`${p}${e.id}.eligible`, e.eligible ? 1 : 0, x.eligible, 0);
    same(`${p}${e.id}.zone`, e.zone, x.zone, 0);
  }
});

console.log(`${checked} values checked across ${SCENARIOS.length} scenarios · FAILURES: ${fails}`);
if (selftest) {
  if (fails === 0) { console.log('SELFTEST FAILED: a changed contribution rate went unnoticed'); process.exit(1); }
  console.log('selftest ok: the changed rate was caught');
  process.exit(0);
}
process.exit(fails ? 1 : 0);
