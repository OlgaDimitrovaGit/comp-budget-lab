/* Снимок собранной страницы в реальном браузере: обе темы, десктоп и телефон.
 *
 * jsdom не показывает масштаб и не рисует SVG — обрезанные подписи и невидимая
 * стрелка в прошлый раз прошли мимо всех автопроверок. Здесь настоящий Chrome.
 *
 * Заодно снимает числа со страницы для сверки с Excel-моделью: это ответ на
 * число из работающей страницы не то же самое, что
 * число из calc.js в Node.
 *
 * Запуск: node build/check-visual.js
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'file:///' + path.resolve(__dirname, '..', 'pay-gap-calculator.html')
  .replace(/\\/g, '/');
const OUT = path.resolve(__dirname, 'shots');

const VIEWS = [
  { name: 'desktop', width: 1280, height: 900, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },   // iPhone 14
];
const THEMES = ['light', 'dark'];

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--allow-file-access-from-files', '--force-device-scale-factor=2'],
  });

  const report = [];

  for (const view of VIEWS) {
    for (const theme of THEMES) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => {
        if (m.type() === 'error') errors.push('console: ' + m.text());
      });
      // сетевые вызовы наружу — правило проекта, ноль
      const external = [];
      page.on('request', r => {
        const u = r.url();
        if (!u.startsWith('file://') && !u.startsWith('data:')) external.push(u);
      });

      await page.setViewport({
        width: view.width, height: view.height,
        deviceScaleFactor: 2, isMobile: view.mobile, hasTouch: view.mobile,
      });
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: theme },
      ]);
      await page.goto(PAGE, { waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 400));

      const tag = `${view.name}-${theme}`;

      // числа со страницы — то, что реально видит человек
      const data = await page.evaluate(() => {
        const txt = el => (el ? el.textContent.trim() : null);
        const nums = Array.from(document.querySelectorAll('body *'))
          .filter(el => !el.children.length && /€[\d\s,.]+/.test(el.textContent))
          .map(el => el.textContent.trim());
        const svg = document.querySelector('svg');
        // подписи, вылезающие за границы своего SVG
        let clipped = [];
        if (svg) {
          const box = svg.getBoundingClientRect();
          clipped = Array.from(svg.querySelectorAll('text')).filter(t => {
            const b = t.getBoundingClientRect();
            return b.width && (b.left < box.left - 0.5 || b.right > box.right + 0.5
              || b.top < box.top - 0.5 || b.bottom > box.bottom + 0.5);
          }).map(t => t.textContent.trim());
        }
        return {
          title: txt(document.querySelector('h1')),
          money: nums.slice(0, 12),
          svgCount: document.querySelectorAll('svg').length,
          svgTexts: svg ? svg.querySelectorAll('text').length : 0,
          clipped,
          bodyOverflow: document.body.scrollWidth > window.innerWidth + 1,
          scrollW: document.body.scrollWidth,
          innerW: window.innerWidth,
          bg: getComputedStyle(document.body).backgroundColor,
          fg: getComputedStyle(document.body).color,
        };
      });

      await page.screenshot({
        path: path.join(OUT, `${tag}.png`), fullPage: true,
      });
      // первый экран отдельно — критерий «три числа за три секунды»
      await page.screenshot({
        path: path.join(OUT, `${tag}-fold.png`), fullPage: false,
      });

      report.push({ tag, errors, external, ...data });
      await page.close();
    }
  }

  await browser.close();

  console.log('=== VISUAL CHECK ===\n');
  for (const r of report) {
    console.log(`--- ${r.tag} ---`);
    console.log('  bg/fg      :', r.bg, '/', r.fg);
    console.log('  js errors  :', r.errors.length ? r.errors.join('; ') : 'none');
    console.log('  external   :', r.external.length ? r.external.join('; ') : 'none');
    console.log('  svg        :', r.svgCount, 'svg,', r.svgTexts, 'text nodes');
    console.log('  clipped    :', r.clipped.length ? r.clipped.join(' | ') : 'none');
    console.log('  h-overflow :', r.bodyOverflow ? `YES (${r.scrollW} > ${r.innerW})` : 'no');
    console.log('  money      :', r.money.slice(0, 6).join(' | '));
    console.log('');
  }
  console.log('shots ->', OUT);
})().catch(e => { console.error(e); process.exit(1); });
