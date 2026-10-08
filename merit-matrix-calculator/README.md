# Salary review: budget and outcome

**[Open the calculator](https://olgadimitrovagit.github.io/comp-budget-lab/merit-matrix-calculator/)**

A merit matrix and salary review cost calculator. It first closes the
unexplained gender pay gap, then works out merit increases person by person,
and answers three questions: who gets how much, what the review costs this year
and in next year's budget, and whether it opens the gender pay gap again.

## You do not need to download anything

Open the link and the calculator runs in your browser. Load your own CSV files
and the figures are computed in the tab: nothing is uploaded, stored or
transmitted, and the page makes no network requests at all.

If you would rather work in a spreadsheet:

| | |
|---|---|
| **[build/merit-model.xlsx](build/merit-model.xlsx)** | the same calculation in Excel, live formulas, one row per employee. It holds the demo data and the default parameters. |
| **[build/demo-data.csv](build/demo-data.csv)**, **[build/demo-bands.csv](build/demo-bands.csv)** | the input format, filled in: employees and salary ranges. The page offers the same two files for download. |

## On the demo data

212 simulated employees in seven categories, Spain, salary ranges for 2026, a
review effective 1 April 2027, a target merit increase of 4%. All amounts
include bonus and employer contributions.

| | Full year | 2027, April to December |
|---|---|---|
| Pay equity | €332,757 | €249,568 |
| Merit | €786,430 | €589,822 |
| **Total** | **€1,119,187** (6.76% of payroll cost) | **€839,390** (5.07%) |

Merit as calculated comes to 5.39% of eligible base pay against the 4% target:
1.39 percentage points and €199,571 a year above the target budget.

## Method

1. Pay equity. In each category where women are paid less, the part of the
   gap that grade and tenure do not explain is closed in full: a regression of
   total cash on grade and tenure within the category, as in the
   [Pay Gap Remediation Cost Calculator](../pay-gap-calculator/). The money goes
   to women below the category median, in proportion to how far below it they
   are. The range maximum does not limit it.
2. Merit, from the base pay after pay equity. Target salary = range
   midpoint × company target compa-ratio × target compa-ratio of the rating. An
   eligible employee below target is raised to it, then three limits apply in
   this order: at least the rating's minimum increase, no more than the
   per-person cap, no pay above the range maximum if that limit is on. At or
   above the range maximum: no increase. Increases are not scaled to hit the
   target %: the difference is shown instead.
3. Cost. Base, bonus and employer contributions, with a contribution ceiling
   and tiered rates above it. This year counts from the effective month; next
   year is this review over twelve months, without a new cycle.
4. Gap check. Raw and unexplained gap by category on total cash,
   full-time equivalent: before, after pay equity, after merit.

The page states every rule in full under "Your data, Excel model, contributions
and method".

## Input format

Employees:

```
id, category, gender, grade, rating, hire_date, last_change_date, base_salary, bonus_pct, fte
```

Salary ranges:

```
category, grade, min, mid, max
```

`base_salary` is annual gross base pay, full time. `bonus_pct` is a percentage
of base pay, `rating` is 1 to 5, `gender` is `F` or `M`, dates are `YYYY-MM-DD`.
Without `gender` or `category` the page still computes the cost and skips pay
equity and the gap check.

## Files

```
index.html                  the calculator, self-contained, no dependencies
README.md                   this file

build/                      the model and the reference calculation
  reference_calc.py         the calculation in Python, the reference everything is checked against
  build_model.py            builds merit-model.xlsx from the demo CSV files
  check_model.py            checks the recalculated workbook against reference_calc.py
  dump_reference.py         runs reference_calc.py on scenarios, for the page checks
  make_demo.js              writes the demo data (needs ../pay-gap-calculator/build/calc.js)
  merit-model.xlsx          the Excel model
  demo-data.csv             212 simulated employees
  demo-bands.csv            their salary ranges
  mini-data.csv             a 12-person set used by the checks
  mini-bands.csv            its salary ranges

page/                       sources of index.html (React, Vite)
  src/engine.js             the page's calculation, a line-by-line port of reference_calc.py
  check-engine.mjs          engine against reference_calc.py, 5 scenarios
  check-page.py             the built page in a real browser: clicks, file inputs, no network requests
```

## Reproducing the numbers

```
cd page && npm install && npm run build   # writes ../index.html; fails on any external load
node check-engine.mjs                      # page engine against the Python reference
python check-page.py                       # needs Playwright
cd ../build
node make_demo.js                          # demo CSV files
python build_model.py                      # writes merit-model.xlsx
```

`build_model.py` writes formulas only. Open the workbook in Excel and let it
recalculate before running `python check_model.py`. Every check exits non-zero
on a mismatch.

## Limits

The demo data comes from a seeded generator, not from any real organisation.
The tool illustrates a method: it is not legal, actuarial or financial advice.

Employer contributions default to Spain 2026 and are editable on the page.
Salary ranges are taken as current and market-based. Collective agreements are
not modelled. Under EU Directive 2023/970 (Art. 10), a gap of 5% in a category
of workers triggers a joint pay assessment only if it is unjustified and not
remedied within six months; it is not a finding of discrimination.

## Licence

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Reuse and adapt it,
including commercially, with attribution.
