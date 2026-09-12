# Comp Budget Lab

Open, reproducible compensation budgeting workflows. Data, formulas, code and results, published in full.

Built by [Olga Dimitrova](https://www.linkedin.com/in/olga-dimitrova-04311742a/), a compensation practitioner with 16 years of comp budgeting and reporting in organizations of 1,200 to 17,000 people.

## Pay Gap Remediation Cost Calculator

**[Open the calculator](https://olgadimitrovagit.github.io/comp-budget-lab/)**

What it costs to close the unexplained gender pay gap, and how that cost lands on a budget. Minimum compliance against full equalisation, under EU Directive 2023/970.

The page runs entirely in your browser. It makes no network requests: nothing is uploaded, stored or transmitted. Load your own CSV and the numbers are computed in the tab.

### On the demo data

212 synthetic employees across seven categories, payroll €13,028,736.

| | Minimum compliance | Full equalisation | Difference |
|---|---|---|---|
| Base pay adjustment | €126,315 | €335,191 | €208,876 |
| Employer contributions | €22,221 | €61,331 | €39,110 |
| **Total** | **€148,536** | **€396,522** | **€247,986** |
| Payroll uplift | 1.14% | 3.04% | 1.90% |

Contribution rates and the ceiling are Spain 2026 defaults and are editable in the tool.

### Method

Per category: raw gap on total pay, then an ordinary least squares regression of pay on grade and tenure to split the gap into a part explained by grade and tenure and an unexplained residual. Only the residual is remediated. Recipients are employees of the underpaid gender below the median of their own category, with the increase distributed in proportion to each shortfall. Employer contributions are computed on the increase and split at the annual contribution ceiling. Categories where the gap favours women are not adjusted: equalisation is upward only.

Full method, with every formula, is in the "How this is computed" section of the page.

### Files

```
index.html                          the calculator, self-contained, no dependencies
build/calc.js                       the calculation, pure functions, no DOM
build/csv.js                        CSV import
build/ui.js                         DOM and chart
build/shell.html                    markup and styles
build/bundle.py                     assembles the four into index.html
build/check-*.js                    behaviour, render, visual and metadata checks
build/excel/pay-gap-model.xlsx      the same model in Excel, live formulas throughout
build/excel/pay-gap-model-mini.xlsx the same structure on 10 rows
build/excel/build_model.py          builds the workbook from CSV
build/excel/reference_calc.py       independent Python port of calc.js, used to cross-check
build/excel/demo-data.csv           the 212-employee demo dataset
build/sample.csv                    10-row sample showing the expected columns
```

`index.html` is generated. Edit the sources in `build/` and run `python build/bundle.py`.

### The Excel model

`build/excel/pay-gap-model.xlsx` carries the whole money chain in live formulas: no array formulas, no macros, nothing hidden. Medians are computed by rank, the regression by explicit sums and Cramer's rule, so the linear algebra is visible in the cells. Open it, change a salary, and watch every downstream figure move.

The chain was verified end to end: Excel against `reference_calc.py`, against `calc.js` in Node, against the live page in Chrome. All categories and totals agree to 1e-9.

### Input format

CSV with these columns:

`id, category, gender, base_salary, variable_pay, tenure_years, grade, fte, months_worked`

`gender` is `F` or `M`. Pay figures are actual amounts paid; the tool normalises for FTE and months worked. Download the sample from the page for a working example.

### Limits

The demo figures come from a seeded generator, not from any real organisation. The tool illustrates a method: it is not legal or actuarial advice, and it does not decide whether a gap is lawful.

Categories with fewer than 10 employees, or fewer than 3 of either gender, are marked statistically unreliable. The figures are still shown, but they should not carry a decision on their own.

Not in scope: grouping work of equal value into categories, optimising the allocation of a limited budget, comparing methods of selecting recipients, several jurisdictions at once, salary ranges and compa-ratio.

## Payroll Budget: Plan vs Actual

**[Open the dashboard](https://olgadimitrovagit.github.io/comp-budget-lab/budget-plan-fact/)**

A signalling dashboard, not an analytical one. An HR director opens a link on a phone and sees one of two outcomes within seconds: execution is on track, or there is a problem and a call is due. It answers where the budget diverges from plan and by how much, not why.

Like the calculator, the page makes no network requests. Load your own CSV and the numbers are computed in the tab; the page hands back the same self-contained file with your data inside.

### On the demo data

Seven departments, twelve months, annual payroll plan EUR 16,549,701. Actuals run through August; September to December are forecast.

| | Plan | Expected | Deviation |
|---|---|---|---|
| Jan-Aug (actual) | EUR 11,005,551 | EUR 11,275,717 | **+EUR 270,166** (+2.45%) |
| Sep-Dec (forecast) | EUR 5,544,150 | EUR 5,812,405 | **+EUR 268,255** (+4.84%) |
| **Full year** | **EUR 16,549,701** | **EUR 17,088,122** | **+EUR 538,421** (+3.25%) |

The "problem" threshold defaults to 3% and is configurable on the page. The full-year variance is above it, so the dashboard signals.

The September turn is not invented: from that month a salary equalisation takes effect, EUR 396,522 a year including employer contributions. That figure is the output of the calculator above. This dashboard asks the next question - what the decision does to a budget that was already approved.

Details, input format, the Excel model and how to reproduce the numbers: [budget-plan-fact/README.md](budget-plan-fact/README.md).

## Licence

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Reuse and adapt it, including commercially, with attribution.
