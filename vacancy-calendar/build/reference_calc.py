# -*- coding: utf-8 -*-
"""
Reference calculation for the vacancy calendar.

What a list of open roles really costs in the budget year once each role gets a
realistic start date, and which start dates to defer, and by how many months, to meet
the target. The Excel model and the web page must agree with this file to the
cent; check_model.py compares them.

Standard library only.
"""
import csv
import math
import os
import statistics
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SAMPLE_POSITIONS = os.path.join(ROOT, "sample-positions.csv")
SAMPLE_HISTORY = os.path.join(ROOT, "sample-hiring-history.csv")
MODEL = os.path.join(ROOT, "vacancy-calendar-model.xlsx")

# The whole 25-grade scale, so a user's file with any grade finds its row in the timing table.
GRADES = [f"G{n}" for n in range(1, 26)]

# Illustrative default days for the grades the demo uses (as in the 05.11 demo).
ANCHOR_TTF = {10: 35, 12: 45, 14: 55, 16: 70, 18: 90}


def fill_scale(anchors):
    """Days for every grade on the scale: halfway between the nearest anchors, the nearest anchor beyond the ends."""
    keys = sorted(anchors)
    out = {}
    for n in range(1, 26):
        lo = max([k for k in keys if k <= n], default=keys[0])
        hi = min([k for k in keys if k >= n], default=keys[-1])
        v = anchors[lo] if lo == hi else anchors[lo] + (anchors[hi] - anchors[lo]) * (n - lo) / (hi - lo)
        out[f"G{n}"] = math.floor(v + 0.5)  # half up, as everywhere in the model
    return out


DEFAULTS = {
    "budget_year": 2027,
    # The day the plan is made: candidates already in interview or at offer
    # start this many days after it.
    "as_of": date(2026, 12, 15),
    "stage_days": {"interview": 40, "offer": 20},
    # A grade with fewer filled roles than this in the history uses the default timing.
    "min_history": 3,
    # Default timing when the history is too thin: filled for the whole scale from the demo anchors.
    "default_lag": {g: 30 for g in GRADES},
    "default_ttf": fill_scale(ANCHOR_TTF),
    # A role may be moved by at most this many months.
    "max_shift": 3,
    # Budget-year cost of current staff, and the budget-year target for the whole payroll.
    "existing_payroll": 130_000_000.00,
    "target": 137_300_000.00,
    # Current staff who leave: their seat stays empty for a while before a
    # replacement starts, and that saves pay. Illustrative, not a benchmark.
    "attrition": 10.0,       # % of current staff leaving in the budget year
    "vacant_months": 2.0,    # months a leaver's seat stays empty on average
    # Share of open roles without a candidate that are actually filled in the
    # budget year; roles with a candidate in the pipeline count in full. Illustrative.
    "fill_rate": 90.0,
    # Employer contributions: one total rate on pay up to the ceiling (None: no ceiling).
    # Default Spain 2026: 30.65% + AT/EP office-work rate 1.50% (RDL 3/2026, Cuadro II a) = 32.15%,
    # ceiling EUR 5,101.20 a month x 12 (Orden PJC/297/2026); the solidarity charge
    # above the ceiling (about 1%) is left out, so contributions are slightly understated.
    "contrib_rate": 32.15,
    "ceiling": 61214.40,
}


def parse_date(s):
    y, m, d = (int(x) for x in s.strip()[:10].split("-"))
    return date(y, m, d)


def parse_month(s):
    y, m = (int(x) for x in s.strip()[:7].split("-"))
    return date(y, m, 1)


def contributions(pay, S):
    """Employer contributions on annual pay: one total rate on pay up to the ceiling."""
    base = pay if S["ceiling"] is None else min(pay, S["ceiling"])
    return S["contrib_rate"] / 100 * base


def cost_month(d, year):
    """Month in which pay starts counting, numbered from January of the budget year = 1.
    A start after the 15th counts from the next month (the 15th rule)."""
    return (d.year - year) * 12 + d.month + (1 if d.day > 15 else 0)


def months_in(m, k):
    """Paid months in year k of the plan (k = 1 budget year, k = 2 the year after)."""
    return max(0, min(12, 12 * k + 1 - m))


def half_up(x):
    return math.floor(x + 0.5)


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        lines = f.read().splitlines()
    if lines and lines[0].lower().startswith("sep="):
        lines = lines[1:]
    return list(csv.DictReader(lines))


def load_positions(path):
    out = []
    for r in read_csv(path):
        if not (r.get("position_id") or "").strip():
            continue
        out.append({
            "id": r["position_id"].strip(),
            "department": r["department"].strip(),
            "grade": r["grade"].strip().upper(),
            "base": float(r["base_salary"]),
            "bonus_pct": float(r.get("target_bonus_pct") or 0),
            "requested": parse_month(r["requested_month"]),
            "stage": (r.get("stage") or "").strip().lower(),
            "expected_start": parse_date(r["expected_start"]) if (r.get("expected_start") or "").strip() else None,
            "project_start": parse_date(r["project_start"]) if (r.get("project_start") or "").strip() else None,
            "critical": (r.get("critical") or "").strip().lower() in ("yes", "y", "1", "true"),
            # Share of a full-time post: 0.5 costs exactly half a full post, contributions included.
            "fte": float((r.get("fte") or "1").replace(",", ".")),
        })
        if out[-1]["fte"] <= 0:
            raise ValueError(f"{out[-1]['id']}: fte must be above 0")
    return out


def load_history(path):
    return [r for r in read_csv(path) if (r.get("grade") or "").strip()]


def timing(history, S):
    """Request-to-posting and posting-to-start days by grade: history median, or the default if history is thin."""
    out = {}
    for g in GRADES:
        lag = [float(r["request_to_open_days"]) for r in history
               if r["grade"].strip().upper() == g and (r.get("request_to_open_days") or "").strip()]
        ttf = [float(r["open_to_start_days"]) for r in history
               if r["grade"].strip().upper() == g and (r.get("open_to_start_days") or "").strip()]
        n = len(ttf)
        use_hist = n >= S["min_history"]
        out[g] = {
            "n": n,
            "median_lag": statistics.median(lag) if lag else None,
            "median_ttf": statistics.median(ttf) if ttf else None,
            "lag": half_up(statistics.median(lag)) if use_hist and lag else S["default_lag"][g],
            "ttf": half_up(statistics.median(ttf)) if use_hist else S["default_ttf"][g],
        }
    return out


STEPS = ["requested", "approval", "time_to_start", "pipeline", "project", "unfilled", "leavers"]


def analyse(positions, history, S=DEFAULTS):
    Y = S["budget_year"]
    jan1 = date(Y, 1, 1)
    T = timing(history, S)
    rows = []
    for p in positions:
        t = T[p["grade"]]
        pay = p["base"] * (1 + p["bonus_pct"] / 100)
        # FTE scales pay and contributions linearly: 0.5 is half the cost of one full-time person.
        annual = p.get("fte", 1.0) * (pay + contributions(pay, S))
        s0 = p["requested"]
        # The requested month is when the manager wants the person to start. Hiring
        # can begin ahead of it, but not before the budget year opens.
        lag, ttf = (0, 0) if p["stage"] else (t["lag"], t["ttf"])
        s1 = max(s0, jan1 + timedelta(days=lag))
        s2 = max(s0, jan1 + timedelta(days=lag + ttf))
        if p["stage"]:
            if p["stage"] == "accepted":
                s3 = max(jan1, p["expected_start"])
            else:
                s3 = max(jan1, S["as_of"] + timedelta(days=S["stage_days"][p["stage"]]))
        else:
            s3 = s2
        s4 = max(p["project_start"], s3) if p["project_start"] else s3
        starts = [s0, s1, s2, s3, s4]
        m = [cost_month(s, Y) for s in starts]
        rows.append({**p, "pay": pay, "annual": annual, "monthly": annual / 12,
                     "starts": starts, "m": m,
                     "cost": [annual * months_in(x, 1) / 12 for x in m],
                     # Expected share filled: the fill rate for roles without a candidate.
                     "w": 1.0 if p["stage"] else S["fill_rate"] / 100,
                     "eligible": not p["critical"] and not p["stage"] and not p["project_start"]})

    C = [sum(r["cost"][k] for r in rows) for k in range(5)]
    # Expected cost of new hires: each role weighted by the chance it is filled.
    E4 = sum(r["cost"][4] * r["w"] for r in rows)
    unfilled = E4 - C[4]
    leavers = S["existing_payroll"] * S["attrition"] / 100 * S["vacant_months"] / 12
    existing_net = S["existing_payroll"] - leavers
    gap = existing_net + E4 - S["target"]

    # Moves: biggest monthly cost first, ties in file order; each role moved by the
    # fewest whole months that close what is left of the gap, at most max_shift and
    # never past the end of the budget year.
    order = sorted([i for i, r in enumerate(rows) if r["eligible"]], key=lambda i: (-rows[i]["monthly"], i))
    rank = {i: k + 1 for k, i in enumerate(order)}
    cum = 0.0
    for i, r in enumerate(rows):
        r["max_eff"] = min(S["max_shift"], months_in(r["m"][4], 1)) if r["eligible"] else 0
        r["rank"] = rank.get(i)
        r["saving_max"] = r["monthly"] * r["w"] * r["max_eff"]
    for i in order:
        r = rows[i]
        r["cum_before"] = cum
        cum += r["saving_max"]
    for r in rows:
        if r["eligible"] and r["cum_before"] < gap and r["max_eff"] > 0 and r["monthly"] * r["w"] > 0:
            r["shift"] = min(r["max_eff"], math.ceil((gap - r["cum_before"]) / (r["monthly"] * r["w"])))
        else:
            r["shift"] = 0
        r["m5"] = r["m"][4] + r["shift"]
        # Expected figures from here on: cost if filled, times the share filled.
        r["cost5"] = r["w"] * r["annual"] * months_in(r["m5"], 1) / 12
        r["saving"] = r["w"] * r["cost"][4] - r["cost5"]
        r["next4"] = r["w"] * r["annual"] * months_in(r["m"][4], 2) / 12
        r["next5"] = r["w"] * r["annual"] * months_in(r["m5"], 2) / 12

    C5 = sum(r["cost5"] for r in rows)
    moves = C5 - E4
    gap_after = existing_net + C5 - S["target"]
    capacity = sum(r["saving_max"] for r in rows)

    next4 = sum(r["next4"] for r in rows)
    next5 = sum(r["next5"] for r in rows)
    carry = sum(r["w"] * r["annual"] - r["cost5"] for r in rows if r["m5"] <= 12)
    new_next = sum(r["next5"] for r in rows if r["m5"] > 12)

    depts = []
    for d in sorted({r["department"] for r in rows}):
        rs = [r for r in rows if r["department"] == d]
        depts.append({"department": d, "roles": len(rs),
                      "requested": sum(r["cost"][0] for r in rs),
                      "realistic": sum(r["w"] * r["cost"][4] for r in rs),
                      "after_moves": sum(r["cost5"] for r in rs),
                      "moved": sum(1 for r in rs if r["shift"] > 0),
                      "full_year": sum(r["w"] * r["annual"] for r in rs)})

    curve = {name: [sum(r["monthly"] * wt(r) for r in rows if mm(r) <= k) for k in range(1, 13)]
             for name, mm, wt in (("requested", lambda r: r["m"][0], lambda r: 1.0),
                                  ("realistic", lambda r: r["m"][4], lambda r: r["w"]),
                                  ("after_moves", lambda r: r["m5"], lambda r: r["w"]))}

    return {
        "timing": T, "rows": rows,
        "roles": len(rows), "full_year": sum(r["w"] * r["annual"] for r in rows),
        "cost": C, "steps": [C[0]] + [C[k] - C[k - 1] for k in range(1, 5)] + [unfilled, -leavers],
        "existing": S["existing_payroll"], "target": S["target"],
        "leavers": leavers, "unfilled": unfilled, "expected": E4,
        "total_requested": S["existing_payroll"] + C[0],
        "total_realistic": existing_net + E4,
        "gap": gap, "capacity": capacity, "moves": moves, "after_moves": C5,
        "total_after": existing_net + C5, "gap_after": gap_after,
        "moved_roles": sum(1 for r in rows if r["shift"] > 0),
        "moved_months": sum(r["shift"] for r in rows),
        "next_realistic": next4, "next_after": next5, "carry": carry, "new_next": new_next,
        "depts": depts, "curve": curve,
    }


if __name__ == "__main__":
    import sys
    R = analyse(load_positions(sys.argv[1] if len(sys.argv) > 1 else SAMPLE_POSITIONS),
                load_history(sys.argv[2] if len(sys.argv) > 2 else SAMPLE_HISTORY))
    for g, t in R["timing"].items():
        print(f"{g}: n={t['n']} lag={t['lag']} ttf={t['ttf']}  (median {t['median_lag']}, {t['median_ttf']})")
    print(f"roles {R['roles']}, full-year cost {R['full_year']:,.2f}")
    for name, v in zip(STEPS, R["steps"]):
        print(f"  {name:14s} {v:16,.2f}")
    print(f"  expected new   {R['expected']:16,.2f}")
    print(f"existing {R['existing']:,.2f}  target {R['target']:,.2f}")
    print(f"total requested {R['total_requested']:,.2f}  realistic {R['total_realistic']:,.2f}  gap {R['gap']:,.2f}")
    print(f"moves {R['moves']:,.2f} on {R['moved_roles']} roles, {R['moved_months']} months; capacity {R['capacity']:,.2f}; gap after {R['gap_after']:,.2f}")
    print(f"next year: realistic {R['next_realistic']:,.2f}  after moves {R['next_after']:,.2f}  = {R['after_moves']:,.2f} + carry {R['carry']:,.2f} + new {R['new_next']:,.2f}")
    for d in R["depts"]:
        print("  ", d)
