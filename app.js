const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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

const noteData = {
  timing: { time: '00:18.0', fill: '33%', message: 'Jumped to the timing note at 00:18.' },
  pathway: { time: '00:42.0', fill: '65%', message: 'Jumped to the pathway note at 00:42.' }
};
const scrubber = $('.scrubber');
const trackFill = $('.track-fill');
const currentTime = $('.current-time');

function selectNote(note) {
  const data = noteData[note];
  if (!data) return;
  $$('[data-note-card]').forEach((card) => card.classList.toggle('selected', card.dataset.noteCard === note));
  $('.marker-a')?.classList.toggle('active-marker', note === 'timing');
  $('.marker-b')?.classList.toggle('active-marker', note === 'pathway');
  trackFill.style.width = data.fill;
  scrubber.style.left = data.fill;
  currentTime.textContent = data.time;
  showToast(data.message);
}

$$('[data-note], [data-note-card]').forEach((element) => {
  element.addEventListener('click', () => selectNote(element.dataset.note || element.dataset.noteCard));
});

$('[data-demo-trigger]')?.addEventListener('click', () => {
  $('#top .hero-visual')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  selectNote('timing');
  setTimeout(() => showToast('Try clicking a note card to jump through the review.'), 700);
});

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
    }
  });
});

$('[data-signup-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = $('#email').value.trim();
  if (!email) return;
  $('[data-form-message]').textContent = `You’re on the list, ${email}. We’ll save your spot.`;
  event.currentTarget.reset();
  showToast('Thanks — your Looproom workspace is almost ready.');
});

const header = $('[data-header]');
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const current = window.scrollY;
  header.classList.toggle('scrolled', current > 16);
  if (window.innerWidth > 720 && current > lastScroll && current > 160) header.classList.add('hide-on-scroll');
  if (current < lastScroll) header.classList.remove('hide-on-scroll');
  lastScroll = current;
}, { passive: true });
