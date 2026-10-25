// Landing page: nav, signed-in state, reveal-on-scroll (once), and the small product animations.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Analytics: events land in window.dataLayer so any tag manager can pick them up later.
window.dataLayer = window.dataLayer || [];
const track = (event, props = {}) => window.dataLayer.push({ event, ...props, ts: Date.now() });
$$('[data-cta]').forEach((a) => a.addEventListener('click', () => track('cta_click', { cta: a.dataset.cta })));

// ---------- Already signed in on this device? Offer the app and Log out ----------
function signedIn() {
  try {
    const raw = localStorage.getItem('sb-egkwjdwfzuslyrhuzkmq-auth-token');
    return Boolean(raw && JSON.parse(raw)?.refresh_token);
  } catch {
    return false;
  }
}
if (signedIn()) {
  $$('[data-auth-login]').forEach((a) => { a.textContent = 'Log out'; a.href = '/app/logout'; a.dataset.cta = 'logout'; });
  $$('[data-auth-primary]').forEach((a) => { a.textContent = 'Open Looproom'; a.href = '/app'; a.dataset.cta = 'open_app'; });
  const footerApp = $('[data-footer-app]');
  if (footerApp) { footerApp.textContent = 'Open Looproom →'; footerApp.href = '/app'; }
}

// ---------- Nav ----------
const nav = $('[data-nav]');
const menu = $('[data-menu]');
const toggle = $('[data-menu-toggle]');
function setMenu(open) {
  menu.classList.toggle('open', open);
  nav.classList.toggle('menu-open', open);
  toggle.setAttribute('aria-expanded', String(open));
}
toggle.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
$$('a', menu).forEach((a) => a.addEventListener('click', () => setMenu(false)));

const mobileCta = $('[data-mobile-cta]');
const hero = $('.hero');
const final = $('#signup');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 8);
  const pastHero = hero.getBoundingClientRect().bottom < 80;
  const atEnd = final.getBoundingClientRect().top < window.innerHeight;
  mobileCta.classList.toggle('show', pastHero && !atEnd);
}, { passive: true });

// ---------- Reveal: each block fades up the first time it scrolls into view ----------
document.documentElement.classList.add('js');
const revealed = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('in');
    revealed.unobserve(entry.target);
  }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
$$('[data-reveal]').forEach((el) => (reducedMotion ? el.classList.add('in') : revealed.observe(el)));

// Product modules play their little animation once, when they're mostly on screen.
const played = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('play');
    countUp(entry.target);
    played.unobserve(entry.target);
  }
}, { threshold: 0.45 });
$$('[data-play]').forEach((el) => (reducedMotion ? el.classList.add('play', 'still') : played.observe(el)));

function countUp(root) {
  for (const el of $$('[data-count]', root)) {
    const end = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 1100);
      el.textContent = `${Math.round(end * (1 - Math.pow(1 - t, 3)))}${suffix}`;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

// ---------- Hero: pin → sketch → loop → fixed, on a gentle loop while visible ----------
const demo = $('[data-hero-demo]');
const typed = $('[data-hero-typed]');
const status = $('[data-hero-status]');
const NOTE = '@Maya arms are late on the 5-6…';
let step = 0;
let typing = 0;
let visible = true;
function show(next) {
  step = next;
  demo.dataset.step = String(step);
  $$('[data-hero-step]').forEach((li) => li.classList.toggle('on', Number(li.dataset.heroStep) === step));
  status.textContent = step >= 4 ? 'Resolved ✓' : step >= 3 ? 'Practicing' : 'Open';
  status.className = `status ${step >= 4 ? 'ok' : step >= 3 ? 'info' : ''}`;
  clearInterval(typing);
  typed.textContent = '';
  if (step === 0) {
    let i = 0;
    typing = setInterval(() => { typed.textContent = NOTE.slice(0, (i += 1)); if (i >= NOTE.length) clearInterval(typing); }, 45);
  }
}
if (reducedMotion) show(4);
else {
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.2 }).observe(demo);
  show(0);
  const DURATIONS = [2600, 2600, 2600, 3200, 3000];
  const advance = () => {
    if (visible && !document.hidden) show((step + 1) % 5);
    setTimeout(advance, DURATIONS[step]);
  };
  setTimeout(advance, DURATIONS[0]);
}
$$('[data-hero-step]').forEach((li) => li.addEventListener('click', () => show(Number(li.dataset.heroStep))));

// ---------- Sign-up form: hand the email to the app's sign-up screen ----------
$('[data-signup-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = $('#email').value.trim();
  track('signup_submit');
  location.href = signedIn() ? '/app' : `/app/login?mode=signup&email=${encodeURIComponent(email)}`;
});
