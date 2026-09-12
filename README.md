# Comp Budget Lab

Open, reproducible compensation budgeting workflows. Data, formulas, code and
results, published in full.

Built by [Olga Dimitrova](https://www.linkedin.com/in/olga-dimitrova-04311742a/),
a compensation practitioner with 16 years of comp budgeting and reporting in
organizations of 1,200 to 17,000 people.

Every artefact here runs entirely in your browser and makes no network requests:
nothing is uploaded, stored or transmitted. Load your own CSV and the numbers are
computed in the tab.

## Artefacts

### [Pay Gap Remediation Cost Calculator](pay-gap-calculator/)

**[Open the calculator](https://olgadimitrovagit.github.io/comp-budget-lab/pay-gap-calculator/)**

What it costs to close the unexplained gender pay gap, and how that cost lands on
a budget. Minimum compliance against full equalisation, under EU Directive
2023/970. On the demo data the two options cost €148,536 and €396,522 a year.

Method, input format, the Excel model and how to reproduce the numbers:
[pay-gap-calculator/README.md](pay-gap-calculator/README.md).

### [Payroll Budget: Plan vs Actual](budget-plan-fact/)

**[Open the dashboard](https://olgadimitrovagit.github.io/comp-budget-lab/budget-plan-fact/)**

A signalling dashboard, not an analytical one. An HR director opens a link on a
phone and sees one of two outcomes within seconds: execution is on track, or
there is a problem and a call is due. It answers where the budget diverges from
plan and by how much, not why.

It takes the calculator's output as its input: from September a salary
equalisation of €396,522 a year takes effect against a plan approved before that
decision.

Details, input format, the Excel model and how to reproduce the numbers:
[budget-plan-fact/README.md](budget-plan-fact/README.md).

## Layout

Each artefact is a folder of its own, with the same shape:

```
<artefact>/index.html    the page, self-contained, no dependencies
<artefact>/build/        sources, demo data, Excel model and checks
<artefact>/README.md     what it is, how to reproduce the numbers
```

`index.html` in each folder is generated from the sources in its `build/`; the
build command is in that artefact's README. The `index.html` at the repository
root is a redirect: the calculator was published there before it moved into a
folder, and the link is already in circulation.

Every check exits non-zero on a mismatch rather than printing a report and
passing, so a broken number fails the run instead of being reported in passing.

## Limits

The demo figures in every artefact come from seeded generators, not from any real
organisation. They illustrate methods: they are not legal, actuarial or financial
advice.

Contribution rates, ceilings and thresholds are specific to one country and one
year, and are labelled with both wherever they appear.

## Licence

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Reuse and adapt it,
including commercially, with attribution.
