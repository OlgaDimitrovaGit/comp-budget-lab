# -*- coding: utf-8 -*-
"""
Независимый эталон: портирование calc.js на Python.

Нужен, чтобы проверять Excel-модель не «на глаз», а сверкой с числами.
Логика повторяет build/calc.js буквально; расхождение эталона с Excel
означает ошибку в формулах, расхождение эталона с калькулятором —
ошибку портирования.
"""
import csv
import statistics
import sys

DEFAULTS = {
    "threshold_pct": 5,
    "implementation_month": 7,
    "rate_below": 31.5,
    "rate_above": 1.15,
    "ceiling": 61214,
}
EPS = 1e-9


def load(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
    out = []
    for i, r in enumerate(rows):
        fte = float(r["fte"]) if r.get("fte") else 1.0
        mw = float(r["months_worked"]) if r.get("months_worked") else 12.0
        factor = fte * (mw / 12)
        base = float(r["base_salary"])
        var = float(r["variable_pay"])
        out.append({
            "idx": i,
            "id": r["id"],
            "category": r["category"].strip(),
            "gender": "F" if r["gender"].strip().upper() == "F" else "M",
            "grade": float(r["grade"]),
            "tenure": float(r["tenure_years"]),
            "factor": factor,
            "actual_base": base,
            "actual_var": var,
            "n_base": base / factor,
            "n_var": var / factor,
            "n_total": (base + var) / factor,
        })
    return out


def regress(rows):
    """OLS n_total ~ grade + tenure. Возвращает (coef_grade, coef_tenure, r2, ok)."""
    n = len(rows)
    if n < 4:
        return 0.0, 0.0, None, False
    g = [r["grade"] for r in rows]
    t = [r["tenure"] for r in rows]
    y = [r["n_total"] for r in rows]

    def varp(a):
        m = sum(a) / len(a)
        return sum((x - m) ** 2 for x in a) / len(a)

    if varp(g) < EPS or varp(t) < EPS:
        return 0.0, 0.0, None, False

    Sg, St, Sy = sum(g), sum(t), sum(y)
    Sgg = sum(x * x for x in g)
    Stt = sum(x * x for x in t)
    Sgt = sum(g[i] * t[i] for i in range(n))
    Sgy = sum(g[i] * y[i] for i in range(n))
    Sty = sum(t[i] * y[i] for i in range(n))
    Syy = sum(x * x for x in y)

    cgg = Sgg - Sg * Sg / n
    ctt = Stt - St * St / n
    cgt = Sgt - Sg * St / n
    cgy = Sgy - Sg * Sy / n
    cty = Sty - St * Sy / n
    cyy = Syy - Sy * Sy / n

    det = cgg * ctt - cgt * cgt
    if abs(det) < EPS:
        return 0.0, 0.0, None, False

    bg = (cgy * ctt - cty * cgt) / det
    bt = (cty * cgg - cgy * cgt) / det
    r2 = None if cyy < EPS else (bg * cgy + bt * cty) / cyy
    return bg, bt, r2, True


def contributions_on(base_before, uplift, S):
    if uplift <= 0:
        return 0.0
    room = max(0.0, S["ceiling"] - base_before)
    below = min(uplift, room)
    above = uplift - below
    return S["rate_below"] / 100 * below + S["rate_above"] / 100 * above


def analyse(emp, S=None):
    S = dict(DEFAULTS, **(S or {}))
    order, by = [], {}
    for e in emp:
        if e["category"] not in by:
            by[e["category"]] = []
            order.append(e["category"])
        by[e["category"]].append(e)

    cats = []
    acc = {"min": [0.0, 0.0], "full": [0.0, 0.0]}

    for name in order:
        rows = by[name]
        f = [r for r in rows if r["gender"] == "F"]
        m = [r for r in rows if r["gender"] == "M"]
        mean = lambda a: (sum(a) / len(a)) if a else 0.0
        mean_m = mean([r["n_total"] for r in m])
        mean_f = mean([r["n_total"] for r in f])
        med_all = statistics.median([r["n_total"] for r in rows]) if rows else 0.0

        raw = ((mean_m - mean_f) / mean_m * 100) if (mean_m > 0 and f and m) else 0.0

        bg, bt, r2, ok = regress(rows)
        expl = 0.0
        if ok and f and m:
            dg = mean([r["grade"] for r in m]) - mean([r["grade"] for r in f])
            dt = mean([r["tenure"] for r in m]) - mean([r["tenure"] for r in f])
            expl = (bg * dg + bt * dt) / mean_m * 100 if mean_m > 0 else 0.0
        expl = max(0.0, min(expl, raw)) if raw >= 0 else min(0.0, max(expl, raw))
        unexpl = raw - expl

        row = {"category": name, "n": len(rows), "nF": len(f), "nM": len(m),
               "mean_m": mean_m, "mean_f": mean_f, "median_all": med_all,
               "raw": raw, "coef_g": bg, "coef_t": bt, "r2": r2, "reg_ok": ok,
               "explained": expl, "unexplained": unexpl}

        for tag, target in (("min", S["threshold_pct"]), ("full", 0.0)):
            adj = con = 0.0
            recip = 0
            if raw >= 0 and unexpl > target + 1e-12:
                under = [r for r in f if r["n_total"] < med_all]
                deficits = [med_all - r["n_total"] for r in under]
                td = sum(deficits)
                if under and td > 0:
                    need = (unexpl - target) / 100 * mean_m * len(f)
                    for r, d in zip(under, deficits):
                        up_norm = need * (d / td)
                        up_act = up_norm * r["factor"]
                        adj += up_act
                        con += contributions_on(r["actual_base"], up_act, S)
                    recip = len(under)
            row[tag] = {"adjustment": adj, "contributions": con,
                        "cost": adj + con, "recipients": recip}
            acc[tag][0] += adj
            acc[tag][1] += con
        cats.append(row)

    payroll = sum(r["actual_base"] + r["actual_var"] for r in emp)
    totals = {}
    for tag in ("min", "full"):
        a, c = acc[tag]
        totals[tag] = {"adjustment": a, "contributions": c, "total": a + c,
                       "pct": (a + c) / payroll * 100 if payroll else 0.0}
    return {"categories": cats, "payroll": payroll, "totals": totals,
            "headcount": len(emp)}


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "build/sample.csv"
    res = analyse(load(src))
    print("Численность: %d   ФОТ: %.2f" % (res["headcount"], res["payroll"]))
    print()
    for c in res["categories"]:
        print("%-18s n=%d (F%d/M%d) med=%10.2f raw=%7.3f%% expl=%7.3f%% unexpl=%7.3f%% "
              "reg_ok=%s cg=%9.2f ct=%9.2f r2=%s" % (
                  c["category"], c["n"], c["nF"], c["nM"], c["median_all"],
                  c["raw"], c["explained"], c["unexplained"], int(c["reg_ok"]),
                  c["coef_g"], c["coef_t"],
                  ("%.4f" % c["r2"]) if c["r2"] is not None else "-"))
        for tag in ("min", "full"):
            s = c[tag]
            print("      %-5s adj=%10.2f contrib=%9.2f cost=%10.2f recip=%d" % (
                tag, s["adjustment"], s["contributions"], s["cost"], s["recipients"]))
    print()
    for tag in ("min", "full"):
        t = res["totals"][tag]
        print("ИТОГО %-5s adj=%10.2f contrib=%9.2f total=%10.2f (%.3f%% к фонду)" % (
            tag, t["adjustment"], t["contributions"], t["total"], t["pct"]))
