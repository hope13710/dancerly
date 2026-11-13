// The app icon and favicons, drawn from one vector "d" (run: node tools/make-icons.js).
// Writes logo.svg and public/favicon.svg, and renders the PNGs with the preinstalled Chromium (Playwright).
//   • Large icons (home screen, install): the "d" as designed, on a soft top-to-bottom purple gradient.
//   • Favicons (16–64px): the same "d", slightly bigger and bolder (thicker stem and bowl, smaller counter),
//     because thin parts blur away at tab size. Big companies tune small icon sizes the same way.
//   • Maskable (Android): full-bleed square, "d" at 82% so it stays inside the area Android may crop to a circle.
//   • apple-touch-icon: full-bleed square; iOS rounds the corners itself.
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const TOP = '#5856E4';
const BOTTOM = '#3E3CC6';

// A circle as a path; clockwise (sweep 1) adds, counter-clockwise (sweep 0) cuts a hole under the nonzero rule.
const circle = (cx, cy, r, cw = true) => {
  const s = cw ? 1 : 0;
  return `M${cx - r} ${cy}a${r} ${r} 0 1 ${s} ${2 * r} 0a${r} ${r} 0 1 ${s} ${-2 * r} 0Z`;
};
// A rounded rectangle, clockwise.
const rrect = (x, y, w, h, r) =>
  `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;

// The "d" in a 512 box (measured from the current icon), as one path: bowl + stem, minus the counter.
const D = {
  regular: { bowl: [242, 295, 117], stem: [312, 98, 74, 312, 8], counter: [251, 293.5, 55] },
  // Small sizes: thicker strokes, the same outline.
  bold: { bowl: [240, 297, 119], stem: [308, 96, 82, 316, 9], counter: [249, 295, 49] },
};
const dPath = ({ bowl, stem, counter }) => `${circle(...bowl)}${rrect(...stem)}${circle(...counter, false)}`;

function svg({ weight = 'regular', scale = 1, rounded = true, size = 512 }) {
  // Scale the letter about its own center (255.5, 255) and place it at the icon's center.
  const t = `translate(256 256) scale(${scale}) translate(-255.5 -255)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TOP}"/><stop offset="1" stop-color="${BOTTOM}"/></linearGradient></defs>
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#bg)"/>
  <path transform="${t}" fill="#fff" d="${dPath(D[weight])}"/>
</svg>
`;
}

const outputs = [
  // [file, size, options]
  ['icon-512.png', 512, { weight: 'regular' }],
  ['public/icon-192.png', 192, { weight: 'regular' }],
  ['apple-touch-icon.png', 180, { weight: 'regular', rounded: false }],
  ['public/icon-maskable-512.png', 512, { weight: 'regular', rounded: false, scale: 0.82 }],
  ['public/icon-maskable-192.png', 192, { weight: 'regular', rounded: false, scale: 0.82 }],
  ['favicon.png', 64, { weight: 'bold', scale: 1.1 }],
];

await writeFile('logo.svg', svg({ weight: 'regular' }));
await writeFile('public/favicon.svg', svg({ weight: 'bold', scale: 1.1 }));

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, size, opts] of outputs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg({ ...opts, size })}</body></html>`);
  await page.locator('svg').screenshot({ path: file, omitBackground: true });
  console.log('wrote', file);
}
await browser.close();
