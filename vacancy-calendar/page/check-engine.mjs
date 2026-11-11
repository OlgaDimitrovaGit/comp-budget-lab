// The page engine must equal reference_calc.py to the cent. exit 1 on any difference.
//   node check-engine.mjs            demo + 4,000-row file with FTE + changed settings
//   node check-engine.mjs --self-test  a broken engine result must be caught
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULTS, loadPositions, loadHistory, analyse } from "./src/lib/engine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJ = join(HERE, "..");
const POS = join(PROJ, "sample-positions.csv"), HIST = join(PROJ, "sample-hiring-history.csv");
const tmp = mkdtempSync(join(tmpdir(), "vc-check-"));
const selfTest = process.argv.includes("--self-test");

// 4,000 roles: the demo rows repeated with varied ids, grades and months (deterministic).
const demo = readFileSync(POS, "utf8").trim().split(/\r?\n/);
const FTES = ["1", "0.5", "1,5", "10", "2.5", ""];
const big = [demo[0] + ",fte"];
for (let i = 0; i < 4000; i++) {
  const c = demo[1 + (i % (demo.length - 1))].split(",");
  c[0] = `B${String(i + 1).padStart(5, "0")}`;
  c[2] = `G${1 + ((i * 7) % 25)}`;
  c[5] = `2027-${String(1 + ((i * 5) % 12)).padStart(2, "0")}`;
  const f = FTES[i % FTES.length];
  big.push(c.join(",") + "," + (f.includes(",") ? `"${f}"` : f));
}
const BIG = join(tmp, "big.csv");
writeFileSync(BIG, big.join("\n"));

const cases = [
  { name: "demo", pos: POS, hist: HIST, set: {} },
  { name: "demo, target 134M (moves can't close)", pos: POS, hist: HIST, set: { target: 134_000_000 } },
  { name: "demo, shift 6, rate 30, no ceiling, plan date 2027-01-10", pos: POS, hist: HIST,
    set: { max_shift: 6, contrib_rate: 30, ceiling: null, as_of: "2027-01-10", stage_days: { interview: 60, offer: 30 } } },
  { name: "4,000 roles, payroll 300M, target 437M", pos: BIG, hist: HIST, set: { existing_payroll: 300_000_000, target: 437_000_000 } },
  // No leavers and every role filled: must give the figures before these settings existed (05.11 demo).
  { name: "demo, payroll 66M, no leavers, all roles filled, target 76.3M", pos: POS, hist: HIST,
    set: { existing_payroll: 66_000_000, attrition: 0, fill_rate: 100, target: 76_300_000 },
    expect: { gap: 2731061.18, moved_roles: 128, moved_months: 384 } },
  { name: "demo, attrition 20%, seat empty 4 months, fill rate 50%, target 134M", pos: POS, hist: HIST,
    set: { attrition: 20, vacant_months: 4, fill_rate: 50, target: 134_000_000 } },
];

let fail = 0;
const near = (a, b) => Math.abs(a - b) < 0.005;
for (const c of cases) {
  const sf = join(tmp, "s.json");
  writeFileSync(sf, JSON.stringify(c.set));
  const ref = JSON.parse(execFileSync("python", [join(HERE, "..", "build", "dump_reference.py"), c.pos, c.hist, sf], { encoding: "utf8", maxBuffer: 1 << 26 }));
  const S = { ...DEFAULTS, ...c.set };
  const R = analyse(loadPositions(readFileSync(c.pos, "utf8")).positions, loadHistory(readFileSync(c.hist, "utf8")), S);
  if (selfTest) R.after_moves += 0.01;
  const errs = [];
  for (const k of Object.keys(ref).filter((k) => typeof ref[k] === "number")) if (!near(R[k], ref[k])) errs.push(`${k}: page ${R[k]} vs reference ${ref[k]}`);
  ref.steps.forEach((v, i) => { if (!near(Object.values(R.bridge)[i], v)) errs.push(`step ${i}: ${Object.values(R.bridge)[i]} vs ${v}`); });
  ref.shifts.forEach((v, i) => { if (R.rows[i].shift !== v) errs.push(`row ${i + 1} shift ${R.rows[i].shift} vs ${v}`); });
  ref.depts.forEach((d, i) => { for (const k of Object.keys(d)) if (typeof d[k] === "number" ? !near(R.depts[i][k], d[k]) : R.depts[i][k] !== d[k]) errs.push(`dept ${d.department} ${k}`); });
  for (const [k, v] of Object.entries(c.expect || {})) if (!near(ref[k], v)) errs.push(`${k}: reference ${ref[k]} vs fixed ${v}`);
  for (const [g, [n, lag, ttf]] of Object.entries(ref.timing)) { const t = R.timing[g]; if (t.n !== n || t.lag !== lag || t.ttf !== ttf) errs.push(`timing ${g}`); }
  console.log(`${errs.length ? "FAIL" : "ok  "} ${c.name}: after moves ${R.total_after.toFixed(2)}, gap after ${R.gap_after.toFixed(2)}, moved ${R.moved_roles}`);
  errs.slice(0, 8).forEach((e) => console.log("     " + e));
  if (errs.length) fail++;
}
// FTE is linear: 0.5 of a post costs exactly half a full post, contributions included,
// also above the contribution ceiling.
{
  const head = "position_id,department,grade,base_salary,target_bonus_pct,requested_month,fte";
  const csv = [head, "A,X,G18,90000,15,2027-08,1", "B,X,G18,90000,15,2027-08,0.5", "C,X,G18,90000,15,2027-08,1.5"].join("\n");
  const R = analyse(loadPositions(csv).positions, [], { ...DEFAULTS });
  const [a, b, c] = R.rows;
  const ok = [0, 1, 2, 3, 4].every((k) => near(b.cost[k], a.cost[k] / 2) && near(c.cost[k], a.cost[k] * 1.5)) && near(b.annual, a.annual / 2);
  console.log(`${ok ? "ok  " : "FAIL"} FTE 0.5 and 1.5 cost half and one and a half of a full post`);
  if (!ok) fail++;
}
if (selfTest) {
  if (fail >= cases.length) { console.log("self-test ok: broken result caught"); process.exit(0); }
  console.log("self-test FAIL: broken result not caught"); process.exit(1);
}
process.exit(fail ? 1 : 0);
