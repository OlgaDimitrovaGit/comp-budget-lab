// Calculation engine of the page. A line-by-line port of build/reference_calc.py
// (the reference the Excel model is checked against) plus the shaping of its result
// for the screen. No dependencies: the page and check-engine.mjs import the same file.

export const DEFAULTS = {
  effective: { year: 2027, month: 4 },
  pool_pct: 4.0,
  min_months_hire: 6,
  min_months_change: 3,
  clip_at_max: true,
  company_target: 1.0,
  max_increase: 0.30, // one cap for everyone, share of aligned base; null or 0 = no cap
  // rating: [target compa-ratio, minimum increase]; target 0 = no increase
  ratings: { 1: [0.0, 0.0], 2: [0.95, 0.0], 3: [1.0, 0.0], 4: [1.05, 0.01], 5: [1.10, 0.02] },
  zones: [0.0, 0.90, 1.0, 1.10],
  rate_below: 32.15, // Spain 2026: 30.65% + AT/EP office-work rate 1.50%
  // employer share of the solidarity contribution above the ceiling, Spain 2026:
  // [band upper bound as a multiple of the ceiling, rate %]
  above_ceiling: [[1.10, 0.96], [1.50, 1.04], [null, 1.22]],
  ceiling: 61214.40,
};
const EPS = 1e-9;
const LOW_CR = 0.90; // "far below range": CR < 90%, the edge of the first matrix zone

export const EMPLOYEE_COLUMNS = ['id', 'category', 'gender', 'grade', 'rating', 'hire_date',
  'last_change_date', 'base_salary', 'bonus_pct', 'fte'];
export const BAND_COLUMNS = ['category', 'grade', 'min', 'mid', 'max'];
// columns the calculation cannot run without; category and gender only switch off pay equity
const REQUIRED = ['id', 'grade', 'rating', 'hire_date', 'last_change_date', 'base_salary', 'bonus_pct', 'fte'];
export const ALL_EMPLOYEES = 'All employees';

// ------------------------------------------------------------------ CSV
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(v => v.trim())) rows.push(row);
      row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('A quoted value is not closed. Check the CSV and try again.');
  if (field || row.length) { row.push(field); if (row.some(v => v.trim())) rows.push(row); }
  return rows;
}

function records(rows) {
  const head = rows[0].map(h => h.trim().toLowerCase());
  return { head, list: rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

function parseDate(s, what, line) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) throw new Error(`Row ${line}: ${what} must be a date as YYYY-MM-DD, got “${s}”.`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function num(s, what, line) {
  const v = Number(s);
  if (s === '' || !Number.isFinite(v)) throw new Error(`Row ${line}: ${what} must be a number, got “${s}”.`);
  return v;
}

/** Employees from CSV rows. Missing category or gender columns switch the pay equity step off. */
export function loadEmployees(rows) {
  if (!rows.length || rows.length < 2) throw new Error('Include a header row and at least one employee.');
  const { head, list } = records(rows);
  const missing = REQUIRED.filter(c => !head.includes(c));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}. Use the sample CSVs for the expected format.`);
  const hasCategory = head.includes('category'), hasGender = head.includes('gender');
  const emp = list.map((r, i) => {
    const line = i + 2;
    if (hasGender && !['F', 'M'].includes(r.gender.trim().toUpperCase())) throw new Error(`Line ${line}: gender must be F or M.`);
    return {
      id: r.id,
      category: hasCategory ? r.category : ALL_EMPLOYEES,
      gender: hasGender && r.gender.trim().toUpperCase() === 'F' ? 'F' : 'M',
      grade: Math.trunc(num(r.grade, 'grade', line)),
      rating: Math.trunc(num(r.rating, 'rating', line)),
      hire: parseDate(r.hire_date, 'hire_date', line),
      change: parseDate(r.last_change_date, 'last_change_date', line),
      base: num(r.base_salary, 'base_salary', line),
      bonus: num(r.bonus_pct, 'bonus_pct', line) / 100,
      fte: num(r.fte, 'fte', line),
    };
  });
  for (const e of emp) {
    if (!(e.rating >= 1 && e.rating <= 5)) throw new Error(`Employee ${e.id}: rating must be 1 to 5.`);
  }
  return { emp, hasCategory, hasGender };
}

/** Salary ranges keyed by category and grade; without a category column, by grade only. */
export function loadBands(rows) {
  if (!rows.length || rows.length < 2) throw new Error('The salary ranges file needs a header row and at least one range.');
  const { head, list } = records(rows);
  const missing = ['grade', 'min', 'mid', 'max'].filter(c => !head.includes(c));
  if (missing.length) throw new Error(`Salary ranges: missing columns ${missing.join(', ')}.`);
  const bands = new Map();
  list.forEach((r, i) => {
    const line = i + 2;
    const cat = head.includes('category') && r.category ? r.category : ALL_EMPLOYEES;
    bands.set(`${cat}|${Math.trunc(num(r.grade, 'grade', line))}`,
      [num(r.min, 'min', line), num(r.mid, 'mid', line), num(r.max, 'max', line)]);
  });
  return bands;
}

// ------------------------------------------------------------------ reference_calc.py
const dayNumber = d => Date.UTC(d.y, d.m - 1, d.d) / 86400000;

/** Complete months from d1 to d2, as Excel DATEDIF(d1, d2, "m"). */
function monthsBetween(d1, d2) {
  return (d2.y - d1.y) * 12 + (d2.m - d1.m) - (d2.d < d1.d ? 1 : 0);
}

function contributions(pay, S) {
  const c = S.ceiling;
  let out = S.rate_below / 100 * Math.min(pay, c);
  let lo = c;
  for (const [top, rate] of S.above_ceiling) {
    const hi = top === null ? pay : Math.min(pay, top * c);
    out += rate / 100 * Math.max(0, hi - lo);
    if (top !== null) lo = top * c;
  }
  return out;
}

const contributionsOn = (before, uplift, S) => uplift <= 0 ? 0 : contributions(before + uplift, S) - contributions(before, S);

function median(a) {
  a = [...a].sort((x, y) => x - y);
  const n = a.length;
  return (a[Math.floor((n - 1) / 2)] + a[Math.floor(n / 2)]) / 2;
}

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

function regress(rows, pay) {
  const n = rows.length;
  const g = rows.map(r => r.grade), t = rows.map(r => r.tenure), y = rows.map(pay);
  const Sg = sum(g, x => x), St = sum(t, x => x), Sy = sum(y, x => x);
  const cgg = sum(g, x => x * x) - Sg * Sg / n;
  const ctt = sum(t, x => x * x) - St * St / n;
  let cgt = 0, cgy = 0, cty = 0;
  for (let i = 0; i < n; i++) { cgt += g[i] * t[i]; cgy += g[i] * y[i]; cty += t[i] * y[i]; }
  cgt -= Sg * St / n; cgy -= Sg * Sy / n; cty -= St * Sy / n;
  const det = cgg * ctt - cgt * cgt;
  if (n < 4 || Math.abs(det) < EPS) return [0, 0, false];
  return [(cgy * ctt - cty * cgt) / det, (cty * cgg - cgy * cgt) / det, true];
}

/** Raw gap of mean pay (men − women) / men, split into the part explained by grade and tenure and the rest, in %. */
function decompose(rows, pay = r => r.total) {
  const f = rows.filter(r => r.gender === 'F'), m = rows.filter(r => r.gender === 'M');
  const meanM = mean(m.map(pay)), meanF = mean(f.map(pay));
  const raw = f.length && m.length && meanM > 0 ? (meanM - meanF) / meanM * 100 : 0;
  const [bg, bt, ok] = regress(rows, pay);
  let expl = 0;
  if (ok && f.length && m.length) {
    const dg = mean(m.map(r => r.grade)) - mean(f.map(r => r.grade));
    const dt = mean(m.map(r => r.tenure)) - mean(f.map(r => r.tenure));
    expl = (bg * dg + bt * dt) / meanM * 100;
  }
  expl = raw >= 0 ? Math.max(0, Math.min(expl, raw)) : Math.min(0, Math.max(expl, raw));
  return { raw, expl, unexpl: raw - expl, meanM };
}

export function analyse(employees, bands, settings = {}, opts = { hasCategory: true, hasGender: true }) {
  const S = { ...DEFAULTS, ...settings };
  const equityOn = opts.hasCategory && opts.hasGender;
  const eff = { y: S.effective.year, m: S.effective.month, d: 1 };
  const emp = employees.map(e => ({ ...e }));
  for (const e of emp) {
    const b = bands.get(`${e.category}|${e.grade}`);
    if (!b) throw new Error(`No salary range for ${e.category === ALL_EMPLOYEES ? '' : e.category + ', '}grade ${e.grade}. Load the salary ranges file together with the employee file.`);
    [e.min, e.mid, e.max] = b;
    e.tenure = (dayNumber(eff) - dayNumber(e.hire)) / 365.25;
    e.total = e.base * (1 + e.bonus);
  }

  // Step 1: pay equity, full equalisation, per category
  const cats = new Map();
  for (const e of emp) {
    if (!cats.has(e.category)) cats.set(e.category, []);
    cats.get(e.category).push(e);
    e.uplift_total = 0;
  }
  const catOut = new Map();
  for (const [name, rows] of cats) {
    const f = rows.filter(r => r.gender === 'F');
    const d = decompose(rows);
    const med = median(rows.map(r => r.total));
    const need = equityOn && d.raw >= 0 && d.unexpl > 1e-12 ? d.unexpl / 100 * d.meanM * f.length : 0;
    const under = f.filter(r => r.total < med);
    const td = sum(under, r => med - r.total);
    if (need > 0 && td > 0) for (const r of under) r.uplift_total = need * (med - r.total) / td;
    catOut.set(name, {
      raw: d.raw, explained: d.expl, unexplained: d.unexpl, median: med, need,
      // closed in full by step 1 where it was against women; otherwise unchanged
      unexplained_after_equity: need > 0 && td > 0 ? 0 : d.unexpl,
    });
  }

  // Step 2: target-based merit on the aligned base
  const zoneOf = cr => { let z = 0; S.zones.forEach((b, i) => { if (cr >= b) z = i; }); return z + 1; };
  for (const e of emp) {
    e.uplift_base = e.uplift_total / (1 + e.bonus);
    e.aligned = e.base + e.uplift_base;
    e.equity_over_max = e.uplift_base > 0 && e.aligned > e.max;
    e.eligible = monthsBetween(e.hire, eff) >= S.min_months_hire && monthsBetween(e.change, eff) >= S.min_months_change;
    e.cr = e.aligned / e.mid;
    const [tgt, mn] = S.ratings[e.rating];
    const cap = S.max_increase;
    const targetSalary = e.mid * S.company_target * tgt;
    const gap = Math.max(0, targetSalary - e.aligned);
    let inc = tgt === 0 ? 0 : Math.max(gap, mn * e.aligned);
    if (cap) inc = Math.min(inc, cap * e.aligned);
    if (e.aligned >= e.max) inc = 0;
    if (S.clip_at_max) inc = Math.min(inc, Math.max(0, e.max - e.aligned));
    e.increase = e.eligible ? inc : 0;
    e.new_base = e.aligned + e.increase;
    // target: the same target % to every eligible person, as a full-cost benchmark
    e.target_inc = e.eligible ? S.pool_pct / 100 * e.aligned : 0;
    e.zone = zoneOf(e.cr);
  }

  // Unexplained gap after merit: the same decomposition, re-run on total cash after the review
  for (const [name, rows] of cats) catOut.get(name).unexplained_after_merit = decompose(rows, r => r.new_base * (1 + r.bonus)).unexpl;

  // Costs
  const factor = (13 - eff.m) / 12;
  const res = {};
  for (const [tag, baseKey, incKey] of [['step1', 'base', 'uplift_base'], ['step2', 'aligned', 'increase'], ['target', 'aligned', 'target_inc']]) {
    const base = sum(emp, e => e[incKey] * e.fte);
    const bonus = sum(emp, e => e[incKey] * e.bonus * e.fte);
    const contrib = sum(emp, e => contributionsOn(e[baseKey] * (1 + e.bonus) * e.fte, e[incKey] * (1 + e.bonus) * e.fte, S));
    const annual = base + bonus + contrib;
    res[tag] = { base, bonus, contrib, annual, in_year: annual * factor };
  }
  const payBefore = sum(emp, e => e.total * e.fte);
  const contribBefore = sum(emp, e => contributions(e.total * e.fte, S));
  const payroll = payBefore + contribBefore;
  const eligibleBase = sum(emp.filter(e => e.eligible), e => e.aligned * e.fte);
  const meritPct = eligibleBase > 0 ? res.step2.base / eligibleBase * 100 : 0;
  const costAnnual = res.step1.annual + res.step2.annual;
  return {
    ...res, S, factor, equityOn,
    pay_before: payBefore, contrib_before: contribBefore, payroll, eligible_base: eligibleBase,
    merit_pct: meritPct, dev_pp: meritPct - S.pool_pct,
    dev_eur: res.step2.annual - res.target.annual,
    dev_eur_in_year: (res.step2.annual - res.target.annual) * factor,
    cost_annual: costAnnual, cost_in_year: costAnnual * factor,
    load_full_pct: costAnnual / payroll * 100, load_in_year_pct: costAnnual * factor / payroll * 100,
    flag_equity_over_max: emp.filter(e => e.equity_over_max).length,
    below_min_after: emp.filter(e => e.new_base < e.min).length,
    red_circled: emp.filter(e => e.aligned >= e.max).length,
    cats: catOut, emp,
  };
}

// ------------------------------------------------------------------ screen data (make_data.py)
function crBlock(rows) {
  const mid = sum(rows, e => e.mid * e.fte);
  const cr = k => mid > 0 ? sum(rows, e => e[k] * e.fte) / mid * 100 : 0;
  const low = k => rows.filter(e => e[k] < LOW_CR * e.mid).length;
  return {
    cr_before: cr('base'), cr_after_equity: cr('aligned'), cr_after_merit: cr('new_base'),
    below_low_before: low('base'), below_low_after: low('new_base'),
  };
}

/** The numbers the screen shows, unrounded; same keys as data.json of the dashboard run. */
export function shape(r) {
  const { emp, S } = r;
  const categories = [];
  for (const [name, c] of r.cats) {
    const rows = emp.filter(e => e.category === name);
    const f = rows.filter(e => e.gender === 'F'), m = rows.filter(e => e.gender === 'M');
    const gap = key => {
      const mm = mean(m.map(key));
      return f.length && m.length && mm > 0 ? (mm - mean(f.map(key))) / mm * 100 : 0;
    };
    categories.push({
      name, n: rows.length, women: f.length, men: m.length, small: rows.length < 10,
      gap_before: c.raw,
      unexplained_before: c.unexplained,
      unexplained_after_equity: c.unexplained_after_equity,
      unexplained_after_merit: c.unexplained_after_merit,
      gap_after_equity: gap(e => e.aligned * (1 + e.bonus)),
      gap_after_merit: gap(e => e.new_base * (1 + e.bonus)),
      equity_cost_base: sum(rows, e => e.uplift_base * e.fte),
      merit_cost_base: sum(rows, e => e.increase * e.fte),
      ...crBlock(rows),
    });
  }
  const elig = emp.filter(e => e.eligible);
  const rows = Object.keys(S.ratings).map(Number).sort((a, b) => a - b).map(k => ({
    rating: k, target_cr: S.ratings[k][0], min_increase: S.ratings[k][1],
    cells: S.zones.map((_, z) => {
      const cell = elig.filter(e => e.rating === k && e.zone === z + 1);
      const eb = sum(cell, e => e.aligned * e.fte), inc = sum(cell, e => e.increase * e.fte);
      return { n: cell.length, eur: inc, pct: eb > 0 ? inc / eb * 100 : 0 };
    }),
  }));
  const s1 = r.step1, s2 = r.step2;
  return {
    settings: {
      pool_pct: S.pool_pct, effective_month: S.effective.month, effective_year: S.effective.year,
      in_year_factor: r.factor, company_target_cr: S.company_target,
      max_increase_pct: (S.max_increase || 0) * 100, min_months_hire: S.min_months_hire,
      min_months_change: S.min_months_change, clip_at_max: S.clip_at_max,
      contrib_rate_pct: S.rate_below, ceiling_eur: S.ceiling,
    },
    equity_on: r.equityOn,
    headcount: emp.length, eligible: elig.length, women: emp.filter(e => e.gender === 'F').length,
    budget: {
      payroll_before: r.payroll, pay_before: r.pay_before, contrib_before: r.contrib_before,
      payroll_after_equity: r.payroll + s1.annual, payroll_after_merit: r.payroll + r.cost_annual,
      change_total_annual: r.cost_annual, change_total_in_year: r.cost_in_year,
      change_total_pct: r.load_full_pct, change_in_year_pct: r.load_in_year_pct,
    },
    equity: { ...s1 }, merit: { ...s2 },
    pool: {
      eligible_base: r.eligible_base, pool_pct: S.pool_pct, target: { ...r.target },
      merit_pct: r.merit_pct, variance_pp: r.dev_pp,
      variance_eur: r.dev_eur, variance_eur_in_year: r.dev_eur_in_year,
      merit_in_year_pct_of_payroll: s2.in_year / r.payroll * 100,
      merit_annual_pct_of_payroll: s2.annual / r.payroll * 100,
    },
    flags: {
      equity_over_max: r.flag_equity_over_max, red_circled: r.red_circled,
      below_min_after_merit: r.below_min_after, not_eligible: emp.length - elig.length,
      equity_recipients: emp.filter(e => e.uplift_base > 0).length,
      merit_recipients: emp.filter(e => e.increase > 0).length,
    },
    categories,
    cr_all: { ...crBlock(emp), low_cr_pct: Math.round(LOW_CR * 100) },
    matrix: { rows },
  };
}

/** CSV text in, screen data out. */
export function run(employeesCsv, bandsCsv, settings) {
  const { emp, hasCategory, hasGender } = loadEmployees(parseCsv(employeesCsv));
  return shape(analyse(emp, loadBands(parseCsv(bandsCsv)), settings, { hasCategory, hasGender }));
}
