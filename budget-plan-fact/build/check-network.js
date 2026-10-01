/* Checks that the dashboard makes no network calls, on load and after a CSV
 * is picked. The page promises that an uploaded file stays in the browser;
 * anything wired to the first upload (a lazy parser, a beacon) would slip past
 * a load-only check, so the sample CSV goes through the real file input.
 *
 *   node build/check-network.js     exit 1 on any request or an ignored upload
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = 'file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/');
const SAMPLE = path.join(ROOT, 'sample.csv');

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
  });
  const p = await b.newPage();
  const requests = [];
  p.on('request', r => {
    const u = r.url();
    if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) requests.push(u);
  });
  await p.goto(PAGE, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 300));
  console.log('network requests (load):', requests.length ? requests.join('; ') : 'none');

  const loadCount = requests.length;
  const before = await p.evaluate(() => document.body.innerText);
  const input = await p.$('#csv');
  if (!input) { console.error('csv input MISSING'); process.exit(1); }
  await input.uploadFile(SAMPLE);
  await p.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1000));
  // A pick the page ignored would make "no requests" meaningless.
  const after = await p.evaluate(() => document.body.innerText);
  const changed = after !== before;
  console.log('page changed after CSV pick:', changed ? 'yes' : 'NO — upload not processed');
  const late = requests.slice(loadCount);
  console.log('network requests (after CSV pick):', late.length ? late.join('; ') : 'none');
  await b.close();
  if (requests.length || !changed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
