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
// Sample reports. The same notes, written for whoever asked: dancers read "you", coaches read "Maya".
// Every line cites the coach note it came from, just like the real thing will.
const reports = {
  dancer: {
    class: {
      scope: 'Tue, Oct 22 · 4 notes from Alex Lee',
      worked: ['What you worked on', 'Chorus timing and the arm pathway into the turn.', [1, 2], ['timing', 'pathway']],
      todo: ['What to do next', [['00:18', 'Count “5-and-6” out loud until the shoulder hit lands on 6.', 1, 'timing'], ['00:42', 'Keep the elbow above the wrist through the transition.', 2, 'pathway']]],
      landed: ['What landed', [['Clean entrance on count 1 of the intro.', 3, 'timing']]],
      recurring: ['Keeps coming up', []]
    },
    week: {
      scope: 'Oct 19 – 25 · 9 notes from Alex Lee',
      worked: ['What you worked on', 'Chorus timing, wider arm pathways, and holding energy through the last eight.', [1, 3, 6], ['timing', 'pathway', 'energy']],
      todo: ['What to do next', [['00:18', 'Count “5-and-6” through the chorus hit — record one take at 0.5×.', 1, 'timing'], ['01:03', 'Hold the final shape for a full two counts.', 6, 'energy']]],
      landed: ['What landed', [['Your wider arm pathway at 00:42 — resolved in Version 2.', 3, 'pathway']]],
      recurring: ['Keeps coming up', [['Rushing the “and” counts — noted 3 weeks in a row.', 5, 'timing']]]
    },
    month: {
      scope: 'October · 31 notes from Alex Lee and Sora Kim',
      worked: ['What you worked on', 'Timing early in the month; by week 4 your coaches shifted to musicality in the bridge.', [2, 14, 27], ['timing', 'musicality']],
      todo: ['What to do next', [['01:20', 'Bridge: play with the half-time feel instead of hitting every count.', 27, 'musicality']]],
      landed: ['What landed', [['8 of 11 timing corrections fixed, most within two takes.', 14, 'timing'], ['Intro pathways clean since week 2.', 9, 'pathway']]],
      recurring: ['Keeps coming up', [['Rushing the “and” counts — still open in the chorus.', 5, 'timing']]]
    }
  },
  coach: {
    class: {
      scope: 'Tue, Oct 22 · 4 of your notes',
      worked: ['What Maya worked on', 'Chorus timing and the arm pathway into the turn.', [1, 2], ['timing', 'pathway']],
      todo: ['Next steps you gave', [['00:18', 'Count “5-and-6” out loud until the shoulder hit lands on 6.', 1, 'timing'], ['00:42', 'Elbow above the wrist through the transition.', 2, 'pathway']]],
      landed: ['What landed', [['Clean entrance on count 1 of the intro.', 3, 'timing']]],
      recurring: ['Worth a look', []]
    },
    week: {
      scope: 'Oct 19 – 25 · 9 of your notes',
      worked: ['What Maya worked on', 'Chorus timing, wider arm pathways, and holding energy through the last eight.', [1, 3, 6], ['timing', 'pathway', 'energy']],
      todo: ['Next steps you gave', [['00:18', 'Count “5-and-6” through the chorus hit — one take at 0.5×.', 1, 'timing'], ['01:03', 'Hold the final shape for a full two counts.', 6, 'energy']]],
      landed: ['What landed', [['Wider arm pathway at 00:42 — resolved in Version 2.', 3, 'pathway']]],
      recurring: ['Worth a look', [['Rushing the “and” counts, 3 weeks in a row — also open for 3 other dancers.', 5, 'timing']]]
    },
    month: {
      scope: 'October · 31 notes from you and Sora Kim',
      worked: ['What Maya worked on', 'Timing early in the month; by week 4 the focus shifted to musicality in the bridge.', [2, 14, 27], ['timing', 'musicality']],
      todo: ['Next steps you gave', [['01:20', 'Bridge: half-time feel instead of hitting every count.', 27, 'musicality']]],
      landed: ['What landed', [['8 of 11 timing corrections fixed, most within two takes.', 14, 'timing'], ['Intro pathways clean since week 2.', 9, 'pathway']]],
      recurring: ['Worth a look', [['Rushing the “and” counts — still open. Consider making it Tuesday’s focus.', 5, 'timing']]]
    }
  }
};
const audiences = {
  dancer: {
    kind: 'Your recap',
    status: 'Generated by you · just now',
    people: [['MC', 'dancer', 'Generated by', 'Maya Chen', 'Dancer', true], ['AL', 'coach', 'From notes by', 'Alex Lee', 'Coach', false]],
    actions: '<button type="button" class="ghost">Share with coach</button><button type="button" class="primary" data-report-generate><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5c.6 4.9 2.6 8 9.5 10.5-6.9 2.5-8.9 5.6-9.5 10.5-.6-4.9-2.6-8-9.5-10.5C9.4 9.5 11.4 6.4 12 1.5Z" /></svg>Regenerate</button>'
  },
  coach: {
    kind: 'Coach report',
    status: 'Draft · waiting for your review',
    people: [['AL', 'coach', 'Prepared by', 'Alex Lee', 'Coach', true], ['MC', 'dancer', 'For', 'Maya Chen', 'Dancer', false]],
    actions: '<button type="button" class="ghost">Edit</button><button type="button" class="primary">Review &amp; send ↗</button>'
  }
};
const reportEl = $('[data-report]');
const reportSection = $('#ai-reports');
const reportView = { audience: 'dancer', period: 'week' };
const cite = (n) => `<sup class="cite">[${n}]</sup>`;
// Coaches write notes without labels; the AI adds them here, in the report.
const aiTag = (label) => `<span class="ai-tag t-${label}">${label[0].toUpperCase()}${label.slice(1)}</span>`;
const person = ([initials, role, label, name, roleLabel, author]) => `<div class="person ${author ? 'is-author' : ''}"><span class="person-avatar ${role}">${initials}</span><span><small>${label}</small><b>${name}</b><i class="role-chip ${role}">${roleLabel}</i></span></div>`;

function renderReport() {
  const aud = audiences[reportView.audience];
  const r = reports[reportView.audience][reportView.period];
  const list = ([, items], cls, icon) => `<ul class="${cls}">${items.map((item) => item.length === 3 ? `<li><i>${icon}</i><span>${item[0]}${cite(item[1])}${aiTag(item[2])}</span></li>` : `<li><i>${icon}</i><span><span class="ts">${item[0]}</span> ${item[1]}${cite(item[2])}${aiTag(item[3])}</span></li>`).join('')}</ul>`;
  reportEl.dataset.audience = reportView.audience;
  reportSection.dataset.audience = reportView.audience;
  $('[data-report-kind]', reportEl).textContent = aud.kind;
  $('[data-report-status]', reportEl).textContent = aud.status;
  $('[data-report-people]', reportEl).innerHTML = `${person(aud.people[0])}<span class="people-arrow" aria-hidden="true">${reportView.audience === 'dancer' ? '←' : '→'}</span>${person(aud.people[1])}`;
  $('[data-report-source]', reportEl).textContent = r.scope;
  $('[data-report-actions]', reportEl).innerHTML = aud.actions;
  $('[data-report-body]', reportEl).innerHTML = `
    <div class="report-skeleton" aria-hidden="true"><em>✦ Reading ${r.scope.split('· ')[1]}…</em><span></span><span></span><span></span><span></span><span></span></div>
    <div class="report-block"><h4>${r.worked[0]}</h4><p>${r.worked[1]}${r.worked[2].map(cite).join('')}</p><div class="ai-tags">${r.worked[3].map(aiTag).join('')}</div></div>
    <div class="report-block"><h4>${r.todo[0]}</h4>${list(r.todo, 'report-todo', '☐')}</div>
    <div class="report-block"><h4>${r.landed[0]}</h4>${list(r.landed, 'report-landed', '✓')}</div>
    ${r.recurring[1].length ? `<div class="report-block"><h4>${r.recurring[0]}</h4>${list(r.recurring, 'report-recurring', '⚠')}</div>` : ''}`;
  $$('[data-report-tab]', reportEl).forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.reportTab === reportView.period)));
  $$('[data-audience-tab]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.audienceTab === reportView.audience)));
  $('[data-report-generate]', reportEl)?.addEventListener('click', () => generateReport());
}

// A short "reading your notes" shimmer before the report appears, like the real generation step.
let generateTimer;
function generateReport(changes = {}) {
  Object.assign(reportView, changes);
  renderReport();
  if (reducedMotion) return;
  const body = $('[data-report-body]', reportEl);
  body.classList.add('is-generating');
  clearTimeout(generateTimer);
  generateTimer = setTimeout(() => body.classList.remove('is-generating'), 850);
}

if (reportEl) {
  renderReport();
  $$('[data-report-tab]', reportEl).forEach((tab) => tab.addEventListener('click', () => {
    generateReport({ period: tab.dataset.reportTab });
    track('report_tab', { period: tab.dataset.reportTab, audience: reportView.audience });
  }));
  $$('[data-audience-tab]').forEach((tab) => tab.addEventListener('click', () => {
    generateReport({ audience: tab.dataset.audienceTab });
    track('report_audience', { audience: tab.dataset.audienceTab });
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
