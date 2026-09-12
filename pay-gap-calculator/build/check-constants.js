/* Reconciles the defaults across every file that records them.
 *
 * Five values (threshold, month, two rates, ceiling) live in four places:
 * calc.js, shell.html, excel/build_model.py, excel/reference_calc.py.
 * A constant written in two places drifts — on this project the row numbers of
 * the Summary sheet already did. Here the same class of error is caught by a
 * script rather than by eye: any mismatch means exit 1.
 */
const fs = require('fs');
const path = require('path');

const R = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const KEYS = ['threshold_pct', 'implementation_month', 'rate_below', 'rate_above', 'ceiling'];

/* calc.js is the source of truth: DEFAULT_SETTINGS. */
const calc = require('./calc.js').DEFAULT_SETTINGS;

/* shell.html — the values in the controls' value= attributes. */
const shell = R('shell.html');
const fromShell = id => {
  const m = shell.match(new RegExp('id="' + id + '"[^>]*?value="([^"]+)"'));
  return m ? parseFloat(m[1]) : null;
};
const html = {
  threshold_pct: fromShell('ctl-threshold'),
  implementation_month: fromShell('ctl-month'),
  rate_below: fromShell('ctl-rate-below'),
  rate_above: fromShell('ctl-rate-above'),
  ceiling: fromShell('ctl-ceiling'),
};

/* Both Python files hold a DEFAULTS = { "key": value, ... } dictionary. */
const fromPy = src => {
  const out = {};
  KEYS.forEach(k => {
    const m = src.match(new RegExp('"' + k + '"\\s*:\\s*([0-9.]+)'));
    out[k] = m ? parseFloat(m[1]) : null;
  });
  return out;
};
const model = fromPy(R('excel/build_model.py'));
const ref = fromPy(R('excel/reference_calc.py'));

const sources = { 'calc.js': calc, 'shell.html': html, 'build_model.py': model, 'reference_calc.py': ref };

const bad = [];
console.log('key'.padEnd(22) + Object.keys(sources).map(s => s.padStart(18)).join(''));
KEYS.forEach(k => {
  const vals = Object.keys(sources).map(s => sources[s][k]);
  const same = vals.every(v => v !== null && Math.abs(v - vals[0]) < 1e-9);
  if (!same) bad.push(k);
  console.log((same ? '  ' : '! ') + k.padEnd(20) + vals.map(v => String(v).padStart(18)).join(''));
});

if (bad.length) {
  console.error('\nMISMATCH in: ' + bad.join(', '));
  process.exit(1);
}
console.log('\nall ' + KEYS.length + ' defaults agree across ' + Object.keys(sources).length + ' files');
