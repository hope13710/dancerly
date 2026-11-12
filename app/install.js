// "Add to Home Screen": one offer on phones, at a moment it makes sense (right after their first upload, or on
// the third day they open dancerly), never again once closed. Android gets the system's own install prompt in
// one tap; iPhone has no such prompt, so it shows the three taps in Safari. Not shown when dancerly already runs
// from the Home Screen, on computers, or inside an app's built-in browser (Instagram, KakaoTalk…) where it can't be installed.
import { isKo } from './i18n.js';
import { ic } from './icons.js';
import { track } from './onboarding.js';

const KEY = 'looproom:install-offer'; // 'shown' once offered; never again
const DAYS = 'looproom:open-days';    // distinct days this browser opened the app, up to 3
let deferred = null;

// Android Chrome hands over its install prompt; keep it for our own button.
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { try { localStorage.setItem(KEY, 'shown'); } catch {} track('app_installed'); });

const ua = navigator.userAgent;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
const isIos = () => /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const inAppBrowser = () => /Instagram|FBAN|FBAV|KAKAOTALK|Line\/|TikTok|musical_ly|Snapchat|; wv\)/i.test(ua);
const offered = () => { try { return localStorage.getItem(KEY) === 'shown'; } catch { return true; } };

function canOffer() {
  return isPhone() && !standalone() && !inAppBrowser() && !offered();
}

// Counts the days the app is opened; the third one is a returning user worth offering it to.
export function noteOpenDay() {
  try {
    const today = new Date().toDateString();
    const days = JSON.parse(localStorage.getItem(DAYS) || '[]');
    if (!days.includes(today)) { days.push(today); localStorage.setItem(DAYS, JSON.stringify(days.slice(-3))); }
    if (days.length >= 3) offerInstall('third_day');
  } catch {}
}

export function offerInstall(reason) {
  if (!canOffer()) return;
  try { localStorage.setItem(KEY, 'shown'); } catch {}
  // After the upload toast has had its moment.
  setTimeout(() => show(reason), reason === 'upload' ? 1500 : 800);
}

function show(reason) {
  const ios = isIos();
  const step = (icon, html) => `<li><span class="install-step-ic">${ic(icon, 'solo')}</span><span>${html}</span></li>`;
  const steps = ios
    ? [step('share', isKo ? 'Safari 아래쪽의 <b>공유</b> 버튼을 눌러요' : 'Tap <b>Share</b> in Safari’s toolbar'),
      step('addbox', isKo ? '<b>홈 화면에 추가</b>를 골라요' : 'Choose <b>Add to Home Screen</b>'),
      step('check', isKo ? '오른쪽 위 <b>추가</b>를 누르면 끝이에요' : 'Tap <b>Add</b>, and you’re done')]
    : [step('vmore', isKo ? '오른쪽 위 <b>⋮ 메뉴</b>를 눌러요' : 'Tap the <b>⋮ menu</b> at the top right'),
      step('addbox', isKo ? '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 골라요' : 'Choose <b>Install app</b> or <b>Add to Home screen</b>')];
  const oneTap = !ios && deferred;
  const el = document.createElement('dialog');
  el.className = 'dialog sheet install-sheet';
  el.innerHTML = `<div class="dialog-card" data-no-i18n>
    <img class="install-icon" src="/icon-192.png" alt="" width="56" height="56" />
    <h2>${isKo ? 'dancerly를 홈 화면에 추가하세요' : 'Add dancerly to your Home Screen'}</h2>
    <p class="muted">${isKo ? '앱처럼 한 번에 열려요. 앱 스토어에서 받을 필요 없어요.' : 'Open it with one tap, like an app. Nothing to download from an app store.'}</p>
    ${oneTap ? '' : `<ol class="install-steps">${steps.join('')}</ol>`}
    <div class="dialog-actions">
      <button type="button" class="btn ghost" data-later>${isKo ? '나중에' : 'Not now'}</button>
      ${oneTap ? `<button type="button" class="btn primary" data-install>${isKo ? '홈 화면에 추가' : 'Add to Home Screen'}</button>` : `<button type="button" class="btn primary" data-later>${isKo ? '확인' : 'Got it'}</button>`}
    </div>
  </div>`;
  document.body.append(el);
  el.showModal();
  // Focus the sheet itself, not its first button: a tapped-open sheet shouldn't show a keyboard focus ring.
  const card = el.querySelector('.dialog-card');
  card.tabIndex = -1;
  card.focus({ preventScroll: true });
  track('install_offered', { reason, platform: ios ? 'ios' : 'android', one_tap: Boolean(oneTap) });
  el.querySelectorAll('[data-later]').forEach((b) => b.addEventListener('click', () => el.close()));
  el.addEventListener('click', (e) => { if (e.target === el) el.close(); });
  el.querySelector('[data-install]')?.addEventListener('click', async () => {
    const prompt = deferred;
    deferred = null;
    el.close();
    prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    track('install_choice', { outcome });
  });
  el.addEventListener('close', () => el.remove());
}
