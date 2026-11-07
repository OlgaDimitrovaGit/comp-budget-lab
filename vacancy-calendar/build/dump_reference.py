# -*- coding: utf-8 -*-
"""Dumps reference_calc results as JSON for check-engine.mjs.

  python dump_reference.py <positions.csv> <history.csv> [settings.json]

settings.json overrides DEFAULTS keys (as_of as YYYY-MM-DD).
"""
import json, os, sys
from datetime import date
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reference_calc as rc  # noqa: E402

S = dict(rc.DEFAULTS)
if len(sys.argv) > 3:
    for k, v in json.load(open(sys.argv[3], encoding="utf-8")).items():
        S[k] = date.fromisoformat(v) if k == "as_of" else v
R = rc.analyse(rc.load_positions(sys.argv[1]), rc.load_history(sys.argv[2]), S)
keys = ["total_requested", "total_realistic", "gap", "capacity", "moves", "after_moves", "total_after",
        "gap_after", "moved_roles", "moved_months", "next_after", "carry", "new_next", "leavers", "unfilled"]
out = {k: R[k] for k in keys}
out["realistic"] = R["expected"]
out["steps"] = R["steps"]
out["shifts"] = [r["shift"] for r in R["rows"]]
out["depts"] = R["depts"]
out["timing"] = {g: [t["n"], t["lag"], t["ttf"]] for g, t in R["timing"].items()}
json.dump(out, sys.stdout)
