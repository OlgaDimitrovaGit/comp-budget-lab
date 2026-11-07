// The page promises that the reader's files stay in the browser. Checks: no network request
// on load, none after a CSV goes through the real file inputs, and the page did take the file
// (an ignored pick would make "no requests" meaningless).
//   node check-network.mjs     exit 1 on any request or an ignored upload
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const puppeteer = createRequire(join(HERE, "package.json"))("puppeteer-core");
const PAGE = pathToFileURL(join(HERE, "..", "index.html")).href;
const PROJ = join(HERE, "..");

const b = await puppeteer.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new" });
let failed = false;
try {
  const p = await b.newPage();
  const requests = [];
  p.on("request", (r) => { const u = r.url(); if (!/^(file|data|blob):/.test(u)) requests.push(u); });
  await p.goto(PAGE, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 300));
  console.log("requests on load:", requests.length ? requests.join("; ") : "none");
  const loaded = requests.length;
  // innerText skips closed <details>: open them so the file name and any error are visible.
  await p.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));

  for (const [kind, file, expect] of [
    ["positions", "sample-positions.csv", "sample-positions.csv · 240 open roles"],
    ["history", "sample-hiring-history.csv", "hiring history: sample-hiring-history.csv"],
  ]) {
    const input = await p.$(`input[type=file][data-kind=${kind}]`);
    if (!input) { console.log(`${kind} file input MISSING`); failed = true; continue; }
    await input.uploadFile(join(PROJ, file));
    await p.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    const text = await p.evaluate(() => document.body.innerText);
    const taken = text.includes(expect);
    console.log(`${kind} file accepted:`, taken ? "yes" : `NO (expected "${expect}" on the page)`);
    if (!taken) failed = true;
  }
  const late = requests.slice(loaded);
  console.log("requests after file picks:", late.length ? late.join("; ") : "none");
  if (requests.length) failed = true;
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
