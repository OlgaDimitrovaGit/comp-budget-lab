#!/usr/bin/env python3
"""
Builds the dashboard page: data, comment and palette are inlined into a single
self-contained HTML file.

The page has to open without an internet connection and make no network request
of any kind: no fonts, no libraries, no analytics. So the chart is drawn as
inline SVG, the palette is copied in as a :root block, and the dataset is placed
in a <script type="application/json"> inside the file itself.

Updating the data does not go through this script: the CSV is loaded in the
browser, recalculated in place, and the page hands back a new file just as
self-contained as this one. The script is for the first build and for rebuilding
after a change to the markup.
"""
import csv
import json
import os
import sys
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TOKENS = os.path.join(ROOT, "design", "tokens.css")

FACT_MONTHS = 8
SIGNAL_THRESHOLD = 3.0   # % — the "problem" threshold, configurable on the page

# Departments in the source CSV are already in English (Sales, Engineering, ...).
# DEPT_EN is therefore an identity mapping, kept as an explicit dictionary rather
# than dropped: the page expects D.deptEn in the payload, and an explicit
# dictionary pins down the set of departments instead of assuming a name from the
# CSV is already fit to display.
DEPT_EN = {
    "Engineering": "Engineering",
    "Sales": "Sales",
    "Operations": "Operations",
    "Manufacturing": "Manufacturing",
    "Marketing": "Marketing",
    "Customer Support": "Customer Support",
    "Legal": "Legal",
}


def read_rows():
    with open(os.path.join(HERE, "budget-plan-fact.csv"), encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def read_comment():
    path = os.path.join(HERE, "comment.txt")
    if not os.path.exists(path):
        return ""
    return " ".join(open(path, encoding="utf-8").read().split())


def extract_palette():
    """Takes the :root block from the shared tokens.css.

    The values are never retyped: there is one source of truth, and a copy
    entered by hand drifts from it silently. All three blocks are taken — light,
    system dark, and the manual toggle.
    """
    css = open(TOKENS, encoding="utf-8").read()
    # Drop the header comment: it explains how to use the palette, which the
    # reader of the page does not need.
    start = css.index(":root {")
    block = css[start:]
    # Strip every CSS comment as well. tokens.css is a working file: beside each
    # value it carries the reasoning for choosing it, in Russian, addressed to
    # whoever maintains the palette. That is process, not artefact, and it has
    # no business in a published page - it shipped 87 lines of internal notes
    # into the previous build. The values stay, the commentary does not.
    out = []
    i = 0
    while i < len(block):
        j = block.find("/*", i)
        if j == -1:
            out.append(block[i:])
            break
        out.append(block[i:j])
        k = block.find("*/", j + 2)
        if k == -1:
            break
        i = k + 2
    block = "".join(out)
    # Collapse the blank lines the removed comments leave behind.
    lines = [ln.rstrip() for ln in block.split("\n")]
    cleaned = []
    for ln in lines:
        if ln.strip() == "" and cleaned and cleaned[-1].strip() == "":
            continue
        cleaned.append(ln)
    return "\n".join(cleaned).strip() + "\n"


def verify(rows):
    """Checks on the assembled data. Returns a list of violations."""
    failures = []
    f = lambda x: float(x) if x else 0.0

    plan_year = sum(f(r["plan"]) for r in rows)
    exp_year = sum(f(r["fact"]) if r["fact"] else f(r["forecast"]) for r in rows)
    dev_year = (exp_year - plan_year) / plan_year * 100

    p8 = sum(f(r["plan"]) for r in rows if int(r["month_no"]) <= FACT_MONTHS)
    f8 = sum(f(r["fact"]) for r in rows if int(r["month_no"]) <= FACT_MONTHS)
    dev8 = (f8 - p8) / p8 * 100

    p4 = sum(f(r["plan"]) for r in rows if int(r["month_no"]) > FACT_MONTHS)
    fc4 = sum(f(r["forecast"]) for r in rows if int(r["month_no"]) > FACT_MONTHS)
    dev4 = (fc4 - p4) / p4 * 100

    # 1. The year agrees with the generator's reference figures. Hard-coded on
    # purpose: if the dataset is rebuilt differently, the page has to say so
    # rather than quietly show different numbers.
    REF_PLAN_YEAR = 16549701.43
    REF_EXP_YEAR = 17088122.21
    if abs(plan_year - REF_PLAN_YEAR) > 0.01:
        failures.append(
            f"annual plan {plan_year:,.2f} != reference {REF_PLAN_YEAR:,.2f}")
    if abs(exp_year - REF_EXP_YEAR) > 0.01:
        failures.append(
            f"annual expected {exp_year:,.2f} != reference {REF_EXP_YEAR:,.2f}")

    # 2. The signal fires: otherwise the dashboard has nothing to show.
    if dev_year < SIGNAL_THRESHOLD:
        failures.append(
            f"year {dev_year:+.1f}% is below the {SIGNAL_THRESHOLD}% threshold - "
            f"the page would show 'on track'")

    # 3. Sep-Dec runs higher than the first eight months: there is no underspend
    # in the fourth quarter, there is a pay rise. The reverse would mean the
    # overspend had vanished.
    if dev4 <= dev8:
        failures.append(
            f"Sep-Dec {dev4:+.1f}% is not above 8M {dev8:+.1f}%")

    # 4. Completeness: 7 departments x 12 months, actuals exactly through August.
    deps = {r["department"] for r in rows}
    if len(rows) != len(deps) * 12:
        failures.append(f"{len(rows)} rows, expected {len(deps) * 12}")
    for r in rows:
        m = int(r["month_no"])
        if m <= FACT_MONTHS and not r["fact"]:
            failures.append(
                f"{r['department']} {r['month']}: actual is empty before September")
        if m > FACT_MONTHS and not r["forecast"]:
            failures.append(
                f"{r['department']} {r['month']}: forecast is empty after August")

    return failures, dev_year, dev8, dev4


def build(template_name="template.html", out_name="dashboard.html"):
    rows = read_rows()
    failures, dev_year, dev8, dev4 = verify(rows)
    if failures:
        print(f"CHECKS FAILED: {len(failures)}")
        for x in failures:
            print(f"  FAIL: {x}")
        sys.exit(1)

    data = [
        {
            "d": r["department"],
            "m": r["month"],
            "n": int(r["month_no"]),
            "p": round(float(r["plan"]), 2),
            "f": round(float(r["fact"]), 2) if r["fact"] else None,
            "c": round(float(r["forecast"]), 2) if r["forecast"] else None,
        }
        for r in rows
    ]

    payload = {
        "rows": data,
        "factMonths": FACT_MONTHS,
        "threshold": SIGNAL_THRESHOLD,
        "comment": read_comment(),
        "commentDate": "31/08/2026",
        "deptEn": DEPT_EN,
        "built": datetime.date.today().strftime("%d/%m/%Y"),
    }

    html = read_template(template_name).replace("/*PALETTE*/", extract_palette())
    html = html.replace('"__DATA__"', json.dumps(payload, ensure_ascii=False))

    out = os.path.join(HERE, out_name)
    # newline="\n" is required: without it Windows turns every \n into \r\n, and
    # the built file differs from one built on another machine by exactly the
    # number of lines — from identical sources. That is how the md5 recorded in
    # the project notes once drifted (63,125 bytes LF against 64,320 CRLF, a
    # difference of 1,195 = the line count). A value that exists in two places
    # has to match byte for byte, otherwise "rebuilds to the same md5" stops
    # being a check.
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)

    print(f"Written: {out}")
    print(f"Size: {len(html.encode('utf-8')) / 1024:.0f} KB")
    print()
    print(f"Year:     {dev_year:+.1f}%   {SIGNAL_THRESHOLD}% threshold - "
          f"{'REACHED' if dev_year >= SIGNAL_THRESHOLD else 'not reached'}")
    print(f"8M:       {dev8:+.1f}%")
    print(f"Sep-Dec:  {dev4:+.1f}%")
    print()
    print("CHECKS: all 4 groups passed")
    print()
    print("Required next: open it in a browser, both themes, narrow screen.")


def read_template(name="template.html"):
    """The template lives in its own file rather than as a string in the code.

    That way an editor highlights the HTML, and the markup does not drown in
    quote escaping inside a Python string.
    """
    with open(os.path.join(HERE, name), encoding="utf-8") as fh:
        return fh.read()


if __name__ == "__main__":
    # Template and output names are arguments so that alternative chart
    # treatments are built by ONE verified calculation rather than a copy of the
    # script: a copy drifts from the original silently, and then the variants
    # are compared on accidentally different numbers instead of on presentation.
    tpl = sys.argv[1] if len(sys.argv) > 1 else "template.html"
    out = sys.argv[2] if len(sys.argv) > 2 else "dashboard.html"
    build(tpl, out)
