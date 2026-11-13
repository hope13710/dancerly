// Landing page: nav, signed-in state, English/Korean switch, and the small product animations.
import { LANDING_KO } from './landing-ko.js';
import { rememberSource } from '/app/source.js';
rememberSource(); // ?ref=ig_dm etc., so a signup days later is still credited
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
  $$('[data-auth-primary]').forEach((a) => { a.textContent = 'Open dancerly'; a.href = '/app'; a.dataset.cta = 'open_app'; });
  const footerApp = $('[data-footer-app]');
  if (footerApp) { footerApp.textContent = 'Open dancerly'; footerApp.href = '/app'; }
}

// ---------- English / Korean (English by default; the choice is shared with the app) ----------
const LANG_KEY = 'looproom:lang';
// A saved choice wins; on a first visit, the browser's language (a Korean phone opens in Korean).
let lang = /^ko\b/i.test((navigator.languages && navigator.languages[0]) || navigator.language || '') ? 'ko' : 'en';
try { const saved = localStorage.getItem(LANG_KEY); if (saved === 'ko' || saved === 'en') lang = saved; } catch {}
const originalText = new WeakMap();
const ATTRS = ['aria-label', 'placeholder'];
function applyLang() {
  document.documentElement.lang = lang;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement.closest('script, style, [data-hero-typed]')) continue;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const en = originalText.get(node);
    const key = en.replace(/\s+/g, ' ').trim();
    const ko = lang === 'ko' ? LANDING_KO[key] : undefined;
    // Korean honorifics attach to the name before them: "Maya" + " 님이…" → "Maya님이…".
    node.nodeValue = ko === undefined ? en : ko.startsWith('님') ? en.replace(key, ko).trimStart() : en.replace(key, ko);
  }
  for (const el of document.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
    for (const name of ATTRS) {
      if (!el.hasAttribute(name)) continue;
      const stash = `data-en-${name}`;
      if (!el.hasAttribute(stash)) el.setAttribute(stash, el.getAttribute(name));
      const en = el.getAttribute(stash);
      el.setAttribute(name, lang === 'ko' ? LANDING_KO[en] ?? en : en);
    }
  }
  $$('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === lang)));
}
$$('[data-set-lang]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.setLang === lang) return;
  lang = b.dataset.setLang;
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  track('language_switch', { lang });
  applyLang();
  show(step);
}));

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

// Product modules play their little animation once, when they're mostly on screen.
const played = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('play');
    played.unobserve(entry.target);
  }
}, { threshold: 0.45 });
$$('[data-play]').forEach((el) => (reducedMotion ? el.classList.add('play', 'still') : played.observe(el)));


applyLang();

// ---------- Hero: pin → sketch → loop → fixed, on a gentle loop while visible ----------
const demo = $('[data-hero-demo]');
const typed = $('[data-hero-typed]');
const NOTE = { en: '@Maya reach all the way out on the arm hit…', ko: '@Maya 팔을 뻗는 동작에서 끝까지 뻗어 주세요…' };
let step = 0;
let typing = 0;
let visible = true;
// The stage plays one rehearsal clip (generated with Higgsfield). "Take 2" is the wide shot where the note lands;
// "Take 3" is the later push-in, standing in for the next take.
const video = $('[data-hero-video]');
const MOMENT = 1.4; // the arm hit the note is about
const LOOP = [1.0, 2.0];
const NEXT_TAKE = [3.6, 7.2];
const DURATION = 7.3;
const clock = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function useTake(n) {
  $$('[data-hero-takes] span').forEach((s, i) => s.classList.toggle('on', i === n));
}
function stageFor(s) {
  if (!video) return;
  video.playbackRate = s === 2 ? 0.5 : 1;
  const at = (t, play) => {
    const go = () => { video.currentTime = t; if (play && !reducedMotion) video.play().catch(() => {}); else video.pause(); };
    if (video.readyState >= 1) go(); else video.addEventListener('loadedmetadata', go, { once: true });
  };
  if (s === 3) { useTake(1); at(NEXT_TAKE[0], true); return; }
  useTake(0);
  if (s === 0) at(0.2, true); // plays up to the moment, then holds there while the note is typed and sketched
  else if (s === 2) at(LOOP[0], true);
  else at(MOMENT, false);
}
if (video) {
  const now = $('[data-hero-now]');
  const fill = $('[data-hero-fill]');
  const head = $('[data-hero-head]');
  const badge = $('[data-hero-time]');
  const draw = () => {
    const t = video.currentTime;
    if (step === 0 && t >= MOMENT) { video.pause(); video.currentTime = MOMENT; }
    if (step === 2 && t >= LOOP[1]) video.currentTime = LOOP[0];
    if (step === 3 && t >= NEXT_TAKE[1]) video.currentTime = NEXT_TAKE[0];
    const share = Math.min(1, video.currentTime / DURATION);
    fill.style.transform = `scaleX(${share})`;
    head.style.left = `${share * 100}%`;
    now.textContent = clock(video.currentTime);
    badge.textContent = `${clock(video.currentTime)}.${Math.floor((video.currentTime % 1) * 10)}`;
  };
  // The timeline only redraws while the video plays (it pauses off screen), and once after any jump.
  let frame = 0;
  const loop = () => { draw(); frame = requestAnimationFrame(loop); };
  video.addEventListener('play', () => { cancelAnimationFrame(frame); loop(); });
  video.addEventListener('pause', () => { cancelAnimationFrame(frame); draw(); });
  video.addEventListener('seeked', draw);
  video.addEventListener('loadedmetadata', draw);
}

let toolTimer = 0;
function pickTool(tool, color) {
  document.querySelectorAll('[data-hero-skbar] [data-tool]').forEach((el) => el.classList.toggle('on', el.dataset.tool === tool));
  document.querySelectorAll('[data-hero-skbar] [data-c]').forEach((el) => el.classList.toggle('on', el.dataset.c === color));
}
function show(next) {
  step = next;
  stageFor(step);
  demo.dataset.step = String(step);
  // Step 0 (typing + sketching) and 1 (pinned) are one chapter: "Note it and sketch it".
  $$('[data-hero-step]').forEach((b) => { const on = Number(b.dataset.heroStep) === Math.max(1, step); b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'step' : 'false'); });
  clearInterval(typing);
  clearTimeout(toolTimer);
  typed.textContent = '';
  if (step === 0) {
    // Draw the sketch from scratch alongside the typing, including the very first time.
    $$('.hero-app .sk').forEach((sk) => {
      sk.style.transition = 'none';
      sk.style.strokeDashoffset = '400';
      sk.getBoundingClientRect();
      sk.style.transition = '';
      sk.style.strokeDashoffset = '';
    });
    // The toolbar follows the drawing: circle in yellow first, then the arrow in red.
    pickTool('circle', 'y');
    toolTimer = setTimeout(() => pickTool('arrow', 'r'), 1550);
    let i = 0;
    typing = setInterval(() => { const note = NOTE[lang]; typed.textContent = note.slice(0, (i += 1)); if (i >= note.length) clearInterval(typing); }, 45);
  }
}
if (reducedMotion) show(3);
else {
  // The demo plays on its own until someone takes over: picking a step stays on that step, and Pause stops it
  // (anything that moves on its own for more than a few seconds needs a way to stop it).
  let auto = true;
  let stopped = false; // paused with the button: nothing moves until Play
  let timer = 0;
  const DURATIONS = [3400, 2200, 3400, 3000];
  const pauseBtn = $('[data-hero-pause]');
  const LABEL = { pause: { en: 'Pause demo', ko: '데모 일시정지' }, play: { en: 'Play demo', ko: '데모 재생' } };
  const paintPause = () => {
    const label = LABEL[auto ? 'pause' : 'play'];
    pauseBtn.setAttribute('aria-pressed', String(!auto));
    if (!auto) chips.forEach((c) => c.classList.remove('run')); // the bar only runs while the demo does
    pauseBtn.setAttribute('data-en-aria-label', label.en); // what the language switch restores
    pauseBtn.setAttribute('aria-label', label[lang]);
  };
  const chips = $$('[data-hero-step]');
  const runChip = () => {
    if (step === 1) return; // chip 1 is already running from step 0
    const chip = chips[Math.max(1, step) - 1];
    chips.forEach((c) => c.classList.remove('run'));
    if (!auto || reducedMotion) return;
    void chip.offsetWidth; // restart the bar
    chip.style.setProperty('--run', `${step === 0 ? DURATIONS[0] + DURATIONS[1] : DURATIONS[step]}ms`);
    chip.classList.add('run');
  };
  const schedule = () => {
    clearTimeout(timer);
    if (!auto) { chips.forEach((c) => c.classList.remove('run')); return; }
    runChip();
    timer = setTimeout(() => {
      if (visible && !document.hidden) show((step + 1) % 4);
      schedule();
    }, DURATIONS[step]);
  };
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    // Off screen, the video rests.
    if (!visible) video?.pause(); else if (step !== 1 && !stopped) video?.play().catch(() => {});
  }, { threshold: 0.2 }).observe(demo);
  show(0);
  schedule();
  $$('[data-hero-step]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.heroStep);
    auto = false;
    stopped = false;
    clearTimeout(timer);
    show(n === 1 ? 0 : n);
    paintPause();
    track('hero_step_click', { step: n });
  }));
  pauseBtn.addEventListener('click', () => {
    if (auto) {
      auto = false;
      stopped = true;
      clearTimeout(timer);
      clearInterval(typing);
      video?.pause();
      track('hero_demo_pause');
    } else {
      auto = true;
      stopped = false;
      if (step !== 1) video?.play().catch(() => {});
      schedule();
    }
    paintPause();
  });
  paintPause();
}


