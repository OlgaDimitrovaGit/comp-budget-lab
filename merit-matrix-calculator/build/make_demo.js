/*
 * Builds the full demo for the Merit Matrix workbook: demo-data.csv and demo-bands.csv.
 *
 * Employees are the ~200 people of the Pay Gap Remediation Cost Calculator
 * demo (same seeded generator, same base pay). This script only adds what a
 * merit review needs and that generator does not have: a rating, hire and
 * last-change dates, and salary ranges per category and grade.
 *
 *   node make_demo.js            -> writes demo-data.csv and demo-bands.csv
 */
'use strict';
const fs = require('fs');
const path = require('path');
// The pay gap calculator's engine: pay-gap-calculator/build/calc.js in a folder next to this
// artefact's folder, or in a subfolder of one
const ROOT = path.join(__dirname, '..', '..');
const CALC = require([ROOT, ...fs.readdirSync(ROOT).map(d => path.join(ROOT, d))]
  .map(d => path.join(d, 'pay-gap-calculator', 'build', 'calc.js')).find(f => fs.existsSync(f)));

const EFF = Date.UTC(2027, 3, 1);      // review effective date, 2027-04-01 (= DEFAULTS in reference_calc.py)
const LAST_CYCLE = '2026-04-01';       // previous annual review
const DATA_DATE = '2026-10-31';        // the demo is an export as of this date: no hire or pay change after it
const SEED = 20261006;                 // separate seed: the pay gap generator's sequence is untouched

// Salary ranges, Spain 2026. Market mid at an anchor grade (INE EES 2022 earnings for the
// occupation, net of a typical bonus share, indexed to 2026 with Spain's wage cost statistics),
// then raised to the pay level of a large employer in Madrid.
const REGION = 1.17;                   // Madrid against the national level
const SIZE = 1.20;                     // large employer against the all-employer average
// The product (1.404) is a chosen demo pay level, above INE's Madrid 200+ vs Spain ratio (1.307, EES 2022)
const LEVEL = REGION * SIZE;
// category: [anchor grade, market mid at anchor (national), [lowest, highest grade], generator base, tenure max]
const MARKET = {
  'Customer Support': [4, 24408, [3, 6], 30000, 14],
  'Manufacturing': [5, 29105, [4, 8], 34000, 22],
  'Operations': [6, 31637, [5, 10], 38000, 14],
  'Marketing': [8, 44630, [6, 10], 42000, 14],
  'Engineering': [8, 40715, [7, 12], 46000, 14],
  'Sales': [8, 45358, [8, 12], 55000, 14],
  'Legal': [9, 40652 * 1.12, [9, 12], 62000, 14],
};
// Range width (max / min - 1) by grade
const WIDTH = g => (g <= 5 ? 0.30 : g <= 9 ? 0.40 : g <= 11 ? 0.50 : 0.60);
// Grade-to-grade steps follow the generator's own pay curve, so a typical person sits near mid
const typical = (c, g) => {
  const [, , [a, b], base, T] = MARKET[c];
  const tenure = (g - a) / Math.max(1, b - a) * T * 0.55 + 0.225 * T;
  return base * Math.pow(1.12, g - a) * (1 + 0.015 * tenure);
};
const r100 = x => Math.round(x / 100) * 100;

const bands = [];
const bandOf = {};
for (const c of Object.keys(MARKET)) {
  const [ag, mid0, [a, b]] = MARKET[c];
  const k = mid0 / typical(c, ag);
  for (let g = a; g <= b; g++) {
    const mid = r100(k * typical(c, g) * LEVEL);
    const w = WIDTH(g);
    const min = r100(mid * 2 / (2 + w));
    const max = r100(min * (1 + w));
    bands.push({ category: c, grade: g, min, mid, max });
    bandOf[c + '|' + g] = { min, mid, max };
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const round2 = x => Math.round(x * 100) / 100;

// Rating distribution, 1..5 (illustrative)
const RATING_CUM = [0.04, 0.18, 0.70, 0.92, 1.0];

const people = CALC.generateDemoData().map(e => {
  const share = e.fte * e.months_worked / 12;
  const base = e.base_salary / share;                 // annual full-time base
  const hireMs = EFF - Math.round(e.tenure_years * 365.25) * 86400000;
  const hire = iso(hireMs);
  const u = rnd();
  const rating = RATING_CUM.findIndex(p => u < p) + 1;
  return {
    id: e.id, category: e.category, gender: e.gender, grade: e.grade, rating,
    hire_date: hire, last_change_date: hire > LAST_CYCLE ? hire : LAST_CYCLE,
    base_salary: round2(base), bonus_pct: round2(e.variable_pay / e.base_salary * 100), fte: e.fte,
    tenure: e.tenure_years,
  };
});

// Three hires of October 2026: under six months by the review date, too new for it
const newcomers = people.filter(p => p.tenure < 2);
for (let i = 0; i < 3; i++) {
  const p = newcomers.splice(Math.floor(rnd() * newcomers.length), 1)[0];
  const days = 152 + Math.floor(rnd() * 30);    // 2026-10-02 .. 2026-10-31
  p.hire_date = p.last_change_date = iso(EFF - days * 86400000);
  p.tenure = days / 365.25;
}

// A few off-cycle individual pay changes, July to October 2026
const pool = people.filter(p => p.last_change_date === LAST_CYCLE);
for (let i = 0; i < 5; i++) {
  const p = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
  p.last_change_date = iso(Date.UTC(2026, 6, 1) + Math.floor(rnd() * 120) * 86400000);
}

// Fourteen recent hires paid below the range minimum (hired cheap), four women and ten men
// (pay equity lifts most of the women back into the range first),
// all long enough in the company to take part in the review
const BELOW_MIN = { F: 4, M: 10 };
const candidates = people.filter(p => p.tenure >= 0.75 && p.tenure <= 4);
for (const g of ['F', 'M']) {
  const list = candidates.filter(p => p.gender === g);
  for (let i = 0; i < BELOW_MIN[g] && list.length; i++) {
    const p = list.splice(Math.floor(rnd() * list.length), 1)[0];
    const b = bandOf[p.category + '|' + p.grade];
    p.base_salary = round2(b.min * (0.86 + 0.08 * rnd()));
  }
}

const late = people.filter(p => p.hire_date > DATA_DATE || p.last_change_date > DATA_DATE);
if (late.length) throw new Error(`dates after ${DATA_DATE}: ${late.map(p => p.id).join(', ')}`);

const dir = __dirname;
const head = ['id', 'category', 'gender', 'grade', 'rating', 'hire_date', 'last_change_date', 'base_salary', 'bonus_pct', 'fte'];
fs.writeFileSync(path.join(dir, 'demo-data.csv'),
  [head.join(',')].concat(people.map(p => head.map(h => p[h]).join(','))).join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'demo-bands.csv'),
  ['category,grade,min,mid,max'].concat(bands.map(b => [b.category, b.grade, b.min, b.mid, b.max].join(','))).join('\n') + '\n');

// Where people sit against their range (before pay equity)
let below = 0, above = 0;
const crs = [];
for (const p of people) {
  const b = bandOf[p.category + '|' + p.grade];
  crs.push(p.base_salary / b.mid);
  if (p.base_salary < b.min) below++;
  if (p.base_salary > b.max) above++;
}
crs.sort((x, y) => x - y);
const q = f => crs[Math.floor(crs.length * f)].toFixed(2);
console.log(`written demo-data.csv (${people.length}) and demo-bands.csv (${bands.length}); ` +
  `CR P10 ${q(0.1)} median ${q(0.5)} P90 ${q(0.9)}; below min ${below}, above max ${above}`);
