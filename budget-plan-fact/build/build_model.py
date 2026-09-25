# -*- coding: utf-8 -*-
"""
Builds the Excel counterpart of the plan-vs-actual dashboard.

Reads budget-plan-fact.csv and produces an .xlsx in which the whole chain is
live: plan -> actual -> deviation -> running total -> forecast with
equalisation -> annual result.

Python supplies only the source data (plan, actual, and the cost of
equalisation by department). Not one total is written in as a number: anything
that can be computed is computed by an Excel formula. That is what makes the
workbook a counterpart rather than a copy — it checks the dashboard instead of
repeating its output.

Correspondence with generate_dataset.py:
  plan_month[dep][m]      -> Data sheet, plan column
  fact                    -> Data sheet, fact column
  forecast                -> Data sheet, formula: plan + equalisation uplift
  equalisation_by_dep()   -> Equalisation sheet
  annual result           -> Summary sheet

IMPORTANT: openpyxl only writes formulas. What they compute is shown only by a
recalculation in real Excel — see recalc_model.ps1. Without that step, "it
agrees" is backed by nothing.
"""
import csv
import os
import sys

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName

HERE = os.path.dirname(os.path.abspath(__file__))

# --- Styling: the same colours as the first artefact ------------------------
H_FILL = PatternFill("solid", fgColor="1F3B57")
H_FONT = Font(color="FFFFFF", bold=True, size=10)
IN_FILL = PatternFill("solid", fgColor="FFF4D6")    # source data
CALC_FILL = PatternFill("solid", fgColor="EAF3FA")  # computed by formula
SET_FILL = PatternFill("solid", fgColor="E6F4EA")   # a setting, meant to be changed
NEG_FILL = PatternFill("solid", fgColor="FDECEA")   # overspend
TITLE = Font(bold=True, size=13)
BOLD = Font(bold=True)
MUTED = Font(color="6B7280", size=9)
THIN = Side(style="thin", color="D0D7DE")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

EUR = '#,##0.00'
PCT = '0.00%'

FACT_MONTHS = 8
EQUALISATION_MONTH = 9


def header(ws, row, labels, widths):
    for j, (label, w) in enumerate(zip(labels, widths), start=1):
        c = ws.cell(row=row, column=j, value=label)
        c.fill = H_FILL
        c.font = H_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
        ws.column_dimensions[get_column_letter(j)].width = w
    ws.row_dimensions[row].height = 30


def read_dataset():
    path = os.path.join(HERE, "budget-plan-fact.csv")
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def read_equalisation():
    """Cost of equalisation by department, from the first artefact's reference.

    Not recomputed here: two copies of the same figure drift apart silently.
    """
    sys.path.insert(0, HERE)
    from generate_dataset import PAYGAP as paygap
    sys.path.insert(0, paygap)
    import reference_calc as rc

    sys.path.insert(0, HERE)
    from generate_dataset import SCENARIO

    employees = rc.load(os.path.join(paygap, "demo-data.csv"))
    result = rc.analyse(employees, rc.DEFAULTS)
    out = {}
    for cat in result["categories"]:
        out[cat["category"]] = {
            "adjustment": cat[SCENARIO]["adjustment"],
            "contributions": cat[SCENARIO]["contributions"],
            "cost": cat[SCENARIO]["cost"],
            "recipients": int(cat[SCENARIO]["recipients"]),
        }
    return out, SCENARIO


def build(out_path):
    rows = read_dataset()
    equalisation, scenario = read_equalisation()

    departments = []
    for r in rows:
        if r["department"] not in departments:
            departments.append(r["department"])
    months = []
    for r in rows:
        if r["month"] not in months:
            months.append(r["month"])

    # The deviations are read from the file the generator wrote rather than
    # derived back from the actuals: the actuals carry month-to-month noise, and
    # deriving backwards yields an average instead of the original figure (a
    # discrepancy of 17 EUR on the annual total).
    dev = {}
    with open(os.path.join(HERE, "department-deviation.csv"), encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            dev[r["department"]] = float(r["run_rate_deviation_pct"])

    wb = Workbook()

    # ======================================================================
    # SHEET Settings
    # ======================================================================
    st = wb.active
    st.title = "Settings"
    st["A1"] = "Model settings"
    st["A1"].font = TITLE
    st["A2"] = ("Payroll budget plan vs actual. Synthetic data, illustration of method. "
                "Comp Budget Lab.")
    st["A2"].font = MUTED
    st["A4"] = "Only the green cells are meant to be edited. Everything else recalculates."
    st["A4"].font = MUTED

    settings = [
        ("fact_months", FACT_MONTHS, "Months of actuals",
         "Months are numbered from 1 for January, so 8 means actuals run to August. "
         "Later months are forecast."),
        ("equalisation_month", EQUALISATION_MONTH, "Equalisation starts in month",
         "Months are numbered from 1 for January, so 9 means September. "
         "From that month onwards the forecast carries the cost of closing the pay gap."),
    ]
    header(st, 6, ["Name", "Value", "What it is", "Notes"], [24, 14, 34, 76])
    for i, (name, val, label, note) in enumerate(settings):
        r = 7 + i
        st.cell(row=r, column=1, value=name).border = BOX
        c = st.cell(row=r, column=2, value=val)
        c.fill = SET_FILL
        c.border = BOX
        c.font = BOLD
        st.cell(row=r, column=3, value=label).border = BOX
        d = st.cell(row=r, column=4, value=note)
        d.border = BOX
        d.alignment = Alignment(wrap_text=True, vertical="top")
        wb.defined_names.add(DefinedName(name, attr_text="Settings!$B$%d" % r))
        st.row_dimensions[r].height = 28

    st["A11"] = "Scenario"
    st["A11"].font = BOLD
    scen_label = ("Full equalisation: every unexplained residual brought to zero."
                  if scenario == "full" else
                  "Minimum compliance: every category brought to the 5% threshold.")
    st["A12"] = (
        scen_label + " The budget was approved before that decision was taken, so it "
        "contains no money for it. From the equalisation month onwards the forecast "
        "therefore runs above plan.")
    st["A12"].font = MUTED
    st["A12"].alignment = Alignment(wrap_text=True, vertical="top")
    st.merge_cells("A12:D14")

    # ======================================================================
    # SHEET Equalisation — the cost of closing the gap, by department
    # ======================================================================
    eq = wb.create_sheet("Equalisation")
    eq["A1"] = "Cost of closing the pay gap, by department"
    eq["A1"].font = TITLE
    eq["A2"] = (
        "What it costs to raise pay for the people who are underpaid for reasons that grade "
        "and tenure do not explain. Each figure is the annual cost of those raises plus the "
        "employer contributions due on them. The monthly uplift is that annual cost divided "
        "by twelve.")
    eq["A2"].font = MUTED
    eq["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    eq.merge_cells("A2:F3")
    eq["A4"] = (
        "The figures come from a separate calculator that measures the gap and prices the "
        "two ways of closing it: bringing every category to a 5% threshold, or bringing every "
        "unexplained difference to zero. This workbook takes its output and asks a different "
        "question: what that decision does to a budget already approved. "
        "Calculator and method: https://olgadimitrovagit.github.io/comp-budget-lab/")
    eq["A4"].font = MUTED
    eq["A4"].alignment = Alignment(wrap_text=True, vertical="top")
    eq.merge_cells("A4:F5")

    EHDR = 7

    header(eq, EHDR, ["Department", "Recipients", "Adjustment, EUR",
                      "Contributions, EUR", "Annual cost, EUR", "Monthly uplift, EUR",
                      "Run-rate deviation, %"],
           [22, 12, 18, 18, 18, 18, 20])

    eq_row = {}
    for i, dep in enumerate(departments):
        r = EHDR + 1 + i
        e = equalisation.get(dep, {"adjustment": 0.0, "contributions": 0.0,
                                   "cost": 0.0, "recipients": 0})
        eq.cell(row=r, column=1, value=dep).border = BOX
        c = eq.cell(row=r, column=2, value=e["recipients"])
        c.fill, c.border = IN_FILL, BOX
        # Full precision, no round(): the workbook divides the total by 12 and
        # multiplies it across 4 months and 7 departments, so a sixth decimal
        # truncated here grows into cents on the annual total. The cell format
        # rounds the display; the stored value stays exact.
        for col, key in ((3, "adjustment"), (4, "contributions")):
            c = eq.cell(row=r, column=col, value=e[key])
            c.fill, c.border, c.number_format = IN_FILL, BOX, EUR
        # Cost and monthly uplift are formulas, not numbers.
        c = eq.cell(row=r, column=5, value="=C%d+D%d" % (r, r))
        c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR
        c = eq.cell(row=r, column=6, value="=E%d/12" % r)
        c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR
        # The department's deviation from plan, %, is an input rather than a
        # computed figure. The forecast needs it: over the remaining months a
        # department keeps deviating as it did over the first eight, and the
        # equalisation uplift lands on top of that.
        c = eq.cell(row=r, column=7, value=dev[dep])
        c.fill, c.border, c.number_format = IN_FILL, BOX, "0.00"
        eq_row[dep] = r

    tot_r = EHDR + 1 + len(departments)
    eq.cell(row=tot_r, column=1, value="TOTAL").font = BOLD
    for col in (2, 3, 4, 5, 6):
        L = get_column_letter(col)
        c = eq.cell(row=tot_r, column=col,
                    value="=SUM(%s%d:%s%d)" % (L, EHDR + 1, L, tot_r - 1))
        c.font, c.border = BOLD, BOX
        c.number_format = EUR if col > 2 else '#,##0'
    eq.freeze_panes = "A%d" % (EHDR + 1)

    # ======================================================================
    # SHEET Data — plan, actual, deviation, running total, forecast
    # ======================================================================
    ws = wb.create_sheet("Data")
    ws["A1"] = "Plan vs actual by department and month"
    ws["A1"].font = TITLE
    ws["A2"] = ("Yellow: from the CSV. Blue: calculated here. "
                "Deviation is actual (or forecast) minus plan: positive means overspend.")
    ws["A2"].font = MUTED

    HDR = 4
    cols = ["Department", "Month", "#", "Plan, EUR", "Actual, EUR", "Forecast, EUR",
            "Expected, EUR", "Deviation, EUR", "Deviation, %", "Cumulative, EUR"]
    header(ws, HDR, cols, [22, 8, 5, 15, 15, 15, 15, 15, 12, 16])

    notes = {
        4: "Annual payroll including employer contributions, spread over months with "
           "holiday-reserve seasonality. Higher at the start and end of the year, lower "
           "over the summer.",
        5: "Actuals, months 1..fact_months. Empty afterwards.",
        6: "Forecast for the remaining months. It carries the department's own deviation "
           "forward and adds the monthly equalisation uplift once the equalisation month "
           "is reached. A department that overspent for eight months keeps overspending: "
           "the uplift sits on top of that, it does not replace it.",
        7: "Whichever of the two is known for this month: actual if there is one, "
           "otherwise forecast.",
        10: "Running total of deviation within the department, from January. It shows "
            "whether a department's monthly gaps accumulate or cancel out over the year.",
    }
    for col, text in notes.items():
        ws.cell(row=HDR, column=col).comment = Comment(text, "Comp Budget Lab", height=140, width=340)

    by_key = {(r["department"], int(r["month_no"])): r for r in rows}
    first_data = HDR + 1
    r = first_data
    dep_first = {}
    for dep in departments:
        dep_first[dep] = r
        for m in range(1, 13):
            src = by_key[(dep, m)]
            ws.cell(row=r, column=1, value=dep).border = BOX
            ws.cell(row=r, column=2, value=src["month"]).border = BOX
            ws.cell(row=r, column=3, value=m).border = BOX

            c = ws.cell(row=r, column=4, value=float(src["plan"]))
            c.fill, c.border, c.number_format = IN_FILL, BOX, EUR

            # Actual: from the CSV, only while month <= fact_months
            if src["fact"]:
                c = ws.cell(row=r, column=5, value=float(src["fact"]))
                c.fill, c.border, c.number_format = IN_FILL, BOX, EUR
            else:
                ws.cell(row=r, column=5).border = BOX

            # Forecast is a formula: the plan carried along the department's own
            # trend, plus the equalisation uplift from the relevant month. The
            # trend is essential: without it the workbook would assume a return
            # to plan exactly from September.
            # ROUND to the cent is not cosmetic: the generator writes
            # round(forecast, 2) into the CSV, and without rounding here the
            # workbook would diverge from it by 3.7 cents accumulated across 28
            # rows. The rounding sits where the generator's does, rather than
            # being papered over by a wider reconciliation tolerance.
            er = eq_row[dep]
            ws.cell(row=r, column=6,
                    value=("=IF(C{r}<=fact_months,\"\","
                           "ROUND(D{r}*(1+Equalisation!$G${er}/100)"
                           "+IF(C{r}>=equalisation_month,Equalisation!$F${er},0),2))"
                           ).format(r=r, er=er))
            c = ws.cell(row=r, column=6)
            c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR

            # Expected: the actual if there is one, otherwise the forecast
            c = ws.cell(row=r, column=7,
                        value="=IF(C{r}<=fact_months,E{r},F{r})".format(r=r))
            c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR

            c = ws.cell(row=r, column=8, value="=G{r}-D{r}".format(r=r))
            c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR

            c = ws.cell(row=r, column=9, value="=IF(D{r}=0,\"\",H{r}/D{r})".format(r=r))
            c.fill, c.border, c.number_format = CALC_FILL, BOX, PCT

            # Running total within the department
            if m == 1:
                formula = "=H{r}".format(r=r)
            else:
                formula = "=J{p}+H{r}".format(p=r - 1, r=r)
            c = ws.cell(row=r, column=10, value=formula)
            c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR

            r += 1

    last_data = r - 1
    ws.freeze_panes = "A%d" % first_data
    ws.auto_filter.ref = "A%d:J%d" % (HDR, last_data)

    # ======================================================================
    # SHEET Monthly — company totals by month
    # ======================================================================
    mo = wb.create_sheet("Monthly")
    mo["A1"] = "Company total by month"
    mo["A1"].font = TITLE
    mo["A2"] = ("Two different quantities, and the dashboard must keep them apart: "
                "the monthly deviation says how far this month ran from plan, while the "
                "cumulative one carries every month before it. On this dataset both are "
                "positive from January, and the monthly figure roughly doubles once "
                "equalisation starts.")
    mo["A2"].font = MUTED
    mo["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    mo.merge_cells("A2:G3")

    MHDR = 5
    header(mo, MHDR, ["Month", "#", "Plan, EUR", "Expected, EUR",
                      "Deviation, EUR", "Deviation, %", "Cumulative, EUR"],
           [10, 5, 16, 16, 16, 12, 16])

    for i, month_name in enumerate(months):
        r = MHDR + 1 + i
        m = i + 1
        mo.cell(row=r, column=1, value=month_name).border = BOX
        mo.cell(row=r, column=2, value=m).border = BOX
        for col, src_col in ((3, "D"), (4, "G")):
            c = mo.cell(row=r, column=col,
                        value="=SUMIF(Data!$C${f}:$C${l},$B{r},Data!${sc}${f}:${sc}${l})"
                              .format(f=first_data, l=last_data, r=r, sc=src_col))
            c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR
        c = mo.cell(row=r, column=5, value="=D{r}-C{r}".format(r=r))
        c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR
        c = mo.cell(row=r, column=6, value="=E{r}/C{r}".format(r=r))
        c.fill, c.border, c.number_format = CALC_FILL, BOX, PCT
        formula = "=E{r}".format(r=r) if m == 1 else "=G{p}+E{r}".format(p=r - 1, r=r)
        c = mo.cell(row=r, column=7, value=formula)
        c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR

    m_first, m_last = MHDR + 1, MHDR + 12
    r = m_last + 1
    mo.cell(row=r, column=1, value="YEAR").font = BOLD
    for col in (3, 4, 5):
        L = get_column_letter(col)
        c = mo.cell(row=r, column=col, value="=SUM(%s%d:%s%d)" % (L, m_first, L, m_last))
        c.font, c.border, c.number_format = BOLD, BOX, EUR
    c = mo.cell(row=r, column=6, value="=E{r}/C{r}".format(r=r))
    c.font, c.border, c.number_format = BOLD, BOX, PCT
    mo.freeze_panes = "A%d" % m_first

    # ======================================================================
    # SHEET Departments — totals by department
    # ======================================================================
    dp = wb.create_sheet("Departments")
    dp["A1"] = "By department: eight months of actuals against the year"
    dp["A1"].font = TITLE
    dp["A2"] = ("Sign of the deviation is stable within a department: it either "
                "underspends all year or overspends all year. On this dataset six of "
                "seven overspend; Engineering is the one that does not.")
    dp["A2"].font = MUTED

    DHDR = 4
    header(dp, DHDR, ["Department", "Plan 8M, EUR", "Actual 8M, EUR", "Deviation 8M, EUR",
                      "Deviation 8M, %", "Equalisation, EUR", "Year plan, EUR",
                      "Year expected, EUR", "Year deviation, EUR", "Year, %"],
           [22, 15, 15, 16, 13, 16, 16, 16, 16, 10])

    for i, dep in enumerate(departments):
        r = DHDR + 1 + i
        f, l = dep_first[dep], dep_first[dep] + 11
        dp.cell(row=r, column=1, value=dep).border = BOX
        pairs = [
            (2, "=SUMIF(Data!$C${f}:$C${l},\"<=\"&fact_months,Data!$D${f}:$D${l})"),
            (3, "=SUMIF(Data!$C${f}:$C${l},\"<=\"&fact_months,Data!$E${f}:$E${l})"),
        ]
        for col, tpl in pairs:
            c = dp.cell(row=r, column=col, value=tpl.format(f=f, l=l))
            c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR
        c = dp.cell(row=r, column=4, value="=C{r}-B{r}".format(r=r))
        c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR
        c = dp.cell(row=r, column=5, value="=D{r}/B{r}".format(r=r))
        c.fill, c.border, c.number_format = CALC_FILL, BOX, PCT
        # Computed from the visible rows of the Data sheet: the sum of
        # (forecast - plan) over the equalisation months. This used to be the
        # monthly uplift from the Equalisation sheet multiplied by the number of
        # months — the same answer by a second route, which nothing on screen
        # could check.
        c = dp.cell(row=r, column=6,
                    value=("=SUMIFS(Data!$F${f}:$F${l},Data!$C${f}:$C${l},\">=\"&equalisation_month)"
                           "-SUMIFS(Data!$D${f}:$D${l},Data!$C${f}:$C${l},\">=\"&equalisation_month)"
                           ).format(f=f, l=l))
        c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR
        c = dp.cell(row=r, column=7, value="=SUM(Data!$D${f}:$D${l})".format(f=f, l=l))
        c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR
        c = dp.cell(row=r, column=8, value="=SUM(Data!$G${f}:$G${l})".format(f=f, l=l))
        c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR
        c = dp.cell(row=r, column=9, value="=H{r}-G{r}".format(r=r))
        c.fill, c.border, c.number_format = CALC_FILL, BOX, EUR
        c = dp.cell(row=r, column=10, value="=I{r}/G{r}".format(r=r))
        c.fill, c.border, c.number_format = CALC_FILL, BOX, PCT

    d_first, d_last = DHDR + 1, DHDR + len(departments)
    r = d_last + 1
    dp.cell(row=r, column=1, value="TOTAL").font = BOLD
    for col in (2, 3, 4, 6, 7, 8, 9):
        L = get_column_letter(col)
        c = dp.cell(row=r, column=col, value="=SUM(%s%d:%s%d)" % (L, d_first, L, d_last))
        c.font, c.border, c.number_format = BOLD, BOX, EUR
    for col, num in ((5, "=D{r}/B{r}"), (10, "=I{r}/G{r}")):
        c = dp.cell(row=r, column=col, value=num.format(r=r))
        c.font, c.border, c.number_format = BOLD, BOX, PCT
    dp.freeze_panes = "A%d" % d_first

    # ======================================================================
    # SHEET Summary — what the dashboard shows on its first screen
    # ======================================================================
    sm = wb.create_sheet("Summary")
    sm["A1"] = "Summary"
    sm["A1"].font = TITLE
    sm["A2"] = ("Every figure here is a formula. Change an actual on the Data sheet "
                "and watch this recalculate.")
    sm["A2"].font = MUTED
    sm.column_dimensions["A"].width = 46
    for col in ("B", "C"):
        sm.column_dimensions[col].width = 20

    year_row = m_last + 1

    # Rows are declared by key, and references are assembled from the actual
    # addresses. Row numbers are never typed by hand: that is how constants
    # drifted in the first artefact and a "Total" ended up referring to itself.
    # The same class of error has already happened here once — Deviation was
    # referring to the header row.
    SUM_ROWS = [
        ("h1",        "Eight months of actuals", None, None),
        ("plan8",     "Plan, Jan-Aug",
         "=SUMIF(Monthly!$B${mf}:$B${ml},\"<=\"&fact_months,Monthly!$C${mf}:$C${ml})", EUR),
        ("fact8",     "Actual, Jan-Aug",
         "=SUMIF(Monthly!$B${mf}:$B${ml},\"<=\"&fact_months,Monthly!$D${mf}:$D${ml})", EUR),
        ("save8",     "Accumulated deviation", "={fact8}-{plan8}", EUR),
        ("save8pct",  "As % of plan", "={save8}/{plan8}", PCT),
        ("gap1",      "", None, None),
        ("h2",        "Cost of closing the gap", None, None),
        ("eq_year",   "Annual cost of equalisation", "=Equalisation!$E${tot}", EUR),
        ("eq_now",    "Charged this year (from month %d)" % EQUALISATION_MONTH,
         "=SUMIFS(Data!$F${df}:$F${dl},Data!$C${df}:$C${dl},\">=\"&equalisation_month)"
         "-SUMIFS(Data!$D${df}:$D${dl},Data!$C${df}:$C${dl},\">=\"&equalisation_month)", EUR),
        ("gap2",      "", None, None),
        ("h3",        "Full year", None, None),
        ("yplan",     "Plan", "=Monthly!$C${yr}", EUR),
        ("yexp",      "Expected (actual + forecast)", "=Monthly!$D${yr}", EUR),
        ("ydelta",    "Deviation", "={yexp}-{yplan}", EUR),
        ("ydeltapct", "As % of plan", "={ydelta}/{yplan}", PCT),
        ("gap3",      "", None, None),
        ("cross",     "First month the cumulative is above plan",
         "=INDEX(Monthly!$A${mf}:$A${ml},MATCH(TRUE,INDEX(Monthly!$G${mf}:$G${ml}>0,0),0))",
         None),
    ]

    # Hand out the addresses first, then substitute them into the formulas.
    addr = {key: "B%d" % (4 + i) for i, (key, _, _, _) in enumerate(SUM_ROWS)}
    ctx = dict(addr, mf=m_first, ml=m_last, tot=tot_r, yr=year_row,
               df=first_data, dl=last_data)

    for i, (key, label, formula, fmt) in enumerate(SUM_ROWS):
        r = 4 + i
        c = sm.cell(row=r, column=1, value=label)
        if formula is None and label:
            c.font = BOLD
        if formula:
            v = sm.cell(row=r, column=2, value=formula.format(**ctx))
            v.fill, v.border = CALC_FILL, BOX
            if fmt:
                v.number_format = fmt

    # The addresses recalc_model.ps1 reads. They are written here rather than
    # remembered in that script: otherwise inserting a row makes them drift
    # silently.
    sm["D1"] = "cells_for_check"
    sm["D1"].font = MUTED
    for j, key in enumerate(("plan8", "fact8", "yplan", "yexp", "ydelta", "cross")):
        sm.cell(row=2 + j, column=4, value=key).font = MUTED
        sm.cell(row=2 + j, column=5, value=addr[key]).font = MUTED
    sm.column_dimensions["D"].width = 18
    sm.column_dimensions["E"].width = 8

    sm["A23"] = ("Deviation is expected minus plan throughout. A positive figure means the "
                 "company spent more than planned, a negative one less. On this dataset the "
                 "deviation is positive from January and the cumulative never returns to plan.")
    sm["A23"].font = MUTED
    sm["A23"].alignment = Alignment(wrap_text=True, vertical="top")
    sm.merge_cells("A23:C25")

    # ======================================================================
    # SHEET Legend
    # ======================================================================
    lg = wb.create_sheet("Legend")
    lg["A1"] = "Legend and method"
    lg["A1"].font = TITLE
    lg.column_dimensions["A"].width = 32
    lg.column_dimensions["B"].width = 110

    blocks = [
        ("Colours", ""),
        ("Yellow", "Source data. Comes from the CSV, never calculated."),
        ("Blue", "Calculated by formula. These cells recalculate themselves."),
        ("Green", "A setting on the Settings sheet. These are meant to be changed."),
        ("", ""),
        ("Order of calculation", ""),
        ("1. Plan",
         "Annual payroll including employer contributions, spread over twelve months with "
         "holiday-reserve seasonality: higher at the start and end of the year, lower over "
         "the summer, when headcount is thin and accrued leave is taken. The seasonal "
         "coefficients sum to twelve, so seasonality moves money inside the year without "
         "changing the annual total."),
        ("2. Actual",
         "Months 1..fact_months. Each department's deviation keeps a stable sign: it either "
         "underspends all year or overspends all year. One department is deliberately well "
         "outside the others' range: budgets rarely break evenly, they break in one place."),
        ("3. Forecast",
         "For the remaining months, the department's own deviation carries forward and the "
         "monthly equalisation uplift is added on top, from the equalisation month onwards. "
         "The uplift is the annual cost of closing the pay gap divided by twelve. This is "
         "why deviation runs higher in the last four months than in the first eight: the "
         "pay rise lands on top of a gap that was already there."),
        ("4. Deviation",
         "Expected minus plan. Positive is an overspend. Shown both per month and as a "
         "running total from January."),
        ("5. Year",
         "Plan against actual plus forecast. The accumulated deviation is set against the "
         "cost of equalisation charged this year."),
        ("", ""),
        ("Two quantities not to confuse", ""),
        ("Monthly deviation",
         "How far this one month ran from plan. It answers: is this month worse than the "
         "last. On this dataset it roughly doubles in the equalisation month."),
        ("Cumulative deviation",
         "The same figure carried from January, so it answers a different question: how much "
         "of the year's budget has gone. A month can improve while the cumulative still "
         "grows. Both are correct; do not read one for the other."),
        ("", ""),
        ("What this model does not do", ""),
        ("No explanation of variances",
         "It shows where and by how much, not why. Causes belong in the conversation, not on "
         "the screen."),
        ("Employer contributions",
         "A raise to base pay brings employer contributions with it, and those are part of "
         "the budget line. The rates here are Spain 2026: 31.5% on annual pay up to a "
         "ceiling of 61,214 EUR, and 0.96% on anything above it (the employer share of the "
         "first band of the solidarity contribution, 0.96% of the combined 1.15%). The scale is regressive, "
         "so a raise to someone already above the ceiling attracts almost no contributions "
         "while the same raise below it attracts the full rate. That is why the effective "
         "rate on the Equalisation sheet differs so much between departments. Rates and "
         "ceiling are specific to one country and one year: in another jurisdiction the "
         "numbers change, the structure does not."),
        ("Synthetic data",
         "Generated from a seeded PRNG, not from any real organisation. The workbook "
         "illustrates a budgeting approach and is not legal or actuarial advice."),
    ]
    r = 3
    for label, text in blocks:
        if label:
            c = lg.cell(row=r, column=1, value=label)
            c.font = BOLD if not text else Font(bold=False)
            if not text:
                c.font = BOLD
            c.alignment = Alignment(vertical="top")
        if text:
            c = lg.cell(row=r, column=2, value=text)
            c.alignment = Alignment(wrap_text=True, vertical="top")
            lg.row_dimensions[r].height = max(14, 13 * (len(text) // 95 + 1))
        r += 1

    wb.save(out_path)
    return out_path, len(rows), departments


def main():
    # The workbook sits beside the page, not in build/: it is one of the three
    # files a reader takes away.
    out = os.path.join(os.path.dirname(HERE), "budget-plan-fact-model.xlsx")
    path, n, departments = build(out)
    print("Written: %s" % path)
    print("Data rows: %d, departments: %d" % (n, len(departments)))
    print()
    print("Sheets: Settings, Equalisation, Data, Monthly, Departments, Summary, Legend")
    print()
    print("NOTE: openpyxl has only written the formulas. Nothing has been")
    print("computed yet. The next step is required:")
    print("  powershell -File recalc_model.ps1")


if __name__ == "__main__":
    main()
