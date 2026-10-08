import { createContext, useContext } from 'react';
import { analyse, DEFAULTS, loadBands, loadEmployees, parseCsv, shape } from './engine.js';
import demoEmployees from '../../build/demo-data.csv?raw';
import demoBands from '../../build/demo-bands.csv?raw';

export { demoEmployees, demoBands };
export type Data = ReturnType<typeof shape>;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// the same lists as the Inputs sheet of the Excel model (build_model.py, LISTS)
export const REVIEW_DATES = Array.from({ length: 26 }, (_, i) => `${MONTHS[(10 + i) % 12]} ${2026 + Math.floor((10 + i) / 12)}`);
export const MONTH_STEPS = [0, 1, 2, 3, 6, 9, 12];
export const MAX_INCREASE = ['No cap', 10, 15, 20, 25, 30, 40, 50, 75, 100];

export type Params = {
  budget: string; date: string; target: string; max: string; service: string; change: string; clip: boolean;
  ratings: { rating: number; target: string; min: string }[];
  contrib: { rate: string; ceiling: string; band1: string; band2: string; band3: string };
};

const pct = (x: number) => String(Math.round(x * 10000) / 100);
export const DEFAULT_PARAMS: Params = {
  budget: String(DEFAULTS.pool_pct.toFixed(1)),
  date: `${MONTHS[DEFAULTS.effective.month - 1]} ${DEFAULTS.effective.year}`,
  target: pct(DEFAULTS.company_target),
  max: DEFAULTS.max_increase ? pct(DEFAULTS.max_increase) : 'No cap',
  service: String(DEFAULTS.min_months_hire),
  change: String(DEFAULTS.min_months_change),
  clip: DEFAULTS.clip_at_max,
  ratings: [5, 4, 3, 2, 1].map(r => {
    const [t, m] = DEFAULTS.ratings[r as 1];
    return { rating: r, target: t ? pct(t) : '', min: pct(m) };
  }),
  contrib: {
    rate: String(DEFAULTS.rate_below), ceiling: String(DEFAULTS.ceiling),
    band1: String(DEFAULTS.above_ceiling[0][1]), band2: String(DEFAULTS.above_ceiling[1][1]), band3: String(DEFAULTS.above_ceiling[2][1]),
  },
};

/** A typed number: comma or point as the decimal mark; empty → fallback. NaN when unreadable. */
export function readNumber(s: string, empty = NaN) {
  const t = s.replace('%', '').replace(',', '.').trim();
  return t === '' ? empty : Number(t);
}

/** Page parameters → engine settings; null while any field is unreadable (the screen keeps the last result). */
export function toSettings(p: Params) {
  const [mon, year] = p.date.split(' ');
  const ratings: Record<number, [number, number]> = {};
  for (const r of p.ratings) ratings[r.rating] = [readNumber(r.target, 0) / 100, readNumber(r.min, 0) / 100];
  const s = {
    effective: { year: Number(year), month: MONTHS.indexOf(mon) + 1 },
    pool_pct: readNumber(p.budget),
    company_target: readNumber(p.target) / 100,
    max_increase: p.max === 'No cap' ? null : Number(p.max) / 100,
    min_months_hire: Number(p.service), min_months_change: Number(p.change),
    clip_at_max: p.clip, ratings,
    rate_below: readNumber(p.contrib.rate), ceiling: readNumber(p.contrib.ceiling),
    above_ceiling: [[1.10, readNumber(p.contrib.band1, 0)], [1.50, readNumber(p.contrib.band2, 0)], [null, readNumber(p.contrib.band3, 0)]],
  };
  const nums = [s.pool_pct, s.company_target, s.rate_below, s.ceiling, ...s.above_ceiling.map(x => x[1] as number),
    ...Object.values(ratings).flat()];
  return nums.every(Number.isFinite) && s.company_target > 0 && s.ceiling >= 0 ? s : null;
}

/** Period wording from the review month: "Apr–Dec 2027", "9 months". */
export function period(d: Data) {
  const y = d.settings.effective_year, m = d.settings.effective_month, n = 13 - m;
  return {
    year: y, next: y + 1, months: n,
    span: m === 12 ? `Dec ${y}` : `${MONTHS[m - 1]}–Dec ${y}`,
    monthsText: n === 1 ? '1 month' : `${n} months`,
  };
}

export const DataContext = createContext<Data | null>(null);
export const useData = () => useContext(DataContext)!;

export type Source = { employees: string; bands: string; name: string | null };

/** Runs the engine; throws the engine's message when the files do not fit together. */
export function compute(src: Source, settings: object): Data {
  const { emp, hasCategory, hasGender } = loadEmployees(parseCsv(src.employees));
  return shape(analyse(emp, loadBands(parseCsv(src.bands)), settings, { hasCategory, hasGender })) as Data;
}
