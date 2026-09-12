# Pay Gap Remediation Cost Calculator

**[Open the calculator](https://olgadimitrovagit.github.io/comp-budget-lab/pay-gap-calculator/)**

What it costs to close the unexplained gender pay gap, and how that cost lands
on a budget. Minimum compliance against full equalisation, under EU Directive
2023/970.

## You do not need to download anything

Open the link and the calculator runs in your browser. Load your own CSV and the
figures are computed in the tab: nothing is uploaded, stored or transmitted, and
the page makes no network requests at all.

If you would rather work in a spreadsheet, or want to keep a copy:

| | |
|---|---|
| **[pay-gap-model.xlsx](pay-gap-model.xlsx)** | the same calculation in Excel, live formulas. Download and open: it needs nothing else. |
| **[sample.csv](sample.csv)** | the input format, filled in. Replace the rows with your own. |

Everything inside `build/` is the source the page is assembled from, plus the
checks that verify the figures. It is there so the numbers can be audited. **You
do not need any of it to use the calculator or the workbook.**

## On the demo data

212 synthetic employees across seven categories, payroll €13,028,736.

| | Minimum compliance | Full equalisation | Difference |
|---|---|---|---|
| Base pay adjustment | €126,315 | €335,191 | €208,876 |
| Employer contributions | €22,221 | €61,331 | €39,110 |
| **Total** | **€148,536** | **€396,522** | **€247,986** |
| Payroll uplift | 1.14% | 3.04% | 1.90% |

Contribution rates and the ceiling are Spain 2026 defaults and are editable in
the tool.

## Method

Per category: raw gap on total pay, then an ordinary least squares regression of
pay on grade and tenure to split the gap into a part explained by grade and
tenure and an unexplained residual. Only the residual is remediated. Recipients
are employees of the underpaid gender below the median of their own category,
with the increase distributed in proportion to each shortfall. Employer
contributions are computed on the increase and split at the annual contribution
ceiling. Categories where the gap favours women are not adjusted: equalisation
is upward only.

Full method, with every formula, is in the "How this is computed" section of the
page.

## Input format

CSV with these columns:

```
id, category, gender, base_salary, variable_pay, tenure_years, grade, fte, months_worked
```

`gender` is `F` or `M`. Pay figures are actual amounts paid; the tool normalises
for FTE and months worked. Download the sample from the page for a working
example.

## The Excel model

`pay-gap-model.xlsx` carries the whole money chain in live formulas:
no array formulas, no macros, nothing hidden. Medians are computed by rank, the
regression by explicit sums and Cramer's rule, so the linear algebra is visible
in the cells. Open it, change a salary, and watch every downstream figure move.

The chain was verified end to end: Excel against `build/excel/reference_calc.py`,
against `calc.js` in Node, against the live page in Chrome. All categories and
totals agree to 1e-9.

## Files

```
index.html                          the calculator, self-contained, no dependencies
pay-gap-model.xlsx                  the same model in Excel, live formulas throughout
sample.csv                          10-row sample showing the expected columns
README.md                           this file

build/                              sources and checks - not needed to use the tool
  calc.js                           the calculation, pure functions, no DOM
  csv.js                            CSV import
  ui.js                             DOM and chart
  shell.html                        markup and styles
  bundle.py                         assembles the four into index.html
  check-behaviour.js                behaviour of the page under input
  check-render.js                   what the page renders
  check-meta.js                     metadata, and that no network request is made
  check-legibility.js               type sizes and contrast
  check-visual.js                   screenshots, both themes
  check-constants.js                reconciles the defaults across every file holding them
  shot-chart.js                     a large screenshot of the chart card
  excel/build_model.py              builds the workbook from CSV
  excel/reference_calc.py           independent Python port of calc.js, used to cross-check
  excel/export_demo.js              writes the demo dataset out of calc.js
  excel/demo-data.csv               the 212-employee demo dataset
```

## Reproducing the numbers

```
python build/bundle.py                 # writes index.html from the sources in build/
python build/excel/reference_calc.py   # the independent port, prints every category
python build/excel/build_model.py      # writes pay-gap-model.xlsx
node build/check-behaviour.js          # behaviour, render and metadata checks
node build/check-render.js
node build/check-meta.js
node build/check-constants.js
```

`index.html` is generated. Edit the sources in `build/` and run
`python build/bundle.py`. The checks exit non-zero on a mismatch rather than
printing a report and passing.

The screenshot checks (`check-visual.js`, `shot-chart.js`) need Puppeteer and
write into `build/shots/`, which is not kept in the repository.

## Limits

The demo figures come from a seeded generator, not from any real organisation.
The tool illustrates a method: it is not legal or actuarial advice, and it does
not decide whether a gap is lawful.

Categories with fewer than 10 employees, or fewer than 3 of either gender, are
marked statistically unreliable. The figures are still shown, but they should
not carry a decision on their own.

Not in scope: grouping work of equal value into categories, optimising the
allocation of a limited budget, comparing methods of selecting recipients,
several jurisdictions at once, salary ranges and compa-ratio.

## Licence

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Reuse and adapt it,
including commercially, with attribution.
