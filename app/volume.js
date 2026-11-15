// Sound for every player: a mute button, and a volume slider that opens on hover where there's a mouse.
// Phones keep the button only: iPhone Safari ignores a page's volume, so the side buttons set it there.
// The choice is remembered for the next video.
import { ic } from './icons.js';

const KEY = 'dancerly:volume';
let state = { muted: false, volume: 1 };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved) state = { muted: !!saved.muted, volume: Math.min(1, Math.max(0, Number(saved.volume ?? 1))) };
} catch {}

const silent = () => state.muted || state.volume === 0;
const icon = () => ic(silent() ? 'volOff' : state.volume < 0.5 ? 'volLow' : 'vol', 'solo');

export function volumeControl() {
  return `<span class="vol-wrap"><button type="button" class="toggle-btn vol-btn" data-vol aria-label="Mute" title="Mute" aria-pressed="false">${icon()}</button><input class="vol-range" type="range" min="0" max="1" step="0.05" value="${state.volume}" aria-label="Volume" data-vol-range /></span>`;
}

// apply({ muted, volume }) sets the sound on the player. Runs once now, then on every change.
export function wireVolume(root, apply) {
  const btn = root.querySelector('[data-vol]');
  const range = root.querySelector('[data-vol-range]');
  if (!btn) return null;
  const paint = () => {
    const off = silent();
    btn.innerHTML = icon();
    btn.setAttribute('aria-pressed', String(off));
    btn.setAttribute('aria-label', off ? 'Unmute' : 'Mute');
    btn.title = off ? 'Unmute' : 'Mute';
    const v = off ? 0 : state.volume;
    range.value = String(v);
    range.style.setProperty('--v', `${v * 100}%`);
  };
  const set = (next) => {
    state = { ...state, ...next };
    paint();
    apply({ ...state });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  };
  btn.addEventListener('click', () => set(silent() ? { muted: false, volume: state.volume || 1 } : { muted: true }));
  range.addEventListener('input', () => { const v = Number(range.value); set({ volume: v, muted: v === 0 }); });
  paint();
  apply({ ...state });
  return { toggle: () => btn.click() };
}
