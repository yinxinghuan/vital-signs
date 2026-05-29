// Splash → poster screenshot.
// Per project rule: puppeteer viewport = output/2, deviceScaleFactor=2.
// Rendering at full output dims collapses CSS-clamped titles.

const puppeteer = require('/Users/yin/AlterU_logo_concepts/node_modules/puppeteer');
const path = require('path');

const OUT_PATH = '/Users/yin/code/games/games/posters/vital-signs.png';
const URL = process.env.URL || 'https://yinxinghuan.github.io/vital-signs/#demo=splash';
const OUT_W = 1024;
const OUT_H = 1024;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 120000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    defaultViewport: {
      width: OUT_W / 2,
      height: OUT_H / 2,
      deviceScaleFactor: 2,
    },
  });
  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait briefly for fonts + first paint
    await new Promise(r => setTimeout(r, 3000));
    // Kill RAF + animations so screenshot capture isn't fighting the render loop
    await page.evaluate(() => {
      window.requestAnimationFrame = function() { return 0; };
    });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: OUT_PATH, type: 'png', captureBeyondViewport: false, timeout: 60000 });
    console.log('wrote', OUT_PATH);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
