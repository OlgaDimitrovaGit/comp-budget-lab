/* Scenarios, boundaries, invariants.
 *
 * The script FAILS (exit 1) on any mismatch rather than just printing a report.
 * It used to always exit zero: swapping a contribution rate moved the total by
 * two thousand euro and the run still reported "all good". A check that cannot
 * fail checks nothing.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* Reference totals for the demo dataset. Any change to the calculation must
   either preserve them or be deliberately entered here — they cannot drift
   silently. */
const EXPECT = { min: '€148,536', full: '€396,522', diff: '€247,986' };

const errs = [];
const vc = new VirtualConsole().on('jsdomError', e => errs.push(e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const W = dom.window, d = W.document;

const out = [];
const fail = [];
const ok = (name, cond, detail) => {
  out.push((cond ? 'ok   ' : 'FAIL ') + name + (detail ? ': ' + detail : ''));
  if (!cond) fail.push(name);
};

setTimeout(() => {
  ok('no js errors', errs.length === 0, errs.join(' | '));

  // headline
  const min = d.querySelector('#head-min').textContent;
  const full = d.querySelector('#head-full').textContent;
  const diff = d.querySelector('#head-diff').textContent;
  ok('headline minimum', min === EXPECT.min, min + ' (expected ' + EXPECT.min + ')');
  ok('headline full', full === EXPECT.full, full + ' (expected ' + EXPECT.full + ')');
  ok('headline difference', diff === EXPECT.diff, diff + ' (expected ' + EXPECT.diff + ')');

  // self-check state, read from the exposed object (no banner on the page)
  const sc = W.__selfCheck;
  ok('self-check object exposed', !!sc);
  if (sc) {
    ok('self-check passes', sc.passed, 'failed: ' + (sc.failed || []).join(', '));
    ok('self-check ran the demo block', sc.total === 13, sc.total + ' checks (expected 13)');
  }
  ok('no self-check banner in the page', !d.querySelector('#selfcheck'));

  // scenario toggle
  const before = d.querySelector('#cat-body').textContent.length;
  d.querySelector('input[name="scenario"][value="full"]').click();
  const after = d.querySelector('#cat-body').textContent.length;
  ok('scenario toggle changes the table', before !== after);
  ok('headline unchanged by the toggle', d.querySelector('#head-diff').textContent === EXPECT.diff);
  d.querySelector('input[name="scenario"][value="minimum"]').click();

  // threshold boundary
  const t = d.querySelector('#ctl-threshold');
  t.value = '0';
  t.dispatchEvent(new W.Event('input', { bubbles: true }));
  ok('threshold 0 collapses the difference', d.querySelector('#head-diff').textContent === '€0',
    d.querySelector('#head-diff').textContent);
  t.value = '5';
  t.dispatchEvent(new W.Event('input', { bubbles: true }));
  ok('threshold restored', d.querySelector('#head-diff').textContent === EXPECT.diff);

  // structural promises
  ok('no innerHTML in the bundle', (html.match(/\.innerHTML/g) || []).length === 0);
  const fetches = (html.match(/\ssrc="https?:/g) || []).length +
    (html.match(/<link\b[^>]*\shref="https?:/g) || [])
      .filter(t => !/rel="(license|author|canonical)"/.test(t)).length;
  ok('no external fetches', fetches === 0, String(fetches));
  ok('body overflow-x hidden', /body\s*\{[^}]*overflow-x:\s*hidden/.test(html));
  ok('no "regression" before Method',
    (d.body.textContent.split('Method')[0].match(/regression/gi) || []).length === 0);

  console.log(out.join('\n'));
  if (fail.length) {
    console.error('\n' + fail.length + ' check(s) failed: ' + fail.join(', '));
    process.exit(1);
  }
  console.log('\nall ' + out.length + ' checks passed');
}, 700);
