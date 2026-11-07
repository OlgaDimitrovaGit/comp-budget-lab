import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
// Demo files are read from the artefact folder at build time: one source, no copies.
import demoPositions from "../../../sample-positions.csv?raw";
import demoHistory from "../../../sample-hiring-history.csv?raw";
import { DEFAULTS, analyse, loadHistory, loadPositions } from "@/lib/engine.js";
import { eurM, eurK, m2 } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vacancy calendar: what open roles really cost in 2027" },
      { name: "description", content: "What open roles cost at realistic start dates, which start dates to defer to meet the 2027 payroll target, and what carries over into 2028." },
      { property: "og:title", content: "Vacancy calendar: what open roles really cost in 2027" },
      { property: "og:description", content: "Open roles at realistic start dates against the 2027 payroll target." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

type R = ReturnType<typeof analyse>;
const csvHref = (text: string) => `data:text/csv;charset=utf-8,${encodeURIComponent(text)}`;
const avgMonths = (r: R) => (r.moved_roles ? String(Math.round((r.moved_months / r.moved_roles) * 10) / 10) : "0");
const cents = (v: number) => Math.round(v / 1e4); // compare on the shown €0.00M scale

/* ---------- tooltip ---------- */
type Tip = { x: number; y: number; content: ReactNode } | null;
function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const ref = useRef<HTMLDivElement>(null);
  const bind = (content: ReactNode) => ({
    onMouseMove: (e: React.MouseEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content });
    },
    onMouseLeave: () => setTip(null),
  });
  const node = (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 w-max max-w-64 rounded-md bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-lg transition-opacity duration-150"
      style={{
        opacity: tip ? 1 : 0,
        left: tip ? Math.max(0, Math.min(tip.x + 14, (ref.current?.clientWidth ?? 0) - 200)) : 0,
        top: tip ? tip.y + 16 : 0,
      }}
    >
      {tip?.content}
    </div>
  );
  return { ref, bind, node };
}

/* ---------- theme ---------- */
function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const d = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
  }, []);
  const flip = () => {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("theme", d ? "dark" : "light");
  };
  return (
    <button onClick={flip} className="btn" aria-label="Toggle dark theme">
      {dark ? "☀ Light" : "◐ Dark"}
    </button>
  );
}

/* ---------- 1. KPI cards ---------- */
function Kpi({ label, value, target, note }: { label: string; value: number; target: number; note?: string }) {
  const gap = value - target;
  const over = cents(gap) > 0;
  const zero = cents(gap) === 0;
  return (
    <div className="panel relative overflow-hidden p-4 transition-shadow hover:shadow-md">
      <span className={`absolute inset-y-0 left-0 w-1 ${over ? "bg-destructive" : "bg-good"}`} />
      <div className="text-xs text-muted-foreground sm:text-sm">{label}</div>
      <div className="num mt-2 text-2xl font-semibold tracking-tight @3xl:text-3xl">{eurM(value)}</div>
      <div className={`num mt-1 text-xs font-medium sm:text-sm ${over ? "text-destructive" : zero ? "text-muted-foreground" : "text-good"}`}>
        {zero ? "€0.00M" : `${gap > 0 ? "▲" : "▼"} ${eurM(gap, { sign: true })}`}
      </div>
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/* ---------- 2. waterfall ---------- */
function Waterfall({ r }: { r: R }) {
  const { ref, bind, node } = useTip();
  const b = r.bridge;
  // Everything here is the hiring budget net of leavers: what payroll changes by against current payroll.
  const req = r.requested, timed = r.timed, filled = r.realistic;
  const real = filled - r.leavers, after = r.after_moves - r.leavers;
  const timing = b.approval + b.time_to_start + b.pipeline + b.project;
  const parts = ([["approval", b.approval], ["time to start", b.time_to_start], ["candidates already in the pipeline", b.pipeline]] as const)
    .filter(([, v]) => Math.round(v / 1000) !== 0);
  const change = (label: string, from: number, to: number, tip: ReactNode) =>
    cents(to - from) !== 0 ? [{ label, lo: Math.min(from, to), hi: Math.max(from, to), v: to - from, total: false, tip }] : [];
  const hasMoves = cents(r.moves) !== 0;
  const bars = [
    { label: "As requested by the business", lo: 0, hi: req, v: req, total: true, tip: <><b>As requested</b><br />Every open role from its requested month: {eurM(req)}</> },
    ...change("Hiring timelines", req, timed, <><b>Hiring timelines {eurM(timing, { sign: true })}</b>{parts.map(([l, v]) => <span key={l}><br />{l} {eurK(v)}</span>)}</>),
    ...change("Roles not filled", timed, filled, <><b>Roles not filled {eurM(r.unfilled, { sign: true })}</b><br />{r.fill_rate}% of roles without a candidate are filled in 2027; the rest cost nothing this year</>),
    ...change("Leavers' empty seats", filled, real, <><b>Leavers' empty seats {eurM(-r.leavers, { sign: true })}</b><br />{r.attrition}% of current staff leave, each seat stays empty {r.vacant_months} months</>),
    { label: "Realistic forecast", lo: 0, hi: real, v: real, total: true, tip: <><b>Realistic forecast</b><br />{eurM(real)}: new hires at realistic start dates, minus leavers' empty seats</> },
    ...(hasMoves ? [
      { label: "Deferrals", lo: after, hi: real, v: r.moves, total: false, tip: <><b>Deferrals {eurM(r.moves, { sign: true })}</b><br />{r.moved_roles} roles deferred, {avgMonths(r)} months on average</> },
      { label: "After deferrals", lo: 0, hi: after, v: after, total: true, tip: <><b>After deferrals</b><br />{eurM(after)} · hiring budget within the target {eurM(r.hiring_budget)}</> },
    ] : []),
  ];
  const top = Math.max(...bars.map((x) => x.hi), 1);
  const raw = top / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const max = Math.ceil((top * 1.12) / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const pct = (v: number) => `${(v / max) * 100}%`;
  const cols = { gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` };
  return (
    <div ref={ref} className="relative">
      <div className="relative h-64 sm:h-72">
        {ticks.map((g) => (
          <div key={g} className="absolute left-0 right-0 border-t border-dashed border-border sm:left-10" style={{ bottom: pct(g) }}>
            <span className="num absolute -left-10 hidden w-8 -translate-y-1/2 text-right text-[10px] text-muted-foreground sm:block">€{+(g / 1e6).toFixed(1)}M</span>
          </div>
        ))}
        <div className="absolute inset-0 grid gap-1 pl-0 sm:gap-6 sm:pl-10" style={cols}>
          {bars.map((x) => (
            <div key={x.label} className="group relative" {...bind(x.tip)}>
              <div
                className={`absolute inset-x-0 rounded-sm transition-all duration-200 group-hover:brightness-110 group-hover:shadow-md ${x.total ? "bg-total" : "bg-reduction"}`}
                style={{ bottom: pct(x.lo), height: pct(x.hi - x.lo) }}
              >
                <span className={`num absolute -inset-x-2 -top-5 whitespace-nowrap text-center text-[9px] font-semibold sm:text-xs ${x.total ? "text-foreground" : "text-muted-foreground"}`}>
                  {eurM(x.v, { sign: !x.total })}
                </span>
              </div>
              <div className="absolute inset-0 rounded-sm transition-colors group-hover:bg-foreground/5" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 grid gap-1 border-t border-border pl-0 pt-2 sm:gap-6 sm:pl-10" style={cols}>
        {bars.map((x) => (
          <div key={x.label} className="text-center text-[10px] leading-tight text-muted-foreground sm:text-xs">{x.label}</div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-total" />Total</span>
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-reduction" />Change</span>
      </div>
      {node}
    </div>
  );
}

/* ---------- 3. 2027 and 2028 cards: five shared rows, so both cards line up ---------- */
function Card({ title, big, line, bar, caption }: { title: string; big: ReactNode; line: ReactNode; bar: ReactNode; caption: ReactNode }) {
  return (
    <section className="panel grid content-start gap-y-2 p-4 sm:p-5 @2xl:row-span-5 @2xl:grid-rows-subgrid">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="num text-2xl font-semibold tracking-tight @3xl:text-3xl">{big}</div>
      <div className="text-sm">{line}</div>
      <div className="mt-2 self-end">{bar}</div>
      <div className="text-sm text-muted-foreground">{caption}</div>
    </section>
  );
}

function YearCards({ r }: { r: R }) {
  const saved = -r.moves;
  const noMoves = cents(r.gap) <= 0;
  const cantClose = !noMoves && cents(r.gap_after) > 0;
  const used = r.capacity > 0 ? Math.min(100, Math.round((saved / r.capacity) * 100)) : 0;
  const ny = { total: r.next_after, base: r.after_moves, carry: r.carry + r.new_next };
  const real = r.realistic - r.leavers, after = r.after_moves - r.leavers;
  return (
    <div className="grid gap-5 @2xl:grid-cols-2">
      <Card
        title="2027 hiring budget, net of leavers"
        big={noMoves ? eurM(real) : <><span className="text-muted-foreground">{eurM(real)}</span> → {eurM(after)}</>}
        line={noMoves
          ? <span className="font-medium text-good">No deferrals needed: {eurM(-r.gap)} below the target</span>
          : <><span className={`font-medium ${cantClose ? "text-destructive" : "text-good"}`}>Deferrals save {eurM(saved)}</span><span className="text-muted-foreground"> · {r.moved_roles} roles, {avgMonths(r)} months on average</span></>}
        bar={<div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-all duration-700 ${cantClose ? "bg-destructive" : "bg-reduction"}`} style={{ width: `${used}%` }} /></div>}
        caption={noMoves ? <>Possible savings from deferrals: {eurM(r.capacity)}</> : <>Uses {eurM(saved)} of {eurM(r.capacity)} possible savings ({used}%)</>}
      />
      <Card
        title="2027 hires in 2028 payroll"
        big={eurM(ny.total)}
        line={<span className="text-muted-foreground">Full-year cost of 2027 hires{r.late_roles ? `, plus ${r.late_roles} roles starting in 2028` : ""}</span>}
        bar={<div className="flex h-2 overflow-hidden rounded-full"><div className="bg-total" style={{ width: `${ny.total > 0 ? (ny.base / ny.total) * 100 : 0}%` }} /><div className="flex-1 bg-reduction" /></div>}
        caption={<span className="flex flex-wrap gap-x-3"><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-total" />{eurM(ny.base)} new hires' cost in 2027</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-reduction" />{eurM(ny.carry)} {r.late_roles ? "carry-over and 2028 starts" : "carry-over (annualisation)"}</span></span>}
      />
    </div>
  );
}

/* ---------- 4. departments ---------- */
function Departments({ r }: { r: R }) {
  const { ref, bind, node } = useTip();
  const [all, setAll] = useState(false);
  const depts = r.depts
    .map((d) => ({ ...d, savings: d.requested - d.after_moves }))
    .sort((a, b) => b.savings - a.savings || a.department.localeCompare(b.department));
  const tot = depts.reduce(
    (a, d) => ({ roles: a.roles + d.roles, moved: a.moved + d.moved, requested: a.requested + d.requested, realistic: a.realistic + d.realistic, after_moves: a.after_moves + d.after_moves, savings: a.savings + d.savings, full_year: a.full_year + d.full_year }),
    { roles: 0, moved: 0, requested: 0, realistic: 0, after_moves: 0, savings: 0, full_year: 0 },
  );
  const shown = all ? depts : depts.slice(0, 12);
  const withTotal = depts.length > 1;
  const maxSav = Math.max(...depts.map((d) => d.savings), 1);
  const th = "px-3 py-2 text-right font-medium";
  const td = "px-3 py-2 text-right";
  return (
    <div ref={ref} className="relative">
      <div className="hidden overflow-x-auto md:block">
        <table className="num w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left font-medium">Department</th>
              <th className={th}>Roles, #</th><th className={th}>Deferred, #</th><th className={th}>As requested</th>
              <th className={th}>Realistic</th><th className={th}>After deferrals</th>
              <th className={th}>Reduction vs request</th><th className={th}>Full-year cost</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr
                key={d.department}
                className="border-b border-border transition-colors hover:bg-row-hover"
                {...bind(<><b>{d.department}</b><br />{d.moved} of {d.roles} roles deferred<br />timelines & unfilled roles {eurM(d.realistic - d.requested, { sign: true })} · deferrals {eurM(d.after_moves - d.realistic, { sign: true })}{tot.savings > 0 && <><br />{((d.savings / tot.savings) * 100).toFixed(0)}% of total reduction</>}</>)}
              >
                <td className="px-3 py-2 text-left">{d.department}</td>
                <td className={td}>{d.roles}</td>
                <td className={td}>{d.moved}</td>
                <td className={td}>{m2(d.requested)}</td>
                <td className={td}>{m2(d.realistic)}</td>
                <td className={td}>{m2(d.after_moves)}</td>
                <td className={td}>
                  <div className="flex items-center justify-end gap-2">
                    <span className="h-1.5 rounded-full bg-reduction" style={{ width: `${Math.max(0, d.savings / maxSav) * 56}px` }} />
                    <span className="font-medium">{m2(d.savings)}</span>
                  </div>
                </td>
                <td className={td}>{m2(d.full_year)}</td>
              </tr>
            ))}
            {withTotal && (
              <tr className="bg-muted font-semibold">
                <td className="px-3 py-2 text-left">Total</td>
                <td className={td}>{tot.roles}</td><td className={td}>{tot.moved}</td>
                <td className={td}>{m2(tot.requested)}</td><td className={td}>{m2(tot.realistic)}</td>
                <td className={td}>{m2(tot.after_moves)}</td><td className={td}>{m2(tot.savings)}</td>
                <td className={td}>{m2(tot.full_year)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="num space-y-2 md:hidden">
        {[...shown.map((d) => ({ ...d, isTotal: false })), ...(withTotal ? [{ ...tot, department: "Total", isTotal: true }] : [])].map((d) => (
          <div key={d.department} className={`rounded-md border border-border p-3 ${d.isTotal ? "bg-muted" : ""}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={d.isTotal ? "font-semibold" : "font-medium"}>{d.department}</span>
              <span className="text-xl font-semibold"><span className="mr-1.5 text-xs font-normal text-muted-foreground">Reduction vs request</span>{m2(d.savings)}</span>
            </div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              <div>{d.roles} roles · {d.moved} deferred</div>
              <div>As requested {m2(d.requested)} · realistic {m2(d.realistic)} · after deferrals {m2(d.after_moves)} · full year: {m2(d.full_year)}</div>
            </div>
          </div>
        ))}
      </div>
      {depts.length > 12 && (
        <button className="link mt-3 text-sm" onClick={() => setAll(!all)}>{all ? "Show the first 12" : `Show all ${depts.length}`}</button>
      )}
      {node}
    </div>
  );
}

/* ---------- 5. scenario fields: a bad value keeps the last good one and says so ---------- */
const parseNum = (s: string) => {
  const t = s.trim().replace(/[€\s]/g, "").replace(",", ".");
  const v = Number(t);
  return t !== "" && Number.isFinite(v) ? v : null;
};
type NumField = { text: string; value: number | null; bad: boolean; set: (s: string) => void };
function useNum(initial: number | null, ok: (v: number) => boolean, allowEmpty = false): NumField {
  const [text, setText] = useState(initial == null ? "" : String(initial));
  const [value, setValue] = useState<number | null>(initial);
  const [bad, setBad] = useState(false);
  const set = (s: string) => {
    setText(s);
    if (allowEmpty && s.trim() === "") { setValue(null); setBad(false); return; }
    const v = parseNum(s);
    if (v != null && ok(v)) { setValue(v); setBad(false); } else setBad(true);
  };
  return { text, value, bad, set };
}

function Field({ label, hint, bad, badHint, children }: { label: string; hint?: string; bad?: boolean; badHint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm">{label}</span>
      <div className="mt-1">{children}</div>
      {bad ? <span className="mt-1 block text-xs text-destructive">{badHint}</span> : hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
function MoneyInput({ f }: { f: NumField }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
      <input className="field pl-7 pr-9" inputMode="decimal" value={f.text} onChange={(e) => f.set(e.target.value)} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">M</span>
    </div>
  );
}
type Inputs = { target: NumField; current: NumField; shift: NumField; interview: NumField; offer: NumField; attrition: NumField; vacant: NumField; fill: NumField };
const RATE_FIELDS = [
  ["Staff leaving", "attrition", "%", "0 to 100"],
  ["Seat stays empty", "vacant", "months", "0 to 12"],
  ["Open roles filled", "fill", "%", "1 to 100"],
] as const;
function Scenario({ f, planDate }: { f: Inputs; planDate: string }) {
  const keep = (v: number | null, money = false) => `Not a number. Still using ${v == null ? "—" : money ? `€${v.toFixed(2)}M` : v}`;
  const shown = new Date(`${planDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return (
    <div className="space-y-4">
      <Field label="2027 payroll target" hint="incl. employer contributions" bad={f.target.bad} badHint={keep(f.target.value, true)}><MoneyInput f={f.target} /></Field>
      <Field label="Current payroll" hint="current headcount, full year 2027" bad={f.current.bad} badHint={keep(f.current.value, true)}><MoneyInput f={f.current} /></Field>
      <Field label="Max. start-date deferral, months" hint="per role; critical roles and candidates in the pipeline are not deferred">
        <select className="field" value={f.shift.text} onChange={(e) => f.shift.set(e.target.value)}>{[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select>
      </Field>
      <div className="border-t border-border pt-4">
        <div className="text-sm font-semibold">Candidates already in the pipeline</div>
        <div className="mt-3 space-y-3">
          {([["Interviewing: starts in", "interview"], ["Offer sent: starts in", "offer"]] as const).map(([l, k]) => (
            <div key={k}>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">{l}</span>
                <span className="flex shrink-0 items-center gap-1.5"><input className="field w-16 text-right" value={f[k].text} onChange={(e) => f[k].set(e.target.value)} inputMode="numeric" /><span className="w-14 text-left">days</span></span>
              </label>
              {f[k].bad && <span className="mt-1 block text-xs text-destructive">Whole days, 0 to 365. Still using {f[k].value}</span>}
            </div>
          ))}
        </div>
        <span className="mt-2 block text-xs text-muted-foreground">from the plan date, {shown}</span>
      </div>
      <div className="border-t border-border pt-4">
        <div className="text-sm font-semibold">Leavers and fill rate, 2027</div>
        <div className="mt-3 space-y-3">
          {RATE_FIELDS.map(([l, k, unit, range]) => (
            <div key={k}>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">{l}</span>
                <span className="flex shrink-0 items-center gap-1.5"><input className="field w-16 text-right" value={f[k].text} onChange={(e) => f[k].set(e.target.value)} inputMode="decimal" /><span className="w-14 text-left">{unit}</span></span>
              </label>
              {f[k].bad && <span className="mt-1 block text-xs text-destructive">{range}. Still using {f[k].value}</span>}
            </div>
          ))}
        </div>
        <span className="mt-2 block text-xs text-muted-foreground">open roles filled: share of roles without a candidate that start in 2027. Defaults are illustrative: use your own history</span>
      </div>
    </div>
  );
}

function Section({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-4 sm:p-5 ${className}`}>
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/* ---------- data loading ---------- */
type Pos = ReturnType<typeof loadPositions> & { name: string | null };
type Hist = { rows: ReturnType<typeof loadHistory>; name: string | null };
const demoPos = (): Pos => ({ ...loadPositions(demoPositions), name: null });
const demoHist = (): Hist => ({ rows: loadHistory(demoHistory), name: null });
const readFile = (file: File) => new Promise<string>((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = () => no(fr.error); fr.readAsText(file); });

const POSITION_HELP: [string, string][] = [
  ["position_id", "any unique code"],
  ["department", "as you want it grouped"],
  ["grade", "G1 to G25"],
  ["base_salary", "annual, in euros"],
  ["target_bonus_pct", "optional, e.g. 15"],
  ["requested_month", "month the business asks for, YYYY-MM"],
  ["stage", "optional: interview, offer or accepted"],
  ["expected_start", "start date for accepted offers, YYYY-MM-DD"],
  ["project_start", "optional, YYYY-MM-DD: the role is not needed earlier"],
  ["critical", "optional, yes or no: critical roles are never deferred"],
];
const HISTORY_HELP: [string, string][] = [
  ["grade", "G1 to G25"],
  ["request_to_open_days", "days from request to posted vacancy"],
  ["open_to_start_days", "days from vacancy to the person's first day"],
];

/* ---------- page ---------- */
function Dashboard() {
  const f: Inputs = {
    target: useNum(DEFAULTS.target / 1e6, (v) => v > 0),
    current: useNum(DEFAULTS.existing_payroll / 1e6, (v) => v >= 0),
    shift: useNum(DEFAULTS.max_shift, (v) => Number.isInteger(v) && v >= 0 && v <= 6),
    interview: useNum(DEFAULTS.stage_days.interview, (v) => Number.isInteger(v) && v >= 0 && v <= 365),
    offer: useNum(DEFAULTS.stage_days.offer, (v) => Number.isInteger(v) && v >= 0 && v <= 365),
    attrition: useNum(DEFAULTS.attrition, (v) => v >= 0 && v <= 100),
    vacant: useNum(DEFAULTS.vacant_months, (v) => v >= 0 && v <= 12),
    fill: useNum(DEFAULTS.fill_rate, (v) => v >= 1 && v <= 100),
  };
  const rate = useNum(DEFAULTS.contrib_rate, (v) => v >= 0 && v <= 100);
  const ceiling = useNum(DEFAULTS.ceiling, (v) => v > 0, true);
  const [planDate, setPlanDate] = useState(DEFAULTS.as_of);
  const [pos, setPos] = useState<Pos>(demoPos);
  const [hist, setHist] = useState<Hist>(demoHist);
  const [error, setError] = useState<string | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const dataRef = useRef<HTMLDetailsElement>(null);
  const openData = () => {
    setDataOpen(true);
    requestAnimationFrame(() => dataRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const S = useMemo(() => ({
    ...DEFAULTS,
    target: (f.target.value ?? 0) * 1e6,
    existing_payroll: (f.current.value ?? 0) * 1e6,
    max_shift: f.shift.value ?? DEFAULTS.max_shift,
    stage_days: { interview: f.interview.value ?? 0, offer: f.offer.value ?? 0 },
    contrib_rate: rate.value ?? DEFAULTS.contrib_rate,
    ceiling: ceiling.value,
    as_of: planDate,
    attrition: f.attrition.value ?? DEFAULTS.attrition,
    vacant_months: f.vacant.value ?? DEFAULTS.vacant_months,
    fill_rate: f.fill.value ?? DEFAULTS.fill_rate,
  }), [f.target.value, f.current.value, f.shift.value, f.interview.value, f.offer.value, f.attrition.value, f.vacant.value, f.fill.value, rate.value, ceiling.value, planDate]);
  const r = useMemo(() => analyse(pos.positions, hist.rows, S), [pos, hist, S]);

  const load = (kind: "positions" | "history") => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await readFile(file);
      if (kind === "positions") {
        setPos({ ...loadPositions(text), name: file.name });
        if (!hist.name) setHist({ rows: [], name: null }); // demo history does not belong to the reader's roles
      } else setHist({ rows: loadHistory(text), name: file.name });
      setError(null);
    } catch (err) {
      setError(`${file.name}: ${(err as Error).message} Your previous data is still in use.`);
    }
  };
  const useDemo = () => { setPos(demoPos()); setHist(demoHist()); setError(null); };

  const noMoves = cents(r.gap) <= 0;
  const cantClose = !noMoves && cents(r.gap_after) > 0;
  const used = r.capacity > 0 ? Math.min(100, Math.round((-r.moves / r.capacity) * 100)) : 0;
  const verdict = noMoves
    ? `Within the target without deferrals: ${eurM(-r.gap)} headroom.`
    : cantClose
      ? `Over the target by ${eurM(r.gap_after)} even after all possible deferrals: agree which roles to cut.`
      : `The realistic forecast is ${eurM(r.gap)} over the target. It fits if ${r.moved_roles} of ${r.eligible_roles} roles that can wait start ${avgMonths(r)} months later on average: that saves ${eurM(-r.moves)}, ${used}% of what deferrals can give.`;
  const source = `${pos.name ?? "Simulated data"} · ${r.roles} open roles`;
  const notes = [
    !hist.rows.length && "No hiring history: default timelines by grade.",
    pos.name && !pos.notes.critical && "No critical column: no role is treated as critical.",
    pos.name && !pos.notes.stage && "No stage column: no candidates in the pipeline.",
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 border-b border-border pb-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Vacancy calendar: what open roles really cost in 2027</h1>
          <div className="shrink-0"><ThemeToggle /></div>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            <span className="block">Requests say “everyone from January”,<br className="sm:hidden" /> but people start later.</span>
            <span className="block">What will open roles cost at realistic start dates?</span>
            <span className="block">Which hires to defer to meet the payroll target?</span>
            <span className="block">What carries over into 2028?</span>
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground"><i className={`size-2 rounded-full ${pos.name ? "bg-good" : "bg-muted-foreground"}`} />{source}</span>
            <button className="btn" onClick={openData}>↑ Load your data</button>
          </div>
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden md:block">
          <div className="panel sticky top-6 p-4">
            <h2 className="mb-4 text-sm font-semibold">Your inputs</h2>
            <Scenario f={f} planDate={planDate} />
          </div>
        </aside>

        <main className="@container min-w-0 space-y-5">
          <Section title="2027 payroll against the target">
            <p className={`mb-4 text-base font-semibold leading-relaxed sm:text-lg ${cantClose ? "text-destructive" : ""}`}>{verdict}</p>
            <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3">
              <Kpi label="As requested by the business" value={r.total_requested} target={r.target} />
              <Kpi label="Realistic forecast" value={r.total_realistic} target={r.target} note="timelines, leavers, unfilled roles" />
              <Kpi label="After deferrals" value={r.total_after} target={r.target} note={noMoves ? "No deferrals needed" : undefined} />
            </div>
          </Section>

          <details className="panel group md:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Your inputs</span>
                <span className="block text-xs text-muted-foreground">Payroll target, current payroll, deferrals, pipeline, leavers, fill rate</span>
              </span>
              <span className="btn shrink-0 group-open:hidden">Change ▾</span>
              <span className="btn hidden shrink-0 group-open:inline-flex">Hide ▴</span>
            </summary>
            <div className="border-t border-border p-4"><Scenario f={f} planDate={planDate} /></div>
          </details>

          <Section title="2027 hiring budget: from the requests to the target"><Waterfall r={r} /></Section>

          <YearCards r={r} />

          <Section title="Payroll impact by department, €M">
            <Departments r={r} />
            <p className="mt-3 text-xs text-muted-foreground">Realistic: hiring timelines and the share of roles filled in 2027.{cents(r.leavers) > 0 && <> Leavers' empty seats ({eurM(-r.leavers, { sign: true })}) come off current payroll and are not split by department.</>}</p>
            <p className="mt-1 text-xs text-muted-foreground">Role-by-role list of deferrals: <a className="link" href="vacancy-calendar-model.xlsx" download>Excel model, Plan sheet</a></p>
          </Section>
        </main>
      </div>

      <details ref={dataRef} open={dataOpen} onToggle={(e) => setDataOpen(e.currentTarget.open)} className="panel group mt-5 scroll-mt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-semibold sm:p-5">
          Your data, Excel model and method <span className="text-muted-foreground transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="space-y-5 border-t border-border p-4 text-sm leading-relaxed sm:p-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="btn">
                Load open roles CSV
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={load("positions")} data-kind="positions" />
              </label>
              <label className="btn">
                Load hiring history CSV
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={load("history")} data-kind="history" />
              </label>
              {(pos.name || hist.name) && <button className="btn" onClick={useDemo}>Use demo data</button>}
            </div>
            <div className="text-muted-foreground">
              Open roles: {pos.name ?? "demo file"} · hiring history: {hist.name ?? (hist.rows.length ? "demo file" : "none")}. Your files stay in your browser: nothing is uploaded anywhere.
            </div>
            {error && <div role="alert" className="font-medium text-destructive">{error}</div>}
            {notes.map((n) => <div key={n} className="text-muted-foreground">{n}</div>)}
          </div>

          <div>
            <b>Templates:</b>{" "}
            <a className="link" href={csvHref(demoPositions)} download="sample-positions.csv">sample open roles CSV</a> ·{" "}
            <a className="link" href={csvHref(demoHistory)} download="sample-hiring-history.csv">sample hiring history CSV</a>
            <details className="mt-2 rounded-md border border-border">
              <summary className="cursor-pointer px-3 py-2 font-medium">Columns</summary>
              <div className="grid gap-4 px-3 pb-3 sm:grid-cols-2">
                {([["Open roles, one row per role", POSITION_HELP], ["Hiring history, one row per filled role", HISTORY_HELP]] as const).map(([t, rows]) => (
                  <div key={t}>
                    <div className="mb-1 font-medium">{t}</div>
                    <ul className="space-y-0.5 text-muted-foreground">{rows.map(([c, d]) => <li key={c}><code className="text-foreground">{c}</code>: {d}</li>)}</ul>
                  </div>
                ))}
              </div>
            </details>
          </div>

          <div className="grid gap-3 sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-start sm:gap-x-6">
            <b className="sm:pt-2">Employer contributions:</b>
            <div>
              <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
                <input className="field w-20 text-right" inputMode="decimal" value={rate.text} onChange={(e) => rate.set(e.target.value)} aria-label="Contribution rate, %" />
                <span>% on pay up to €</span>
                <input className="field w-28 text-right" inputMode="decimal" value={ceiling.text} onChange={(e) => ceiling.set(e.target.value)} aria-label="Annual ceiling, €" />
                <span>a year</span>
              </div>
              {rate.bad || ceiling.bad
                ? <span className="mt-1 block text-xs text-destructive">Rate 0 to 100, ceiling a positive number or empty. Still using {rate.value}% and {ceiling.value == null ? "no ceiling" : `€${ceiling.value.toLocaleString("en-US")}`}</span>
                : <span className="mt-1 block text-xs text-muted-foreground">Default: Spain 2026, 32.15% (30.65% general, permanent contracts + 1.50% occupational risk for office work) up to €5,101.20 a month. Empty ceiling: the rate applies to all pay.</span>}
            </div>
            <b className="sm:pt-2">Plan date:</b>
            <div>
              <input type="date" className="field sm:max-w-48" value={planDate} onChange={(e) => e.target.value && setPlanDate(e.target.value)} />
              <span className="mt-1 block text-xs text-muted-foreground">Candidates in the pipeline start counting from this date</span>
            </div>
          </div>

          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 font-medium">Hiring timelines by grade, G1 to G25</summary>
            <div className="max-h-80 overflow-auto">
              <table className="num w-full text-sm">
                <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left font-medium">Grade</th><th className="px-3 py-2 text-right font-medium">Days to approve</th>
                    <th className="px-3 py-2 text-right font-medium">Days from posting to start</th><th className="px-3 py-2 text-right font-medium">Filled roles in history</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(r.timing).map(([g, t]) => {
                    const dflt = t.n < S.min_history;
                    return (
                      <tr key={g} className={`border-b border-border transition-colors hover:bg-row-hover ${dflt ? "text-muted-foreground" : ""}`}>
                        <td className="px-3 py-1.5">{g}</td><td className="px-3 py-1.5 text-right">{t.lag}</td>
                        <td className="px-3 py-1.5 text-right">{t.ttf}</td><td className="px-3 py-1.5 text-right">{t.n}{dflt && " · default"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-3 py-2 text-xs text-muted-foreground">Fewer than {S.min_history} filled roles in the history: default timeline for the grade</p>
          </details>

          <p><b>Excel model:</b> <a className="link" href="vacancy-calendar-model.xlsx" download>download</a>. The same calculation in formulas, role by role, with the demo data and default settings. Your files and the values entered on this page do not go into it.</p>
          <p><b>How it is calculated:</b> <a className="link" href="method.html">method, step by step</a></p>
        </div>
      </details>

      <section className="mt-8 space-y-2 rounded-md border border-border bg-card px-4 py-3 text-sm">
        <p><b>Need it on your company's data?</b> I can adapt the tool to your grades, hiring history, contribution rules and payroll target. Terms on request: <a className="link" href="https://www.linkedin.com/in/olga-dimitrova-04311742a/" target="_blank" rel="noopener noreferrer">message me on LinkedIn</a>.</p>
        <p className="text-muted-foreground">New free C&amp;B tools go out first in my newsletter, <a className="link" href="https://www.linkedin.com/newsletters/compensation-budget-lab-7516123221679611904/" target="_blank" rel="noopener noreferrer">Compensation Budget Lab</a>.</p>
      </section>

      <footer className="mt-8 flex flex-wrap gap-x-1 border-t border-border pt-4 text-xs text-muted-foreground">
        Olga Dimitrova · <a className="hover:text-foreground hover:underline" href="https://www.linkedin.com/in/olga-dimitrova-04311742a/" target="_blank" rel="author noopener noreferrer">LinkedIn</a> · <a className="hover:text-foreground hover:underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="license noopener noreferrer">CC BY 4.0</a> · demo data is simulated
      </footer>
    </div>
  );
}
