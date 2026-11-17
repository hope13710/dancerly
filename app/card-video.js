// Video progress cards: Take 1 and the latest take on the same beat, as a 7-second 1080×1920 MP4 for
// Instagram Stories, Reels and TikTok. Everything is drawn and encoded on the device (WebCodecs through
// Mediabunny); nothing is uploaded. The same drawing makes the live preview and the still image.

export const W = 1080, H = 1920, FPS = 30, LEN = 7;
const FONT = 'CardInter, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const VIOLET = '#7d7ef0';
const INK = '#0b0c10';
// Instagram's own buttons cover the top ~250 px and the bottom ~320 px: words stay between.
const TOP = 300, SIGN = 1600;

// The styles a card can take. Two takes: all of these but Rehearsal; one take: Rehearsal and Countdown.
export const STYLES = {
  split: { name: 'Split', hint: 'Then and now, together' },
  wipe: { name: 'Wipe', hint: 'Take 1, then swipe to now' },
  countdown: { name: 'Countdown', hint: 'Built around your show' },
  rehearsal: { name: 'Rehearsal', hint: 'Your take, front and center' }
};
// A frame that reads well on its own, for the still image and the style thumbnails.
export const STILL_AT = { split: 6.6, wipe: 6.6, countdown: 3, rehearsal: 6.6 };

// ---------- Fonts and the logo ----------
let assets = null;
export function loadAssets() {
  return (assets ||= (async () => {
    await Promise.all([600, 800, 900].map(async (w) => {
      try { document.fonts.add(await new FontFace('CardInter', `url(/fonts/inter-latin-${w}-normal.woff2)`, { weight: String(w) }).load()); } catch {}
    }));
    // The site's horizontal wordmark, turned white.
    const img = new Image();
    img.src = '/logo-wordmark.png';
    try { await img.decode(); } catch { return { logo: null }; }
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    return { logo: c };
  })());
}

// ---------- Drawing helpers (sizes in 1080-wide units; s.u scales them) ----------
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (t) => Math.max(0, Math.min(1, t));
const dims = (img) => (img ? { w: img.videoWidth || img.width, h: img.videoHeight || img.height } : null);
const ready = (img) => { const d = dims(img); return d && d.w > 0 && d.h > 0; };
export const portrait = (img) => { const d = dims(img); return Boolean(d && d.h > d.w * 1.05); };

function spacing(g, px) { if ('letterSpacing' in g) g.letterSpacing = `${px}px`; }
// Text that shrinks to fit maxW (so a long crew name never runs off the card).
function type(s, text, x, y, size, weight, { fill = '#fff', alpha = 1, align = 'left', track = 0, maxW = null } = {}) {
  const { g, u } = s;
  let px = size * u;
  g.font = `${weight} ${px}px ${FONT}`; spacing(g, track * u);
  if (maxW) while (px > size * u * 0.5 && g.measureText(text).width > maxW * u) { px -= 2 * u; g.font = `${weight} ${px}px ${FONT}`; }
  g.globalAlpha = alpha; g.fillStyle = fill; g.textAlign = align; g.textBaseline = 'alphabetic';
  g.fillText(text, x * u, y * u);
  const w = g.measureText(text).width;
  g.globalAlpha = 1; g.textAlign = 'left'; spacing(g, 0);
  return w / u;
}
function tag(s, text, x, y, { now = false, size = 30 } = {}) {
  const { g, u } = s;
  g.font = `800 ${size * u}px ${FONT}`; spacing(g, 1.5 * u);
  const w = g.measureText(text).width, pad = 18 * u, h = size * 1.7 * u;
  g.beginPath(); g.roundRect(x * u, y * u, w + pad * 2, h, 10 * u);
  g.fillStyle = now ? '#fff' : 'rgba(10,10,14,0.62)'; g.fill();
  g.fillStyle = now ? INK : '#fff'; g.textBaseline = 'middle'; g.fillText(text, x * u + pad, y * u + h / 2 + u);
  spacing(g, 0);
}
function fit(g, img, x, y, w, h, mode = 'cover') {
  if (!ready(img)) { g.fillStyle = '#1a1b20'; g.fillRect(x, y, w, h); return; }
  const d = dims(img);
  const k = mode === 'cover' ? Math.max(w / d.w, h / d.h) : Math.min(w / d.w, h / d.h);
  g.drawImage(img, x + (w - d.w * k) / 2, y + (h - d.h * k) / 2, d.w * k, d.h * k);
}
// A picture in a rounded box; x, y, w, h in units.
function clip(s, img, x, y, w, h, r = 24, dim = 0) {
  const { g, u } = s;
  g.save(); g.beginPath(); g.roundRect(x * u, y * u, w * u, h * u, r * u); g.clip();
  fit(g, img, x * u, y * u, w * u, h * u);
  if (dim) { g.fillStyle = `rgba(0,0,0,${dim})`; g.fillRect(x * u, y * u, w * u, h * u); }
  g.restore();
}
// A soft backdrop from the picture itself: drawn tiny and stretched back up (no ctx.filter, which not every browser has).
const tiny = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: 27, height: 48 }) : null;
function backdrop(s, img, dim = 0.55) {
  const t = tiny.getContext('2d');
  fit(t, img, 0, 0, tiny.width, tiny.height);
  s.g.imageSmoothingQuality = 'high'; s.g.drawImage(tiny, 0, 0, s.W, s.H);
  s.g.fillStyle = `rgba(0,0,0,${dim})`; s.g.fillRect(0, 0, s.W, s.H);
}
function header(s, card) {
  type(s, card.crew, 60, TOP, 92, 900, { track: -2, maxW: 960 });
  if (card.song) type(s, card.song, 62, TOP + 58, 36, 600, { alpha: 0.7, maxW: 950 });
}
function signature(s) {
  const { g, u } = s;
  const logo = s.logo;
  g.font = `600 ${28 * u}px ${FONT}`;
  const tw = g.measureText('made with').width / u;
  if (!logo) return type(s, 'made with dancerly', 540, SIGN, 28, 600, { alpha: 0.6, align: 'center' });
  const lh = 40, lw = lh * logo.width / logo.height, gap = 12, left = (1080 - tw - gap - lw) / 2;
  type(s, 'made with', left, SIGN, 28, 600, { alpha: 0.6 });
  g.globalAlpha = 0.85;
  g.drawImage(logo, (left + tw + gap) * u, (SIGN - lh * 0.78) * u, lw * u, lh * u); // the y's tail hangs below the line, like type
  g.globalAlpha = 1;
}
function sample(s) {
  const { g, u } = s;
  g.font = `800 ${28 * u}px ${FONT}`;
  const w = g.measureText('SAMPLE').width / u + 36;
  g.beginPath(); g.roundRect((1020 - w) * u, (TOP - 60) * u, w * u, 48 * u, 10 * u); g.fillStyle = '#f59e0b'; g.fill();
  g.fillStyle = INK; g.textBaseline = 'middle'; g.fillText('SAMPLE', (1020 - w + 18) * u, (TOP - 35) * u);
}
// The box a take sits in: 16:9 for footage filmed sideways, taller for footage filmed upright.
const box = (img, w, maxH) => Math.min(maxH, Math.round(w * (portrait(img) ? 16 / 9 : 9 / 16)));

// ---------- The styles ----------
// Split: both takes on the same beat, stacked (sideways footage) or side by side (upright footage).
function split(s, card, a, b, t) {
  s.g.fillStyle = INK; s.g.fillRect(0, 0, s.W, s.H);
  header(s, card);
  const up = portrait(b), x = 60, top = 430;
  let ra, rb;
  if (up) { const w = 473, h = box(b, w, 1120); ra = [x, top, w, h]; rb = [x + w + 14, top, w, h]; }
  else { const w = 960, h = box(b, w, 540); ra = [x, top, w, h]; rb = [x, top + h + 14, w, h]; }
  clip(s, a, ...ra, 24, 0.22); // the past, a touch dimmer
  clip(s, b, ...rb);
  tag(s, card.fromTag, ra[0] + 20, ra[1] + 20, { size: up ? 26 : 30 });
  tag(s, card.toTag, rb[0] + 20, rb[1] + 20, { now: true, size: up ? 26 : 30 });
  // The last beat: the pictures dim and the span takes over.
  const end = ease(clamp((t - 5.7) / 0.5));
  if (end > 0) {
    const y0 = ra[1] - 10, y1 = Math.max(ra[1] + ra[3], rb[1] + rb[3]) + 10, cy = (y0 + y1) / 2;
    s.g.fillStyle = `rgba(11,12,16,${0.72 * end})`; s.g.fillRect(0, y0 * s.u, s.W, (y1 - y0) * s.u);
    type(s, card.payoff, 540, cy - 10, 150, 900, { align: 'center', alpha: end, track: -4, maxW: 960 });
    if (card.event) type(s, card.event.line, 540, cy + 80, 40, 800, { align: 'center', alpha: end, fill: VIOLET, track: 3, maxW: 960 });
  }
}

// Wipe: Take 1, then a hard wipe to the latest take while the counter runs up.
function wipe(s, card, a, b, t) {
  const { g, u, W: w, H: h } = s;
  const p = ease(clamp((t - 3.0) / 0.8));
  const up = portrait(b);
  const show = (img) => {
    if (up) { fit(g, img, 0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, w, h); }
    else { backdrop(s, img); fit(g, img, 0, 560 * u, w, 640 * u, 'contain'); }
  };
  if (p < 1) show(a);
  if (p > 0) {
    g.save(); g.beginPath(); g.rect(0, 0, w * p, h); g.clip(); show(b); g.restore();
    if (p < 1) { g.fillStyle = '#fff'; g.shadowColor = 'rgba(255,255,255,0.8)'; g.shadowBlur = 30 * u; g.fillRect(w * p - 5 * u, 0, 10 * u, h); g.shadowBlur = 0; }
  }
  if (up) { const fade = g.createLinearGradient(0, 0, 0, 520 * u); fade.addColorStop(0, 'rgba(0,0,0,0.55)'); fade.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fade; g.fillRect(0, 0, w, 520 * u); }
  if (up) { const fade = g.createLinearGradient(0, 1150 * u, 0, h); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.7)'); g.fillStyle = fade; g.fillRect(0, 1150 * u, w, h - 1150 * u); }
  header(s, card);
  const n = Math.round(card.from + (card.to - card.from) * p);
  type(s, card.unit, 60, 1300, 44, 800, { alpha: 0.8, track: 4 });
  const nw = type(s, String(n), 52, 1500, 230, 900, { track: -8 });
  const end = ease(clamp((t - 5.4) / 0.5));
  if (end > 0 && card.event) {
    type(s, card.event.name, 52 + nw + 36, 1420, 40, 800, { alpha: end, fill: VIOLET, track: 3, maxW: 1000 - nw - 88 });
    type(s, card.event.when, 52 + nw + 36, 1470, 40, 800, { alpha: end, track: 3, maxW: 1000 - nw - 88 });
  }
}

// Countdown: a big D-number and the show; the latest take, with Take 1 small in the corner.
function countdown(s, card, a, b, t) {
  const { g, u } = s;
  g.fillStyle = INK; g.fillRect(0, 0, s.W, s.H);
  type(s, card.crew, 60, TOP, 40, 800, { alpha: 0.85, track: 3, maxW: 960 });
  const pulse = 1 + 0.04 * Math.max(0, Math.sin(Math.PI * clamp((t - 5.6) / 0.5)));
  g.save(); g.translate(48 * u, 640 * u); g.scale(pulse, pulse);
  type({ ...s }, card.event?.big || '', 0, 0, 300, 900, { track: -12 });
  g.restore();
  if (card.event) type(s, card.event.sub, 62, 712, 40, 800, { fill: VIOLET, track: 3, maxW: 960 });
  const up = portrait(b), y = 790;
  const w = up ? 560 : 960, h = box(b, w, 750), x = up ? 60 : 60;
  clip(s, b, x, y, w, h);
  tag(s, card.toTag, x + 20, y + 20, { now: true });
  if (a) {
    // Take 1, small, overlapping the bottom right corner of the latest take.
    const pw = up ? 300 : 380, ph = box(a, pw, 420), px = up ? x + w + 40 : 1080 - 60 - pw + 24, py = up ? y + h - ph : y + h - ph + 120;
    g.fillStyle = INK; g.beginPath(); g.roundRect((px - 8) * u, (py - 8) * u, (pw + 16) * u, (ph + 16) * u, 22 * u); g.fill();
    clip(s, a, px, py, pw, ph, 16);
    tag(s, card.fromShort, px + 14, py + 14, { size: 24 });
  }
  if (card.song) type(s, card.song, 62, y + h + (up ? 70 : 90), 36, 600, { alpha: 0.7, maxW: up ? 960 : 600 });
}

// Rehearsal: one take, front and center.
function rehearsal(s, card, a, b, t) {
  s.g.fillStyle = INK; s.g.fillRect(0, 0, s.W, s.H);
  header(s, card);
  const up = portrait(b), w = up ? 640 : 960, h = box(b, w, 1080), x = (1080 - w) / 2, y = 430;
  clip(s, b, x, y, w, h);
  tag(s, card.toTag, x + 20, y + 20, { now: true });
  const end = ease(clamp((t - 5.7) / 0.5));
  if (end > 0 && card.event) type(s, card.event.line, 540, y + h + 90, 40, 800, { align: 'center', alpha: end, fill: VIOLET, track: 3, maxW: 960 });
}

const DRAW = { split, wipe, countdown, rehearsal };

// One frame of a card. canvas: any 9:16 canvas (the preview is smaller than the export).
export function drawFrame(canvas, style, card, a, b, t, logo) {
  const g = canvas.getContext('2d');
  const s = { g, W: canvas.width, H: canvas.height, u: canvas.width / W, logo };
  g.save();
  DRAW[style](s, card, a, b, t);
  g.restore();
  signature(s);
  if (card.sample) sample(s);
}

// ---------- Live preview: two muted <video>s playing from the chosen beat, drawn every frame ----------
export function makePlayers(host, urlA, urlB) {
  const mk = (url) => {
    const v = document.createElement('video');
    Object.assign(v, { muted: true, playsInline: true, preload: 'auto', crossOrigin: 'anonymous', src: url });
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.className = 'ce-source';
    host.append(v);
    return v;
  };
  return { a: urlA ? mk(urlA) : null, b: mk(urlB) };
}
const loaded = (v) => (!v || v.readyState >= 2 ? Promise.resolve(v) : new Promise((res) => {
  const done = () => res(v);
  v.addEventListener('loadeddata', done, { once: true });
  v.addEventListener('error', () => res(null), { once: true });
}));
const seek = (v, t) => (!v ? Promise.resolve() : new Promise((res) => {
  const d = Number.isFinite(v.duration) ? v.duration : t + LEN;
  const to = Math.max(0, Math.min(t, d - 0.05));
  if (Math.abs(v.currentTime - to) < 0.02) return res();
  v.addEventListener('seeked', () => res(), { once: true });
  v.currentTime = to;
}));
export async function playersReady(p) {
  const [a, b] = await Promise.all([loaded(p.a), loaded(p.b)]);
  return Boolean(b) && (!p.a || Boolean(a));
}

// get() returns { style, card, startA, startB } each frame, so changes show at once.
export function startPreview(canvas, players, get, logo) {
  let raf = 0, t0 = performance.now(), stopped = false, restarting = false;
  const restart = async () => {
    restarting = true;
    const { startA, startB } = get();
    [players.a, players.b].forEach((v) => v?.pause());
    await Promise.all([seek(players.a, startA), seek(players.b, startB)]);
    if (stopped) return;
    await Promise.all([players.a?.play().catch(() => {}), players.b.play().catch(() => {})]);
    t0 = performance.now();
    restarting = false;
  };
  const loop = () => {
    if (stopped) return;
    const t = (performance.now() - t0) / 1000;
    if (t >= LEN && !restarting) restart();
    const { style, card } = get();
    drawFrame(canvas, style, card, players.a, players.b, Math.min(t, LEN - 0.01), logo);
    raf = requestAnimationFrame(loop);
  };
  restart().then(() => { raf = requestAnimationFrame(loop); });
  return {
    restart,
    stop() { stopped = true; cancelAnimationFrame(raf); [players.a, players.b].forEach((v) => v?.pause()); }
  };
}

// A single frame at full size (the still image, and the style thumbnails), from the same players.
export async function still(canvas, players, { style, card, startA, startB }, logo, at = STILL_AT[style]) {
  [players.a, players.b].forEach((v) => v?.pause());
  await Promise.all([seek(players.a, startA + at), seek(players.b, startB + at)]);
  drawFrame(canvas, style, card, players.a, players.b, at, logo);
}

// ---------- The video ----------
let mbx = null;
const lib = () => (mbx ||= import('./vendor/mediabunny-card-1.61.3.js'));

// Whether this device can make the MP4 (WebCodecs with H.264 at 1080×1920). Otherwise: the image.
export async function canMakeVideo() {
  if (typeof window.VideoEncoder !== 'function' || typeof window.VideoDecoder !== 'function') return false;
  try { return await (await lib()).canEncodeVideo('avc', { width: W, height: H, bitrate: 6e6 }); } catch { return false; }
}

// Renders the card as an MP4 Blob. onProgress(0..1). Stops early (throws AbortError) when signal aborts.
export async function makeVideo({ style, card, urlA, urlB, startA, startB, logo, onProgress = () => {}, signal }) {
  const mb = await lib();
  const open = async (url) => {
    if (!url) return null;
    const input = new mb.Input({ source: new mb.UrlSource(url), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This take has no video in it.');
    const dur = await input.computeDuration();
    const k = Math.min(1, W / Math.max(track.displayWidth, track.displayHeight));
    const sink = new mb.CanvasSink(track, { width: Math.round(track.displayWidth * k), height: Math.round(track.displayHeight * k), fit: 'fill', poolSize: 2 });
    return { sink, dur, input };
  };
  const [A, B] = await Promise.all([open(urlA), open(urlB)]);
  const n = FPS * LEN;
  // Only the frames each style shows: the wipe drops Take 1 after the swipe and starts the latest take at it.
  const span = style === 'wipe' ? [[0, Math.ceil(3.8 * FPS)], [Math.floor(3.0 * FPS), n]] : [[0, n], [0, n]];
  const times = (src, start, [s, e]) => Array.from({ length: e - s }, (_, k) => Math.max(0, Math.min(src.dur - 0.05, start + (s + k) / FPS)));
  const itA = A ? A.sink.canvasesAtTimestamps(times(A, startA, span[0]))[Symbol.asyncIterator]() : null;
  const itB = B.sink.canvasesAtTimestamps(times(B, startB, span[1]))[Symbol.asyncIterator]();
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  const source = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();
  let a = null, b = null;
  try {
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (itA && i >= span[0][0] && i < span[0][1]) a = (await itA.next()).value?.canvas || a;
      if (i >= span[1][0] && i < span[1][1]) b = (await itB.next()).value?.canvas || b;
      drawFrame(canvas, style, card, a, b, i / FPS, logo);
      await source.add(i / FPS, 1 / FPS);
      if (i % 6 === 0) onProgress(i / n);
    }
    source.close();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    [A, B].forEach((x) => x?.input?.dispose?.());
  }
  onProgress(1);
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}
