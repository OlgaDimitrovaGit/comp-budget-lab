# Payroll Budget: Plan vs Actual

**[Open the dashboard](https://olgadimitrovagit.github.io/comp-budget-lab/budget-plan-fact/)**

A signalling dashboard, not an analytical one. An HR director opens a link on a
phone and sees one of two outcomes within seconds: execution is on track, or
there is a problem and a call is due.

It answers where the budget diverges from plan and by how much. It does not
answer why: causes belong in the conversation, not on the screen.

## You do not need to download anything

Open the link and the dashboard runs in your browser. Load your own CSV and the
figures are computed in the tab: nothing is uploaded, stored or transmitted, and
the page makes no network requests at all. The page then hands you back the same
self-contained file with your data inside, which you send on as a link.

If you would rather work in a spreadsheet, or want to keep a copy:

| | |
|---|---|
| **[budget-plan-fact-model.xlsx](budget-plan-fact-model.xlsx)** | the same calculation in Excel, live formulas. Download and open: it needs nothing else. |
| **[sample.csv](sample.csv)** | the input format, filled in. Replace the rows with your own. |

Everything inside `build/` is the source the page is assembled from, plus the
generator and the checks that verify the figures. It is there so the numbers can
be audited. **You do not need any of it to use the dashboard or the workbook.**

## On the demo data

Seven departments, twelve months, annual payroll plan €16,549,701. Actuals run
through August; September to December are forecast.

| | Plan | Expected | Deviation |
|---|---|---|---|
| Jan–Aug (actual) | €11,005,551 | €11,275,717 | **+€270,166** (+2.45%) |
| Sep–Dec (forecast) | €5,544,150 | €5,812,405 | **+€268,255** (+4.84%) |
| **Full year** | **€16,549,701** | **€17,088,122** | **+€538,421** (+3.25%) |

The "problem" threshold is configurable and defaults to 3%. The full-year
variance is above it, so the dashboard signals.

### By department

Sorted worst first, which is the order the dashboard uses.

| Department | Plan | Expected | Variance |
|---|---|---|---|
| Sales | €2,807,385 | €3,110,207 | +10.79% |
| Manufacturing | €2,521,233 | €2,609,786 | +3.51% |
| Legal | €857,102 | €886,131 | +3.39% |
| Customer Support | €1,411,870 | €1,456,289 | +3.15% |
| Marketing | €2,326,012 | €2,383,207 | +2.46% |
| Operations | €2,639,115 | €2,681,228 | +1.60% |
| Engineering | €3,986,985 | €3,961,276 | −0.64% |

Sales drives most of the overspend. Engineering is the only department below
plan.

## Where the September turn comes from

The plan was approved before the decision to equalise pay. From September a
salary equalisation takes effect: €33,043 a month across 52 of 212 employees,
€396,522 a year including employer contributions.

That figure is not invented here. It is the output of the first artefact in this
repository, the [Pay Gap Remediation Cost
Calculator](https://olgadimitrovagit.github.io/comp-budget-lab/pay-gap-calculator/), which measures
the unexplained gap and prices the options for closing it. This dashboard takes
that output and asks the next question: what the decision does to a budget that
was already approved.

## Input format

CSV with these columns:

```
department,month,month_no,plan,fact,forecast
Sales,Jan,1,120000,117600,
Sales,Sep,9,120000,,123000
```

`fact` is filled through the last closed month and blank after it; `forecast` is
the opposite. Every department needs all twelve months. Amounts in euros.
`sample.csv` is a two-department working example.

The comment shown to the director is typed into the page, not carried in the
CSV.

## The Excel model

`budget-plan-fact-model.xlsx` carries the same calculation in live
formulas across seven sheets: plan → actual → deviation → running total →
forecast with equalisation → annual result. Nothing is written in as a number
that could be computed; openpyxl writes the formulas and real Excel computes
them.

The workbook was recalculated by the live engine and agrees with the CSV to
0.000000 on all five control figures: annual plan, annual expected, annual
deviation, eight-month plan and eight-month actual. No formula errors.

## Files

```
index.html                          the dashboard, self-contained, no dependencies
budget-plan-fact-model.xlsx         the same model in Excel, live formulas
sample.csv                          two-department example of the input format
README.md                           this file

build/                              sources and checks - not needed to use the tool
  template.html                     markup, styles and logic
  build_dashboard.py                embeds data and palette into the page
  palette.css                       the palette the page is built with
  generate_dataset.py               the seeded dataset generator, with its checks
  budget-plan-fact.csv              the demo dataset, 7 departments x 12 months
  department-deviation.csv          per-department deviation, input to the generator and the model
  make_sample.py                    writes sample.csv
  build_model.py                    builds the Excel workbook from the CSV
  recalc_model.ps1                  recalculates the workbook and checks it against the CSV
  comment.txt                       the comment baked into the published build
```

The dashboard is generated. Edit `build/template.html` and run
`python build/build_dashboard.py`, which writes `dashboard.html` next to the
template; that file is what ships as `index.html`.

## Reproducing the numbers

```
python build/generate_dataset.py          # writes budget-plan-fact.csv, runs 11 checks
python build/build_model.py               # writes budget-plan-fact-model.xlsx
powershell -File build/recalc_model.ps1   # recalculates it and verifies against the CSV
python build/build_dashboard.py           # writes build/dashboard.html
```

The generator is seeded, so it reproduces the same CSV byte for byte. The checks
in each script exit non-zero on a mismatch rather than printing a report and
passing.

## Limits

The figures come from a seeded generator, not from any real organisation. The
dashboard illustrates a method; it is not financial advice.

Contribution rates used in the equalisation cost are Spain 2026: 31.5% on annual
pay up to a ceiling of €61,214 and 1.15% above it. They are specific to one
country and one year.

Deliberately out of scope: explaining variances, headcount planning, multiple
currencies, and any comparison between departments beyond the size of the gap.

## Licence

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Reuse and adapt it,
including commercially, with attribution.
