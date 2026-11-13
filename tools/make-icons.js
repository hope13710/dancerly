// The app icon and favicons, drawn from one vector "d" (run: node tools/make-icons.js).
// Writes logo.svg and public/favicon.svg, and renders the PNGs with the preinstalled Chromium (Playwright).
//   • Large icons (home screen, install): the "d" as designed, on a soft top-to-bottom purple gradient.
//   • Favicons (16–64px): the same "d", slightly bigger and bolder (thicker stem and bowl, smaller counter),
//     because thin parts blur away at tab size. Big companies tune small icon sizes the same way.
//   • Maskable (Android): full-bleed square, "d" at 82% so it stays inside the area Android may crop to a circle.
//   • apple-touch-icon: full-bleed square; iOS rounds the corners itself.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

// Optical centering: centered by its outline, the "d" looks low and to the right (the bowl's weight sits bottom
// left of the stem, and the stem's tip is thin). Its visual weight was 4% right and 4% below center, so it moves
// up and left by about two thirds of that: centered to the eye, without overcorrecting.
const NUDGE = [-14, -12];

function svg({ weight = 'regular', scale = 1, rounded = true, size = 512 }) {
  // Scale the letter about its own center (255.5, 255), place it at the icon's center, then nudge it.
  const t = `translate(${256 + NUDGE[0] * scale} ${256 + NUDGE[1] * scale}) scale(${scale}) translate(-255.5 -255)`;
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

// iPhone and iPad launch images (Home Screen app): the app icon, 120pt, in the middle of the app's background, the same
// picture Android draws from the manifest and the app shows until its first screen (app/index.html, .boot).
// iPhone only uses an image made for its exact screen, so one per screen size, portrait. [css width, height, scale]
const SPLASH_BG = '#F7F8FA';
const SCREENS = [
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
  [430, 932, 3], // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  [420, 912, 3], // Air
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 12 Pro, 13, 13 Pro, 14, 16e
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [414, 736, 3], // 8 Plus
  [375, 667, 2], // SE (2nd and 3rd), 8
];
// iPads, held either way: one image per orientation.
const IPADS = [
  [1032, 1376, 2], // Pro 13" (M4), Air 13"
  [1024, 1366, 2], // Pro 12.9"
  [834, 1210, 2], // Pro 11" (M4)
  [834, 1194, 2], // Pro 11"
  [820, 1180, 2], // Air 10.9"/11", iPad 10th gen and A16
  [834, 1112, 2], // Air 10.5", Pro 10.5"
  [810, 1080, 2], // iPad 10.2" (7th–9th gen)
  [768, 1024, 2], // mini 7.9", iPad 9.7"
  [744, 1133, 2], // mini 8.3" (6th gen and later)
];
const LAUNCH = [
  ...SCREENS.map(([w, h, dpr]) => ['iphone', w, h, dpr, 'portrait']),
  ...IPADS.flatMap(([w, h, dpr]) => [['ipad', w, h, dpr, 'portrait'], ['ipad', w, h, dpr, 'landscape']]),
];
await mkdir('public/splash', { recursive: true });
const tags = [];
for (const [kind, w, h, dpr, orientation] of LAUNCH) {
  // device-width/height are the portrait size either way; a landscape image is that size turned on its side.
  const [vw, vh] = orientation === 'portrait' ? [w, h] : [h, w];
  const file = `splash/${kind}-${vw * dpr}x${vh * dpr}.png`;
  const shot = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
  await shot.setContent(`<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:${SPLASH_BG}"><div style="width:120px;height:120px">${svg({ size: 120 })}</div></body></html>`);
  await shot.screenshot({ path: `public/${file}` });
  await shot.close();
  tags.push(`    <link rel="apple-touch-startup-image" href="/${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation})" />`);
  console.log('wrote', `public/${file}`);
}
await browser.close();

// The <link> tags go in app/index.html between the splash markers.
const html = await readFile('app/index.html', 'utf8');
const marked = html.replace(/(<!-- splash -->\n)[\s\S]*?( *<!-- \/splash -->)/, `$1${tags.join('\n')}\n$2`);
if (marked === html && !html.includes('<!-- splash -->')) console.warn('app/index.html has no <!-- splash --> markers: tags not written');
else await writeFile('app/index.html', marked);
