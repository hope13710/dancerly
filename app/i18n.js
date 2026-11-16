// dancerly is an English-only service. User-generated content is never translated.
export const LANGS = [['en', 'English']];
export const lang = 'en';
export const isKo = false;

export function getLang() { return 'en'; }
export function setLang() {}
export function t(text) { return text; }
export function translateTree() {}
export function startTranslating() {
  document.documentElement.lang = 'en';
}
