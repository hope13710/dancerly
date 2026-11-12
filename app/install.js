// Add to Home Screen, done the way X, Pinterest and Google's own guidance do it:
//   • Phones: offered once, at a moment it pays off (right after an upload, or on the third day dancerly is
//     opened), never again once closed. After that it waits in Me › Install app.
//   • Android (Chrome, Edge, Samsung Internet, Opera): the browser's own install prompt in one tap; otherwise the
//     taps for that browser's menu. iPhone has no install prompt: the taps in Safari or Chrome/Edge/Firefox.
//   • Computers: never a pop-up (people already come back through a bookmark). Chrome and Edge get "Install app"
//     in the account menu, one click; Safari and Firefox on computers don't install web apps well, so nothing.
//   • Not shown when dancerly already runs from the Home Screen, or inside an app's built-in browser (Instagram,
//     KakaoTalk…) where installing isn't possible.
// Measured: offered, chosen, installed, and opens from the Home Screen (once a day), to compare who comes back.
import { isKo } from './i18n.js';
import { ic } from './icons.js';
import { track } from './onboarding.js';

const KEY = 'looproom:install-offer'; // 'shown' once offered; never pops up again
const DAYS = 'looproom:open-days';    // distinct days this browser opened the app, up to 3
const STANDALONE_DAY = 'looproom:standalone-day';
let deferred = null;

const ua = navigator.userAgent;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
const isIos = () => /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const inAppBrowser = () => /Instagram|FBAN|FBAV|KAKAOTALK|Line\/|TikTok|musical_ly|Snapchat|; wv\)/i.test(ua);
const offered = () => { try { return localStorage.getItem(KEY) === 'shown'; } catch { return true; } };

// Which browser's steps to show.
function browser() {
  if (isIos()) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Firefox/.test(ua)) return 'firefox';
  return 'android';
}

// The "Install app" entries (Me on phones, the account menu on computers) show only where installing works.
export function paintEntries() {
  const can = !standalone() && !inAppBrowser() && (isPhone() || Boolean(deferred));
  document.querySelectorAll('[data-install-app]').forEach((el) => { el.hidden = !can; });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; paintEntries(); });
window.addEventListener('appinstalled', () => {
  try { localStorage.setItem(KEY, 'shown'); } catch {}
  deferred = null;
  paintEntries();
  track('app_installed');
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-install-app]')) showInstall('menu');
});

// Opened from the Home Screen: noted once a day, so returning visits can be compared.
export function noteOpenDay() {
  try {
    const today = new Date().toDateString();
    if (standalone() && localStorage.getItem(STANDALONE_DAY) !== today) {
      localStorage.setItem(STANDALONE_DAY, today);
      track('opened_from_home_screen');
    }
    const days = JSON.parse(localStorage.getItem(DAYS) || '[]');
    if (!days.includes(today)) { days.push(today); localStorage.setItem(DAYS, JSON.stringify(days.slice(-3))); }
    if (days.length >= 3) offerInstall('third_day');
  } catch {}
}

// The one-time offer on phones.
export function offerInstall(reason) {
  if (!isPhone() || standalone() || inAppBrowser() || offered()) return;
  try { localStorage.setItem(KEY, 'shown'); } catch {}
  // After the upload toast has had its moment.
  setTimeout(() => showInstall(reason), reason === 'upload' ? 1500 : 800);
}

// The words fit the moment: right after an upload it's about seeing the team's feedback.
function copy(reason) {
  if (reason === 'upload') {
    return isKo
      ? ['팀원 피드백을 바로 열어 보세요', '홈 화면에 추가하면 피드백이 올라왔을 때 한 번에 열 수 있어요. 앱 스토어에서 받을 필요 없어요.']
      : ['See your team’s feedback in one tap', 'Add dancerly to your Home Screen to open it the moment feedback comes in. Nothing to download from an app store.'];
  }
  if (reason === 'third_day') {
    return isKo
      ? ['다음엔 한 번에 여세요', '홈 화면에 추가하면 앱처럼 바로 열려요. 앱 스토어에서 받을 필요 없어요.']
      : ['Next time, open it in one tap', 'Add dancerly to your Home Screen and it opens like an app. Nothing to download from an app store.'];
  }
  if (!isPhone()) {
    return isKo
      ? ['dancerly 앱 설치', '브라우저 탭 없이 별도 창으로 열려요. 작업 표시줄이나 Dock에서 바로 실행할 수 있어요.']
      : ['Install the dancerly app', 'It opens in its own window, without browser tabs, right from your taskbar or Dock.'];
  }
  return isKo
    ? ['dancerly 앱으로 설치하기', '홈 화면에서 앱처럼 바로 열려요. 앱 스토어에서 받을 필요 없어요.']
    : ['Install the dancerly app', 'It opens straight from your Home Screen, like an app. Nothing to download from an app store.'];
}

function steps(kind) {
  const step = (icon, html) => `<li><span class="install-step-ic">${ic(icon, 'solo')}</span><span>${html}</span></li>`;
  const add = isKo ? step('check', '<b>추가</b>를 누르면 끝이에요') : step('check', 'Tap <b>Add</b>, and you’re done');
  if (kind === 'ios-safari') {
    return [step('share', isKo ? '<b>공유</b> 버튼을 눌러요 (화면 아래 또는 주소창 옆)' : 'Tap <b>Share</b> (at the bottom, or next to the address bar)'),
      step('addbox', isKo ? '목록을 내려 <b>홈 화면에 추가</b>를 골라요' : 'Scroll down and choose <b>Add to Home Screen</b>'), add];
  }
  if (kind === 'ios-other') {
    return [step('share', isKo ? '주소창 오른쪽의 <b>공유</b> 버튼을 눌러요' : 'Tap <b>Share</b> at the right of the address bar'),
      step('addbox', isKo ? '<b>홈 화면에 추가</b>를 골라요' : 'Choose <b>Add to Home Screen</b>'), add];
  }
  if (kind === 'samsung') {
    return [step('menu', isKo ? '아래쪽 <b>≡ 메뉴</b>를 눌러요' : 'Tap the <b>≡ menu</b> at the bottom'),
      step('addbox', isKo ? '<b>현재 페이지 추가</b> → <b>홈 화면</b>을 골라요' : 'Choose <b>Add page to</b> → <b>Home screen</b>')];
  }
  return [step('vmore', isKo ? '오른쪽 위 <b>⋮ 메뉴</b>를 눌러요' : 'Tap the <b>⋮ menu</b> at the top right'),
    step('addbox', isKo ? (kind === 'firefox' ? '<b>설치</b>를 골라요' : '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 골라요') : (kind === 'firefox' ? 'Choose <b>Install</b>' : 'Choose <b>Install app</b> or <b>Add to Home screen</b>'))];
}

export function showInstall(reason) {
  const kind = browser();
  const oneTap = Boolean(deferred); // Chrome, Edge, Samsung Internet, Opera: the browser's own prompt
  const [title, body] = copy(reason);
  const el = document.createElement('dialog');
  el.className = 'dialog sheet install-sheet';
  el.innerHTML = `<div class="dialog-card" data-no-i18n>
    <img class="install-icon" src="/icon-192.png" alt="" width="56" height="56" />
    <h2>${title}</h2>
    <p class="muted">${body}</p>
    ${oneTap ? '' : `<ol class="install-steps">${steps(kind).join('')}</ol>`}
    <div class="dialog-actions">
      <button type="button" class="btn ghost" data-later>${isKo ? '나중에' : 'Not now'}</button>
      ${oneTap ? `<button type="button" class="btn primary" data-install>${isKo ? '설치하기' : 'Install'}</button>` : `<button type="button" class="btn primary" data-later>${isKo ? '확인' : 'Got it'}</button>`}
    </div>
  </div>`;
  document.body.append(el);
  el.showModal();
  // Focus the sheet itself, not its first button: a tapped-open sheet shouldn't show a keyboard focus ring.
  const card = el.querySelector('.dialog-card');
  card.tabIndex = -1;
  card.focus({ preventScroll: true });
  track('install_offered', { reason, browser: kind, one_tap: oneTap });
  el.querySelectorAll('[data-later]').forEach((b) => b.addEventListener('click', () => el.close()));
  el.addEventListener('click', (e) => { if (e.target === el) el.close(); });
  el.querySelector('[data-install]')?.addEventListener('click', async () => {
    const prompt = deferred;
    deferred = null;
    el.close();
    prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    track('install_choice', { outcome, reason });
    paintEntries();
  });
  el.addEventListener('close', () => el.remove());
}
