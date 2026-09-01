/* Проверка авторской метки, лицензии, метаданных и образца CSV.
 *
 * Главное здесь — что внешние ссылки в подвале остались ссылками и не
 * превратились в сетевые вызовы: правило проекта запрещает запросы, а не
 * гиперссылки, и разница проверяется, а не предполагается.
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const PAGE = 'file:///' + path.resolve(__dirname, '..', 'pay-gap-calculator.html')
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
  console.log('network requests:', requests.length ? requests.join('; ') : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
