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
    defaultViewport: {
      width: OUT_W / 2,
      height: OUT_H / 2,
      deviceScaleFactor: 2,
    },
  });
  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    // Give fonts + animations a moment to settle
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({
      path: OUT_PATH,
      type: 'png',
      omitBackground: false,
    });
    console.log('wrote', OUT_PATH);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
