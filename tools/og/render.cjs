// Renders tools/og/og.html to og-image.png (1200×630), the picture shown when a dancerly link is shared.
// Usage: node tools/og/render.cjs   (needs Playwright's Chromium)
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'og.html'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, '..', '..', 'og-image.png') });
  await browser.close();
  console.log('Wrote og-image.png');
})();
