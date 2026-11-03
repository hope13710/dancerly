// Renders tools/demo/demo.html into a 30-second 1080×1920 MP4 (tools/demo/out/dancerly-demo.mp4).
// Usage: node tools/demo/render.cjs            → full video (PAGE=story renders story.html → dancerly-story.mp4)
//        node tools/demo/render.cjs 3 9.7 22   → only PNG stills at those seconds (for checking)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const FPS = 30, DURATION = 30;
const PAGE = process.env.PAGE || 'demo';
const NAME = PAGE === 'demo' ? 'dancerly-demo' : `dancerly-${PAGE}`;
(async () => {
  const out = path.join(__dirname, 'out');
  const frames = path.join(out, 'frames');
  fs.mkdirSync(frames, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(__dirname, `${PAGE}.html`));
  await page.evaluate(() => window.ready);
  const stills = process.argv.slice(2).map(Number);
  if (stills.length) {
    for (const t of stills) { await page.evaluate((t) => window.render(t), t); await page.screenshot({ path: path.join(out, `${PAGE}-still-${t}.png`) }); }
    console.log('stills in', out);
  } else {
    for (const f of fs.readdirSync(frames)) fs.unlinkSync(path.join(frames, f));
    const n = FPS * DURATION;
    for (let i = 0; i < n; i++) {
      await page.evaluate((t) => window.render(t), i / FPS);
      await page.screenshot({ path: path.join(frames, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
    }
    const mp4 = path.join(out, `${NAME}.mp4`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, '%04d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
    console.log('wrote', mp4);
  }
  await browser.close();
})();
