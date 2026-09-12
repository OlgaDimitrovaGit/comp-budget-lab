#!/usr/bin/env python3
"""
A sample CSV with a header: it shows the format, not the data.

The first artefact's sample (build/sample.csv) is built the same way: a few
rows of round numbers. Its job is to give someone a file they can open,
understand the structure of, and fill with their own figures.

Two departments across all twelve months. Fewer will not do: the format has to
show both the whole year and both roles a row can play — actual through August,
forecast after it. One department underspends and the other overspends,
otherwise the example would not show that variance runs in both directions.

The numbers are round and invented. This is not an extract from the working
dataset: a format example and demonstration data are different things, and
mixing them invites the reader to take someone else's figures as a model for
their own.
"""
import csv
import os

HERE = os.path.dirname(os.path.abspath(__file__))

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
FACT_MONTHS = 8

# Department -> (monthly plan, actual variance in %, monthly equalisation uplift).
# Sales underspends, Support overspends. Only Sales gets the uplift: a department
# with no pay gap gets nothing, and the example shows that.
# Actuals are listed month by month rather than derived from the plan: the same
# number twelve times over reads as a placeholder, and then nobody can tell what
# they are supposed to put there.
SAMPLE = [
    {
        "department": "Sales",
        "plan": 120000,
        "uplift": 3000,           # equalisation, from September
        "fact": [117600, 118200, 117000, 118800, 117300, 118500, 116700, 117900],
    },
    {
        "department": "Customer Support",
        "plan": 80000,
        "uplift": 0,              # no gap here, so no uplift
        "fact": [81200, 80800, 81600, 80400, 81000, 81400, 80600, 81800],
    },
]


def build():
    rows = []
    for dep in SAMPLE:
        for i, month in enumerate(MONTHS, start=1):
            if i <= FACT_MONTHS:
                fact = dep["fact"][i - 1]
                forecast = ""
            else:
                fact = ""
                forecast = dep["plan"] + dep["uplift"]
            rows.append({
                "department": dep["department"],
                "month": month,
                "month_no": i,
                "plan": dep["plan"],
                "fact": fact,
                "forecast": forecast,
            })
    return rows


def main():
    rows = build()
    path = os.path.join(HERE, "sample.csv")
    with open(path, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(
            fh, fieldnames=["department", "month", "month_no", "plan", "fact", "forecast"])
        w.writeheader()
        w.writerows(rows)

    # Check: the header matches the working dataset. If the two drifted apart,
    # a file presented as a format example would be showing a different format.
    with open(os.path.join(HERE, "budget-plan-fact.csv"), encoding="utf-8-sig") as fh:
        real_header = fh.readline().strip()
    with open(path, encoding="utf-8") as fh:
        sample_header = fh.readline().strip()

    print("Written: %s" % path)
    print("Rows: %d (%d departments x 12 months)" % (len(rows), len(SAMPLE)))
    for dep in SAMPLE:
        p8 = dep["plan"] * FACT_MONTHS
        f8 = sum(dep["fact"])
        mark = "underspend" if f8 < p8 else "overspend "
        print("  %-18s %s %+.1f%% over 8 months"
              % (dep["department"], mark, (f8 - p8) / p8 * 100))
    print()
    if real_header != sample_header:
        print("CHECK FAILED: the sample header has drifted from the dataset")
        print("  dataset: %s" % real_header)
        print("  sample:  %s" % sample_header)
        raise SystemExit(1)
    print("Header matches budget-plan-fact.csv:")
    print("  %s" % sample_header)


if __name__ == "__main__":
    main()
