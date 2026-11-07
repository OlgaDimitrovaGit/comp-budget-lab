# -*- coding: utf-8 -*-
"""
Builds vacancy-calendar-model.xlsx from a CSV of open roles and a hiring history.

Every figure is a live formula. The Plan sheet runs left to right in numbered
steps, one simple operation per column; rows 1-4 carry the step, a note, a spare
row and the column header. Yellow cells are inputs.

    python build_model.py [positions.csv] [hiring-history.csv] [out.xlsx]
"""
import os
import sys

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName

from reference_calc import (DEFAULTS, GRADES, MODEL, SAMPLE_HISTORY, SAMPLE_POSITIONS,
                            load_history, load_positions)

SRC = sys.argv[1] if len(sys.argv) > 1 else SAMPLE_POSITIONS
HIST = sys.argv[2] if len(sys.argv) > 2 else SAMPLE_HISTORY
OUT = sys.argv[3] if len(sys.argv) > 3 else MODEL

INPUT = PatternFill("solid", fgColor="FFF4CC")
STEP = PatternFill("solid", fgColor="DCE6F0")
TOTAL = PatternFill("solid", fgColor="EAF1E4")
BOLD = Font(bold=True)
RU = Font(italic=True, color="7F7F7F")
WRAP = Alignment(wrap_text=True, vertical="top")
EUR = '#,##0.00 "€"'
EUR0 = '#,##0 "€"'
DATE = "yyyy-mm-dd"
MONTH = "mmm yyyy"

positions = load_positions(SRC)
history = load_history(HIST)
S = DEFAULTS
CAP = max(1000, len(positions))
CAPH = max(300, len(history))
wb = Workbook()


def name(n, ref):
    wb.defined_names[n] = DefinedName(n, attr_text=ref)


RU_NOTES = os.environ.get("NOTES") == "ru"


def note2(ws, r, c, text, wrap=True):
    if text and RU_NOTES:
        cell = ws.cell(r, c, text)
        cell.font = RU
        if wrap:
            cell.alignment = WRAP


# ---------------------------------------------------------------- Inputs
ws = wb.active
ws.title = "Inputs"
ws["A1"] = "Inputs: change the yellow cells"
ws["A1"].font = Font(bold=True, size=13)
ws.append([])
ws.append(["Setting", "Value", "Note"])
note2(ws, 3, 4, "", wrap=False)
for c in ws[3]:
    c.font = BOLD

settings = [
    ("BudgetYear", "Budget year", S["budget_year"], "0", True,
     "The year the hiring budget is for.", ""),
    ("YearStart", "First day of the budget year", "=DATE(BudgetYear,1,1)", DATE, False,
     "No one starts before this day in the plan.", ""),
    ("AsOf", "Plan date", S["as_of"], DATE, True,
     "The day the plan is made. Candidates already in interview or at offer count from it.",
     ""),
    ("DaysInterview", "Days to start: candidate in interview", S["stage_days"]["interview"], "0", True,
     "From the plan date to the first day of work, for a role whose candidate is in interview.",
     ""),
    ("DaysOffer", "Days to start: offer made", S["stage_days"]["offer"], "0", True,
     "From the plan date to the first day of work, for a role with an offer out. An accepted offer uses its own start date.",
     ""),
    ("MinHistory", "Min. filled roles per grade in History", S["min_history"], "0", True,
     "A grade with fewer filled roles in the History sheet uses the default days in the table below.",
     ""),
    ("MaxShift", "Most months a start can be deferred", S["max_shift"], '0 "mo"', True,
     "Never deferred: critical roles, roles with a candidate in the pipeline, roles tied to a project launch.",
     ""),
    ("ExistingPayroll", "Budget-year cost of current staff", S["existing_payroll"], EUR, True,
     "Full cost of the people already employed, including employer contributions, for the whole budget year, "
     "from your payroll forecast. Demo value: simulated.",
     ""
     ""),
    ("Target", "Budget-year target: total payroll cost", S["target"], EUR, True,
     "The approved target for current staff plus new hires, including employer contributions. Demo value: simulated.",
     ""
     ""),
    ("Attrition", "Current staff leaving in the budget year, %", S["attrition"] / 100, "0.0%", True,
     "Share of current staff expected to leave during the year. Illustrative: use your own attrition history.",
     ""),
    ("VacantMonths", "Months a leaver's seat stays empty", S["vacant_months"], '0.0 "mo"', True,
     "On average, before the replacement starts. The empty months save pay on current staff. Illustrative.",
     ""),
    ("FillRate", "Open roles filled in the budget year, %", S["fill_rate"] / 100, "0%", True,
     "Share of roles without a candidate that actually start in the budget year. Roles with a candidate in the "
     "pipeline count in full. A role not filled this year has to be approved again for the next. Illustrative: "
     "use your own history.",
     ""
     ""
     ""),
    ("ContribRate", "Employer contributions, % of pay: one total rate", S["contrib_rate"] / 100, "0.00%", True,
     "Replace with your own country's total employer rate. Default: Spain 2026, 30.65% (permanent contracts) "
     "+ AT/EP premium (accidentes de trabajo y enfermedades profesionales: work accidents and occupational "
     "diseases), office-work rate 1.50% (RDL 3/2026, Cuadro II a) = 32.15%. "
     "The model uses 2026 rates for 2027. The 2027 rates are slightly higher, so contributions come out slightly understated.",
     ""
     ""
     ""
     ""),
    ("Ceiling", "Annual pay ceiling for contributions (empty: none)", S["ceiling"], EUR, True,
     "No contributions on pay above this. Leave empty if your country has no ceiling. Default: Spain 2026, "
     "€5,101.20 a month × 12 (Orden PJC/297/2026). The model leaves out the small solidarity contribution "
     "on pay above it (about 1%).",
     ""
     ""),
]
for i, (n, label, val, fmt, is_input, en, ru) in enumerate(settings):
    r = 4 + i
    ws.cell(r, 1, label)
    c = ws.cell(r, 2, val)
    c.number_format = fmt
    if is_input:
        c.fill = INPUT
    ws.cell(r, 3, en).alignment = WRAP
    note2(ws, r, 4, ru)
    name(n, f"Inputs!$B${r}")

# Timing by grade: medians from the History sheet, defaults where the history is thin.
GT = 4 + len(settings) + 2
ws.cell(GT - 1, 1, "Days to start by grade").font = BOLD
note2(ws, GT - 1, 4, "", wrap=False)
heads = ["Grade", "Default: request to posting, days", "Default: posting to start, days",
         "Filled roles in history", "History median: request to posting", "History median: posting to start",
         "Used: request to posting, days", "Used: posting to start, days"]
for j, h in enumerate(heads):
    c = ws.cell(GT, 1 + j, h)
    c.font = BOLD
    c.alignment = WRAP
HG, HL, HT = (f"History!${L}$2:${L}${CAPH + 1}" for L in "BGH")
for k, g in enumerate(GRADES):
    r = GT + 1 + k
    ws.cell(r, 1, g).fill = INPUT  # rename to your own grades if your scale differs
    for j, v in ((2, S["default_lag"][g]), (3, S["default_ttf"][g])):
        ws.cell(r, j, v).fill = INPUT
    ws.cell(r, 4, f'=COUNTIFS({HG},A{r},{HT},"<>")')
    # _xlfn. marks functions newer than Excel 2007 in the file format; without it Excel shows #NAME?.
    ws.cell(r, 5, f'=IF(COUNTIFS({HG},A{r},{HL},"<>")=0,"",_xlfn.AGGREGATE(17,6,{HL}/(({HG}=A{r})*({HL}<>"")),2))')
    ws.cell(r, 6, f'=IF(D{r}=0,"",_xlfn.AGGREGATE(17,6,{HT}/(({HG}=A{r})*({HT}<>"")),2))')
    ws.cell(r, 7, f'=IF(AND(D{r}>=MinHistory,E{r}<>""),ROUND(E{r},0),B{r})')
    ws.cell(r, 8, f'=IF(D{r}>=MinHistory,ROUND(F{r},0),C{r})')
    for j in (5, 6):
        ws.cell(r, j).number_format = "0.0"
name("GradeList", f"Inputs!$A${GT + 1}:$A${GT + len(GRADES)}")
name("UsedLag", f"Inputs!$G${GT + 1}:$G${GT + len(GRADES)}")
name("UsedTTF", f"Inputs!$H${GT + 1}:$H${GT + len(GRADES)}")
ws.cell(GT + len(GRADES) + 1, 1,
        "Medians come from the History sheet (the merged.csv the hiring exports script writes). "
        "Posting to start runs to the first day of work, not to the accepted offer, because pay starts on day one. "
        "The table covers the full 25-grade scale. Default days are illustrative: set for the demo grades G10-G18, "
        "halfway between the neighbours for odd grades, same as the nearest demo grade below G10 and above G18. "
        "Grades are yellow: rename them if your scale differs. A grade missing from the table shows #N/A on Plan.").alignment = WRAP
note2(ws, GT + len(GRADES) + 2, 1,
      ""
      ""
      ""
      ""
      "")
ws.column_dimensions["A"].width = 44
ws.column_dimensions["B"].width = 18
ws.column_dimensions["C"].width = 70
ws.column_dimensions["D"].width = 60
for col in "EFGH":
    ws.column_dimensions[col].width = 16

# ---------------------------------------------------------------- History
wh = wb.create_sheet("History")
hcols = ["requisition", "grade", "department", "requested", "opened", "started",
         "request_to_open_days", "open_to_start_days"]
wh.append(hcols)
for c in wh[1]:
    c.font = BOLD
for r in history:
    vals = []
    for k in hcols:
        v = (r.get(k) or "").strip()
        if k.endswith("_days") or k == "requisition":
            v = float(v) if v else None
        vals.append(v)
    wh.append(vals)
for col in "ABCDEFGH":
    wh.column_dimensions[col].width = 16
wh.freeze_panes = "A2"

# ---------------------------------------------------------------- Plan
CONTRIB = 'ContribRate*IF(Ceiling="",{x},MIN({x},Ceiling))'
CM = "(YEAR({d})-BudgetYear)*12+MONTH({d})+(DAY({d})>15)"
IN1 = "MAX(0,MIN(12,13-{m}))"
IN2 = "MAX(0,MIN(12,25-{m}))"

INPUT_COLS = [
    ("id", "position_id", None, "Role ID.", ""),
    ("dept", "department", None, "Department.", ""),
    ("grade", "grade", None, "Company grade, as in the timing table on Inputs. Demo: a 25-grade scale, only even grades used, from G10 (junior specialist) to G18 (head of function).", ""),
    ("base", "base_salary", EUR0, "Annual base pay.", ""),
    ("bonus", "target_bonus_pct", "0.0", "Target bonus, % of base.", ""),
    ("req", "requested_month", MONTH, "The month the manager asked for (1st of the month).",
     ""),
    ("stage", "stage", None, "Empty, or interview / offer / accepted if a candidate is already in the pipeline.",
     ""),
    ("exp", "expected_start", DATE, "For an accepted offer: the agreed first day.", ""),
    ("proj", "project_start", DATE, "For a role tied to a project: the launch date. The role does not start before it.",
     ""),
    ("crit", "critical", None, "yes: never deferred.", ""),
]

CALC = [
    ("Step 1. Full annual cost", [
        ("pay", "Annual pay (base + target bonus)", EUR, "={base}*(1+{bonus}/100)",
         "Base plus target bonus.", ""),
        ("con", "Employer contributions", EUR, "=" + CONTRIB.format(x="{pay}"),
         "One total rate on pay up to the ceiling (Inputs).", ""),
        ("ann", "Full annual cost", EUR, "={pay}+{con}", "What the role costs for a full year.", ""),
        ("mon", "Monthly cost", EUR, "={ann}/12", "Full annual cost ÷ 12.", ""),
    ]),
    ("Step 2. Days by grade", [
        ("lag", "Request to posting, days", "0", '=IF({stage}<>"",0,INDEX(UsedLag,MATCH({grade},GradeList,0)))',
         "From the timing table on Inputs. 0 if a candidate is already in the pipeline.",
         ""),
        ("ttf", "Posting to start, days", "0", '=IF({stage}<>"",0,INDEX(UsedTTF,MATCH({grade},GradeList,0)))',
         "Same table.", ""),
    ]),
    ("Step 3. Start date, one effect at a time", [
        ("s0", "As requested", DATE, "={req}", "The month the manager wants the person to start.",
         ""),
        ("s1", "+ approval", DATE, "=MAX({s0},YearStart+{lag})",
         "Hiring may start ahead of the requested month, but not before the year opens: no earlier than 1 January plus days to approve.",
         ""),
        ("s2", "+ time to start", DATE, "=MAX({s0},YearStart+{lag}+{ttf})",
         "No earlier than 1 January plus days to approve and to the first day of work.",
         ""),
        ("s3", "+ pipeline stage", DATE,
         '=IF({stage}="",{s2},IF({stage}="accepted",MAX(YearStart,{exp}),MAX(YearStart,AsOf+IF({stage}="interview",DaysInterview,DaysOffer))))',
         "A candidate already in the pipeline: plan date plus the days for the stage, or the agreed date.",
         ""),
        ("s4", "+ project launch = realistic start", DATE, '=IF({proj}="",{s3},MAX({proj},{s3}))',
         "Not before the project launches.", ""),
    ]),
    ("Step 4. Month pay counts from", [
        (f"m{k}", h, "0", "=" + CM.format(d="{s%d}" % k),
         "Month 1 = January of the budget year. Starting after the 15th counts from the next month." if k == 0 else "",
         "" if k == 0 else "")
        for k, h in enumerate(["As requested", "+ approval", "+ time to start", "+ pipeline", "Realistic"])
    ]),
    ("Step 5. Cost in the budget year", [
        (f"c{k}", h, EUR, "={ann}*" + IN1.format(m="{m%d}" % k) + "/12",
         "Full annual cost × paid months in the budget year ÷ 12." if k == 0 else "",
         "" if k == 0 else "")
        for k, h in enumerate(["As requested", "+ approval", "+ time to start", "+ pipeline", "Realistic"])
    ] + [
        ("w", "Share expected to be filled", "0%", '=IF({stage}<>"",1,FillRate)',
         "1 if a candidate is in the pipeline; otherwise the fill rate on Inputs.",
         ""),
        ("e4", "Realistic forecast", EUR, "={c4}*{w}",
         "Realistic cost × share expected to be filled. From here on every figure is weighted by this share.",
         ""),
        ("mw", "Monthly cost × share filled", EUR, "={mon}*{w}", "For the monthly curve on Summary.",
         ""),
        ("aw", "Full annual cost × share filled", EUR, "={ann}*{w}", "Full-year cost, weighted.",
         ""),
    ]),
    ("Step 6. Deferrals to meet the target", [
        ("elig", "Can be deferred (1/0)", "0",
         '=IF(AND(NOT(OR(LOWER({crit}&"")={{"yes","y","1","true"}})),{stage}="",{proj}=""),1,0)',
         "Not critical, no candidate in the pipeline, not tied to a project.",
         ""),
        ("maxe", "Months it may be deferred", "0", "=IF({elig}=1,MIN(MaxShift," + IN1.format(m="{m4}") + "),0)",
         "The most months on Inputs, and no more than the months left in the budget year: "
         "a role deferred into next year saves nothing more.",
         ""
         ""),
        ("savx", "Most it can save", EUR, "={mon}*{w}*{maxe}",
         "Monthly cost × share expected to be filled × months it may be deferred.",
         ""),
        ("key", "Order key", EUR, "=IF({elig}=1,{mon},-1)", "Monthly cost; -1 for roles that cannot be deferred.",
         ""),
        ("rank", "Order", "0", "=_xlfn.RANK.EQ({key},{R_key})+COUNTIF({A_key},{key})",
         "Most expensive first, so fewer people are deferred for the same saving. Ties in file order.",
         ""),
        ("cum", "Saved by roles before it", EUR, '=SUMIFS({R_savx},{R_rank},"<"&{rank})',
         "What the roles earlier in the order save if each is deferred as far as it may.",
         ""),
        ("shift", "Defer by, months", "0", "=IF(AND({elig}=1,{maxe}>0,{cum}<GapToClose,{mon}*{w}>0),MIN({maxe},ROUNDUP((GapToClose-{cum})/({mon}*{w}),0)),0)",
         "The fewest whole months that close what is left of the gap, up to the role's limit.",
         ""),
        ("m5", "Month pay counts from, after deferrals", "0", "={m4}+{shift}", "", ""),
        ("c5", "Cost in the budget year, after deferrals", EUR, "={w}*{ann}*" + IN1.format(m="{m5}") + "/12",
         "Weighted by the share expected to be filled.", ""),
        ("sav", "Effect of the deferral (- saves)", EUR, "={c5}-{e4}",
         "Cost after the deferral minus the realistic forecast: minus is a saving.",
         ""),
    ]),
    ("Step 7. The year after", [
        ("n4", "Next year, realistic", EUR, "={w}*{ann}*" + IN2.format(m="{m4}") + "/12",
         "Cost in the following year: share filled × full annual cost × paid months ÷ 12. A role that starts in the "
         "budget year is paid all 12.",
         ""
         ""),
        ("n5", "Next year, after deferrals", EUR, "={w}*{ann}*" + IN2.format(m="{m5}") + "/12", "", ""),
        ("p4", "Pay from, realistic", MONTH, "=DATE(BudgetYear,{m4},1)", "First paid month.", ""),
        ("p5", "Pay from, after deferrals", MONTH, "=DATE(BudgetYear,{m5},1)", "", ""),
    ]),
]

wp = wb.create_sheet("Plan", 1)
DATA0 = 5
col_of = {}
for j, (key, *_rest) in enumerate(INPUT_COLS):
    col_of[key] = get_column_letter(1 + j)
ci = len(INPUT_COLS) + 1
for _step, items in CALC:
    for key, *_rest in items:
        col_of[key] = get_column_letter(ci)
        ci += 1
LAST = DATA0 + CAP - 1

wp.cell(1, 1, "Your roles: paste over the yellow columns").font = BOLD
for j, (key, header, fmt, en, ru) in enumerate(INPUT_COLS):
    c = 1 + j
    wp.cell(1, c).fill = INPUT
    wp.cell(2, c, en).alignment = WRAP
    note2(wp, 3, c, ru)
    wp.cell(4, c, header).font = BOLD
    for i in range(CAP):
        cell = wp.cell(DATA0 + i, c)
        cell.fill = INPUT
        if fmt:
            cell.number_format = fmt
    wp.column_dimensions[get_column_letter(c)].width = 13
for i, p in enumerate(positions):
    r = DATA0 + i
    vals = [p["id"], p["department"], p["grade"], p["base"], p["bonus_pct"], p["requested"], p["stage"] or None,
            p["expected_start"], p["project_start"], "yes" if p["critical"] else "no"]
    for j, v in enumerate(vals):
        if v is not None:
            wp.cell(r, 1 + j, v)

# Dropdowns for stage and critical, so a typo cannot slip in by hand.
for key, choices in (("stage", "interview,offer,accepted"), ("crit", "yes,no")):
    dv = DataValidation(type="list", formula1=f'"{choices}"', allow_blank=True, showErrorMessage=True,
                        errorTitle="Pick from the list", error=f"Allowed: {choices.replace(',', ', ')}.")
    dv.add(f"{col_of[key]}{DATA0}:{col_of[key]}{LAST}")
    wp.add_data_validation(dv)

ci = len(INPUT_COLS) + 1
for step, items in CALC:
    first = True
    for key, header, fmt, tmpl, en, ru in items:
        if first:
            wp.cell(1, ci, step).font = BOLD
            first = False
        wp.cell(1, ci).fill = STEP
        wp.cell(2, ci, en).alignment = WRAP
        note2(wp, 3, ci, ru)
        wp.cell(4, ci, header).font = BOLD
        wp.cell(4, ci).alignment = WRAP
        tmpl = '=IF({id}="","",' + tmpl[1:] + ")"
        for i in range(CAP):
            r = DATA0 + i
            refs = {k: f"{v}{r}" for k, v in col_of.items()}
            refs.update({"R_" + k: f"${v}${DATA0}:${v}${LAST}" for k, v in col_of.items()})
            refs.update({"A_" + k: f"${v}${DATA0 - 1}:{v}{r - 1}" for k, v in col_of.items()})
            c = wp.cell(r, ci, tmpl.format(**refs))
            if fmt:
                c.number_format = fmt
        wp.column_dimensions[get_column_letter(ci)].width = 14
        ci += 1
wp.row_dimensions[2].height = 90
wp.row_dimensions[3].height = 90 if RU_NOTES else 6
wp.row_dimensions[4].height = 45
wp.freeze_panes = "B5"


def P(key):
    return f"Plan!${col_of[key]}${DATA0}:${col_of[key]}${LAST}"


# ---------------------------------------------------------------- Summary
wsum = wb.create_sheet("Summary", 0)
wsum["A1"] = "Vacancy calendar: what the open roles cost in the budget year"
wsum["A1"].font = Font(bold=True, size=13)
wsum["A2"] = "Simulated data. Every figure is a live formula over the Plan sheet."
note2(wsum, 2, 3, "", wrap=False)
srow = [4]


def section(title, ru):
    r = srow[0]
    wsum.cell(r, 1, title).font = BOLD
    wsum.cell(r, 1).fill = STEP
    wsum.cell(r, 2).fill = STEP
    note2(wsum, r, 3, ru, wrap=False)
    srow[0] += 1


def line(label, formula, fmt=EUR, ru="", nm=None, total=False):
    r = srow[0]
    wsum.cell(r, 1, label)
    c = wsum.cell(r, 2, formula)
    c.number_format = fmt
    if total:
        wsum.cell(r, 1).font = BOLD
        c.font = BOLD
        c.fill = TOTAL
    note2(wsum, r, 3, ru)
    if nm:
        name(nm, f"Summary!$B${r}")
    srow[0] += 1
    return r


section("BUDGET YEAR: COST OF NEW HIRES, ONE EFFECT AT A TIME", "")
line("Roles in the plan", f'=COUNTIF({P("id")},"?*")', "0", "")
r = line("Full-year cost of all roles (if everyone worked 12 months)", f"=SUM({P('aw')})", EUR,
         ""
         "", nm="FullYear")
wsum.cell(r, 1).font = RU  # reference figure, not a step of the bridge: grey italic
wsum.cell(r, 2).font = RU
line("Hiring budget within the target", "=Target-ExistingPayroll", EUR,
     "", total=True)
line("New hires, start dates as managers requested", f"=SUM({P('c0')})", EUR, "", nm="CostRequested", total=True)
SIGNED = []  # deviation rows: plus = cost goes up / over target (red), minus = saving (green, bold)
SIGNED.append(line("   approval and posting", f"=SUM({P('c1')})-SUM({P('c0')})", EUR,
                   ""))
SIGNED.append(line("   time to start, by grade", f"=SUM({P('c2')})-SUM({P('c1')})", EUR, ""))
SIGNED.append(line("   candidate already in the pipeline", f"=SUM({P('c3')})-SUM({P('c2')})", EUR, ""))
SIGNED.append(line("   tied to a project launch", f"=SUM({P('c4')})-SUM({P('c3')})", EUR, ""))
line("New hires, realistic start dates", f"=SUM({P('c4')})", EUR, "", nm="CostRealistic", total=True)
SIGNED.append(line("   roles not filled in the budget year", f"=SUM({P('e4')})-SUM({P('c4')})", EUR,
                   ""))
line("New hires, realistic forecast", f"=SUM({P('e4')})", EUR,
     "", nm="CostExpected", total=True)
SIGNED.append(line("   deferrals of roles that can wait, to meet the target", f"=SUM({P('c5')})-SUM({P('e4')})", EUR,
                   ""))
line("New hires, new start dates after deferrals", f"=SUM({P('c5')})", EUR, "", nm="CostAfterMoves", total=True)
srow[0] += 1

section("BUDGET YEAR: TOTAL PAYROLL AND THE TARGET", "")
line("Payroll of current staff", "=ExistingPayroll", EUR, "")
SIGNED.append(line("   leavers' empty seats", "=-ExistingPayroll*Attrition*VacantMonths/12", EUR,
                   "", nm="LeaversEffect"))
line("Current staff, net of leavers", "=ExistingPayroll+LeaversEffect", EUR,
     "", nm="ExistingNet")
line("Total payroll, start dates as requested", "=ExistingPayroll+CostRequested", EUR,
     "")
line("Total payroll, realistic forecast", "=ExistingNet+CostExpected", EUR,
     "")
line("Payroll target", "=Target", EUR, "")
SIGNED.append(line("Gap to close (+ over target)", "=ExistingNet+CostExpected-Target", EUR,
     "", nm="GapToClose", total=True))
line("Most that later start dates can save", f"=SUM({P('savx')})", EUR,
     "", nm="Capacity")
line("Total payroll, new start dates after deferrals", "=ExistingNet+CostAfterMoves", EUR,
     "")
SIGNED.append(line("Gap after deferrals (+ still over)", "=ExistingNet+CostAfterMoves-Target", EUR,
     "", nm="GapAfter", total=True))
line("Verdict",
     '=IF(GapToClose<=0,"Realistic start dates already fit the target: nothing to defer.",'
     'IF(GapAfter>0.005,"Deferrals within the limit leave "&TEXT(GapAfter,"#,##0")&" € over the target. Next step: agree which roles to cut.",'
     '"Target met by deferring "&COUNTIF(' + P("shift") + ',">0")&" roles."))', "@",
     "")
srow[0] += 1

section("IMPACT ON NEXT YEAR'S PAYROLL", "")
line("Budget-year hires in next year's payroll", f"=SUM({P('n5')})", EUR,
     "", nm="NextYearCost", total=True)
line("   of which already in the budget year, new start dates after deferrals", "=CostAfterMoves", EUR,
     "")
line("   of which growth: carry-over (annualisation)", "=NextYearCost-CostAfterMoves", EUR,
     ""
     "")
wsum.cell(srow[0], 1, "Assumes no new roles, no pay rises and the same contribution rates in the year after.").alignment = WRAP
note2(wsum, srow[0], 3, "")
srow[0] += 2

section("MONTHLY COST OF NEW HIRES, BUDGET YEAR", "")
r = srow[0]
for j, h in enumerate(["Month", "As requested", "Realistic", "After deferrals"]):
    wsum.cell(r, 1 + j, h).font = BOLD
CURVE0 = r + 1
for k in range(1, 13):
    rr = r + k
    wsum.cell(rr, 1, f"=DATE(BudgetYear,{k},1)").number_format = MONTH
    for j, (key, val) in enumerate([("m0", "mon"), ("m4", "mw"), ("m5", "mw")]):
        wsum.cell(rr, 2 + j, f'=SUMIFS({P(val)},{P(key)},"<="&{k})').number_format = EUR
srow[0] = r + 14

section("BY DEPARTMENT, BUDGET YEAR", "")
r = srow[0]
for j, h in enumerate(["Department", "Roles", "As requested", "Realistic", "After deferrals", "Roles deferred", "Full-year cost"]):
    wsum.cell(r, 1 + j, h).font = BOLD
DEPT0 = r + 1
depts = sorted({p["department"] for p in positions})
for k, d in enumerate(depts):
    rr = DEPT0 + k
    wsum.cell(rr, 1, d).fill = INPUT
    wsum.cell(rr, 2, f'=COUNTIF({P("dept")},A{rr})')
    for j, key in enumerate(["c0", "e4", "c5"]):
        wsum.cell(rr, 3 + j, f'=SUMIFS({P(key)},{P("dept")},A{rr})').number_format = EUR
    wsum.cell(rr, 6, f'=COUNTIFS({P("dept")},A{rr},{P("shift")},">0")')
    wsum.cell(rr, 7, f'=SUMIFS({P("aw")},{P("dept")},A{rr})').number_format = EUR
rr = DEPT0 + len(depts)
wsum.cell(rr, 1, "Total").font = BOLD
for j in range(2, 8):
    L = get_column_letter(j)
    c = wsum.cell(rr, j, f"=SUM({L}{DEPT0}:{L}{rr - 1})")
    c.font = BOLD
    if j not in (2, 6):
        c.number_format = EUR
wsum.cell(rr + 1, 1, "Department names are typed in: add a row for each of yours. The Total must equal the figures above.").alignment = WRAP
note2(wsum, rr + 1, 3, "")
wsum.column_dimensions["A"].width = 58
wsum.column_dimensions["B"].width = 20
wsum.column_dimensions["C"].width = 20
for col in "DEFG":
    wsum.column_dimensions[col].width = 18

# ---------------------------------------------------------------- Method
wm = wb.create_sheet("Method")
method = [
    ("Method", None),
    ("This is a short summary. The detailed method and a step-by-step guide are on the dashboard page, "
     "under the \"How it is calculated\" link.",
     ""
     ""),
    ("1. Full cost of a role: annual base × (1 + target bonus %) plus employer contributions at one total rate, "
     "on pay up to the ceiling. Replace the rate and ceiling on Inputs with your country's.",
     ""
     ""),
    ("2. Realistic start: the manager's month + request to posting + posting to first day, both as the median for the grade "
     "in your hiring history. A candidate in interview or at offer starts a set number of days after the plan date; "
     "an accepted offer starts on its agreed date. A role tied to a project starts no earlier than the launch.",
     ""
     ""
     ""),
    ("3. Pay counts from the month of the first day; a start after the 15th counts from the next month. "
     "Cost in the year = full annual cost × paid months ÷ 12.",
     ""
     ""),
    ("4. Plan steps 3 to 5 add each effect one at a time, so the summary shows what each one is worth.",
     ""),
    ("4a. Realistic forecast: not every open role is filled within the year. Roles without a candidate are weighted by "
     "the fill rate on Inputs, roles with a candidate count in full. Current staff who leave save pay while their seat "
     "is empty: current payroll × attrition × empty months ÷ 12. Both defaults are illustrative: use your own history. "
     "A role not filled this year has to be approved again for the next.",
     ""
     ""
     ""
     ""),
    ("5. Deferrals: if the realistic total is still over the target, the model defers the start of roles that can wait, "
     "most expensive first. Each is deferred by the fewest whole months that close what is left, up to the most months on "
     "Inputs and no more than the months left in the budget year. Critical roles, roles with a candidate and project "
     "roles stay put. If that is not enough, the verdict says so, and the next step is to agree which roles to cut.",
     ""
     ""
     ""
     ""),
    ("6. The year after: every role that started in the budget year is paid 12 months. Deferrals therefore save money in "
     "the budget year only; finance should see both years.",
     ""
     ""),
    ("Rates: Spain 2026 (RDL 3/2026; Orden PJC/297/2026), used for 2027. Timing defaults are illustrative, not market figures. "
     "All data in this file is simulated.",
     ""
     ""),
]
for i, (en, ru) in enumerate(method):
    c = wm.cell(1 + i, 1, en)
    c.alignment = WRAP
    if ru is None:
        c.font = Font(bold=True, size=13)
    note2(wm, 1 + i, 2, ru)
wm.column_dimensions["A"].width = 90
wm.column_dimensions["B"].width = 90

# Deviations: plus (cost up, over target) in red, minus (a saving) in bold green.
OVER = Font(color="C00000")
SAVE = Font(color="00804B", bold=True)
def signed(ws, ref):
    ws.conditional_formatting.add(ref, CellIsRule(operator="greaterThan", formula=["0.005"], font=OVER))
    ws.conditional_formatting.add(ref, CellIsRule(operator="lessThan", formula=["-0.005"], font=SAVE))
for r in SIGNED:
    signed(wsum, f"B{r}")
signed(wp, f"{col_of['sav']}{DATA0}:{col_of['sav']}{LAST}")

wb.save(OUT)
print(f"{len(positions)} roles, {len(history)} history rows -> {OUT}")
