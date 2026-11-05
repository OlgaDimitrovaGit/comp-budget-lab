"""Generate the three demo hiring exports in demo/.

The data is simulated and seeded, so every run writes the same files.
Time to start by grade (35/45/55/70/90 days) and the one-month request lag
are illustrative, not market figures.
"""
import csv
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).parent / "demo"
TTF_BY_GRADE = {1: 35, 2: 45, 3: 55, 4: 70, 5: 90}
DEPARTMENTS = ["Engineering", "Sales", "Finance", "Operations"]

rng = random.Random(2026)
requests, ats, hris = [], [], []
employee = 5000

for n in range(1, 41):
    grade = rng.choice([1, 2, 2, 3, 3, 3, 4, 4, 5])
    requested = date(2025, 1, 6) + timedelta(days=rng.randint(0, 300))
    # The manager log is a hand-kept Excel sheet: grade written three ways.
    grade_text = rng.choice([f"G{grade}", str(grade), f"Grade {grade}"])
    requests.append([str(n), requested.strftime("%d.%m.%Y"), grade_text, rng.choice(DEPARTMENTS)])
    if n in (7, 23):  # cancelled before the vacancy was posted
        continue
    posted = requested + timedelta(days=30 + rng.randint(-10, 10))
    ttf = TTF_BY_GRADE[grade]
    started = posted + timedelta(days=ttf + rng.randint(-ttf // 4, ttf // 4))
    filled = n not in (12, 31, 36, 40)  # still open at export
    # The ATS keeps one row per candidate, not per requisition.
    for c in range(rng.randint(2, 5)):
        ats.append([f"REQ-{n:04d}", f"{posted.isoformat()}T09:{c:02d}:00Z", f"C-{n * 10 + c}", "rejected"])
    if filled:
        ats.append([f"REQ-{n:04d}", f"{posted.isoformat()}T09:30:00Z", f"C-{n * 10 + 9}", "hired"])
        employee += 1
        row = [f"E-{employee}", rng.choice([f"req{n:04d} ", f"REQ{n:04d}"]), started.strftime("%m/%d/%Y"), "New hire"]
        hris.append(row)
        if n % 7 == 0:  # the HR system export repeats some records
            hris.append(row)

for _ in range(3):  # internal moves and direct hires: no requisition
    employee += 1
    hris.append([f"E-{employee}", "", (date(2025, 3, 1) + timedelta(days=rng.randint(0, 200))).strftime("%m/%d/%Y"), "Transfer"])

OUT.mkdir(exist_ok=True)
for name, sep, header, rows in [
    ("requests.csv", ";", ["Request No", "Requested on", "Grade", "Department"], requests),
    ("ats.csv", ",", ["requisition_id", "posted_at", "candidate_id", "stage"], ats),
    ("hris.csv", ",", ["Employee ID", "Position Ref", "Hire Date", "Record Type"], hris),
]:
    with open(OUT / name, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=sep)
        w.writerow(header)
        w.writerows(rows)
    print(f"{name}: {len(rows)} rows")
