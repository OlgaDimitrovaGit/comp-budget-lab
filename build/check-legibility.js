/* Замер фактического кегля SVG-подписей на телефоне.
 *
 * SVG задан в единицах viewBox и масштабируется под ширину контейнера.
 * На узком экране 14px внутри viewBox превращаются в реальные 5-6px —
 * автопроверки этого не видят, потому что в разметке кегль не менялся.
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const PAGE = 'file:///' + path.resolve(__dirname, '..', 'pay-gap-calculator.html')
  .split(path.sep).join('/');
const MIN_PX = 11;   // ниже этого подпись на телефоне нечитаема

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
  });
  for (const w of [1280, 390]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 2 });
    await p.goto(PAGE, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 300));

    const res = await p.evaluate(() => {
      const svg = document.querySelector('svg');
      const vb = svg.viewBox.baseVal;
      const rect = svg.getBoundingClientRect();
      const scale = rect.width / vb.width;
      const out = [];
      svg.querySelectorAll('text').forEach(t => {
        const declared = parseFloat(getComputedStyle(t).fontSize);
        out.push({
          text: t.textContent.trim().slice(0, 22),
          declared: +declared.toFixed(1),
          effective: +(declared * scale).toFixed(1),
        });
      });
      return { scale: +scale.toFixed(3), svgW: Math.round(rect.width),
               vbW: vb.width, labels: out };
    });

    console.log(`--- viewport ${w}px ---`);
    console.log(`  svg ${res.svgW}px / viewBox ${res.vbW} -> scale ${res.scale}`);
    const bad = res.labels.filter(l => l.effective < MIN_PX);
    const groups = {};
    res.labels.forEach(l => {
      const k = l.declared + ' -> ' + l.effective;
      (groups[k] = groups[k] || []).push(l.text);
    });
    Object.entries(groups).forEach(([k, v]) => {
      const eff = parseFloat(k.split('-> ')[1]);
      console.log(`  ${eff < MIN_PX ? 'TOO SMALL' : 'ok       '} ${k}px  (${v.length}) e.g. "${v[0]}"`);
    });
    console.log(`  below ${MIN_PX}px: ${bad.length} of ${res.labels.length}`);
    console.log('');
    await p.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
