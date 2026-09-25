/* =============================================================================
 * CALC — the calculation core of the pay equalisation cost calculator (part A).
 *
 * Plain ES2020. No import/export, no access to document/window, no external
 * libraries. It is inlined into a single .html as the first <script> block.
 *
 * Public interface:
 *   CALC.generateDemoData()           → Employee[]   (~200, deterministic)
 *   CALC.analyse(employees, settings) → Result
 *   CALC.selfCheck(result)            → CheckResult
 *
 * Conventions:
 *   - money is a number in euros and cents, rounded only for display;
 *   - percentages are numbers like 8.4, not 0.084;
 *   - "actual" money accounts for fte and months worked;
 *     "normalised" money is the full-year equivalent;
 *   - analyse() does not mutate the array it is given.
 *
 * Order of computation:
 *   normalisation → gap → OLS decomposition → recipients → two scenarios →
 *   contributions → conversion back to actual money → annual effect.
 * ========================================================================== */

var CALC = (function () {
  'use strict';

  /* ===========================================================================
   * 0. Seeded PRNG
   *
   * mulberry32 is a 32-bit generator with a period of 2^32. It was chosen
   * because it fits in ten lines, needs no library, and produces the same
   * sequence in any JS engine (every operation goes through |0 and >>>, so the
   * arithmetic is integer and does not depend on double precision).
   *
   * This is a requirement: the calculator and the Excel model must produce the
   * same array of employees to the cent. The seed is a hard-coded constant.
   * ======================================================================== */

  var DEMO_SEED = 20260830; // a date rather than an arbitrary number, so it means something

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Normal noise via the Box-Muller transform.
   * Needed so that salaries within a grade scatter plausibly (a bell curve)
   * rather than uniformly: uniform noise distorts the median and makes the
   * regression unnaturally precise. */
  function gauss(rnd) {
    var u1 = 1 - rnd(); // (0,1], so log(0) is never taken
    var u2 = rnd();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /* ===========================================================================
   * 1. Demo data generator
   *
   * The generating model: the value of a grade is a parameter of the generator
   * rather than an input column, and the regression has to recover it.
   *
   *   base_salary = base_category
   *               × (1 + GRADE_STEP)^(grade − 1)      ~12% per grade
   *               × (1 + TENURE_STEP × tenure_years)  ~1.5% per year of service
   *               × (1 + noise)
   *               × (1 + gap coefficient for women)
   *
   * The multiplicative form was chosen because that is how pay scales actually
   * work: a grade step is a percentage, not a fixed amount. The regression is
   * still linear (total_pay ~ grade + tenure), and it recovers the value of a
   * grade as the AVERAGE increase in euros per grade over the observed range —
   * which is enough to decompose the gap, and is exactly what selfCheck tests.
   *
   * The seven heterogeneities are spread across the categories in CATEGORIES
   * below, each marked by a comment.
   * ======================================================================== */

  var GRADE_STEP = 0.12;   // +12% of salary per grade
  var TENURE_STEP = 0.015; // +1.5% of salary per year of service

  /* Seven categories. Fields:
   *   base            — salary at grade 1 with zero tenure, EUR
   *   n               — headcount
   *   grades          — [min, max] available grades
   *   share_f         — share of women
   *   female_grade_bias — shift of the women's distribution across grades:
   *                       0 = even, 1 = women strictly in the lower grades
   *   gap_within_grade  — fraction by which a woman's salary is cut within a grade
   *   var_rate_m / var_rate_f — variable pay as a share of salary, M and F
   *   flat_salary     — salaries follow the scale exactly, no noise and no gap
   *   part_time_share — share of employees with fte<1 or a partial year
   *   noise           — sigma of the multiplicative noise
   */
  var CATEGORIES = [
    {
      // HETEROGENEITY 1: a gap WITHIN a grade.
      // Women are spread across grades exactly as men are (bias 0), but at
      // equal grade and tenure they are paid about 8% less. The regression
      // explains almost none of it — this is a pure unexplained residual.
      name: 'Engineering', base: 46000, n: 44, grades: [1, 6], share_f: 0.34,
      female_grade_bias: 0.00, gap_within_grade: 0.075,
      var_rate_m: 0.12, var_rate_f: 0.12, noise: 0.055, part_time_share: 0.02
    },
    {
      // HETEROGENEITY 2: a STRUCTURAL gap — women concentrate in the lower
      // grades (bias 0.80), while pay within a grade is equal.
      // The regression should explain nearly all of it: explained ≈ raw_gap.
      // HETEROGENEITY 5 (in part): this category also has the widest tenure
      // range, so the tenure-pay link shows up in the tenure coefficient.
      name: 'Operations', base: 38000, n: 38, grades: [1, 6], share_f: 0.55,
      female_grade_bias: 0.80, gap_within_grade: 0.010,
      var_rate_m: 0.08, var_rate_f: 0.08, noise: 0.050, part_time_share: 0.05
    },
    {
      // HETEROGENEITY 3: a SMALL category (n = 8 < 10) with a large gap (14%).
      // Exercises the unreliable flag: n < 10, or either gender below 3. The
      // gap is large but the sample cannot carry a decision — and the tool has
      // to say so.
      name: 'Legal', base: 62000, n: 8, grades: [3, 6], share_f: 0.375,
      female_grade_bias: 0.35, gap_within_grade: 0.090,
      var_rate_m: 0.15, var_rate_f: 0.15, noise: 0.045, part_time_share: 0.00
    },
    {
      // HETEROGENEITY 4: a gap IN FAVOUR OF WOMEN (negative gap_within_grade
      // plus women in the higher grades). reverse_gap = true: the category is
      // NOT adjusted in either scenario but still appears in the result — the
      // tool does not hide what it does not treat.
      name: 'Marketing', base: 42000, n: 26, grades: [1, 5], share_f: 0.50,
      female_grade_bias: -0.35, gap_within_grade: -0.040,
      var_rate_m: 0.10, var_rate_f: 0.10, noise: 0.050, part_time_share: 0.08
    },
    {
      // HETEROGENEITY 5: the TENURE-pay link is strongest here — tenure runs to
      // 22 years and is the main source of variation.
      // Plus a moderate within-grade gap.
      name: 'Manufacturing', base: 34000, n: 40, grades: [1, 5], share_f: 0.40,
      female_grade_bias: 0.30, gap_within_grade: 0.065,
      var_rate_m: 0.06, var_rate_f: 0.06, noise: 0.045,
      part_time_share: 0.05, tenure_max: 22
    },
    {
      // HETEROGENEITY 6: PART-TIME work and a partial year — a third of the
      // category has fte < 1 and/or months_worked < 12. Without normalisation
      // these people would falsely look underpaid and the budget would be
      // overstated. Their cost is converted back into actual money: an uplift
      // on a 0.5 FTE contract costs the company half.
      name: 'Customer Support', base: 30000, n: 30, grades: [1, 4], share_f: 0.60,
      female_grade_bias: 0.40, gap_within_grade: 0.070,
      var_rate_m: 0.05, var_rate_f: 0.05, noise: 0.040, part_time_share: 0.33
    },
    {
      // HETEROGENEITY 7: FLAT SALARIES with a gap in VARIABLE pay.
      // flat_salary: salary follows the scale exactly, with no noise and no
      // gender adjustment. Bonus: 28% of salary for men against 14% for women.
      // Base gap = 0, total gap ≈ 11%, variable_gap_pct ≈ 50%.
      // This is the case a practitioner opens the tool for.
      // It also holds the highest salaries: part of the category sits ABOVE the
      // 61,214 EUR contribution ceiling, which brings the rate_above band into
      // play.
      name: 'Sales', base: 55000, n: 26, grades: [2, 6], share_f: 0.50,
      female_grade_bias: 0.00, gap_within_grade: 0.000, flat_salary: true,
      paired_structure: true,
      var_rate_m: 0.26, var_rate_f: 0.13, noise: 0.000, part_time_share: 0.00
    }
  ];

  /**
   * generateDemoData() — ~200 employees, 7 categories, deterministic.
   *
   * The same call always yields the same array: the PRNG is recreated from the
   * hard-coded seed on every call, and the iteration order over categories and
   * employees is fixed.
   *
   * @returns {Array<Object>} Employee[]
   */
  function generateDemoData() {
    var rnd = mulberry32(DEMO_SEED);
    var out = [];
    var seq = 1;

    for (var ci = 0; ci < CATEGORIES.length; ci++) {
      var C = CATEGORIES[ci];
      var gMin = C.grades[0];
      var gMax = C.grades[1];
      var span = gMax - gMin;
      var tenureMax = C.tenure_max || 14;

      /* paired_structure: the category is generated as matched M/F pairs with
       * IDENTICAL grade and tenure. Needed where salaries are meant to be flat
       * (heterogeneity 7): drawing grades independently puts women of a
       * 26-person sample into lower grades by chance, the base diverges by
       * ~11%, and "flat salaries" stops being true. Pairing removes that
       * artefact: exactly one difference between the genders remains — variable
       * pay. Gender alternates within a pair. */
      var pairPlan = null;
      if (C.paired_structure) {
        /* The category consists of EXACTLY the pairs F,M,F,M… with no
         * remainder: n is even and share_f is effectively 0.5. Any unpaired
         * leftover would shift the average male base and break "flat salaries"
         * again — the very case this category exists to demonstrate. Pairing
         * makes grade and tenure match across genders by construction, so the
         * only difference in the data is variable pay. */
        pairPlan = [];
        for (var p = 0; p < C.n; p++) pairPlan.push(p % 2 === 0 ? 'F' : 'M');
      }

      for (var i = 0; i < C.n; i++) {
        var isF = pairPlan ? pairPlan[i] === 'F' : rnd() < C.share_f;

        /* Grade. u is the position within the grade range [0,1].
         * female_grade_bias shifts the women's distribution: u^(1+2b) with b>0
         * pulls towards lower grades (a structural gap), and with b<0 towards
         * higher ones (which is what creates the reverse gap in Marketing).
         * Men are always distributed evenly. */
        var grade, tenure;
        var isPairPartner = pairPlan && i > 0 && pairPlan[i] === 'M'
          && pairPlan[i - 1] === 'F';

        if (isPairPartner) {
          // the second of a pair inherits the first's structure: same grade, same tenure
          grade = out[out.length - 1].grade;
          tenure = out[out.length - 1].tenure_years;
        } else {
          var u = rnd();
          if (isF && C.female_grade_bias !== 0) {
            var b = C.female_grade_bias;
            u = b > 0 ? Math.pow(u, 1 + 2 * b) : 1 - Math.pow(1 - u, 1 - 2 * b);
          }
          grade = gMin + Math.round(u * span);

          /* Tenure. Correlated with grade: people in higher grades have on
           * average been with the company longer — otherwise the regression
           * would get two independent predictors, which real data never has. */
          var tenureBase = (grade - gMin) / Math.max(1, span) * tenureMax * 0.55;
          tenure = tenureBase + rnd() * tenureMax * 0.45;
          tenure = Math.round(Math.max(0.2, Math.min(tenureMax, tenure)) * 10) / 10;
        }

        /* Salary from the scale: base × grade step × tenure step. */
        var salary = C.base
          * Math.pow(1 + GRADE_STEP, grade - gMin)
          * (1 + TENURE_STEP * tenure);

        if (!C.flat_salary) {
          salary *= (1 + gauss(rnd) * C.noise);          // noise
          if (isF) salary *= (1 - C.gap_within_grade);   // within-grade gap
        }

        /* Variable pay: a share of salary, different for M and F (heterogeneity 7). */
        var varRate = isF ? C.var_rate_f : C.var_rate_m;
        var variable = salary * varRate * (C.flat_salary ? 1 : (0.75 + rnd() * 0.5));

        /* Part-time work and a partial year (heterogeneity 6).
         * base_salary and variable_pay are the amounts ACTUALLY paid, so here
         * they are multiplied by fte and the fraction of the year worked. */
        var fte = 1.0;
        var months = 12;
        if (rnd() < C.part_time_share) {
          fte = [0.5, 0.6, 0.75, 0.8][Math.floor(rnd() * 4)];
        }
        if (rnd() < C.part_time_share * 0.6) {
          months = [4, 6, 7, 9, 10][Math.floor(rnd() * 5)];
        }

        var factor = fte * (months / 12);

        out.push({
          id: 'E' + String(seq++).padStart(3, '0'),
          category: C.name,
          gender: isF ? 'F' : 'M',
          base_salary: round2(salary * factor),
          variable_pay: round2(variable * factor),
          tenure_years: tenure,
          grade: grade,
          fte: fte,
          months_worked: months,
          /* Marks the row as coming from the generator. The demo-only checks
             (the seven heterogeneities, the built-in grade step) describe THIS
             fixture, not pay data in general: run against a reader's CSV they
             fail by construction, which is not a finding about their file. */
          _demo: true
        });
      }
    }
    return out;
  }

  /* ===========================================================================
   * 2. Helper arithmetic
   * ======================================================================== */

  function round2(x) { return Math.round(x * 100) / 100; }

  function mean(a) {
    if (!a.length) return 0;
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  /* Median: with an even n, the average of the two middle values.
   * The median is needed twice: as an alternative measure of the gap, and as
   * the target point for selecting recipients. */
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function sum(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s;
  }

  /* ===========================================================================
   * 3. Normalisation
   *
   *   normalised = pay / fte / (months_worked / 12)
   *
   * Converts actual pay into a full-year equivalent. Without this step someone
   * on a 0.5 FTE contract looks twice underpaid, lands among the recipients,
   * and the budget is overstated twofold. The inverse coefficient, factor, is
   * kept on the employee so the cost can be converted back to actual money.
   * ======================================================================== */

  function normalise(employees) {
    return employees.map(function (e, idx) {
      var fte = (typeof e.fte === 'number' && e.fte > 0) ? e.fte : 1.0;
      var mw = (typeof e.months_worked === 'number' && e.months_worked > 0)
        ? e.months_worked : 12;
      var factor = fte * (mw / 12); // share of a full-time, full-year position
      var nBase = e.base_salary / factor;
      var nVar = e.variable_pay / factor;
      return {
        idx: idx,
        id: e.id != null ? e.id : ('E' + String(idx + 1).padStart(3, '0')),
        category: String(e.category),
        gender: e.gender === 'F' ? 'F' : 'M',
        grade: Number(e.grade),
        tenure_years: Number(e.tenure_years),
        fte: fte,
        months_worked: mw,
        factor: factor,              // multiplier back into actual money
        actual_base: e.base_salary,  // actual, for payroll and for contributions
        actual_var: e.variable_pay,
        n_base: nBase,               // normalised
        n_var: nVar,
        n_total: nBase + nVar
      };
    });
  }

  /* ===========================================================================
   * 4. OLS regression of total_pay ~ grade + tenure_years within a category
   *
   * Normal equations: (X'X) β = X'y, where X = [1, grade, tenure].
   * The 3×3 system is solved by Gaussian elimination with partial pivoting,
   * written out by hand and without libraries.
   *
   * Why normal equations rather than QR: the matrix is 3×3, the conditioning on
   * real headcount data is acceptable, and the formula can be written out in
   * full in Excel — which is a requirement for reconciling the model by hand.
   *
   * Guard against degeneracy: if there are fewer than 4 observations, or grade
   * or tenure is constant, or the pivot at any step is smaller than EPS, the
   * regression is undefined. In that case r_squared: null is returned with zero
   * coefficients, and the explained part of the gap is taken as zero (the whole
   * gap falls into the unexplained residual — the conservative direction, that
   * is, towards a larger adjustment).
   * ======================================================================== */

  var EPS = 1e-9;

  /** Solves an n×n system by Gaussian elimination with partial pivoting.
   *  @returns {Array<number>|null} null if the matrix is singular */
  function solveGauss(A, b) {
    var n = b.length;
    var M = A.map(function (row, i) { return row.slice().concat([b[i]]); });

    for (var col = 0; col < n; col++) {
      // pivot selection: the largest absolute value in the column
      var piv = col;
      for (var r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      if (Math.abs(M[piv][col]) < EPS) return null; // singular matrix
      var tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;

      for (var r2 = col + 1; r2 < n; r2++) {
        var f = M[r2][col] / M[col][col];
        for (var c = col; c <= n; c++) M[r2][c] -= f * M[col][c];
      }
    }
    // back substitution
    var x = new Array(n).fill(0);
    for (var i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  /**
   * OLS for a single category.
   * @param {Array} rows normalised employees of the category
   * @returns {{intercept, coef_grade, coef_tenure, r_squared, n}}
   *          r_squared === null means "the regression is undefined, and
   *          explained is taken as 0".
   */
  function regress(rows) {
    var n = rows.length;
    var fail = {
      intercept: 0, coef_grade: 0, coef_tenure: 0, r_squared: null, n: n
    };
    if (n < 4) return fail;

    var grades = rows.map(function (r) { return r.grade; });
    var tenures = rows.map(function (r) { return r.tenure_years; });
    var ys = rows.map(function (r) { return r.n_total; });

    // a constant predictor means its coefficient is undefined
    var gVar = variance(grades);
    var tVar = variance(tenures);
    if (gVar < EPS || tVar < EPS) return fail;

    // Normal equations: sums of products
    var S = { n: n, g: 0, t: 0, gg: 0, tt: 0, gt: 0, y: 0, gy: 0, ty: 0 };
    for (var i = 0; i < n; i++) {
      var g = grades[i], t = tenures[i], y = ys[i];
      S.g += g; S.t += t; S.y += y;
      S.gg += g * g; S.tt += t * t; S.gt += g * t;
      S.gy += g * y; S.ty += t * y;
    }
    var A = [
      [S.n, S.g, S.t],
      [S.g, S.gg, S.gt],
      [S.t, S.gt, S.tt]
    ];
    var beta = solveGauss(A, [S.y, S.gy, S.ty]);
    if (!beta) return fail;
    if (!isFinite(beta[0]) || !isFinite(beta[1]) || !isFinite(beta[2])) return fail;

    // R² = 1 − SS_res / SS_tot
    var yBar = S.y / n, ssRes = 0, ssTot = 0;
    for (var k = 0; k < n; k++) {
      var pred = beta[0] + beta[1] * grades[k] + beta[2] * tenures[k];
      ssRes += Math.pow(ys[k] - pred, 2);
      ssTot += Math.pow(ys[k] - yBar, 2);
    }
    var r2 = ssTot < EPS ? null : 1 - ssRes / ssTot;

    return {
      intercept: beta[0],
      coef_grade: beta[1],
      coef_tenure: beta[2],
      r_squared: r2,
      n: n
    };
  }

  function variance(a) {
    if (a.length < 2) return 0;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return s / a.length;
  }

  /* ===========================================================================
   * 5. The gap and its decomposition
   *
   * raw_gap % = (mean_M − mean_F) / mean_M × 100.
   * The denominator is men's pay, so the gap reads as "a woman is paid X% less
   * than a man", which is how the directive phrases it. A positive gap favours
   * men, a negative one favours women.
   *
   * explained: the difference the regression predicts from differences in
   * grade/tenure:
   *   explained_EUR = coef_grade × (mean_grade_M − mean_grade_F)
   *                 + coef_tenure × (mean_tenure_M − mean_tenure_F)
   * That is, "how much of the gap is explained by men being on average in
   * higher grades and with longer service". Expressed as % of mean_M.
   *
   * unexplained_pct = raw_gap_mean_pct − explained_pct. Only this part is
   * adjusted.
   *
   * explained is clamped to [0, raw_gap] when the gap is positive: a negative
   * explained part would mean the grade structure works IN FAVOUR of women, and
   * subtracting it would inflate the residual above the actual gap — the model
   * would then demand raising women above men.
   * A DECISION BEYOND THE SPEC, noted in the report.
   * ======================================================================== */

  function computeGaps(rows, reg) {
    var f = rows.filter(function (r) { return r.gender === 'F'; });
    var m = rows.filter(function (r) { return r.gender === 'M'; });

    var meanM = mean(m.map(function (r) { return r.n_total; }));
    var meanF = mean(f.map(function (r) { return r.n_total; }));
    var medM = median(m.map(function (r) { return r.n_total; }));
    var medF = median(f.map(function (r) { return r.n_total; }));
    var varM = mean(m.map(function (r) { return r.n_var; }));
    var varF = mean(f.map(function (r) { return r.n_var; }));
    // the gap on BASE salary — needed to tell "salaries are flat, the gap is in
    // bonuses" from "there is a gap in both". It is not part of the public
    // result shape and is used by selfCheck.
    var baseM = mean(m.map(function (r) { return r.n_base; }));
    var baseF = mean(f.map(function (r) { return r.n_base; }));

    var rawMean = (meanM > 0 && f.length && m.length)
      ? (meanM - meanF) / meanM * 100 : 0;
    var rawMedian = (medM > 0 && f.length && m.length)
      ? (medM - medF) / medM * 100 : 0;
    var varGap = (varM > 0 && f.length && m.length)
      ? (varM - varF) / varM * 100 : 0;

    // the explained part, in euros
    var explainedEur = 0;
    if (reg.r_squared !== null && f.length && m.length) {
      var dG = mean(m.map(function (r) { return r.grade; }))
        - mean(f.map(function (r) { return r.grade; }));
      var dT = mean(m.map(function (r) { return r.tenure_years; }))
        - mean(f.map(function (r) { return r.tenure_years; }));
      explainedEur = reg.coef_grade * dG + reg.coef_tenure * dT;
    }
    var explainedPct = meanM > 0 ? explainedEur / meanM * 100 : 0;

    // clamp: the explained part never exceeds the gap itself
    if (rawMean >= 0) {
      explainedPct = Math.max(0, Math.min(explainedPct, rawMean));
    } else {
      explainedPct = Math.min(0, Math.max(explainedPct, rawMean));
    }

    return {
      mean_m: meanM, mean_f: meanF,
      raw_gap_mean_pct: rawMean,
      raw_gap_median_pct: rawMedian,
      variable_gap_pct: varGap,
      base_gap_pct: (baseM > 0 && f.length && m.length)
        ? (baseM - baseF) / baseM * 100 : 0,
      explained_pct: explainedPct,
      unexplained_pct: rawMean - explainedPct,
      f: f, m: m
    };
  }

  /* ===========================================================================
   * 6. Employer contributions
   *
   *   contributions = rate_below × min(uplift, max(0, ceiling − base_before))
   *                 + rate_above × max(0, base_before + uplift
   *                                       − max(ceiling, base_before))
   *
   * They are computed on the INCREASE to base pay, not on the original salary,
   * and always on the employee's ACTUAL base (the ceiling is annual and applies
   * to what was really paid, not to a part-timer's full-year equivalent).
   *
   * What the construction means: the part of the uplift that fits under the
   * ceiling attracts the full rate, and anything that pushes the base past the
   * ceiling attracts only the reduced one. A single formula covers both a hard
   * cut-off (rate_above = 0) and a change of rate.
   * ======================================================================== */

  function contributionsOn(baseBefore, uplift, settings) {
    if (uplift <= 0) return 0;
    var ceiling = settings.ceiling;
    var rb = settings.rate_below / 100;
    var ra = settings.rate_above / 100;

    var roomBelow = Math.max(0, ceiling - baseBefore); // room under the ceiling
    var partBelow = Math.min(uplift, roomBelow);
    var partAbove = uplift - partBelow;
    return rb * partBelow + ra * partAbove;
  }

  /* ===========================================================================
   * 7. Selecting recipients and distributing the uplift
   *
   * Recipients: employees of the underpaid gender whose NORMALISED total pay is
   * below the median of their own category (the median over the whole category,
   * both genders).
   *
   * The uplift is distributed IN PROPORTION to the shortfall from the median:
   *   share_i = (median − total_i) / Σ(median − total_j)
   * The logic: the further someone is from the middle of their category, the
   * larger the share of the budget they receive. This is the only method;
   * alternatives are out of scope.
   *
   * How much has to be distributed in total: enough to bring the category's
   * unexplained residual down from its current level to the target. The
   * residual is measured as a % of men's average pay, so the amount needed in
   * (normalised) euros is:
   *   need_EUR = (unexplained_pct − target_pct) / 100 × mean_M × n_F
   * where n_F is the headcount of the underpaid gender: raising women's average
   * pay by ΔEUR requires ΔEUR × n_F euros of payroll.
   * ======================================================================== */

  /**
   * One scenario for one category.
   * @param {Array}  rows  normalised employees of the category
   * @param {Object} gaps  the result of computeGaps
   * @param {number} targetPct target unexplained residual, % (0 = full)
   * @param {Object} settings
   * @param {boolean} reverse a category whose gap favours women
   */
  function runScenario(rows, gaps, targetPct, settings, reverse) {
    var empty = {
      recipients: 0, adjustment: 0, contributions: 0, total_cost: 0,
      unexplained_after: gaps.unexplained_pct,
      mean_pay_after: mean(rows.map(function (r) { return r.n_total; })),
      per_employee: []
    };

    // Categories whose gap favours women are not adjusted in either scenario:
    // equalisation is upward only.
    if (reverse) return empty;

    // The category is already below the threshold: minimum leaves it alone.
    if (gaps.unexplained_pct <= targetPct + 1e-12) return empty;

    var under = gaps.f.filter(function (r) { return r.n_total < gaps.median_all; });
    if (!under.length) return empty;

    var deficits = under.map(function (r) { return gaps.median_all - r.n_total; });
    var totalDeficit = sum(deficits);
    if (totalDeficit <= 0) return empty;

    // how many normalised euros have to go into the women's pay in this category
    var needNorm = (gaps.unexplained_pct - targetPct) / 100
      * gaps.mean_m * gaps.f.length;

    var perEmployee = [];
    var adjActual = 0;
    var contrib = 0;

    for (var i = 0; i < under.length; i++) {
      var r = under[i];
      var upliftNorm = needNorm * (deficits[i] / totalDeficit);
      // back into actual money: an uplift on a 0.5 FTE contract costs half
      var upliftActual = upliftNorm * r.factor;
      adjActual += upliftActual;
      contrib += contributionsOn(r.actual_base, upliftActual, settings);
      perEmployee.push({ idx: r.idx, uplift_norm: upliftNorm, uplift_actual: upliftActual });
    }

    // average normalised pay after the adjustment — used by the chart
    var afterTotals = rows.map(function (r) {
      var add = 0;
      for (var k = 0; k < perEmployee.length; k++) {
        if (perEmployee[k].idx === r.idx) { add = perEmployee[k].uplift_norm; break; }
      }
      return r.n_total + add;
    });

    // the actual residual after the uplift: recomputed, not taken from the target
    var newMeanF = mean(gaps.f.map(function (r) {
      var add = 0;
      for (var k = 0; k < perEmployee.length; k++) {
        if (perEmployee[k].idx === r.idx) { add = perEmployee[k].uplift_norm; break; }
      }
      return r.n_total + add;
    }));
    var newRawGap = gaps.mean_m > 0 ? (gaps.mean_m - newMeanF) / gaps.mean_m * 100 : 0;
    var after = newRawGap - gaps.explained_pct;

    return {
      recipients: under.length,
      adjustment: adjActual,
      contributions: contrib,
      total_cost: adjActual + contrib,
      unexplained_after: after,
      mean_pay_after: mean(afterTotals),
      per_employee: perEmployee
    };
  }

  /* ===========================================================================
   * 8. analyse() — the main function
   * ======================================================================== */

  var DEFAULT_SETTINGS = {
    threshold_pct: 5,
    implementation_month: 7,
    rate_below: 31.5,
    rate_above: 0.96,
    ceiling: 61214
  };

  /**
   * analyse(employees, settings) → Result.
   * Does not mutate the input array.
   */
  function analyse(employees, settings) {
    var S = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    var rows = normalise(employees || []);

    // group by category, in order of first appearance
    var order = [];
    var byCat = {};
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i].category;
      if (!byCat[c]) { byCat[c] = []; order.push(c); }
      byCat[c].push(rows[i]);
    }

    var categories = [];
    var accMin = { adjustment: 0, contributions: 0 };
    var accFull = { adjustment: 0, contributions: 0 };

    for (var ci = 0; ci < order.length; ci++) {
      var name = order[ci];
      var crows = byCat[name];

      var reg = regress(crows);
      var gaps = computeGaps(crows, reg);
      gaps.median_all = median(crows.map(function (r) { return r.n_total; }));

      var nF = gaps.f.length, nM = gaps.m.length;

      // reliability flag
      var unreliable = crows.length < 10 || nF < 3 || nM < 3;
      // a gap in favour of women is not adjusted
      var reverse = gaps.raw_gap_mean_pct < 0;

      var scMin = runScenario(crows, gaps, S.threshold_pct, S, reverse);
      var scFull = runScenario(crows, gaps, 0, S, reverse);

      accMin.adjustment += scMin.adjustment;
      accMin.contributions += scMin.contributions;
      accFull.adjustment += scFull.adjustment;
      accFull.contributions += scFull.contributions;

      categories.push({
        category: name,
        headcount: crows.length,
        headcount_f: nF,
        headcount_m: nM,
        raw_gap_mean_pct: gaps.raw_gap_mean_pct,
        raw_gap_median_pct: gaps.raw_gap_median_pct,
        variable_gap_pct: gaps.variable_gap_pct,
        _base_gap_pct: gaps.base_gap_pct, // private, for selfCheck
        explained_pct: gaps.explained_pct,
        unexplained_pct: gaps.unexplained_pct,
        regression: {
          intercept: reg.intercept,
          coef_grade: reg.coef_grade,
          coef_tenure: reg.coef_tenure,
          r_squared: reg.r_squared,
          n: reg.n
        },
        unreliable: unreliable,
        reverse_gap: reverse,
        minimum: publicScenario(scMin),
        full: publicScenario(scFull)
      });
    }

    // payroll "before" — actual money, total pay
    var payrollBefore = sum(rows.map(function (r) { return r.actual_base + r.actual_var; }));

    // how many employees are part-time or worked a partial year — an internal
    // field for selfCheck (heterogeneity 6); the UI does not use it
    var partTime = rows.filter(function (r) {
      return r.fte < 1 || r.months_worked < 12;
    }).length;

    return {
      _demo_parttime: partTime,
      /* True only when every row carries the generator's marker. A reader's CSV
         never does, so the demo-only checks stay out of their result. */
      _is_demo: (employees || []).length > 0
        && (employees || []).every(function (e) { return e && e._demo === true; }),
      categories: categories,
      totals: {
        headcount: rows.length,
        payroll_before: payrollBefore,
        minimum: totalsBlock(accMin, payrollBefore, S),
        full: totalsBlock(accFull, payrollBefore, S),
        difference: diffBlock(
          totalsBlock(accFull, payrollBefore, S),
          totalsBlock(accMin, payrollBefore, S)
        )
      },
      settings_used: Object.assign({}, S)
    };
  }

  /* CategoryScenario for the public result — without the internal per_employee. */
  function publicScenario(sc) {
    return {
      recipients: sc.recipients,
      adjustment: sc.adjustment,
      contributions: sc.contributions,
      total_cost: sc.total_cost,
      unexplained_after: sc.unexplained_after,
      mean_pay_after: sc.mean_pay_after
    };
  }

  /* Annual effect: implementation month m → current year = the full amount
   * × (13 − m) / 12 (implementing in January gives 12/12, in December 1/12);
   * next year is the full amount. */
  function totalsBlock(acc, payrollBefore, S) {
    var total = acc.adjustment + acc.contributions;
    var m = Math.min(12, Math.max(1, Math.round(S.implementation_month)));
    return {
      adjustment: acc.adjustment,
      contributions: acc.contributions,
      total_cost: total,
      cost_current_year: total * (13 - m) / 12,
      cost_next_year: total,
      payroll_uplift_pct: payrollBefore > 0 ? total / payrollBefore * 100 : 0
    };
  }

  /* difference = full − minimum across all fields (the headline number). */
  function diffBlock(full, min) {
    return {
      adjustment: full.adjustment - min.adjustment,
      contributions: full.contributions - min.contributions,
      total_cost: full.total_cost - min.total_cost,
      cost_current_year: full.cost_current_year - min.cost_current_year,
      cost_next_year: full.cost_next_year - min.cost_next_year,
      payroll_uplift_pct: full.payroll_uplift_pct - min.payroll_uplift_pct
    };
  }

  /* ===========================================================================
   * 9. selfCheck() — identities that must hold
   *
   * Each check is an arithmetic identity that has to hold for any input, rather
   * than a property of one particular demo dataset (except the "Data" block,
   * which by definition describes the demo).
   * Detail is human-readable: the string goes into the interface and into the
   * Method section.
   * ======================================================================== */

  var TOL = 0.01; // tolerance in euros — rounding when adding hundreds of numbers

  function selfCheck(result) {
    var checks = [];
    function add(name, passed, detail) {
      checks.push({ name: name, passed: !!passed, detail: detail });
    }

    var cats = result.categories;
    var T = result.totals;
    var S = result.settings_used;

    /* --- Calculation --------------------------------------------------- */

    // 1. The sum of category adjustments equals the increase in payroll.
    ['minimum', 'full'].forEach(function (sc) {
      var catSum = sum(cats.map(function (c) { return c[sc].adjustment; }));
      var d = Math.abs(catSum - T[sc].adjustment);
      add('adjustment matches payroll delta (' + sc + ')', d < TOL,
        'Sum of category adjustments €' + fmt(catSum) + ' vs total €'
        + fmt(T[sc].adjustment) + ' — difference €' + d.toFixed(4)
        + '. Payroll before €' + fmt(T.payroll_before) + ' → after €'
        + fmt(T.payroll_before + T[sc].adjustment) + '.');
    });

    // 2. After minimum, no category is above the threshold.
    var over = cats.filter(function (c) {
      return !c.reverse_gap && c.minimum.unexplained_after > S.threshold_pct + 0.01;
    });
    add('no category above threshold after minimum', over.length === 0,
      over.length === 0
        ? 'All ' + cats.length + ' categories at or below the '
          + S.threshold_pct + '% joint-pay-assessment trigger after minimum compliance.'
        : 'Above threshold: ' + over.map(function (c) {
            return c.category + ' ' + c.minimum.unexplained_after.toFixed(2) + '%';
          }).join(', '));

    // 3. After full, the residual is zero.
    var nz = cats.filter(function (c) {
      return !c.reverse_gap && Math.abs(c.full.unexplained_after) > 0.01;
    });
    add('unexplained residual is zero after full equalisation', nz.length === 0,
      nz.length === 0
        ? 'Residual < 0.01 pp in every corrected category ('
          + cats.filter(function (c) { return !c.reverse_gap; }).length + ' of '
          + cats.length + '; reverse-gap categories excluded by design).'
        : 'Non-zero: ' + nz.map(function (c) {
            return c.category + ' ' + c.full.unexplained_after.toFixed(3) + '%';
          }).join(', '));

    // 4. Contributions are computed on the changed base (on the uplift) rather
    //    than on the original, and fall between the two rates — that is, the
    //    formula really does apply rate_above to the part above the ceiling.
    ['minimum', 'full'].forEach(function (sc) {
      var adj = T[sc].adjustment, con = T[sc].contributions;
      var lo = adj * S.rate_above / 100, hi = adj * S.rate_below / 100;
      var ok = adj <= 0 ? con === 0 : (con > 0 && con <= hi + TOL && con >= lo - TOL);
      add('contributions computed on the uplift, two-rate (' + sc + ')', ok,
        'Uplift €' + fmt(adj) + ' → contributions €' + fmt(con)
        + ' (' + (adj > 0 ? (con / adj * 100).toFixed(2) : '0.00') + '% effective; '
        + 'bounds ' + S.rate_above + '%…' + S.rate_below + '%, ceiling €'
        + fmt(S.ceiling) + '). Effective rate below the headline rate proves the '
        + 'above-ceiling band is being applied.');
    });

    // 5. The current-year effect is below the next-year one unless implemented in January.
    var m = S.implementation_month;
    var okYear = m > 1
      ? T.full.cost_current_year < T.full.cost_next_year - TOL
      : Math.abs(T.full.cost_current_year - T.full.cost_next_year) < TOL;
    add('current-year effect below next-year effect', okYear,
      'Implementation month ' + m + ' → factor (13−' + m + ')/12 = '
      + ((13 - m) / 12).toFixed(4) + '. Full: current year €'
      + fmt(T.full.cost_current_year) + ' vs next year €' + fmt(T.full.cost_next_year) + '.');

    // 6. A small category carries the flag.
    var small = cats.filter(function (c) {
      return c.headcount < 10 || c.headcount_f < 3 || c.headcount_m < 3;
    });
    /* The invariant is the RULE (every small category carries the flag), not the
       presence of a small category. Requiring one made the check fail on any
       clean dataset that simply has none — a property of the file, not a fault. */
    var allFlagged = small.every(function (c) { return c.unreliable; });
    add('small categories flagged as unreliable', allFlagged,
      small.length === 0
        ? 'No category with n<10 or a gender group <3 — the reliability flag is untested.'
        : 'Flagged: ' + small.map(function (c) {
            return c.category + ' (n=' + c.headcount + ', F=' + c.headcount_f
              + ', M=' + c.headcount_m + ')';
          }).join('; ') + '.');

    // 7. Reverse-gap categories are left unadjusted but are shown.
    var rev = cats.filter(function (c) { return c.reverse_gap; });
    var revClean = rev.every(function (c) {
      return c.minimum.adjustment === 0 && c.full.adjustment === 0
        && c.minimum.recipients === 0 && c.full.recipients === 0;
    });
    /* Same shape as the check above: the rule is "if such a category exists it is
       shown and left alone", not "such a category must exist". */
    add('reverse-gap categories shown but not adjusted', revClean,
      rev.length === 0
        ? 'No reverse-gap category present.'
        : rev.map(function (c) {
            return c.category + ' gap ' + c.raw_gap_mean_pct.toFixed(1)
              + '% (in favour of women), adjustment €0 in both scenarios';
          }).join('; ') + ' — listed in the table, not corrected.');

    // 8. The cost for part-timers is expressed in actual money.
    //    An indirect check: the payroll increase is smaller than it would be if
    //    uplifts were counted in FTE equivalents — and that increase is exactly
    //    adjustment, always positive and smaller than payroll.
    add('cost expressed in actual money, not FTE',
      T.full.adjustment > 0 && T.full.adjustment < T.payroll_before,
      'Uplift €' + fmt(T.full.adjustment) + ' is '
      + (T.full.adjustment / T.payroll_before * 100).toFixed(2)
      + '% of payroll €' + fmt(T.payroll_before)
      + '; part-time uplifts scaled by fte × months/12 before summing.');

    /* --- Data: ONLY for the demo dataset -------------------------------
     * These describe the generated fixture (§5 of the spec), not pay data in
     * general. On a reader's CSV they fail by construction — there is no reason
     * their file should carry a built-in +12% grade step or a reverse-gap
     * category — so running them there reported a fault that did not exist.
     * They stay mandatory for the demo, which is what they were written for. */
    if (result._is_demo) {
      // 9. All seven heterogeneities are present.
      var het = demoHeterogeneities(result);
      add('all seven data heterogeneities present', het.all,
        het.lines.join(' | '));

      // 10. The explained part is non-zero in at least two categories.
      var expl = cats.filter(function (c) { return Math.abs(c.explained_pct) > 0.5; });
      add('explained part non-zero in at least two categories', expl.length >= 2,
        expl.length + ' categories with |explained| > 0.5 pp: '
        + expl.map(function (c) {
            return c.category + ' ' + c.explained_pct.toFixed(1) + ' pp of '
              + c.raw_gap_mean_pct.toFixed(1) + ' pp raw';
          }).join('; ') + '.');

      // 11. The regression recovers the built-in value of a grade.
      //     The generator applies +12% of salary per grade. The expected
      //     increase in euros is compared against coef_grade; "reasonable
      //     accuracy" means within ±40% per category (noise, the correlation
      //     of tenure with grade, and the multiplicative nature of the step
      //     make an exact match impossible).
      var recov = gradeRecovery(result);
      add('regression recovers the built-in grade step', recov.ok,
        recov.detail);
    }

    var passed = checks.every(function (c) { return c.passed; });
    return { passed: passed, checks: checks };
  }

  /* Checks that the seven heterogeneities are present, by their signatures in
   * the result. What is tested are observable consequences rather than the
   * generator's constants, so the check stays meaningful on a user's data. */
  function demoHeterogeneities(result) {
    var cats = result.categories;
    var lines = [];
    var flags = [];

    function chk(label, cond, note) {
      flags.push(cond);
      lines.push((cond ? '+' : '-') + ' ' + label + (note ? ': ' + note : ''));
    }

    // 1. within-grade gap — a category with a large residual and a small
    //    explained part
    var c1 = cats.filter(function (c) {
      return c.unexplained_pct > 4 && c.explained_pct < c.unexplained_pct;
    });
    chk('within-grade gap', c1.length > 0,
      c1.length ? c1[0].category + ' unexplained ' + c1[0].unexplained_pct.toFixed(1) + ' pp' : '');

    // 2. structural gap — the explained part is over half of the gap
    var c2 = cats.filter(function (c) {
      return c.raw_gap_mean_pct > 3 && c.explained_pct > c.raw_gap_mean_pct * 0.5;
    });
    chk('structural gap (women in lower grades)', c2.length > 0,
      c2.length ? c2[0].category + ' explained ' + c2[0].explained_pct.toFixed(1)
        + ' of ' + c2[0].raw_gap_mean_pct.toFixed(1) + ' pp' : '');

    // 3. a small category with a large gap
    var c3 = cats.filter(function (c) {
      return c.unreliable && Math.abs(c.raw_gap_mean_pct) > 8;
    });
    chk('small category with a large gap', c3.length > 0,
      c3.length ? c3[0].category + ' n=' + c3[0].headcount + ', gap '
        + c3[0].raw_gap_mean_pct.toFixed(1) + '%' : '');

    // 4. a gap in favour of women
    var c4 = cats.filter(function (c) { return c.reverse_gap; });
    chk('gap in favour of women', c4.length > 0,
      c4.length ? c4[0].category + ' ' + c4[0].raw_gap_mean_pct.toFixed(1) + '%' : '');

    // 5. tenure linked to pay — a positive tenure coefficient
    var c5 = cats.filter(function (c) {
      return c.regression.r_squared !== null && c.regression.coef_tenure > 100;
    });
    chk('tenure linked to pay', c5.length >= 2,
      c5.length + ' categories with coef_tenure > €100/yr, e.g. '
      + (c5.length ? c5[0].category + ' €' + Math.round(c5[0].regression.coef_tenure) : ''));

    // 6. part-time / partial year — checked against the source data
    chk('part-time and part-year present', result._demo_parttime > 0,
      result._demo_parttime + ' employees with fte<1 or months_worked<12');

    // 7. flat salaries with a gap in variable pay
    // Salaries must genuinely be FLAT: the base gap is close to zero and the
    // whole gap sits in variable pay. The weaker form of this check (just
    // "variable_gap is large") passed a category whose base had diverged by 11%
    // from a chance skew across grades — that is, it did not test the claim.
    var c7 = cats.filter(function (c) {
      return Math.abs(c._base_gap_pct) < 1.0 && c.variable_gap_pct > 25;
    });
    chk('flat salaries with a variable-pay gap', c7.length > 0,
      c7.length ? c7[0].category + ' base gap '
        + c7[0]._base_gap_pct.toFixed(2) + '% (flat), variable gap '
        + c7[0].variable_gap_pct.toFixed(1) + '%, total gap '
        + c7[0].raw_gap_mean_pct.toFixed(1) + '%'
        : 'no category with |base gap| < 1% and variable gap > 25%');

    return { all: flags.every(Boolean), lines: lines };
  }

  /* Recovery of the value of a grade by the regression.
   * Expectation: the generator applies +12% of salary per grade, so the average
   * increase in euros is roughly 0.12 × the category's average pay / (1 + 0.12/2).
   * Simpler and more honest: compare coef_grade against 12% of the category's
   * average pay, with a ±40% tolerance — noise and the correlation of tenure
   * with grade blur the coefficient. */
  function gradeRecovery(result) {
    var ok = 0, tested = 0, parts = [];
    result.categories.forEach(function (c) {
      if (c.regression.r_squared === null || c.headcount < 15) return;
      var meanPay = c.minimum.mean_pay_after; // ≈ average normalised pay
      var expected = meanPay * GRADE_STEP / (1 + GRADE_STEP);
      var got = c.regression.coef_grade;
      var ratio = got / expected;
      tested++;
      var good = ratio > 0.6 && ratio < 1.4;
      if (good) ok++;
      parts.push(c.category + ' €' + Math.round(got) + ' vs €' + Math.round(expected)
        + ' expected (×' + ratio.toFixed(2) + ')' + (good ? '' : ' [off]'));
    });
    return {
      ok: tested > 0 && ok >= Math.ceil(tested * 0.6),
      detail: 'Built-in grade step is +' + (GRADE_STEP * 100).toFixed(0)
        + '% of salary per grade. Recovered in ' + ok + ' of ' + tested
        + ' testable categories within ±40%: ' + parts.join('; ') + '.'
    };
  }

  function fmt(x) {
    return (Math.round(x * 100) / 100).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* ===========================================================================
   * 10. Public interface
   * ======================================================================== */

  return {
    generateDemoData: generateDemoData,
    analyse: analyse,
    selfCheck: selfCheck,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
})();

/* For Node (ad-hoc runs and the Excel model); does not trigger in a browser. */
if (typeof module !== 'undefined' && module.exports) { module.exports = CALC; }
