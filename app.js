const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Analytics: events land in window.dataLayer so any tag manager / product analytics can pick them up later.
window.dataLayer = window.dataLayer || [];
function track(event, props = {}) {
  window.dataLayer.push({ event, ...props, ts: Date.now() });
}

// Hero copy experiment. Default is the new copy (a); `?hero=b` shows the original headline for comparison.
const heroVariants = {
  a: { title: '<span>Every correction.</span> <span>Every count.</span> <em>Every version.</em>', lede: 'Give your dancers feedback they can act on — pinned to the exact moment, ready for the next take.' },
  b: { title: 'Give better dance feedback, <em>right where it happens.</em>', lede: 'Upload practice videos, pin notes to exact moments, and help your dancers improve one version at a time.' }
};
const heroVariant = heroVariants[new URLSearchParams(location.search).get('hero')] ? new URLSearchParams(location.search).get('hero') : 'a';
if (heroVariant !== 'a') {
  $('[data-hero-title]').innerHTML = heroVariants[heroVariant].title;
  $('[data-hero-lede]').textContent = heroVariants[heroVariant].lede;
}
track('hero_view', { variant: heroVariant });

const menuToggle = $('[data-menu-toggle]');
const mobileMenu = $('[data-mobile-menu]');

function toggleMenu(force) {
  const open = typeof force === 'boolean' ? force : !mobileMenu.classList.contains('open');
  mobileMenu.classList.toggle('open', open);
  document.body.classList.toggle('menu-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
}

menuToggle?.addEventListener('click', () => toggleMenu());
$$('[data-mobile-menu] a').forEach((link) => link.addEventListener('click', () => toggleMenu(false)));

const toast = $('[data-toast]');
let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

$$('[data-cta]').forEach((cta) => cta.addEventListener('click', () => track('cta_click', { cta: cta.dataset.cta, variant: heroVariant })));

// ---------- Hero product demo ----------
// Four scripted steps, ~25s per loop. Each step renders from its local progress (0 → 1).
const demo = $('[data-demo]');
const noteText = 'Land on the beat before the shoulder hits. Count “5-and-6” here.';
const VIDEO_LENGTH = 72;
const fmt = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const steps = [
  { duration: 4500, render: (t) => ({ time: 8 + t * 10, playing: t < 0.96 }) },
  { duration: 8500, render: (t) => ({ time: 18, sketch: clamp01((t - 0.05) / 0.28), sketching: t > 0.03 && t < 0.36, typing: t > 0.36 && t < 0.86, typed: clamp01((t - 0.38) / 0.4), posting: t > 0.8 && t < 0.86, posted: t >= 0.86 }) },
  { duration: 6500, render: (t) => ({ time: 16 + ((t * 6500) / 1000 % 4), playing: true, speed: '0.5×', viewer: 'Dancer view · Maya', sketch: 1, mirrored: t > 0.12, posted: true, replied: t > 0.55 }) },
  { duration: 5500, render: (t) => ({ time: 18, version: 2, sketch: 1, posted: true, replied: true, resolved: t > 0.45 }) }
];
// Sketch strokes draw one after another: circle, arc, arrowhead.
const sketchStrokes = demo ? $$('.sketch-stroke', demo) : [];
const strokeShares = [0.45, 0.4, 0.15];
const demoState = { step: 0, elapsed: 0, last: 0, paused: false, visible: true, frame: 0 };

function paintDemo(stepIndex, t) {
  const s = steps[stepIndex].render(t);
  demo.dataset.step = String(stepIndex + 1);
  demo.classList.toggle('is-playing', Boolean(s.playing) && !reducedMotion);
  demo.classList.toggle('is-typing', Boolean(s.typing));
  demo.classList.toggle('is-posting', Boolean(s.posting));
  demo.classList.toggle('is-posted', Boolean(s.posted));
  demo.classList.toggle('is-replied', Boolean(s.replied));
  demo.classList.toggle('is-resolved', Boolean(s.resolved));
  demo.classList.toggle('is-sketching', Boolean(s.sketching));
  demo.classList.toggle('is-mirrored', Boolean(s.mirrored));
  let strokeStart = 0;
  sketchStrokes.forEach((stroke, i) => {
    stroke.style.strokeDashoffset = String(1 - clamp01(((s.sketch || 0) - strokeStart) / strokeShares[i]));
    strokeStart += strokeShares[i];
  });
  const pct = `${(s.time / VIDEO_LENGTH) * 100}%`;
  $('.track-fill', demo).style.width = pct;
  $('.scrubber', demo).style.left = pct;
  $('[data-demo-time]', demo).textContent = fmt(s.time);
  $('[data-demo-play]', demo).textContent = s.playing ? 'Ⅱ' : '▶';
  $('[data-demo-speed]', demo).textContent = s.speed || '1×';
  $('[data-demo-viewer]', demo).textContent = s.viewer || 'Coach view';
  $('[data-demo-version]', demo).textContent = s.version || 1;
  $('[data-demo-count]', demo).textContent = s.posted ? 1 : 0;
  $('[data-demo-state]', demo).textContent = s.resolved ? 'Resolved ✓' : 'Open';
  $('[data-demo-typed]', demo).textContent = noteText.slice(0, Math.max(0, Math.round((s.typed || 0) * noteText.length)));
  $$('[data-demo-step]', demo).forEach((button, i) => {
    button.toggleAttribute('aria-current', i === stepIndex);
    if (i === stepIndex) button.setAttribute('aria-current', 'step');
    $('.demo-progress i', button).style.width = i < stepIndex ? '100%' : i === stepIndex ? `${t * 100}%` : '0%';
  });
}

function tickDemo(now) {
  const delta = demoState.last ? now - demoState.last : 0;
  demoState.last = now;
  if (!demoState.paused && demoState.visible && !document.hidden) {
    demoState.elapsed += delta;
    const { duration } = steps[demoState.step];
    if (demoState.elapsed >= duration) {
      demoState.elapsed = 0;
      demoState.step = (demoState.step + 1) % steps.length;
    }
  }
  paintDemo(demoState.step, Math.min(1, demoState.elapsed / steps[demoState.step].duration));
  demoState.frame = requestAnimationFrame(tickDemo);
}

function goToStep(index, { autoplay = true } = {}) {
  demoState.step = index;
  demoState.elapsed = 0;
  demoState.paused = !autoplay;
  if (reducedMotion) paintDemo(index, 1);
}

if (demo) {
  $$('[data-demo-step]', demo).forEach((button, i) => button.addEventListener('click', () => {
    goToStep(i, { autoplay: !reducedMotion });
    track('demo_step_click', { step: i + 1 });
  }));
  if (reducedMotion) {
    // No autoplay: show the finished loop, and let people step through it.
    paintDemo(3, 1);
    demoState.step = 3;
  } else {
    new IntersectionObserver(([entry]) => { demoState.visible = entry.isIntersecting; }, { threshold: 0.2 }).observe(demo);
    demoState.frame = requestAnimationFrame(tickDemo);
  }
}

$('[data-demo-trigger]')?.addEventListener('click', () => {
  demo?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  goToStep(0, { autoplay: !reducedMotion });
  if (reducedMotion) showToast('Step through the demo with the four steps below the video.');
  track('demo_play', { variant: heroVariant });
});

// ---------- AI report preview ----------
// Sample reports. Every line cites the coach note it came from, just like the real thing will.
const reports = {
  class: {
    title: 'Maya Chen · Last class',
    source: 'Tue, Oct 22 · Built from 4 notes by Alex Lee',
    worked: 'Chorus timing and the arm pathway into the turn.',
    cites: [1, 2],
    todo: [['00:18', 'Count “5-and-6” out loud until the shoulder hit lands on 6.', 1], ['00:42', 'Keep the elbow above the wrist through the transition.', 2]],
    landed: [['Clean entrance on count 1 of the intro.', 3]],
    recurring: []
  },
  week: {
    title: 'Maya Chen · This week',
    source: 'Oct 19 – 25 · Built from 9 notes by Alex Lee',
    worked: 'Chorus timing, wider arm pathways, and holding energy through the last eight.',
    cites: [1, 3, 6],
    todo: [['00:18', 'Count “5-and-6” through the chorus hit — record one take at 0.5×.', 1], ['01:03', 'Hold the final shape for a full two counts.', 6]],
    landed: [['Wider arm pathway at 00:42 — resolved in Version 2.', 3]],
    recurring: [['Rushing the “and” counts — noted 3 weeks in a row.', 5]]
  },
  month: {
    title: 'Maya Chen · This month',
    source: 'October · Built from 31 notes by Alex Lee and Sora Kim',
    worked: 'Most notes were about timing early in the month; by week 4 the focus shifted to musicality in the bridge.',
    cites: [2, 14, 27],
    todo: [['01:20', 'Bridge: play with the half-time feel instead of hitting every count.', 27]],
    landed: [['8 of 11 timing corrections fixed, most within two takes.', 14], ['Intro pathways clean since week 2.', 9]],
    recurring: [['Rushing the “and” counts — still open in the chorus.', 5]]
  }
};
const reportEl = $('[data-report]');
const cite = (n) => `<sup class="cite">[${n}]</sup>`;
function renderReport(key) {
  const r = reports[key];
  const list = (items, cls, icon) => `<ul class="${cls}">${items.map(([a, b, c]) => c === undefined ? `<li><i>${icon}</i><span>${a}${cite(b)}</span></li>` : `<li><i>${icon}</i><span><span class="ts">${a}</span> ${b}${cite(c)}</span></li>`).join('')}</ul>`;
  $('[data-report-title]', reportEl).textContent = r.title;
  $('[data-report-source]', reportEl).textContent = r.source;
  $('[data-report-body]', reportEl).innerHTML = `
    <div class="report-block"><h4>What you worked on</h4><p>${r.worked}${r.cites.map(cite).join('')}</p></div>
    <div class="report-block"><h4>What to do next</h4>${list(r.todo, 'report-todo', '☐')}</div>
    <div class="report-block"><h4>What landed</h4>${list(r.landed, 'report-landed', '✓')}</div>
    ${r.recurring.length ? `<div class="report-block"><h4>Keeps coming up</h4>${list(r.recurring, 'report-recurring', '⚠')}</div>` : ''}`;
  $$('[data-report-tab]', reportEl).forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.reportTab === key)));
}
if (reportEl) {
  renderReport('week');
  $$('[data-report-tab]', reportEl).forEach((tab) => tab.addEventListener('click', () => {
    const body = $('[data-report-body]', reportEl);
    body.classList.add('is-switching');
    setTimeout(() => { renderReport(tab.dataset.reportTab); body.classList.remove('is-switching'); }, 150);
    track('report_tab', { period: tab.dataset.reportTab });
  }));
}

// ---------- Page interactions ----------
$$('.workflow-step').forEach((step) => {
  step.addEventListener('mouseenter', () => {
    $$('.workflow-step').forEach((item) => item.classList.remove('active'));
    step.classList.add('active');
  });
});

$$('details').forEach((detail) => {
  detail.addEventListener('toggle', () => {
    if (detail.open) {
      $$('details').filter((other) => other !== detail).forEach((other) => { other.open = false; });
      track('faq_open', { question: $('summary', detail).firstChild.textContent.trim() });
    }
  });
});

$('[data-signup-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = $('#email').value.trim();
  if (!email) return;
  track('signup_submit', { variant: heroVariant });
  form.classList.add('is-loading');
  $('[data-form-message]').textContent = 'Creating your private workspace…';
  // Prototype: no backend yet, so the email only travels to the workspace in this browser session.
  try { sessionStorage.setItem('looproom:signup-email', email); } catch {}
  setTimeout(() => { location.href = '/app?welcome=1'; }, 700);
});

const header = $('[data-header]');
const mobileCta = $('[data-mobile-cta]');
const heroSection = $('.hero');
const signupSection = $('#signup');
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const current = window.scrollY;
  header.classList.toggle('scrolled', current > 16);
  if (window.innerWidth > 720 && current > lastScroll && current > 160) header.classList.add('hide-on-scroll');
  if (current < lastScroll) header.classList.remove('hide-on-scroll');
  lastScroll = current;
  const pastHero = heroSection.getBoundingClientRect().bottom < 0;
  const atSignup = signupSection.getBoundingClientRect().top < window.innerHeight;
  mobileCta?.classList.toggle('show', pastHero && !atSignup);
}, { passive: true });
