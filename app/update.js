// New version after a deploy: phones keep Home Screen apps and tabs open for days, so a fix wouldn't reach
// them until they happened to reload. Like Notion and Slack: the app checks /version.json (written by build.js)
// when it comes back to the screen and every 30 minutes; when there's a new one it switches over quietly on the
// next page change, unless someone is mid-task (typing, uploading, a dialog open): then it asks, and waits.
import { toast, isUploading } from './client.js';
import { isKo } from './i18n.js';

const EVERY_MS = 30 * 60 * 1000;
let loaded = null; // the version this page started with
let ready = false; // a newer one is out
let lastCheck = 0;

async function deployed() {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    return res.ok ? (await res.json()).v || null : null;
  } catch { return null; }
}

// Mid-task: anything that a reload would lose.
function busy() {
  if (isUploading() || document.querySelector('dialog[open]')) return true;
  return [...document.querySelectorAll('textarea, input[type=text], input[type=email], input:not([type])')]
    .some((el) => !el.readOnly && !el.hidden && el.value.trim() && el.offsetParent !== null);
}

async function check() {
  if (!loaded || Date.now() - lastCheck < 60 * 1000) return;
  lastCheck = Date.now();
  const v = await deployed();
  if (!v || v === loaded) return;
  ready = true;
  if (busy()) {
    toast(isKo ? '새 버전이 있어요.' : 'A new version is available.', 'info', { label: isKo ? '새로고침' : 'Refresh', run: () => location.reload() });
  }
}

// Called by the router before each page: the quiet moment to switch to the new version.
export function reloadIfUpdated() {
  if (!ready || busy()) return false;
  location.reload();
  return true;
}

export async function watchForUpdates() {
  loaded = await deployed();
  if (!loaded) return; // local dev, or the file isn't there: nothing to compare
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, EVERY_MS);
}
