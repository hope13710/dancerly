// English / Korean. The app is written in English; in Korean mode, rendered text and labels are swapped
// using the dictionary below (exact phrases) and a few patterns (phrases with numbers or names in them).
// What people type — notes, replies, titles they gave — is never translated.
import { KO, KO_RULES, KO_ATTR, KO_ACTION } from './i18n-ko.js';

const KEY = 'looproom:lang';
export const LANGS = [['en', 'English'], ['ko', '한국어']];
export function getLang() {
  try { return localStorage.getItem(KEY) === 'ko' ? 'ko' : 'en'; } catch { return 'en'; }
}
export function setLang(lang) {
  try { localStorage.setItem(KEY, lang === 'ko' ? 'ko' : 'en'); } catch {}
}
export const lang = getLang();
export const isKo = lang === 'ko';

// Dates and times follow the chosen language wherever the code leaves the locale open.
if (isKo) {
  for (const name of ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']) {
    const original = Date.prototype[name];
    Date.prototype[name] = function (locales, options) { return original.call(this, locales ?? 'ko-KR', options); };
  }
}

// For text built in code (toasts, dialogs): t('Saved.') returns the Korean when it exists.
export function t(text) {
  if (!isKo || !text) return text;
  return translate(String(text)) ?? text;
}

const missing = new Set();
function exact(text) {
  if (KO[text] !== undefined) return KO[text];
  for (const [re, to] of KO_RULES) {
    const m = text.match(re);
    if (m) return typeof to === 'function' ? to(...m) : text.replace(re, to);
  }
  return null;
}
function translate(raw, { attr = false, action = false } = {}) {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || !/[A-Za-z]/.test(text)) return null;
  if (action && KO_ACTION[text] !== undefined) return KO_ACTION[text];
  if (attr && KO_ATTR[text] !== undefined) return KO_ATTR[text];
  const whole = exact(text);
  if (whole !== null) return whole;
  // "Chorus · Take 2 · 3h ago": translate the parts that are interface words, keep the rest.
  if (text.includes('·')) {
    const lead = text.startsWith('· ') ? '· ' : '';
    const parts = text.slice(lead.length).split(' · ');
    const out = parts.map((p) => (p ? exact(p) ?? p : p));
    if (out.some((p, i) => p !== parts[i])) return lead + out.join(' · ');
  }
  if (!/[가-힣]/.test(text)) missing.add(text);
  return null;
}
window.__i18nMissing = missing;

// Places where people's own words appear.
const SKIP = 'script, style, textarea, input, [data-no-i18n], .note > p:not(.private-tag), .reply p:not(:first-child), .row-quote, .recap-headline, .recap-row, .doc, .doc-title, .note-row .row-title, code, pre, .mention';
const ATTRS = ['placeholder', 'title', 'aria-label'];
const done = new WeakMap();

function translateText(node) {
  const value = node.nodeValue;
  if (done.get(node) === value) return;
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  const ko = translate(value, { action: Boolean(parent.closest('button, .btn')) });
  if (ko === null) return;
  const lead = value.match(/^\s*/)[0];
  const trail = value.match(/\s*$/)[0];
  const next = lead + ko + trail;
  done.set(node, next);
  if (next !== value) node.nodeValue = next;
}
function translateAttrs(el) {
  if (el.closest(SKIP) && !el.matches('input, textarea')) return;
  for (const name of ATTRS) {
    const value = el.getAttribute(name);
    if (!value) continue;
    const ko = translate(value, { attr: true });
    if (ko !== null && ko !== value) el.setAttribute(name, ko);
  }
}
export function translateTree(root) {
  if (!isKo || !root) return;
  if (root.nodeType === 3) return translateText(root);
  if (root.nodeType !== 1) return;
  translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) translateText(node);
    else translateAttrs(node);
  }
}

// Watches the page and translates whatever gets rendered.
export function startTranslating(root = document.body) {
  document.documentElement.lang = lang;
  if (!isKo) return;
  translateTree(root);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') translateText(r.target);
      else if (r.type === 'attributes') translateAttrs(r.target);
      else r.addedNodes.forEach(translateTree);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
