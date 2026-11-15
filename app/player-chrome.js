// Full screen on a phone held sideways: the video fills the whole screen and the timeline and controls float over
// it, fading out while it plays (like YouTube's player). Tap the video to bring them back; while they're showing,
// a tap does what it normally does (play or pause). Used by the video screen and Practice.
const SIDEWAYS = '(orientation: landscape) and (max-height: 540px)';
const HIDE_AFTER = 2800;

export function overlayChrome(col, { playing }) {
  const sideways = matchMedia(SIDEWAYS);
  let timer = 0;
  const active = () => col.classList.contains('is-full') && sideways.matches;
  const hideSoon = () => {
    clearTimeout(timer);
    if (active() && playing()) timer = setTimeout(() => { if (active() && playing()) col.classList.add('chrome-off'); }, HIDE_AFTER);
  };
  const show = () => { col.classList.remove('chrome-off'); hideSoon(); };
  // Hidden controls: the first tap only brings them back.
  const onTap = (e) => {
    if (!active()) return;
    if (col.classList.contains('chrome-off')) { e.preventDefault(); e.stopPropagation(); show(); return; }
    hideSoon();
  };
  const onMove = (e) => { if (active() && e.pointerType === 'mouse') show(); };
  const onRotate = () => sync();
  col.addEventListener('click', onTap, true);
  col.addEventListener('pointermove', onMove);
  sideways.addEventListener?.('change', onRotate);
  // Call after play/pause and entering or leaving full screen: paused shows the controls, playing hides them soon.
  function sync() {
    if (!active() || !playing()) { clearTimeout(timer); col.classList.remove('chrome-off'); return; }
    hideSoon();
  }
  return {
    sync,
    stop() {
      clearTimeout(timer);
      col.removeEventListener('click', onTap, true);
      col.removeEventListener('pointermove', onMove);
      sideways.removeEventListener?.('change', onRotate);
      col.classList.remove('chrome-off');
    }
  };
}
