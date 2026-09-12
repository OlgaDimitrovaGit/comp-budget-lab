/* A large screenshot of the chart card — both themes, desktop and phone.
 * The chart on this project has twice broken without any automated check
 * noticing. */
const puppeteer = require('puppeteer-core');
const path = require('path');

const PAGE = 'file:///' + path.resolve(__dirname, '..', 'index.html')
  .split(path.sep).join('/');

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
  });
  for (const [theme, w] of [['light', 1280], ['dark', 1280],
                            ['light', 390], ['dark', 390]]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 2 });
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await p.goto(PAGE, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 300));

    const svg = await p.$('svg');
    const box = await svg.boundingBox();
    const card = await p.evaluateHandle(s => s.closest('section') || s.parentElement, svg);
    const tag = (w === 390 ? 'phone' : 'desk') + '-' + theme;
    await card.asElement().screenshot({
      path: path.join(__dirname, 'shots', 'chart-' + tag + '.png'),
    });
    console.log('chart-' + tag + ': svg ' + Math.round(box.width) + 'x' + Math.round(box.height));
    await p.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
