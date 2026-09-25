/* Rendering, hit areas, labels.
 *
 * Like check-behaviour.js, it fails with exit 1 on a mismatch: a check that only
 * prints let both a broken render and drifted totals through.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const EXPECT = { min: '€148,426', full: '€396,245', diff: '€247,819' };

const errs = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  virtualConsole: new VirtualConsole().on('jsdomError', e => errs.push(e.message)),
});
const W = dom.window, d = W.document;

const out = [];
const fail = [];
const ok = (name, cond, detail) => {
  out.push((cond ? 'ok   ' : 'FAIL ') + name + (detail ? ': ' + detail : ''));
  if (!cond) fail.push(name);
};

setTimeout(() => {
  ok('no js errors', errs.length === 0, errs.join(' | '));

  const svg = d.querySelector('#chart svg');
  ok('svg present', !!svg);
  /* A chart that fails to draw once passed every check while the page showed a
     green banner: the element count is asserted, not merely reported. */
  ok('svg has content', svg && svg.querySelectorAll('*').length > 50,
    svg ? svg.querySelectorAll('*').length + ' elements' : 'no svg');
  ok('hit targets', d.querySelectorAll('.cat-hit').length === 7,
    d.querySelectorAll('.cat-hit').length + ' (expected 7)');
  ok('hover bands', d.querySelectorAll('.cat-band').length === 7);
  ok('focusable hits', d.querySelectorAll('.cat-hit[tabindex="0"]').length === 7);
  ok('threshold line drawn', d.querySelectorAll('.threshline').length > 0);
  ok('direct labels present', d.querySelectorAll('.pt-lab').length > 0,
    [...d.querySelectorAll('.pt-lab')].map(t => t.textContent).join(', '));

  ok('headline minimum', d.querySelector('#head-min').textContent === EXPECT.min);
  ok('headline full', d.querySelector('#head-full').textContent === EXPECT.full);
  ok('headline difference', d.querySelector('#head-diff').textContent === EXPECT.diff);

  const sc = W.__selfCheck;
  ok('self-check passes', sc && sc.passed, sc ? (sc.failed || []).join(', ') : 'not exposed');
  ok('no self-check banner in the page', !d.querySelector('#selfcheck'));

  ok('no stale var(--rev)', (html.match(/var\(--rev\)/g) || []).length === 0);
  ok('no serif on the hero figure', !/\.fig \.value \{[^}]*serif/.test(html));

  /* Only fetched resources count: src= on any element, and <link> hrefs the
     browser loads. A plain <a href> to the byline or the licence is navigation
     on click, not a request. */
  const fetches = (html.match(/\ssrc="https?:/g) || []).length +
    (html.match(/<link\b[^>]*\shref="https?:/g) || [])
      .filter(t => !/rel="(license|author|canonical)"/.test(t)).length;
  ok('no external fetches', fetches === 0, String(fetches));

  console.log(out.join('\n'));
  if (fail.length) {
    console.error('\n' + fail.length + ' check(s) failed: ' + fail.join(', '));
    process.exit(1);
  }
  console.log('\nall ' + out.length + ' checks passed');
}, 600);
