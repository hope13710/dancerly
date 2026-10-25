// Shared by /terms and /privacy: who runs Looproom and how to reach them, plus the English/Korean switch.
// Change these two lines when the operator details change; every mention on both pages updates.
const LEGAL = {
  operator: { en: '', ko: '' }, // the person (or, later, the company) that runs Looproom
  email: '' // the dedicated contact address for legal and privacy requests
};

const KEY = 'looproom:lang';
const pick = () => { try { return localStorage.getItem(KEY) === 'ko' ? 'ko' : 'en'; } catch { return 'en'; } };
function setLang(lang) {
  document.documentElement.dataset.lang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === lang)));
  const title = document.querySelector(`meta[name="title-${lang}"]`)?.content;
  if (title) document.title = title;
  try { localStorage.setItem(KEY, lang); } catch {}
}
setLang(new URLSearchParams(location.search).get('lang') === 'ko' ? 'ko' : new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : pick());
document.querySelectorAll('[data-set-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.setLang)));

document.querySelectorAll('[data-operator]').forEach((el) => {
  const lang = el.closest('[lang]')?.getAttribute('lang') === 'ko' ? 'ko' : 'en';
  el.textContent = LEGAL.operator[lang] || LEGAL.operator.en || el.textContent;
});
document.querySelectorAll('[data-email]').forEach((el) => {
  if (!LEGAL.email) return;
  el.textContent = LEGAL.email;
  if (el.tagName === 'A') el.href = `mailto:${LEGAL.email}`;
});
