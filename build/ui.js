/* ============================================================================
 * Part B — UI
 * Owns all DOM. Computes nothing: calls CALC.* and renders the Result.
 * No network calls of any kind. No external fonts, no CDN, no chart library.
 * ==========================================================================*/

/* ---------------------------------------------------------------------------
 * FIXTURE_RESULT — part B's own stand-in for the Result shape from CONTRACT.md.
 * Used only while part A is missing; dropped at final assembly.
 * Numbers are hand-made and internally plausible, not computed.
 * -------------------------------------------------------------------------*/
var FIXTURE_RESULT = (function () {
  function scen(recipients, adjustment, contributions, unexplainedAfter, meanAfter) {
    return {
      recipients: recipients,
      adjustment: adjustment,
      contributions: contributions,
      total_cost: adjustment + contributions,
      unexplained_after: unexplainedAfter,
      mean_pay_after: meanAfter
    };
  }

  var categories = [
    {
      category: 'Engineering',
      headcount: 42, headcount_f: 14, headcount_m: 28,
      raw_gap_mean_pct: 8.4, raw_gap_median_pct: 7.9, variable_gap_pct: 12.1,
      explained_pct: 3.1, unexplained_pct: 5.3,
      regression: { intercept: 38000, coef_grade: 4800, coef_tenure: 720, r_squared: 0.71, n: 42 },
      unreliable: false, reverse_gap: false,
      minimum: scen(9, 24180.44, 7480.11, 5.0, 61240.00),
      full: scen(14, 61220.10, 18900.55, 0.0, 62980.30)
    },
    {
      category: 'Sales',
      headcount: 36, headcount_f: 17, headcount_m: 19,
      raw_gap_mean_pct: 11.2, raw_gap_median_pct: 10.4, variable_gap_pct: 24.7,
      explained_pct: 2.4, unexplained_pct: 8.8,
      regression: { intercept: 31000, coef_grade: 4100, coef_tenure: 610, r_squared: 0.58, n: 36 },
      unreliable: false, reverse_gap: false,
      minimum: scen(12, 41880.90, 13070.25, 5.0, 54110.70),
      full: scen(17, 78450.30, 24380.60, 0.0, 56220.15)
    },
    {
      category: 'Operations',
      headcount: 48, headcount_f: 26, headcount_m: 22,
      raw_gap_mean_pct: 4.1, raw_gap_median_pct: 3.6, variable_gap_pct: 5.2,
      explained_pct: 2.9, unexplained_pct: 1.2,
      regression: { intercept: 27500, coef_grade: 3300, coef_tenure: 480, r_squared: 0.64, n: 48 },
      unreliable: false, reverse_gap: false,
      minimum: scen(0, 0, 0, 1.2, 41320.00),
      full: scen(19, 22140.75, 6970.35, 0.0, 41800.40)
    },
    {
      category: 'Customer Support',
      headcount: 31, headcount_f: 21, headcount_m: 10,
      raw_gap_mean_pct: 2.2, raw_gap_median_pct: 1.9, variable_gap_pct: 9.8,
      explained_pct: 1.7, unexplained_pct: 0.5,
      regression: { intercept: 24000, coef_grade: 2600, coef_tenure: 390, r_squared: 0.52, n: 31 },
      unreliable: false, reverse_gap: false,
      minimum: scen(0, 0, 0, 0.5, 33050.00),
      full: scen(11, 8320.60, 2620.99, 0.0, 33210.20)
    },
    {
      category: 'Finance',
      headcount: 22, headcount_f: 12, headcount_m: 10,
      raw_gap_mean_pct: -3.6, raw_gap_median_pct: -4.2, variable_gap_pct: -2.1,
      explained_pct: -1.1, unexplained_pct: -2.5,
      regression: { intercept: 35000, coef_grade: 4400, coef_tenure: 700, r_squared: 0.69, n: 22 },
      unreliable: false, reverse_gap: true,
      minimum: scen(0, 0, 0, -2.5, 58400.00),
      full: scen(0, 0, 0, -2.5, 58400.00)
    },
    {
      category: 'Legal',
      headcount: 8, headcount_f: 2, headcount_m: 6,
      raw_gap_mean_pct: 19.7, raw_gap_median_pct: 17.4, variable_gap_pct: 21.3,
      explained_pct: 4.9, unexplained_pct: 14.8,
      regression: { intercept: 41000, coef_grade: 5200, coef_tenure: 830, r_squared: 0.44, n: 8 },
      unreliable: true, reverse_gap: false,
      minimum: scen(2, 19420.00, 5010.30, 5.0, 71880.00),
      full: scen(2, 29060.40, 6440.85, 0.0, 73140.90)
    },
    {
      category: 'Marketing',
      headcount: 13, headcount_f: 7, headcount_m: 6,
      raw_gap_mean_pct: 6.9, raw_gap_median_pct: 6.1, variable_gap_pct: 18.4,
      explained_pct: 0.4, unexplained_pct: 6.5,
      regression: { intercept: 30500, coef_grade: 3900, coef_tenure: 520, r_squared: 0.61, n: 13 },
      unreliable: false, reverse_gap: false,
      minimum: scen(4, 6890.25, 2160.40, 5.0, 45120.00),
      full: scen(7, 20410.80, 6390.70, 0.0, 46030.55)
    }
  ];

  function sumScen(key, month) {
    var adj = 0, con = 0;
    categories.forEach(function (c) { adj += c[key].adjustment; con += c[key].contributions; });
    var total = adj + con;
    return {
      adjustment: adj,
      contributions: con,
      total_cost: total,
      cost_current_year: total * (13 - month) / 12,
      cost_next_year: total,
      payroll_uplift_pct: total / 11800000 * 100
    };
  }

  var month = 7;
  var minimum = sumScen('minimum', month);
  var full = sumScen('full', month);
  var difference = {
    adjustment: full.adjustment - minimum.adjustment,
    contributions: full.contributions - minimum.contributions,
    total_cost: full.total_cost - minimum.total_cost,
    cost_current_year: full.cost_current_year - minimum.cost_current_year,
    cost_next_year: full.cost_next_year - minimum.cost_next_year,
    payroll_uplift_pct: full.payroll_uplift_pct - minimum.payroll_uplift_pct
  };

  return {
    categories: categories,
    totals: {
      headcount: 200,
      payroll_before: 11800000,
      minimum: minimum,
      full: full,
      difference: difference
    },
    settings_used: {
      threshold_pct: 5,
      implementation_month: 7,
      rate_below: 31.5,
      rate_above: 1.15,
      ceiling: 61214
    }
  };
})();

var UI = (function () {
  'use strict';

  /* ---------------------------------------------------------------- state */

  var state = {
    employees: null,      // Employee[] or null while CALC is absent
    result: null,         // last rendered Result
    scenario: 'minimum',  // 'minimum' | 'full' — table + chart only
    usingFixture: true,
    dataLabel: 'demo data'
  };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  /* ------------------------------------------------------------ formatting */

  function $(id) { return document.getElementById(id); }

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var v = Math.round(n);
    return '€' + v.toLocaleString('en-GB');
  }

  function money0(n) { return money(n); }

  function pct(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var d = (digits === undefined) ? 1 : digits;
    return n.toFixed(d) + '%';
  }

  function signedPct(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var d = (digits === undefined) ? 1 : digits;
    return (n > 0 ? '' : '') + n.toFixed(d) + '%';
  }

  function num(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return String(n);
  }

  function text(el, s) { el.textContent = s; }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined && txt !== null) e.textContent = txt;
    return e;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          e.setAttribute(k, String(attrs[k]));
        }
      }
    }
    return e;
  }

  /* -------------------------------------------------------------- settings */

  function numberFromInput(id, fallback) {
    var raw = $(id).value.replace(',', '.').trim();
    var v = parseFloat(raw);
    return isFinite(v) ? v : fallback;
  }

  function readSettings() {
    var s = {
      threshold_pct: numberFromInput('ctl-threshold', 5),
      implementation_month: Math.round(numberFromInput('ctl-month', 7)),
      rate_below: numberFromInput('ctl-rate-below', 31.5),
      rate_above: numberFromInput('ctl-rate-above', 1.15),
      ceiling: numberFromInput('ctl-ceiling', 61214)
    };
    if (s.implementation_month < 1) s.implementation_month = 1;
    if (s.implementation_month > 12) s.implementation_month = 12;
    if (s.threshold_pct < 0) s.threshold_pct = 0;
    if (s.ceiling < 0) s.ceiling = 0;
    return s;
  }

  /* ------------------------------------------------------------ headline */

  function renderHeadline(result) {
    var t = result.totals;
    text($('head-min'), money(t.minimum.total_cost));
    text($('head-full'), money(t.full.total_cost));
    text($('head-diff'), money(t.difference.total_cost));
  }

  /* ------------------------------------------------------------- summary */

  function renderSummary(result) {
    var t = result.totals;
    var s = result.settings_used;
    var rows = [
      ['Headcount', num(t.headcount)],
      ['Payroll before, total pay', money(t.payroll_before)],
      ['Minimum compliance — base pay adjustment', money(t.minimum.adjustment)],
      ['Minimum compliance — employer contributions', money(t.minimum.contributions)],
      ['Minimum compliance — cost this year (from ' + MONTHS[(s.implementation_month || 1) - 1] + ')',
        money(t.minimum.cost_current_year)],
      ['Minimum compliance — cost next year, full', money(t.minimum.cost_next_year)],
      ['Minimum compliance — payroll uplift', pct(t.minimum.payroll_uplift_pct, 2)],
      ['Full equalisation — base pay adjustment', money(t.full.adjustment)],
      ['Full equalisation — employer contributions', money(t.full.contributions)],
      ['Full equalisation — cost this year (from ' + MONTHS[(s.implementation_month || 1) - 1] + ')',
        money(t.full.cost_current_year)],
      ['Full equalisation — cost next year, full', money(t.full.cost_next_year)],
      ['Full equalisation — payroll uplift', pct(t.full.payroll_uplift_pct, 2)]
    ];
    var tbody = $('summary-body');
    clear(tbody);
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('th', 'k', r[0]));
      tr.appendChild(el('td', 'v num', r[1]));
      tbody.appendChild(tr);
    });

    renderScenarioTiles(result);
  }

  /* Stat tiles for the two scenarios plus the difference between them.
   * The same figures as the table above, in the form the reader actually
   * compares them in: one tile per scenario, the total as the headline, the
   * share of payroll as a meter, the breakdown underneath. */
  function renderScenarioTiles(result) {
    var host = $('scen-grid');
    if (!host) return;
    var t = result.totals;
    var s = result.settings_used;
    var month = MONTHS[(s.implementation_month || 1) - 1];
    clear(host);

    /* Meters share one scale so the two fills are comparable: the wider of the
       two scenarios defines full width. Without a common denominator the
       minimum tile would look as expensive as the full one. */
    var maxPct = Math.max(t.minimum.payroll_uplift_pct, t.full.payroll_uplift_pct, 0.0001);

    function tile(name, block, opts) {
      var o = opts || {};
      var box = el('div', 'scen' + (o.diff ? ' scen-diff' : ''));

      var head = el('div', 'scen-head');
      head.appendChild(el('div', 'scen-name', name));
      box.appendChild(head);

      box.appendChild(el('div', 'scen-total num', money(block.total_cost)));

      if (!o.diff) {
        var meter = el('div', 'meter');
        var fill = el('i');
        fill.style.width = Math.max(2, block.payroll_uplift_pct / maxPct * 100) + '%';
        meter.appendChild(fill);
        box.appendChild(meter);
      }
      box.appendChild(el('div', 'meter-note',
        pct(block.payroll_uplift_pct, 2) + ' of payroll'));

      var rows = el('div', 'scen-rows');
      [
        ['Base pay adjustment', money(block.adjustment)],
        ['Employer contributions', money(block.contributions)],
        ['Cost this year (from ' + month + ')', money(block.cost_current_year)],
        ['Cost next year, full', money(block.cost_next_year)]
      ].forEach(function (r) {
        var line = el('div', 'scen-row');
        line.appendChild(el('span', 'k', r[0]));
        line.appendChild(el('span', 'v', r[1]));
        rows.appendChild(line);
      });
      box.appendChild(rows);
      return box;
    }

    host.appendChild(tile('Minimum compliance', t.minimum));
    host.appendChild(tile('Full equalisation', t.full));
    host.appendChild(tile('Difference', t.difference, { diff: true }));
  }

  /* --------------------------------------------------------------- chart
   * Own inline SVG. No library.
   *
   * Geometry: fixed user-space viewBox 0 0 W H, scaled by CSS to the
   * container width (preserveAspectRatio default). Everything inside is in
   * user units, so the phone rendering is the desktop rendering shrunk —
   * font sizes are chosen so that at ~340 CSS px wide the labels still read.
   *
   * X: one slot per category, evenly spaced.
   * Y: unexplained gap %, linear, domain covers [min(0, worst reverse),
   *    max(threshold, worst gap)] with padding; y=0 baseline always drawn,
   *    threshold drawn as a dashed horizontal rule with a label.
   * Marks: "before" hollow circle, "after" filled circle, joined by a
   *    vertical connector. Reverse-gap categories use a distinct shape
   *    (diamond) and sit below the zero line. Unreliable categories get a
   *    hatched marker ring and an asterisk on the axis label.
   * -------------------------------------------------------------------*/

  /* The viewBox width tracks the container's actual width, so user-space px and
     CSS px stay near 1:1 and a 13px label renders at ~13px on every screen.
     A fixed box magnifies or shrinks every glyph with the container: at 780
     against a 318px phone column, every label came out at 5-6px.

     Wmin keeps a floor under the box — below it the chart scales down rather
     than losing all margin. Narrow screens also get tighter side margins and a
     shorter plot: the axis needs less room when there are fewer pixels to
     spend, and the labels rotate instead of wrapping. */
  var CHART = {
    W: 780, Wmin: 360, narrowBelow: 560,
    plotH: 300, plotHNarrow: 210,
    ml: 60, mr: 22, mlNarrow: 40, mrNarrow: 12,
    mt: 44, mtNarrow: 34, mb: 96
  };

  /* Split a category name into at most two display lines. Initials ("CS" for
     Customer Support) are unreadable in a legend-less axis, so we wrap on a
     space instead and only truncate a single over-long word. */
  function labelLines(s, maxLen) {
    var m = maxLen || 13;
    if (s.length <= m) return [s];
    var parts = s.split(/\s+/);
    if (parts.length === 1) return [s.slice(0, m) + '…'];
    var first = parts[0], rest = parts.slice(1).join(' ');
    if (first.length > m) first = first.slice(0, m) + '…';
    if (rest.length > m) rest = rest.slice(0, m) + '…';
    return [first, rest];
  }

  /* Which points get a printed value. Never all of them: seven numbers over
     seven slots is noise. The rule is "the ones the reader would ask about" —
     the worst residual, and every reverse gap, because a point below zero is
     the one thing on this chart that is not a defect to be fixed. */
  function labelled(cats) {
    var pick = {};
    var worst = -Infinity, wi = -1;
    cats.forEach(function (c, i) {
      if (c.reverse_gap) { pick[i] = true; return; }
      if (c.unexplained_pct > worst) { worst = c.unexplained_pct; wi = i; }
    });
    if (wi >= 0) pick[wi] = true;
    return pick;
  }

  function renderChart(result, scenario) {
    var host = $('chart');
    clear(host);

    var cats = result.categories;
    var threshold = result.settings_used.threshold_pct;
    if (!cats.length) { host.appendChild(el('p', 'muted', 'No categories.')); return; }

    /* The viewBox width follows the container, so that user-space px and CSS px
       stay roughly 1:1 at any screen width. With a fixed 780 box the SVG was
       squeezed to ~318 CSS px on a phone (scale 0.41) and every label rendered
       at 5-6px — unreadable, and invisible to jsdom, which reports the declared
       size rather than the scaled one. Clamped: below ~360 the box stops
       shrinking, so a very narrow phone scales down slightly rather than
       cramming seven categories into no space at all. */
    var hostW = host.getBoundingClientRect().width || CHART.W;
    var W = Math.round(Math.max(CHART.Wmin, Math.min(CHART.W, hostW)));
    var narrow = W < CHART.narrowBelow;

    var ml = narrow ? CHART.mlNarrow : CHART.ml;
    var mr = narrow ? CHART.mrNarrow : CHART.mr;
    var mt = narrow ? CHART.mtNarrow : CHART.mt;
    var plotW = W - ml - mr;

    /* Decide the x-label treatment before fixing the height: a rotated label
       needs a deeper bottom margin than a wrapped one. ~7px per character at
       the 14px user-space label size. */
    var slotW = plotW / cats.length;
    var maxChars = Math.max(6, Math.floor(slotW / 7));
    var longestWord = 0;
    cats.forEach(function (c) {
      c.category.split(/\s+/).forEach(function (w) {
        if (w.length > longestWord) longestWord = w.length;
      });
    });
    var rotate = longestWord > maxChars;
    var rotReach = 0;   // vertical depth the rotated labels need, set below
    /* A -40deg label runs down-left from its anchor, so in rotate mode the
       plot needs extra room on the left or the first label is clipped. */
    if (rotate) {
      /* A -40deg label runs down-LEFT from its anchor, so the first category
         needs room to the left of the plot or it is cut off by the viewBox.
         The reserve is the label's own horizontal reach: the longest name at
         ~6.2px per character, projected onto x by cos(40deg) ~= 0.77, capped
         so it cannot swallow the plot on a narrow screen. */
      var longestName = 0;
      cats.forEach(function (c) {
        var n = c.category.length + 8;          // + the " (n=NN)" suffix
        if (n > longestName) longestName = n;
      });
      /* 6.9px per character, not 6.2: the earlier estimate was measured on
         lowercase and left "Customer Support (n=30)" two pixels short. */
      var reach = Math.ceil(longestName * 6.9 * 0.77);
      ml = Math.max(ml, Math.min(reach, Math.round(W * 0.30)));
      plotW = W - ml - mr;
      /* The same label also descends: sin(40deg) ~= 0.64 of its length, plus
         the anchor offset below the axis. The bottom margin has to cover that
         or the longest names are clipped by the viewBox — which is exactly
         what happened to "Customer Support (n=30)". */
      rotReach = Math.ceil(longestName * 6.9 * 0.64) + 26;
    }
    /* slotW was measured against the pre-rotate plot width; the hover bands
       below are sized from it, so it has to follow the narrowed plot or
       adjacent bands overlap. */
    slotW = plotW / cats.length;
    var plotH = narrow ? CHART.plotHNarrow : CHART.plotH;
    /* Rotated labels run down-left from the axis and need more depth than
       wrapped ones; on a narrow box they are the normal case. */
    var mb = rotate ? Math.max(narrow ? 104 : 96, rotReach)
                    : (narrow ? 76 : CHART.mb);
    var H = plotH + mt + mb;

    var vals = [];
    cats.forEach(function (c) {
      vals.push(c.unexplained_pct);
      vals.push(c[scenario].unexplained_after);
    });
    vals.push(0);
    vals.push(threshold);
    var vmax = Math.max.apply(null, vals);
    var vmin = Math.min.apply(null, vals);
    var pad = Math.max(1, (vmax - vmin) * 0.12);
    var yTop = vmax + pad, yBot = vmin - pad;
    if (yTop === yBot) { yTop += 1; yBot -= 1; }

    function y(v) { return mt + plotH * (yTop - v) / (yTop - yBot); }
    function x(i) { return ml + plotW * (i + 0.5) / cats.length; }

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      role: 'img',
      'aria-label': 'Unexplained pay gap by category, before and after adjustment, ' +
        'with the joint pay assessment threshold at ' + threshold + ' per cent'
    });
    svg.setAttribute('class', 'chart-svg');

    /* gridlines + y axis ticks */
    var step = niceStep(yTop - yBot);
    var gridG = svgEl('g', { 'class': 'grid' });
    for (var g = Math.ceil(yBot / step) * step; g <= yTop + 1e-9; g += step) {
      var gy = y(g);
      gridG.appendChild(svgEl('line', { x1: ml, x2: W - mr, y1: gy, y2: gy, 'class': 'gridline' }));
      var lab = svgEl('text', { x: ml - 8, y: gy + 4, 'class': 'axis-lab', 'text-anchor': 'end' });
      lab.textContent = (Math.abs(g) < 1e-9 ? '0' : g.toFixed(step < 1 ? 1 : 0)) + '%';
      gridG.appendChild(lab);
    }
    svg.appendChild(gridG);

    /* zero baseline */
    svg.appendChild(svgEl('line', {
      x1: ml, x2: W - mr, y1: y(0), y2: y(0), 'class': 'zeroline'
    }));

    /* threshold line — required by spec */
    var ty = y(threshold);
    svg.appendChild(svgEl('line', {
      x1: ml, x2: W - mr, y1: ty, y2: ty, 'class': 'threshline'
    }));
    /* Label sits on its own line in the top margin, never over the plot: with
       seven categories a right-aligned in-plot label collides with the last
       point whenever that category's gap is near the threshold. */
    var tlabTxt = 'threshold ' + threshold + '%, joint pay assessment';
    var tlab = svgEl('text', { x: W - mr, y: 30, 'class': 'thresh-lab', 'text-anchor': 'end' });
    tlab.textContent = tlabTxt;
    svg.appendChild(tlab);
    /* The dash sample sits to the LEFT of the text, past its measured width.
       Anchoring it by a guessed offset put the dash through the word. */
    var tw = tlabTxt.length * 6.6 + 10;
    svg.appendChild(svgEl('line', {
      x1: W - mr - tw - 20, x2: W - mr - tw - 4, y1: 26, y2: 26, 'class': 'threshline'
    }));

    /* series */
    var marked = labelled(cats);
    var maxLines = 1;
    if (!rotate) {
      cats.forEach(function (c) {
        var n = labelLines(c.category, maxChars).length;
        if (n > maxLines) maxLines = n;
      });
    }
    cats.forEach(function (c, i) {
      var cx = x(i);
      var before = c.unexplained_pct;
      var after = c[scenario].unexplained_after;
      var moved = Math.abs(before - after) > 1e-9;
      var gcls = 'cat' + (c.reverse_gap ? ' reverse' : '') + (c.unreliable ? ' unreliable' : '');
      var g2 = svgEl('g', { 'class': gcls });

      /* connector */
      g2.appendChild(svgEl('line', {
        x1: cx, x2: cx, y1: y(before), y2: y(after),
        'class': 'connector' + (moved ? '' : ' flat')
      }));

      /* No arrowhead. Direction is already carried twice — by the connector
         running from the hollow "before" to the filled "after" marker, and by
         the legend naming both ends. Every placement tried either collided
         with the dot or, tucked behind it, drew nothing at all. */

      /* before */
      g2.appendChild(mark(cx, y(before), c.reverse_gap, 'before'));
      /* after */
      g2.appendChild(mark(cx, y(after), c.reverse_gap, 'after'));

      /* unreliable ring */
      if (c.unreliable) {
        g2.appendChild(svgEl('circle', {
          cx: cx, cy: y(before), r: 8, 'class': 'unrel-ring'
        }));
      }

      /* x label. A horizontal label only fits when the slot is wide enough for
         the longest word; otherwise the labels of adjacent categories collide.
         Below that width the whole label is rotated instead of being wrapped. */
      var baseY = H - mb + 18;
      if (rotate) {
        var lr = svgEl('text', {
          x: 0, y: 0, 'class': 'cat-lab', 'text-anchor': 'end',
          transform: 'translate(' + (cx + 4) + ',' + (baseY + 2) + ') rotate(-40)'
        });
        lr.textContent = c.category + (c.unreliable ? ' *' : '') + '  (n=' + c.headcount + ')';
        svg.appendChild(lr);
      } else {
        var lines = labelLines(c.category, maxChars);
        lines.forEach(function (ln, li) {
          var lx = svgEl('text', {
            x: cx, y: baseY + li * 15, 'class': 'cat-lab', 'text-anchor': 'middle'
          });
          lx.textContent = ln + (c.unreliable && li === lines.length - 1 ? ' *' : '');
          var lt = svgEl('title');
          lt.textContent = c.category;
          lx.appendChild(lt);
          svg.appendChild(lx);
        });
        /* The headcount sits on a shared baseline set by the LONGEST name on
           the axis, not by this label's own line count — otherwise a two-line
           name ("Customer Support") drops its n= below everyone else's and the
           row of counts stops reading as a row. */
        var lx2 = svgEl('text', {
          x: cx, y: baseY + maxLines * 15 + 2, 'class': 'cat-sub', 'text-anchor': 'middle'
        });
        lx2.textContent = 'n=' + c.headcount;
        svg.appendChild(lx2);
      }

      /* Direct label on the selected points only (see labelled()). Offset away
         from the "after" marker so the two never overlap. */
      if (marked[i]) {
        var ptxt = signedPct(before);
        /* Flip the label inboard near the right edge — at the last category an
           outboard label is cut off by the viewBox ("10.3%" rendered "10.3"). */
        var wEst = ptxt.length * 7.2;
        var flip = cx + 12 + wEst > W - mr;
        var pl = svgEl('text', {
          x: cx + (flip ? -12 : 12),
          y: y(before) + (before < 0 ? 15 : -9),
          'class': 'pt-lab', 'text-anchor': flip ? 'end' : 'start'
        });
        pl.textContent = ptxt;
        g2.appendChild(pl);
      }

      var title = svgEl('title');
      title.textContent = c.category + ': unexplained ' + signedPct(before) +
        ' → ' + signedPct(after) +
        (c.reverse_gap ? ' (gap favours women, not adjusted)' : '') +
        (c.unreliable ? ' (statistically unreliable)' : '');
      g2.appendChild(title);

      /* Full-slot hover/focus target, drawn first so it sits under the marks
         but covers the whole column: the reader should not have to hit a 9px
         dot. Keyboard reaches it too — the tooltip is never the only route to
         a value, the table below carries all of them. */
      var band = svgEl('rect', {
        x: cx - slotW / 2, y: mt, width: slotW, height: plotH, 'class': 'cat-band'
      });
      g2.insertBefore(band, g2.firstChild);
      var hit = svgEl('rect', {
        x: cx - slotW / 2, y: mt, width: slotW, height: plotH,
        'class': 'cat-hit', tabindex: '0', role: 'img',
        'aria-label': title.textContent
      });
      hit.addEventListener('mouseenter', function () { g2.setAttribute('class', gcls + ' hot'); });
      hit.addEventListener('mouseleave', function () { g2.setAttribute('class', gcls); });
      hit.addEventListener('focus', function () { g2.setAttribute('class', gcls + ' hot'); });
      hit.addEventListener('blur', function () { g2.setAttribute('class', gcls); });
      g2.appendChild(hit);

      svg.appendChild(g2);
    });

    /* axis title */
    /* y=14, not 12: the text baseline sits at y, so a 12.5px cap-height rose
       above the top edge of the viewBox and was clipped. */
    var yt = svgEl('text', { x: 4, y: 14, 'class': 'axis-title' });
    yt.textContent = 'unexplained gap, %';
    svg.appendChild(yt);

    host.appendChild(svg);
  }

  function mark(cx, cy, isReverse, kind) {
    var cls = 'pt pt-' + kind;
    if (isReverse) {
      var r = 5.2;
      return svgEl('path', {
        d: 'M ' + cx + ' ' + (cy - r) + ' L ' + (cx + r) + ' ' + cy +
           ' L ' + cx + ' ' + (cy + r) + ' L ' + (cx - r) + ' ' + cy + ' Z',
        'class': cls + ' rev'
      });
    }
    return svgEl('circle', { cx: cx, cy: cy, r: 4.6, 'class': cls });
  }

  function niceStep(range) {
    var raw = range / 5;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / mag;
    var m = n >= 5 ? 5 : n >= 2 ? 2 : 1;
    return m * mag;
  }

  /* --------------------------------------------------------------- table */

  var COLS = [
    { h: 'Category', cls: '' },
    { h: 'n', cls: 'num' },
    { h: 'Women / men', cls: 'num' },
    { h: 'Gap, total pay', cls: 'num' },
    { h: 'Gap, variable pay', cls: 'num' },
    { h: 'Explained by grade and tenure', cls: 'num' },
    { h: 'Unexplained residual', cls: 'num' },
    { h: 'Residual after', cls: 'num' },
    { h: 'Recipients', cls: 'num' },
    { h: 'Base pay adjustment', cls: 'num' },
    { h: 'Employer contributions', cls: 'num' },
    { h: 'Total cost', cls: 'num' },
    { h: 'Reliability', cls: '' }
  ];

  function renderTable(result, scenario) {
    var thead = $('cat-head'), tbody = $('cat-body'), tfoot = $('cat-foot');
    clear(thead); clear(tbody); clear(tfoot);

    var htr = el('tr');
    COLS.forEach(function (c) {
      var th = el('th', c.cls, c.h);
      th.setAttribute('scope', 'col');
      htr.appendChild(th);
    });
    thead.appendChild(htr);

    var sums = { rec: 0, adj: 0, con: 0, tot: 0, n: 0 };

    result.categories.forEach(function (c) {
      var s = c[scenario];
      var tr = el('tr');
      if (c.reverse_gap) tr.classList.add('row-reverse');
      if (c.unreliable) tr.classList.add('row-unreliable');

      var th = el('th', '', c.category);
      th.setAttribute('scope', 'row');
      tr.appendChild(th);

      tr.appendChild(el('td', 'num', num(c.headcount)));
      tr.appendChild(el('td', 'num', c.headcount_f + ' / ' + c.headcount_m));
      tr.appendChild(el('td', 'num' + (c.raw_gap_mean_pct < 0 ? ' neg' : ''), signedPct(c.raw_gap_mean_pct)));
      tr.appendChild(el('td', 'num' + (c.variable_gap_pct < 0 ? ' neg' : ''), signedPct(c.variable_gap_pct)));
      tr.appendChild(el('td', 'num', signedPct(c.explained_pct)));
      tr.appendChild(el('td', 'num strong' + (c.unexplained_pct < 0 ? ' neg' : ''), signedPct(c.unexplained_pct)));
      tr.appendChild(el('td', 'num', signedPct(s.unexplained_after)));
      tr.appendChild(el('td', 'num', num(s.recipients)));
      tr.appendChild(el('td', 'num', money(s.adjustment)));
      tr.appendChild(el('td', 'num', money(s.contributions)));
      tr.appendChild(el('td', 'num strong', money(s.total_cost)));

      var flags = [];
      if (c.unreliable) flags.push('statistically unreliable');
      if (c.reverse_gap) flags.push('gap favours women, not adjusted');
      var fd = el('td', 'flags');
      if (!flags.length) {
        fd.appendChild(el('span', 'muted', '—'));
      } else {
        flags.forEach(function (f) { fd.appendChild(el('span', 'tag', f)); });
      }
      tr.appendChild(fd);

      sums.n += c.headcount;
      sums.rec += s.recipients;
      sums.adj += s.adjustment;
      sums.con += s.contributions;
      sums.tot += s.total_cost;

      tbody.appendChild(tr);
    });

    var ftr = el('tr');
    var fth = el('th', '', 'All categories');
    fth.setAttribute('scope', 'row');
    ftr.appendChild(fth);
    ftr.appendChild(el('td', 'num', num(sums.n)));
    for (var i = 0; i < 6; i++) ftr.appendChild(el('td', 'num', ''));
    ftr.appendChild(el('td', 'num', num(sums.rec)));
    ftr.appendChild(el('td', 'num', money(sums.adj)));
    ftr.appendChild(el('td', 'num', money(sums.con)));
    ftr.appendChild(el('td', 'num strong', money(sums.tot)));
    ftr.appendChild(el('td', '', ''));
    tfoot.appendChild(ftr);
  }

  /* --------------------------------------------------------- self-check */

  /* The checks run on every recompute, but a green banner on the first screen is
     noise: it reports the expected state. Only a failure is worth the reader's
     attention, and it matters most on their own CSV, where a broken figure would
     otherwise look like a finding. Passing hides the element; failing shows it. */
  function renderSelfCheck(result) {
    var host = $('selfcheck');
    clear(host);
    host.hidden = false;

    if (typeof CALC === 'undefined' || typeof CALC.selfCheck !== 'function') {
      host.className = 'selfcheck pending';
      host.appendChild(el('span', 'sc-dot'));
      host.appendChild(el('span', 'sc-text',
        'Self-check unavailable: the calculation engine is not loaded (fixture preview).'));
      return;
    }

    var cr;
    try {
      cr = CALC.selfCheck(result);
    } catch (e) {
      host.className = 'selfcheck fail';
      host.appendChild(el('span', 'sc-dot'));
      host.appendChild(el('span', 'sc-text', 'Self-check threw an error: ' + (e && e.message)));
      return;
    }

    var checks = (cr && cr.checks) || [];
    var failed = checks.filter(function (c) { return !c.passed; });

    if (cr && cr.passed && !failed.length) {
      /* Hidden, not removed: the node keeps its aria-live region and the
         checks/count stay queryable for the automated checks. */
      host.className = 'selfcheck pass';
      host.setAttribute('data-checks', String(checks.length));
      host.hidden = true;
      return;
    }

    host.className = 'selfcheck fail';
    host.appendChild(el('span', 'sc-dot'));
    var wrap = el('div', 'sc-text');
    wrap.appendChild(el('div', 'sc-title',
      'Self-check failed: ' + failed.length + ' of ' + checks.length + ' checks did not hold.'));
    var ul = el('ul', 'sc-list');
    failed.forEach(function (c) {
      var li = el('li');
      li.appendChild(el('span', 'sc-name', c.name));
      if (c.detail) li.appendChild(el('span', 'sc-detail', ': ' + c.detail));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    host.appendChild(wrap);
  }

  /* -------------------------------------------------------------- method */

  function renderMethod(result) {
    var host = $('method-regression');
    clear(host);
    if (!result || !result.categories) return;
    var table = el('table', 'mini');
    var thead = el('thead');
    var htr = el('tr');
    ['Category', 'n', 'Intercept', 'Coef. grade', 'Coef. tenure', 'R²'].forEach(function (h) {
      var th = el('th', h === 'Category' ? '' : 'num', h);
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    var tb = el('tbody');
    result.categories.forEach(function (c) {
      var r = c.regression || {};
      var tr = el('tr');
      tr.appendChild(el('td', '', c.category));
      tr.appendChild(el('td', 'num', num(r.n)));
      tr.appendChild(el('td', 'num', money(r.intercept)));
      tr.appendChild(el('td', 'num', money(r.coef_grade)));
      tr.appendChild(el('td', 'num', money(r.coef_tenure)));
      /* isFinite(null) is true — null coerces to 0 — so the type check is the
         real guard. An underdetermined category (too few rows to fit grade and
         tenure) returns r_squared: null, and without this the whole render
         dies on a small uploaded file. */
      tr.appendChild(el('td', 'num',
        typeof r.r_squared === 'number' && isFinite(r.r_squared) ? r.r_squared.toFixed(2) : '—'));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    host.appendChild(table);
  }

  /* ------------------------------------------------------------- caption */

  function renderCaptions(result) {
    var s = result.settings_used;
    text($('cap-scenario'),
      state.scenario === 'minimum' ? 'Minimum compliance' : 'Full equalisation');
    text($('cap-scenario-2'),
      state.scenario === 'minimum' ? 'minimum compliance' : 'full equalisation');
    text($('cap-threshold'), s.threshold_pct + '%');
    text($('data-source'), state.dataLabel +
      (state.usingFixture ? ' (fixture preview — calculation engine not loaded)' : ''));
  }

  /* -------------------------------------------------------------- render */

  function render(result) {
    if (!result) return;
    state.result = result;
    renderHeadline(result);
    renderSummary(result);
    renderChart(result, state.scenario);
    renderTable(result, state.scenario);
    renderSelfCheck(result);
    renderMethod(result);
    renderCaptions(result);
  }

  /* ------------------------------------------------------------ recompute */

  function haveCalc() {
    return typeof CALC !== 'undefined' &&
      typeof CALC.analyse === 'function';
  }

  function recompute() {
    var settings = readSettings();
    if (haveCalc() && state.employees) {
      state.usingFixture = false;
      var result;
      try {
        result = CALC.analyse(state.employees, settings);
      } catch (e) {
        showNotice('error', 'Calculation failed: ' + (e && e.message));
        return;
      }
      render(result);
      return;
    }
    /* fixture path: settings still shown, headline numbers are the fixture's */
    state.usingFixture = true;
    var fx = cloneFixtureWithSettings(settings);
    render(fx);
  }

  function cloneFixtureWithSettings(settings) {
    var fx = JSON.parse(JSON.stringify(FIXTURE_RESULT));
    fx.settings_used = settings;
    /* the only settings-dependent number the fixture can honestly restate */
    var m = settings.implementation_month;
    ['minimum', 'full'].forEach(function (k) {
      fx.totals[k].cost_current_year = fx.totals[k].total_cost * (13 - m) / 12;
      fx.totals[k].cost_next_year = fx.totals[k].total_cost;
    });
    fx.totals.difference.cost_current_year =
      fx.totals.full.cost_current_year - fx.totals.minimum.cost_current_year;
    fx.totals.difference.cost_next_year =
      fx.totals.full.cost_next_year - fx.totals.minimum.cost_next_year;
    return fx;
  }

  /* ----------------------------------------------------------------- CSV */

  function showNotice(kind, msg) {
    var host = $('csv-messages');
    var box = el('div', 'notice ' + kind);
    box.appendChild(el('span', 'notice-text', msg));
    host.appendChild(box);
  }

  function clearNotices() { clear($('csv-messages')); }

  function handleFile(file) {
    clearNotices();
    if (!file) return;

    if (typeof CSV === 'undefined' || typeof CSV.parse !== 'function') {
      showNotice('error', 'CSV reader is not loaded in this preview build.');
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () {
      showNotice('error', 'The file could not be read.');
    };
    reader.onload = function (ev) {
      var parsed;
      try {
        parsed = CSV.parse(String(ev.target.result));
      } catch (e) {
        showNotice('error', 'The file could not be parsed: ' + (e && e.message));
        return;
      }
      (parsed.warnings || []).forEach(function (w) { showNotice('warn', w); });

      if (!parsed.ok) {
        (parsed.errors || ['The file could not be used.']).forEach(function (er) {
          showNotice('error', er);
        });
        return;
      }
      state.employees = parsed.employees;
      state.dataLabel = file.name + ' — ' + parsed.employees.length + ' rows';
      showNotice('ok', 'Loaded ' + parsed.employees.length + ' rows from ' + file.name +
        '. Nothing left your browser.');
      $('btn-demo').hidden = false;
      recompute();
    };
    reader.readAsText(file);
  }

  function backToDemo() {
    clearNotices();
    $('csv-input').value = '';
    $('btn-demo').hidden = true;
    if (haveCalc() && typeof CALC.generateDemoData === 'function') {
      state.employees = CALC.generateDemoData();
      state.dataLabel = 'demo data — ' + state.employees.length + ' synthetic employees';
    } else {
      state.employees = null;
      state.dataLabel = 'demo data';
    }
    recompute();
  }

  /* ------------------------------------------------------------- controls */

  function bindControls() {
    ['ctl-threshold', 'ctl-month', 'ctl-rate-below', 'ctl-rate-above', 'ctl-ceiling']
      .forEach(function (id) {
        var node = $(id);
        node.addEventListener('input', recompute);
        node.addEventListener('change', recompute);
      });

    $('ctl-reset').addEventListener('click', function () {
      $('ctl-threshold').value = '5';
      $('ctl-month').value = '7';
      $('ctl-rate-below').value = '31.5';
      $('ctl-rate-above').value = '1.15';
      $('ctl-ceiling').value = '61214';
      recompute();
    });

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="scenario"]'),
      function (r) {
        r.addEventListener('change', function () {
          if (!r.checked) return;
          state.scenario = r.value;
          if (state.result) {
            renderChart(state.result, state.scenario);
            renderTable(state.result, state.scenario);
            renderCaptions(state.result);
          }
        });
      }
    );

    $('csv-input').addEventListener('change', function (e) {
      handleFile(e.target.files && e.target.files[0]);
    });
    $('btn-demo').addEventListener('click', backToDemo);
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    bindControls();
    if (haveCalc() && typeof CALC.generateDemoData === 'function') {
      try {
        state.employees = CALC.generateDemoData();
        state.dataLabel = 'demo data — ' + state.employees.length + ' synthetic employees';
      } catch (e) {
        state.employees = null;
      }
    }
    recompute();
    /* The viewBox is derived from the container width, so a resize (or a phone
       turned sideways) has to redraw the chart — otherwise the box keeps the
       width it was built at and the labels scale wrongly again. Debounced:
       a drag fires resize continuously, and only the final width matters. */
    var resizeTimer = null;
    var lastChartW = 0;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var host = $('chart');
        if (!host || !state.result) return;
        var w = Math.round(host.getBoundingClientRect().width);
        /* Redraw only on a real width change: an on-screen keyboard opening
           fires resize with the width untouched. */
        if (w && Math.abs(w - lastChartW) > 1) {
          lastChartW = w;
          renderChart(state.result, state.scenario);
        }
      }, 150);
    });
  }

  return {
    init: init,
    render: render,
    readSettings: readSettings,
    recompute: recompute,
    _state: state
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', UI.init);
} else {
  UI.init();
}
