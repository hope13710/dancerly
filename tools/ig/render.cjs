// Renders each slide in an Instagram post (tools/ig/post*.html) to its own 1080×1350 PNG.
// Usage: node tools/ig/render.cjs post1   →  tools/ig/out/post1-1.png … post1-8.png   (needs Playwright's Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const name = process.argv[2] || 'post1';
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, `${name}.html`));
  await page.waitForTimeout(400);
  for (const slide of await page.$$('[data-slide]')) {
    const n = await slide.getAttribute('data-slide');
    await slide.screenshot({ path: path.join(out, `${name}-${n}.png`) });
  }
  await browser.close();
  console.log(`Wrote ${out}/${name}-*.png`);
})();
