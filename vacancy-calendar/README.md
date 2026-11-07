# Vacancy calendar: what open roles really cost in 2027

**[Open the tool](https://olgadimitrovagit.github.io/comp-budget-lab/vacancy-calendar/)**

Hiring requests usually say "everyone from January", and the hiring budget is
priced as if they all start on January 1. They don't: a request has to be
approved, the role filled, and the new hire has to serve notice. The tool gives
each open role a realistic start date from the company's own hiring history and
answers three questions: what open roles really cost in 2027, which start dates
to defer to meet the payroll target, and what carries over into 2028.

## You do not need to download anything

Open the link and the tool runs in your browser. Load your own CSV files and
the figures are computed in the tab: nothing is uploaded, stored or
transmitted, and the page makes no network requests at all.

If you would rather work in a spreadsheet:

| | |
|---|---|
| **[vacancy-calendar-model.xlsx](vacancy-calendar-model.xlsx)** | the same calculation in Excel, live formulas, one row per role, each step its own column on the Plan sheet. It holds the demo data and the default settings; inputs are the yellow cells on the Inputs sheet. To run your own roles, paste them over the yellow columns of the Plan sheet and your hiring history on History, in the columns of the sample CSV files: the formulas cover up to 1,000 roles and 300 history rows. |
| **[sample-positions.csv](sample-positions.csv)**, **[sample-hiring-history.csv](sample-hiring-history.csv)** | the input format, filled in: open roles and the hiring history. The page offers the same two files for download. |
| **[method.html](method.html)** | the method step by step, following one role through every step |

## On the demo data

A simulated company in Spain: about 1,700 employees, current payroll €130M,
240 open roles (+14% headcount), a 2027 payroll target of €137.3M. Payroll and
the target include bonus and employer social contributions.

| 2027 payroll | €M |
|---|---|
| As requested, everyone from the requested month | 146.78 |
| Realistic: hiring timelines, roles not filled, leavers' empty seats | 139.67 |
| After deferring 121 start dates by 3 months | 137.30 |
| Target | 137.30 |

Hiring timelines close €3.74M of the €9.48M overrun, unfilled roles and
leavers' empty seats another €3.36M; deferrals cover the remaining €2.37M.
In 2028 the people hired in 2027 cost €16.48M, €7.02M more than in 2027:
deferrals save money in 2027 only.

## Method

1. Full annual cost of a role: base salary × (1 + target bonus) + employer
   contributions at one combined rate up to a ceiling.
2. Start date: the requested month, but no earlier than the request can be
   approved and the role filled, counting from 1 January. Approval and search
   times are the medians by grade from the hiring history; a grade with fewer
   than 3 filled roles takes default timings. A candidate already in the
   pipeline starts a set number of days after the plan date (interview 40,
   offer 20) or on the agreed date. A project role starts no earlier than
   its project. Someone who starts after the 15th is paid from the next month.
3. Realistic forecast: roles without a candidate are counted at the fill rate
   (90% by default); leavers' seats stay empty for a while (10% a year, 2 months
   by default) and that comes off current payroll.
4. Deferrals: only roles with no candidate, not project roles and not flagged
   critical. Most expensive per month first, each by the fewest whole months
   that close the rest of the gap, no more than 3, at most out of 2027. If all
   possible deferrals are not enough, the page says so and does not bend the
   rules.
5. 2028: the full-year cost of everyone hired in 2027, at the same fill rate,
   with 2027 salaries.

The page states every rule under "Your data, Excel model and method";
[method.html](method.html) walks through each step with figures.

## Input format

Open roles:

```
position_id, department, grade, base_salary, target_bonus_pct, requested_month, stage, expected_start, project_start, critical
```

Hiring history:

```
requisition, grade, department, requested, opened, started, request_to_open_days, open_to_start_days
```

`base_salary` is annual gross base pay. `target_bonus_pct` is a percentage of
base pay. `requested_month` is `YYYY-MM`, dates are `YYYY-MM-DD`. `stage` is
empty, `interview`, `offer` or `accepted`; `expected_start` is the agreed
date for `accepted`. `project_start` is filled for project roles only.
`critical` is `yes` or `no`. The hiring history is the output of the
[hiring exports merge](../hiring-exports-merge/) script; its first line
`sep=,` is optional.

## Files

```
index.html                    the tool, self-contained, no dependencies
vacancy-calendar-model.xlsx   the same calculation in Excel, live formulas
method.html                   the method step by step
sample-positions.csv          240 simulated open roles: the input format, filled in
sample-hiring-history.csv     a simulated hiring history
og-image.png                  link preview
README.md                     this file

build/                        the model and the reference calculation
  reference_calc.py           the calculation in Python, the reference everything is checked against
  make_demo.py                writes sample-positions.csv (seeded)
  build_model.py              builds vacancy-calendar-model.xlsx from the sample CSV files
  recalc.ps1                  recalculates the workbook in real Excel, lists formula errors
  check_model.py              checks the recalculated workbook against reference_calc.py
  dump_reference.py           runs reference_calc.py on scenarios, for the page checks

page/                         sources of index.html (React, Vite)
  src/lib/engine.js           the page's calculation, a line-by-line port of reference_calc.py
  check-engine.mjs            engine against reference_calc.py, 6 scenarios incl. a 4,000-role file
  check-network.mjs           the built page in Chrome: no requests on load or after picking files
```

## Reproducing the numbers

```
cd page && npm install && npm run build   # writes ../index.html; fails on any external load
node check-engine.mjs                      # page engine against the Python reference
node check-network.mjs                     # needs Chrome; set CHROME=<path to chrome> on macOS or Linux
cd ../build
python make_demo.py                        # writes ../sample-positions.csv
python build_model.py                      # writes ../vacancy-calendar-model.xlsx (needs openpyxl)
powershell -File recalc.ps1                # recalculates it in Excel
python check_model.py                      # 1,611 figures against reference_calc.py
```

The workbook in the repository is already recalculated, so `python
check_model.py` checks it as it is. A workbook rebuilt by `build_model.py`
holds formulas without values until Excel recalculates it. Every check exits
non-zero on a mismatch.

## Limits

The demo data comes from a seeded generator, not from any real organisation.
The tool illustrates a method: it is not legal, actuarial or financial advice.

Employer contributions default to Spain 2026, 32.15% (30.65% general
scheme, permanent contracts, plus 1.50% occupational risk for office work) up to
€61,214.40 a year, and are editable. The solidarity contribution above the
ceiling is left out, so contributions are slightly understated. 2028 uses 2027
salaries, with no indexation. Attrition, empty-seat months and the fill rate
are illustrative defaults; leavers are counted on the whole current payroll,
not by department. If deferrals are not enough, the tool shows how much is
missing; which roles to cut is a decision for managers.

## Licence

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Reuse and adapt it,
including commercially, with attribution.
