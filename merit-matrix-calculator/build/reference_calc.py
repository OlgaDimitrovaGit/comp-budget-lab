# -*- coding: utf-8 -*-
"""
Independent reference for the Merit Matrix workbook.

The workbook is checked against these numbers, not by eye. Step 1 (pay equity,
full equalisation) follows the Pay Gap Remediation Cost Calculator; step 2 is
target-based merit (target compa-ratio by rating).
"""
import csv
import sys
from datetime import date

DEFAULTS = {
    "effective_date": date(2027, 4, 1),
    "pool_pct": 4.0,
    "min_months_hire": 6,
    "min_months_change": 3,
    "clip_at_max": True,
    "company_target": 1.00,
    # one cap for everyone, % of aligned base; the rise itself is the gap to target.
    # None or 0 = no cap
    "max_increase": 0.30,
    # rating: (target compa-ratio, minimum increase)
    "ratings": {1: (0.00, 0.00), 2: (0.95, 0.00), 3: (1.00, 0.00),
                4: (1.05, 0.01), 5: (1.10, 0.02)},
    "zones": [0.0, 0.90, 1.00, 1.10],
    "rate_below": 32.15,  # 30.65% + AT/EP office-work rate 1.50% (Spain 2026)
    # employer rates on pay above the ceiling, Spain 2026 (cuota de solidaridad, employer share):
    # (band upper bound as a multiple of the ceiling, rate %)
    "above_ceiling": [(1.10, 0.96), (1.50, 1.04), (None, 1.22)],
    "ceiling": 61214.40,
}
EPS = 1e-9


def parse_date(s):
    y, m, d = (int(x) for x in s.split("-"))
    return date(y, m, d)


def load_bands(path):
    """Salary ranges keyed by (category, grade): annual full-time base, min / mid / max."""
    return {(r["category"].strip(), int(r["grade"])): (float(r["min"]), float(r["mid"]), float(r["max"]))
            for r in csv.DictReader(open(path, encoding="utf-8-sig"))}


def months_between(d1, d2):
    """Complete months from d1 to d2, as Excel DATEDIF(d1, d2, "m")."""
    return (d2.year - d1.year) * 12 + (d2.month - d1.month) - (1 if d2.day < d1.day else 0)


def load(path):
    out = []
    for r in csv.DictReader(open(path, encoding="utf-8-sig")):
        out.append({
            "id": r["id"], "category": r["category"].strip(),
            "gender": "F" if r["gender"].strip().upper() == "F" else "M",
            "grade": int(r["grade"]), "rating": int(r["rating"]),
            "hire": parse_date(r["hire_date"]), "change": parse_date(r["last_change_date"]),
            "base": float(r["base_salary"]), "bonus": float(r["bonus_pct"]) / 100,
            "fte": float(r["fte"]),
        })
    return out


def contributions(pay, S):
    """Employer contributions on annual pay: full rate up to the ceiling, tiered rates above it."""
    c = S["ceiling"]
    out = S["rate_below"] / 100 * min(pay, c)
    lo = c
    for top, rate in S["above_ceiling"]:
        hi = pay if top is None else min(pay, top * c)
        out += rate / 100 * max(0.0, hi - lo)
        if top is not None:
            lo = top * c
    return out


def contributions_on(before, uplift, S):
    if uplift <= 0:
        return 0.0
    return contributions(before + uplift, S) - contributions(before, S)


def median(a):
    a = sorted(a)
    n = len(a)
    return (a[(n - 1) // 2] + a[n // 2]) / 2


def regress(rows, pay=lambda r: r["total"]):
    n = len(rows)
    g = [r["grade"] for r in rows]
    t = [r["tenure"] for r in rows]
    y = [pay(r) for r in rows]
    Sg, St, Sy = sum(g), sum(t), sum(y)
    cgg = sum(x * x for x in g) - Sg * Sg / n
    ctt = sum(x * x for x in t) - St * St / n
    cgt = sum(g[i] * t[i] for i in range(n)) - Sg * St / n
    cgy = sum(g[i] * y[i] for i in range(n)) - Sg * Sy / n
    cty = sum(t[i] * y[i] for i in range(n)) - St * Sy / n
    det = cgg * ctt - cgt * cgt
    if n < 4 or abs(det) < EPS:
        return 0.0, 0.0, False
    return (cgy * ctt - cty * cgt) / det, (cty * cgg - cgy * cgt) / det, True


def mean(a):
    return sum(a) / len(a) if a else 0.0


def decompose(rows, pay=lambda r: r["total"]):
    """Raw gap of mean pay (men − women) / men, split into the part explained by grade and tenure and the rest, in %."""
    f = [r for r in rows if r["gender"] == "F"]
    m = [r for r in rows if r["gender"] == "M"]
    mean_m = mean([pay(r) for r in m])
    mean_f = mean([pay(r) for r in f])
    raw = (mean_m - mean_f) / mean_m * 100 if (f and m and mean_m > 0) else 0.0
    bg, bt, ok = regress(rows, pay)
    expl = 0.0
    if ok and f and m:
        dg = mean([r["grade"] for r in m]) - mean([r["grade"] for r in f])
        dt = mean([r["tenure"] for r in m]) - mean([r["tenure"] for r in f])
        expl = (bg * dg + bt * dt) / mean_m * 100
    expl = max(0.0, min(expl, raw)) if raw >= 0 else min(0.0, max(expl, raw))
    return raw, expl, raw - expl, mean_m, bg, bt


def analyse(emp, bands, S=None):
    S = dict(DEFAULTS, **(S or {}))
    eff = S["effective_date"]
    for e in emp:
        e["min"], e["mid"], e["max"] = bands[(e["category"], e["grade"])]
        e["tenure"] = (eff - e["hire"]).days / 365.25
        e["total"] = e["base"] * (1 + e["bonus"])

    # Step 1: pay equity, full equalisation, per category
    cats = {}
    for e in emp:
        cats.setdefault(e["category"], []).append(e)
    for e in emp:
        e["uplift_total"] = 0.0
    cat_out = {}
    for name, rows in cats.items():
        f = [r for r in rows if r["gender"] == "F"]
        raw, expl, unexpl, mean_m, bg, bt = decompose(rows)
        med = median([r["total"] for r in rows])
        need = unexpl / 100 * mean_m * len(f) if (raw >= 0 and unexpl > 1e-12) else 0.0
        under = [r for r in f if r["total"] < med]
        td = sum(med - r["total"] for r in under)
        if need > 0 and td > 0:
            for r in under:
                r["uplift_total"] = need * (med - r["total"]) / td
        cat_out[name] = {"raw": raw, "explained": expl, "unexplained": unexpl,
                         "median": med, "need": need, "bg": bg, "bt": bt,
                         # closed in full by step 1 where it was against women; otherwise unchanged
                         "unexplained_after_equity": 0.0 if (need > 0 and td > 0) else unexpl}

    # Step 2: target-based merit on the aligned base
    for e in emp:
        e["uplift_base"] = e["uplift_total"] / (1 + e["bonus"])
        e["aligned"] = e["base"] + e["uplift_base"]
        e["equity_over_max"] = e["uplift_base"] > 0 and e["aligned"] > e["max"]
        e["eligible"] = (months_between(e["hire"], eff) >= S["min_months_hire"]
                         and months_between(e["change"], eff) >= S["min_months_change"])
        e["cr"] = e["aligned"] / e["mid"]
        tgt, mn = S["ratings"][e["rating"]]
        cap = S["max_increase"]
        target_salary = e["mid"] * S["company_target"] * tgt
        gap = max(0.0, target_salary - e["aligned"])
        raw_inc = 0.0 if tgt == 0 else max(gap, mn * e["aligned"])
        if cap:
            raw_inc = min(raw_inc, cap * e["aligned"])
        if e["aligned"] >= e["max"]:
            raw_inc = 0.0
        if S["clip_at_max"]:
            raw_inc = min(raw_inc, max(0.0, e["max"] - e["aligned"]))
        e["increase"] = raw_inc if e["eligible"] else 0.0
        e["new_base"] = e["aligned"] + e["increase"]
        # target: the same pool % to every eligible person, as a full-cost benchmark
        e["target_inc"] = S["pool_pct"] / 100 * e["aligned"] if e["eligible"] else 0.0
        e["zone"] = max(i for i, z in enumerate(S["zones"]) if e["cr"] >= z) + 1

    # Unexplained gap after merit: the same decomposition, re-run on total cash after the review
    for name, rows in cats.items():
        cat_out[name]["unexplained_after_merit"] = decompose(rows, lambda r: r["new_base"] * (1 + r["bonus"]))[2]

    # Costs
    factor = (13 - eff.month) / 12
    res = {"step1": {}, "step2": {}, "target": {}}
    for tag, base_key, inc_key in (("step1", "base", "uplift_base"), ("step2", "aligned", "increase"),
                                   ("target", "aligned", "target_inc")):
        base_inc = sum(e[inc_key] * e["fte"] for e in emp)
        bonus_inc = sum(e[inc_key] * e["bonus"] * e["fte"] for e in emp)
        contrib = sum(contributions_on(e[base_key] * (1 + e["bonus"]) * e["fte"],
                                       e[inc_key] * (1 + e["bonus"]) * e["fte"], S) for e in emp)
        annual = base_inc + bonus_inc + contrib
        res[tag] = {"base": base_inc, "bonus": bonus_inc, "contrib": contrib,
                    "annual": annual, "in_year": annual * factor}

    pay_before = sum(e["total"] * e["fte"] for e in emp)
    contrib_before = sum(contributions(e["total"] * e["fte"], S) for e in emp)
    payroll = pay_before + contrib_before
    eligible_base = sum(e["aligned"] * e["fte"] for e in emp if e["eligible"])
    merit_pct = res["step2"]["base"] / eligible_base * 100
    cost_annual = res["step1"]["annual"] + res["step2"]["annual"]
    res.update({
        "pay_before": pay_before, "contrib_before": contrib_before,
        "payroll": payroll, "eligible_base": eligible_base,
        "merit_pct": merit_pct, "dev_pp": merit_pct - S["pool_pct"],
        "dev_eur": res["step2"]["annual"] - res["target"]["annual"],
        "dev_eur_in_year": (res["step2"]["annual"] - res["target"]["annual"]) * factor,
        "cost_annual": cost_annual, "cost_in_year": cost_annual * factor,
        "load_full_pct": cost_annual / payroll * 100,
        "load_in_year_pct": cost_annual * factor / payroll * 100,
        "flag_equity_over_max": sum(1 for e in emp if e["equity_over_max"]),
        "below_min_after": sum(1 for e in emp if e["new_base"] < e["min"]),
        "red_circled": sum(1 for e in emp if e["aligned"] >= e["max"]),
        "cats": cat_out, "emp": emp,
    })
    return res


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "demo-data.csv"
    bnd = sys.argv[2] if len(sys.argv) > 2 else "demo-bands.csv"
    r = analyse(load(src), load_bands(bnd))
    for e in r["emp"]:
        print("%s up1=%9.2f aligned=%9.2f CR=%.4f elig=%d inc=%9.2f zone=%d" % (
            e["id"], e["uplift_base"], e["aligned"], e["cr"], e["eligible"], e["increase"], e["zone"]))
    for k, c in r["cats"].items():
        print("%-20s raw=%.3f expl=%.3f unexpl=%.3f un1=%.3f un2=%.3f med=%.2f need=%.2f" % (
            k, c["raw"], c["explained"], c["unexplained"], c["unexplained_after_equity"],
            c["unexplained_after_merit"], c["median"], c["need"]))
    for t in ("step1", "step2", "target"):
        print(t, {k: round(v, 2) for k, v in r[t].items()})
    for k in ("pay_before", "contrib_before", "payroll", "eligible_base", "merit_pct", "dev_pp", "dev_eur", "dev_eur_in_year",
              "cost_annual", "cost_in_year", "load_full_pct", "load_in_year_pct"):
        print("%-18s %.4f" % (k, r[k]))
