#!/usr/bin/env python3
"""
The plan-vs-actual payroll budget dataset behind the dashboard.

Built on top of the first artefact's dataset (212 employees, 7 departments).

Three figures per department and month:
  plan     — the budget WITHOUT pay equalisation (drawn up before that decision)
  fact     — actuals Jan-Aug; empty from September
  forecast — Sep-Dec projection WITH equalisation

The September turn into overspend is not a planning error but the price of a
decision priced in the first artefact.

Everything is deterministic: the seed is a constant and randomness flows only
through it. Running this twice must produce a byte-for-byte identical file.
"""

import csv
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _find_paygap():
    """Locate the first artefact's data, which this dataset is built on top of.

    Two layouts have to work. In the published repository the calculator and
    this dashboard are siblings, so the data sits at <repo>/build/excel. In the
    working tree they are separate projects and it sits two levels up. The
    published layout is checked first: a reader who clones the repository must
    be able to reproduce the CSV, and silently falling back to a path that only
    exists on one machine would make "reproducible" untrue.
    """
    candidates = [
        os.path.normpath(os.path.join(HERE, "..", "excel")),
        os.path.normpath(os.path.join(
            HERE, "..", "..", "PROJECT-pay-gap-calculator", "build", "excel")),
    ]
    for path in candidates:
        if os.path.exists(os.path.join(path, "demo-data.csv")):
            return path
    raise SystemExit(
        "demo-data.csv not found. Looked in:\n  "
        + "\n  ".join(candidates))


PAYGAP = _find_paygap()

# The seed is a date rather than an arbitrary number, so that it means something.
SEED = 20260910

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
          "Sep", "Oct", "Nov", "Dec"]
FACT_MONTHS = 8          # actuals are known through August inclusive
EQUALISATION_MONTH = 9   # equalisation applies from September (index 1..12)

# Equalisation scenario from September: "full" closes the gap entirely (to zero),
# "min" brings categories to a 5% threshold.
#
# "full" is used here. On the minimum scenario the year closed with an underspend
# of 55,919 EUR (-0.34%): eight months of accumulated underspend covered it twice
# over, so the overspend risk never materialised and the dashboard had no story
# to tell. Full equalisation consumes the whole cushion and pushes the year into
# overspend, which is what the dashboard is meant to show.
SCENARIO = "full"

# Employer contribution rates: Spain 2026.
# These are not universal constants but the parameters of one jurisdiction in one
# year, and they are revisited whenever either changes.
RATE_BELOW = 31.5     # % below the contribution base ceiling
RATE_ABOVE = 1.15     # % above the ceiling (cuota de solidaridad)
CEILING = 61214.0     # EUR per year, the contribution base ceiling

# --- Target properties of the actuals ---------------------------------------
MONTHLY_DEV_MIN = 1.0      # |deviation| per department per month, % — lower bound
MONTHLY_DEV_MAX = 3.0      # the same, upper bound

# The company-level result is NOT set as a number; it accumulates from the
# departments' deviations.
#
# The dashboard has to show a problem: a signalling tool that never signals is
# useless. So August and the eight-month total run to an overspend rather than an
# underspend.
#
# The magnitude was chosen by calculation, not by eye. The "problem" threshold is
# 3% for the year. The Sep-Dec deviation is the base overspend PLUS equalisation
# (+2.38% against those months' plan): there is no underspend in the fourth
# quarter, there is a pay rise, so the overspend there is HIGHER than over the
# first eight months, not lower.
#
#   8M +2.0%  ->  Sep-Dec +4.38%  ->  year +2.80%   threshold not reached
#   8M +2.5%  ->  Sep-Dec +4.88%  ->  year +3.30%   reached  <- chosen
#   8M +3.0%  ->  Sep-Dec +5.38%  ->  year +3.80%   reached
#
# The ±1-3% deviation corridor survives this: the threshold is reached by a
# figure from INSIDE the corridor.
EXPECTED_OVERSPEND_MIN = 2.0  # % overspend over 8M, lower bound of plausibility
EXPECTED_OVERSPEND_MAX = 3.0  # % upper bound

# The dashboard's "problem" threshold: 3% and above. It is configurable on the
# page; here it is the reference against which the assembled dataset is checked
# for producing a signal at all.
SIGNAL_THRESHOLD = 3.0     # %

# One department deliberately breaks out of the corridor.
#
# The reason is arithmetic, not taste. Engineering carries 24% of the payroll, and
# while it underspends it cancels out six overspending departments: the company
# ceiling is +2.16% even with every deviation at the edge of the corridor. The 3%
# threshold is unreachable that way.
#
# The fix is not to widen the corridor for everyone — that would make all seven
# departments implausible — but to let one department break out of it visibly.
# That is how it goes in practice: a payroll budget does not break evenly, it
# breaks in one place. Sales at +9.5%, with the rest inside ±1-3%, gives a year of
# +3.4%: the threshold is cleared with room to spare, the other departments stay
# plausible, and the table keeps deviations running in both directions. The margin
# matters: at +8% the year landed on exactly 3.00%, and any edit to the numbers
# dropped the signal back to yellow.
BLOWOUT_DEPARTMENT = "Sales"
BLOWOUT_MIN = 9.0          # %
BLOWOUT_MAX = 10.0         # %

# --- Seasonality of the plan ------------------------------------------------
#
# Monthly payroll is uneven, and the reason is not bonuses: those are smoothed by
# accruals. The reason is holiday reserves. The start and end of the year run
# higher, with a gentle dip over the summer: headcount is thin and employees take
# the leave they have accrued.
#
# The coefficients are normalised to sum to exactly 12, so annual payroll is
# unchanged and seasonality only redistributes money inside the year. The swing is
# ±3-4% around the monthly average.
SEASONALITY = {
    1: 1.038,   # Jan  full headcount after the holidays, leave reserve building
    2: 1.035,   # Feb
    3: 1.022,   # Mar
    4: 1.005,   # Apr
    5: 0.986,   # May  start of the holiday season
    6: 0.968,   # Jun
    7: 0.962,   # Jul  the floor: thin headcount, peak use of accrued leave
    8: 0.964,   # Aug
    9: 0.985,   # Sep  back from holiday
    10: 1.006,  # Oct
    11: 1.014,  # Nov
    12: 1.015,  # Dec  hiring up towards year end
}

DEPARTMENT_SIGN = {
    # Most departments overspend and one or two underspend. The mix of directions
    # is deliberate: if every department overspent, the table would be uniform and
    # there would be no way to see that the sorting works.
    "Engineering":      -1,   # underspends — the largest department, holds the total down
    "Sales":            +1,   # overspend
    "Operations":       +1,   # overspend
    "Manufacturing":    +1,   # overspend
    "Marketing":        +1,   # overspend
    "Customer Support": +1,   # overspend
    "Legal":            +1,   # overspend
}


def load_source():
    """Reads the source dataset. Never modifies it: the first artefact is read-only."""
    path = os.path.join(PAYGAP, "demo-data.csv")
    with open(path, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def annual_payroll_by_department(rows):
    """Annual payroll by department: base plus variable pay, as actually paid.

    No FTE normalisation is applied here: a budget is executed in real money,
    not in full-time equivalents. Normalisation was needed by the first artefact
    in order to measure the gap, which is a different question.
    """
    agg = {}
    for r in rows:
        dep = r["category"]
        pay = float(r["base_salary"]) + float(r["variable_pay"])
        agg[dep] = agg.get(dep, 0.0) + pay
    return agg


def equalisation_by_department():
    """The annual equalisation adjustment by department.

    The scenario is set by the SCENARIO constant.

    It is not computed here but by the first artefact's reference calculation:
    two computations of the same figure in two places drift apart silently.
    Returns, per department, the uplift to pay and the employer contributions
    due on it.
    """
    sys.path.insert(0, PAYGAP)
    import reference_calc as rc

    employees = rc.load(os.path.join(PAYGAP, "demo-data.csv"))
    result = rc.analyse(employees, rc.DEFAULTS)

    out = {}
    for cat in result["categories"]:
        out[cat["category"]] = {
            "adjustment": cat[SCENARIO]["adjustment"],
            "contributions": cat[SCENARIO]["contributions"],
            "cost": cat[SCENARIO]["cost"],
        }
    return out, result["totals"][SCENARIO]


def employer_contributions(annual_pay_by_dep, rows):
    """Employer contributions on annual payroll, computed per employee.

    An average rate cannot be used against the ceiling: the scale is regressive,
    so a department with high salaries has a lower effective rate. Contributions
    are therefore computed for each employee and only then summed by department.
    """
    agg = {}
    for r in rows:
        dep = r["category"]
        base = float(r["base_salary"])
        variable = float(r["variable_pay"])
        pay = base + variable

        below = min(pay, CEILING)
        above = max(0.0, pay - CEILING)
        contrib = RATE_BELOW / 100 * below + RATE_ABOVE / 100 * above
        agg[dep] = agg.get(dep, 0.0) + contrib
    return agg


def build():
    rng = random.Random(SEED)

    rows = load_source()
    payroll = annual_payroll_by_department(rows)
    contributions = employer_contributions(payroll, rows)
    equalisation, eq_totals = equalisation_by_department()

    departments = sorted(payroll, key=lambda d: -payroll[d])

    # --- Plan: annual payroll including contributions, spread across months ---
    # Plan figures are never assigned: they are computed from the source dataset.
    # Seasonality redistributes the total inside the year without changing the
    # annual result (the coefficients are normalised to 12).
    plan_annual = {}
    plan_month = {}
    for dep in departments:
        annual = payroll[dep] + contributions[dep]
        plan_annual[dep] = annual
        plan_month[dep] = {m: annual / 12.0 * SEASONALITY[m] for m in range(1, 13)}

    # --- Actuals: stable sign per department, |deviation| 1-3% per month ---
    # Each department's deviation is drawn from the corridor and is NOT scaled to
    # hit a target total: the corridor is given, the total accumulates. The
    # reverse order — fix the total and fit the departments to it — would push
    # deviations outside the bounds of plausibility.
    # The underspending department draws from the LOWER half of the corridor and
    # the overspending ones from the upper half. Otherwise Engineering (24% of
    # payroll) at -2.8% cancels out six overspending departments, leaving +0.8%
    # for the company: the threshold is not reached and there is nothing to show.
    # Both magnitudes stay inside the ±1-3% corridor, so nothing leaves the
    # bounds of plausibility.
    dev = {}
    for dep in departments:
        if dep == BLOWOUT_DEPARTMENT:
            magnitude = rng.uniform(BLOWOUT_MIN, BLOWOUT_MAX)
        elif DEPARTMENT_SIGN[dep] > 0:
            magnitude = rng.uniform(MONTHLY_DEV_MIN, MONTHLY_DEV_MAX)
        else:
            magnitude = rng.uniform(MONTHLY_DEV_MIN, 1.5)
        dev[dep] = DEPARTMENT_SIGN[dep] * magnitude

    # --- Forecast Sep-Dec: plan plus equalisation, month by month ---
    # The annual cost of equalisation lands on 4 months rather than 12: the
    # decision takes effect in September. The monthly uplift is the annual cost
    # divided by 12.
    forecast_uplift = {}
    for dep in departments:
        eq = equalisation.get(dep, {"cost": 0.0})
        forecast_uplift[dep] = eq["cost"] / 12.0

    # --- Assembling the rows ---
    out = []
    for dep in departments:
        for idx, month_name in enumerate(MONTHS, start=1):
            # The plan is rounded BEFORE actuals and forecast are computed, not
            # after. Otherwise the derived figures come from an unrounded plan
            # while the rounded one goes into the file, and the Excel counterpart
            # reading the plan from a cell can no longer reproduce them: a
            # discrepancy of 6 cents on the annual total. The rounding sits where
            # the published number is born.
            plan = round(plan_month[dep][idx], 2)

            if idx <= FACT_MONTHS:
                # Month-to-month noise around a stable sign: a department's
                # deviation need not repeat to the cent every month, but it does
                # not change direction.
                jitter = rng.uniform(-0.15, 0.15)
                actual_dev = dev[dep] + jitter
                if (actual_dev > 0) != (dev[dep] > 0):
                    actual_dev = dev[dep]  # the sign matters more than the noise
                fact = plan * (1 + actual_dev / 100)
                forecast = ""
            else:
                fact = ""
                # The forecast carries the department's OWN deviation, not just
                # the equalisation. There is no underspend in the fourth quarter:
                # a department that overspent for eight months running keeps
                # overspending, and the uplift lands on top. A plain
                # plan + uplift formula silently assumed a return to plan exactly
                # from September, for which there is no basis.
                uplift = forecast_uplift[dep] if idx >= EQUALISATION_MONTH else 0.0
                forecast = plan * (1 + dev[dep] / 100) + uplift

            out.append({
                "department": dep,
                "month": month_name,
                "month_no": idx,
                "plan": round(plan, 2),
                "fact": round(fact, 2) if fact != "" else "",
                "forecast": round(forecast, 2) if forecast != "" else "",
            })

    return out, plan_month, plan_annual, dev, equalisation, eq_totals, departments


def verify(out, plan_month, plan_annual, dev, equalisation, eq_totals, departments):
    """A check has to be able to fail, otherwise it checks nothing.

    CHECKS counts the checks below. It is kept next to them rather than printed
    as a constant at the end: a hard-coded "6 of 6" once survived the addition of
    two more checks and quietly lied.
    """
    CHECKS = 11
    failures = []

    # 1. The eight-month result is an overspend, of a plausible size
    plan_8m = sum(r["plan"] for r in out if r["month_no"] <= FACT_MONTHS)
    fact_8m = sum(r["fact"] for r in out if r["month_no"] <= FACT_MONTHS and r["fact"] != "")
    overspend_pct = (fact_8m - plan_8m) / plan_8m * 100
    if overspend_pct <= 0:
        failures.append(
            f"8M is not an overspend but an underspend of {-overspend_pct:.2f}%")
    elif not (EXPECTED_OVERSPEND_MIN <= overspend_pct <= EXPECTED_OVERSPEND_MAX):
        failures.append(
            f"8M overspend {overspend_pct:.2f}% outside the expected "
            f"{EXPECTED_OVERSPEND_MIN}-{EXPECTED_OVERSPEND_MAX}%")

    # 2. The sign of the deviation is stable within a department
    for dep in departments:
        signs = set()
        for r in out:
            if r["department"] == dep and r["month_no"] <= FACT_MONTHS:
                signs.add(r["fact"] > r["plan"])
        if len(signs) != 1:
            failures.append(f"{dep}: the deviation changes sign from month to month")

    # 3. Monthly deviation within 1-3% for everyone except the outlier department.
    # The exception is named explicitly and checked separately (check 11): quietly
    # relaxing the bound "for somebody" would let a second such department through.
    for r in out:
        if r["month_no"] <= FACT_MONTHS and r["fact"] != "":
            if r["department"] == BLOWOUT_DEPARTMENT:
                continue
            d = abs(r["fact"] - r["plan"]) / r["plan"] * 100
            if not (MONTHLY_DEV_MIN * 0.8 <= d <= MONTHLY_DEV_MAX * 1.2):
                failures.append(
                    f"{r['department']} {r['month']}: deviation {d:.2f}% out of bounds")

    # 4. Equalisation sits in the forecast at exactly its own cost.
    # It is measured ABOVE the department's own trend rather than above plan: the
    # forecast carries both the department's overspend and the uplift. Subtract
    # the trend and the equalisation is what remains.
    eq_annual = sum(v["cost"] for v in equalisation.values())
    uplift_total = 0.0
    for r in out:
        if r["month_no"] >= EQUALISATION_MONTH and r["forecast"] != "":
            trend = r["plan"] * (1 + dev[r["department"]] / 100)
            uplift_total += r["forecast"] - trend
    expected = eq_annual / 12.0 * 4
    if abs(uplift_total - expected) > 0.5:
        failures.append(
            f"forecast uplift above trend {uplift_total:,.2f} != expected {expected:,.2f}")

    # 5. The cost of equalisation matches the first artefact
    if abs(eq_annual - eq_totals["total"]) > 0.01:
        failures.append(
            f"equalisation {eq_annual:,.2f} != reference {eq_totals['total']:,.2f}")

    # 6. A department with no gap receives no uplift.
    # Under full equalisation only Marketing stays in that position: Operations is
    # below the 5% threshold but not at zero, and full equalisation lifts it.
    no_gap = ("Marketing",) if SCENARIO == "full" else ("Operations", "Marketing")
    for dep in no_gap:
        uplift = equalisation.get(dep, {"cost": 0.0})["cost"]
        if uplift != 0.0:
            failures.append(f"{dep}: no gap, yet an uplift of {uplift:,.2f}")

    # 7. Seasonality does not change the annual plan: the months sum to annual payroll
    for dep in departments:
        annual_from_months = sum(
            r["plan"] for r in out if r["department"] == dep)
        expected = plan_annual[dep]
        if abs(annual_from_months - expected) > 1.0:
            failures.append(
                f"{dep}: plan summed over months {annual_from_months:,.2f} "
                f"!= annual {expected:,.2f} — seasonality moved the total")

    # 8. Shape of the seasonality: summer below winter, floor in July
    jan = sum(r["plan"] for r in out if r["month_no"] == 1)
    jul = sum(r["plan"] for r in out if r["month_no"] == 7)
    dec = sum(r["plan"] for r in out if r["month_no"] == 12)
    if not (jul < jan and jul < dec):
        failures.append("seasonality: July is not below January and December")
    swing = (max(SEASONALITY.values()) - min(SEASONALITY.values())) / 2 * 100
    if not (2.5 <= swing <= 4.5):
        failures.append(f"seasonal swing {swing:.1f}% outside the intended 3-4%")

    # 9. The year including the forecast is above the "problem" threshold.
    # If this comes out green, the dashboard has nothing to show the HR director.
    plan_year_chk = sum(r["plan"] for r in out)
    fc_chk = sum(r["forecast"] for r in out if r["forecast"] != "")
    year_dev = (fact_8m + fc_chk - plan_year_chk) / plan_year_chk * 100
    if year_dev < SIGNAL_THRESHOLD:
        failures.append(
            f"year {year_dev:+.2f}% below the {SIGNAL_THRESHOLD}% threshold — "
            f"the signal block would show 'on track' and there is nothing to show")

    # 10. The Sep-Dec deviation is HIGHER than over the first eight months.
    # There is no underspend in the fourth quarter, there is a pay rise: the base
    # overspend continues and equalisation is added on top. The reverse would mean
    # the overspend had vanished from September onwards.
    plan_4m = sum(r["plan"] for r in out if r["month_no"] > FACT_MONTHS)
    dev_4m = (fc_chk - plan_4m) / plan_4m * 100
    if dev_4m <= overspend_pct:
        failures.append(
            f"Sep-Dec {dev_4m:+.2f}% is not above 8M {overspend_pct:+.2f}% — "
            f"the overspend cannot fall in the fourth quarter")

    # 11. There is exactly one outlier department, and it really does stand out.
    # Otherwise the badly overspending department dissolves among the others and
    # the signal in the table stops pointing at the culprit.
    out_of_corridor = set()
    for r in out:
        if r["month_no"] <= FACT_MONTHS and r["fact"] != "":
            d = abs(r["fact"] - r["plan"]) / r["plan"] * 100
            if d > MONTHLY_DEV_MAX * 1.2:
                out_of_corridor.add(r["department"])
    if out_of_corridor != {BLOWOUT_DEPARTMENT}:
        failures.append(
            f"exactly {BLOWOUT_DEPARTMENT} should be outside the corridor, "
            f"but these are: {sorted(out_of_corridor) or 'nobody'}")

    return failures, overspend_pct, plan_8m, fact_8m, CHECKS


def main():
    out, plan_month, plan_annual, dev, equalisation, eq_totals, departments = build()
    failures, overspend_pct, plan_8m, fact_8m, checks = verify(
        out, plan_month, plan_annual, dev, equalisation, eq_totals, departments)

    path = os.path.join(HERE, "budget-plan-fact.csv")
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["department", "month", "month_no", "plan", "fact", "forecast"])
        writer.writeheader()
        writer.writerows(out)

    # The deviations used by the forecast are published as a separate file. The
    # Excel counterpart reads them from here rather than deriving them back from
    # the actuals: the actuals carry month-to-month noise, and deriving backwards
    # gives an average instead of the original figure — a discrepancy of 17 EUR
    # on the annual total.
    dev_path = os.path.join(HERE, "department-deviation.csv")
    with open(dev_path, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["department", "run_rate_deviation_pct"])
        for dep in departments:
            w.writerow([dep, f"{dev[dep]:.10f}"])

    print(f"Written: {path}")
    print(f"Written: {dev_path}")
    print(f"Rows: {len(out)} ({len(departments)} departments x 12 months)")
    print()
    print("Deviation of actuals from plan over 8 months, by department:")
    for dep in departments:
        p = sum(r["plan"] for r in out if r["department"] == dep and r["month_no"] <= FACT_MONTHS)
        f = sum(r["fact"] for r in out if r["department"] == dep and r["month_no"] <= FACT_MONTHS and r["fact"] != "")
        eq = equalisation.get(dep, {"cost": 0.0})["cost"]
        mark = "underspend" if f < p else "overspend "
        print(f"  {dep:20s} {mark} {abs(f - p):10,.2f}  ({(f - p) / p * 100:+.2f}%)"
              f"   equalisation from Sep: {eq:9,.2f}")
    print()
    print(f"  {'TOTAL plan 8M':20s} {plan_8m:14,.2f}")
    print(f"  {'TOTAL actual 8M':20s} {fact_8m:14,.2f}")
    print(f"  {'overspend':20s} {fact_8m - plan_8m:14,.2f}  ({overspend_pct:+.2f}%)")
    print()
    label = "full" if SCENARIO == "full" else "minimum"
    print(f"Equalisation ({label}, year): {eq_totals['total']:,.2f} EUR")

    # The annual result: the dashboard's headline number
    plan_year = sum(r["plan"] for r in out)
    fc_total = sum(r["forecast"] for r in out if r["forecast"] != "")
    expected_year = fact_8m + fc_total
    delta = expected_year - plan_year
    plan_4m = sum(r["plan"] for r in out if r["month_no"] > FACT_MONTHS)
    print()
    print(f"Sep-Dec: plan {plan_4m:,.2f} | forecast {fc_total:,.2f} | "
          f"{(fc_total - plan_4m) / plan_4m * 100:+.2f}%")
    print(f"YEAR: plan {plan_year:,.2f} | expected {expected_year:,.2f} | "
          f"{delta:+,.2f} ({delta / plan_year * 100:+.2f}%)")
    print(f"'Problem' threshold {SIGNAL_THRESHOLD}%: "
          f"{'REACHED' if delta / plan_year * 100 >= SIGNAL_THRESHOLD else 'NOT REACHED'}")

    print()
    if failures:
        print(f"CHECKS: {len(failures)} violations out of {checks} checks")
        for f in failures:
            print(f"  x {f}")
        sys.exit(1)
    print(f"CHECKS: all {checks} passed")


if __name__ == "__main__":
    main()
