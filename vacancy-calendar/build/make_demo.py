# -*- coding: utf-8 -*-
"""
Writes sample-positions.csv: 240 simulated open roles for the 2027 budget.

Seeded, so every run gives the same file. Simulated data, not real people or
a real company. The requested month is when the manager wants the person
to start. Almost every plain role asks for January, as managers do in
practice, and only a few name a later month; project roles ask for the launch
month, some already have a candidate in the
pipeline, some are marked critical and are never moved.
"""
import csv
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HERE), "sample-positions.csv")
N = int(sys.argv[2]) if len(sys.argv) > 2 else 240
SEED = 20271
LATER_PLAIN = 4  # plain (non-project) roles requested for a month after January

DEPTS = [("Engineering", 0.32), ("Sales", 0.20), ("Operations", 0.18),
         ("Product", 0.12), ("Finance", 0.10), ("People", 0.08)]
GRADES = [("G10", 0.15, 28000, 10), ("G12", 0.25, 36000, 10), ("G14", 0.30, 48000, 15),
          ("G16", 0.20, 65000, 20), ("G18", 0.10, 92000, 30)]
MONTHS = [(1, 0.68), (2, 0.08), (3, 0.08), (4, 0.06), (5, 0.04), (6, 0.03), (7, 0.02), (9, 0.01)]

rnd = random.Random(SEED)


def pick(items, weight=lambda x: x[1]):
    return rnd.choices(items, weights=[weight(x) for x in items])[0]


rows = []
for i in range(1, N + 1):
    dept = pick(DEPTS)[0]
    g, _, base, bonus = pick(GRADES)
    salary = round(base * rnd.uniform(0.9, 1.12) / 500) * 500
    month = pick(MONTHS)[0]
    kind = rnd.random()
    stage = expected = project = ""
    if kind < 0.10:
        stage = rnd.choices(["interview", "offer", "accepted"], weights=[5, 3, 2])[0]
        month = 1
        if stage == "accepted":
            expected = f"2027-{rnd.choice([1, 1, 2, 2, 3]):02d}-{rnd.choice([1, 15, 16]):02d}"
    elif kind < 0.25:
        pm = rnd.choice([3, 4, 5, 6, 6, 7, 9, 10])
        project = f"2027-{pm:02d}-01"
        rnd.choice([1, 2, 3])  # kept so the seeded sequence stays the same
        month = pm  # a project role is requested for the launch month
    critical = "yes" if not stage and rnd.random() < 0.10 else "no"
    rows.append({
        "position_id": f"P{i:04d}", "department": dept, "grade": g,
        "base_salary": salary, "target_bonus_pct": bonus,
        "requested_month": f"2027-{month:02d}", "stage": stage,
        "expected_start": expected, "project_start": project, "critical": critical,
    })

# Managers ask for "everyone from January"; only a few plain roles name a later month.
later = 0
for r in rows:
    if not r["stage"] and not r["project_start"] and r["requested_month"] != "2027-01":
        later += 1
        if later > LATER_PLAIN:
            r["requested_month"] = "2027-01"

with open(OUT, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)
print(f"{len(rows)} roles -> {OUT}")
