/* Checks the author credit, licence, metadata and the CSV sample.
 *
 * The main point here is that the external links in the footer stayed links and
 * did not turn into network calls: the rule forbids requests, not hyperlinks,
 * and the difference is verified rather than assumed.
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const PAGE = 'file:///' + path.resolve(__dirname, '..', 'index.html')
  .split(path.sep).join('/');

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
  });
  const p = await b.newPage();
  const requests = [];
  p.on('request', r => {
    const u = r.url();
    if (!u.startsWith('file://') && !u.startsWith('data:')) requests.push(u);
  });
  await p.goto(PAGE, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 300));

  const d = await p.evaluate(() => {
    const meta = n => {
      const el = document.querySelector(
        `meta[name="${n}"], meta[property="${n}"]`);
      return el ? el.getAttribute('content') : null;
    };
    const sample = document.getElementById('sample-csv');
    let sampleDecoded = null, sampleRows = 0;
    if (sample) {
      const href = sample.getAttribute('href') || '';
      const m = href.match(/^data:text\/csv;charset=utf-8;base64,(.+)$/);
      if (m) {
        sampleDecoded = atob(m[1]);
        sampleRows = sampleDecoded.trim().split('\n').length - 1;
      }
    }
    const links = [...document.querySelectorAll('footer a')].map(a => ({
      text: a.textContent.trim(), href: a.href, rel: a.rel,
    }));
    return {
      title: document.title,
      description: meta('description'),
      author: meta('author'),
      ogTitle: meta('og:title'),
      ogDescription: meta('og:description'),
      licenceLink: (document.querySelector('link[rel="license"]') || {}).href || null,
      byline: (document.querySelector('.byline') || {}).textContent || null,
      footerLinks: links,
      sampleExists: !!sample,
      sampleIsDataUri: sampleDecoded !== null,
      sampleDownloadName: sample ? sample.getAttribute('download') : null,
      sampleRows,
      sampleHeader: sampleDecoded ? sampleDecoded.split('\n')[0] : null,
    };
  });

  console.log('title       :', d.title);
  console.log('description :', d.description ? d.description.slice(0, 70) + '…' : 'MISSING');
  console.log('author      :', d.author || 'MISSING');
  console.log('og:title    :', d.ogTitle || 'MISSING');
  console.log('og:desc     :', d.ogDescription ? 'present' : 'MISSING');
  console.log('link license:', d.licenceLink || 'MISSING');
  console.log('');
  console.log('byline      :', (d.byline || 'MISSING').replace(/\s+/g, ' ').trim());
  console.log('footer links:');
  d.footerLinks.forEach(l => console.log(`   "${l.text}" -> ${l.href} [rel=${l.rel}]`));
  console.log('');
  console.log('sample link :', d.sampleExists ? 'present' : 'MISSING');
  console.log('  data URI  :', d.sampleIsDataUri ? 'yes' : 'NO — external file!');
  console.log('  download  :', d.sampleDownloadName);
  console.log('  rows      :', d.sampleRows);
  console.log('  header    :', d.sampleHeader);
  console.log('');
  console.log('network requests (load):', requests.length ? requests.join('; ') : 'none');

  // Loading is only half of the promise: anything wired to the first upload
  // (a lazy parser, a beacon) would slip past a load-only check. Pick the
  // sample CSV through the real file input and keep listening.
  const loadCount = requests.length;
  if (d.sampleIsDataUri) {
    const os = require('os'), fs = require('fs');
    const tmp = path.join(os.tmpdir(), 'pay-gap-sample.csv');
    const csv = await p.evaluate(() => atob(document.getElementById('sample-csv')
      .getAttribute('href').split(',')[1]));
    fs.writeFileSync(tmp, csv);
    const input = await p.$('#csv-input');
    if (!input) { console.error('csv input MISSING'); process.exit(1); }
    await input.uploadFile(tmp);
    await p.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
    fs.unlinkSync(tmp);
    // A pick that the page ignored would make "no requests" meaningless.
    const msg = await p.$eval('#csv-messages', el => el.textContent.trim());
    console.log('csv messages:', msg || 'NONE — upload not processed');
    if (!msg) process.exit(1);
    const after = requests.slice(loadCount);
    console.log('network requests (after CSV pick):', after.length ? after.join('; ') : 'none');
  }
  await b.close();
  // The page promises that data never leaves the tab; a request must fail the check.
  if (requests.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
