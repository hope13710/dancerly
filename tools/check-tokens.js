// Keeps the app's look on its tokens (app/tokens.css): counts raw values in app/app.css that should be tokens
// and fails the build if any count goes up from tools/token-baseline.json. Counts going down is the goal;
// run `node tools/check-tokens.js --update` after cleaning some up to lock the lower numbers in.
// Raw colors, font sizes and radii that have a token belong in tokens; ones that don't are a new decision,
// made in tokens.css first.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const css = readFileSync(new URL('app/app.css', root), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const baselineUrl = new URL('tools/token-baseline.json', root);

const count = (re) => (css.match(re) || []).length;
const now = {
  'raw colors (#hex)': count(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g),
  'raw rgba()': count(/rgba?\(\s*\d/g),
  'raw font sizes (px)': count(/font-size:\s*\d+(\.\d+)?px/g),
  'raw radii (px)': count(/border-radius:\s*\d+px/g),
  'raw box-shadows': count(/box-shadow:(?!\s*(?:none|var\())[^;]*\d/g),
  '!important': count(/!important/g)
};

if (process.argv.includes('--update')) {
  writeFileSync(baselineUrl, `${JSON.stringify(now, null, 2)}\n`);
  console.log('Token baseline updated:', now);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselineUrl, 'utf8'));
const worse = Object.entries(now).filter(([k, v]) => v > (baseline[k] ?? 0));
if (worse.length) {
  console.error('\nDesign tokens: app/app.css has new raw values. Use the tokens in app/tokens.css instead');
  console.error('(or add a token there first, if this really is a new color, size or radius):');
  for (const [k, v] of worse) console.error(`  ${k}: ${v} (was ${baseline[k]})`);
  console.error('');
  process.exit(1);
}
const better = Object.entries(now).filter(([k, v]) => v < baseline[k]);
if (better.length) console.log('Design tokens: fewer raw values than the baseline:', Object.fromEntries(better), '(run node tools/check-tokens.js --update)');
