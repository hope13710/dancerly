// Practice: the project's choreo video, section by section. Loop a part, slow it down, mirror it.
// The choreo video is one of the project's own videos, or a YouTube video (migration 057).
// Built for a phone propped up in a studio: big controls, tap the video to play or pause, the screen stays on.
import { sb, $, $$, esc, fmt, toast, friendlyError, dialog, actionSheet, schema, takeUrl } from '../client.js';
import { ctx } from '../ctx.js';
import { loadProject } from './project.js';
import { track } from '../onboarding.js';
import { ic } from '../icons.js';
import { isKo } from '../i18n.js';

const SPEEDS = [0.5, 0.75, 1];
const SPEED_KEY = 'looproom:practice-speed';
const MIRROR_KEY = 'looproom:practice-mirror';
const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

// A YouTube video id from anything people paste: watch, youtu.be, shorts, embed, live, music, mobile links, or the id.
export function youtubeId(text) {
  const s = String(text || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let url;
  try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') || (url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/) || [])[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

// The project's choreo video, ready to play: { kind: 'file', video, take } or { kind: 'youtube', id, title }, or null.
export async function loadChoreo(project) {
  if (!schema.choreo) return null;
  if (project.choreo_youtube) return { kind: 'youtube', id: project.choreo_youtube, title: project.choreo_title || '' };
  if (!project.choreo_video_id) return null;
  // A trashed video is hidden by row-level security: then there's no choreo video.
  const { data: video } = await sb.from('videos').select('id, title, takes(id, number, storage_path, thumb_path)').eq('id', project.choreo_video_id).maybeSingle();
  const take = video?.takes?.length ? [...video.takes].sort((a, b) => b.number - a.number)[0] : null;
  return take ? { kind: 'file', video, take } : null;
}
export const choreoTitle = (choreo) => (choreo?.kind === 'file' ? choreo.video.title : choreo?.title) || (isKo ? '원본 안무 영상' : 'Choreo video');
export const youtubeThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// Owners pick the choreo video: a YouTube link, or one of the project's videos.
export async function chooseChoreo({ projectId, videos = [], anchor = null }) {
  const usable = videos.filter((v) => v.takes?.length);
  let how = 'youtube';
  if (usable.length) {
    how = await actionSheet({
      title: 'Add a choreo video',
      anchor,
      actions: [
        { value: 'youtube', icon: 'play', label: 'Paste a YouTube link', hint: 'An official dance practice video, a tutorial, or the choreographer’s video' },
        { value: 'video', icon: 'video', label: 'Use a video from this project', hint: 'One you’ve already uploaded here' }
      ]
    });
    if (!how) return false;
  }
  if (how === 'video') {
    const picked = await dialog({
      title: 'Choose the choreo video',
      body: 'Everyone in the project can practice from it, section by section.',
      fields: [{ name: 'video', label: 'Video', type: 'select', required: true, options: usable.map((v) => ({ value: v.id, label: v.title })) }],
      confirm: 'Set as choreo video'
    });
    return picked ? setChoreo(projectId, { videoId: picked.video }) : false;
  }
  for (let value = ''; ;) {
    const got = await dialog({
      title: 'Add a YouTube choreo video',
      body: 'Paste the link to the video your team learns from. It plays here from YouTube, so nothing is uploaded.',
      fields: [
        { name: 'url', label: 'YouTube link', placeholder: 'https://youtu.be/…', value, required: true, max: 300 },
        { name: 'title', label: 'Name (optional)', placeholder: 'e.g. Official dance practice', max: 120 }
      ],
      confirm: 'Add'
    });
    if (!got) return false;
    const id = youtubeId(got.url);
    if (id) return setChoreo(projectId, { youtube: id, title: got.title || null });
    toast('That doesn’t look like a YouTube video link. Copy it from the Share button on YouTube.', 'error');
    value = got.url;
  }
}

export async function setChoreo(projectId, { videoId = null, youtube = null, title = null } = {}) {
  const { error } = await sb.from('projects').update({ choreo_video_id: videoId, choreo_youtube: youtube, choreo_title: youtube ? title : null }).eq('id', projectId);
  if (error) { toast(friendlyError(error), 'error'); return false; }
  if (videoId || youtube) track('choreo_set', { kind: youtube ? 'youtube' : 'file' });
  toast(videoId || youtube ? 'Choreo video set. Everyone in the project can practice from it.' : 'Choreo video removed.');
  return true;
}

// ---------- Players: one small interface over a <video> and a YouTube embed ----------
function filePlayer(host, src) {
  host.innerHTML = `<video class="practice-video" playsinline preload="metadata" src="${esc(src)}"></video>`;
  const v = host.querySelector('video');
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f());
  ['play', 'pause', 'ended', 'loadedmetadata', 'ratechange'].forEach((e) => v.addEventListener(e, emit));
  return {
    ready: new Promise((resolve) => (v.readyState >= 1 ? resolve() : v.addEventListener('loadedmetadata', resolve, { once: true }))),
    get time() { return v.currentTime; },
    get duration() { return Number.isFinite(v.duration) ? v.duration : 0; },
    get paused() { return v.paused; },
    get ended() { return v.ended; },
    play() { return v.play().catch(() => {}); },
    pause() { v.pause(); },
    seek(t) { v.currentTime = t; },
    rate(r) { v.playbackRate = r; },
    on(f) { listeners.add(f); },
    destroy() { v.pause(); v.removeAttribute('src'); v.load(); }
  };
}

let ytApi = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { before?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { ytApi = null; reject(new Error('YouTube didn’t load')); };
    document.head.append(s);
  });
  return ytApi;
}
function youtubePlayer(host, id, onError) {
  host.innerHTML = '<div class="practice-yt"><div data-yt></div></div>';
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f());
  let p = null;
  let state = -1;
  const ready = loadYouTubeApi().then((YT) => new Promise((resolve) => {
    p = new YT.Player(host.querySelector('[data-yt]'), {
      videoId: id,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, fs: 0, iv_load_policy: 3 },
      events: {
        onReady: () => resolve(),
        onStateChange: (e) => { state = e.data; emit(); },
        onError: (e) => onError?.(e.data)
      }
    });
  }));
  return {
    ready,
    get time() { return p?.getCurrentTime?.() || 0; },
    get duration() { return p?.getDuration?.() || 0; },
    get paused() { return state !== 1 && state !== 3; },
    get ended() { return state === 0; },
    get title() { return p?.getVideoData?.()?.title || ''; },
    play() { p?.playVideo?.(); },
    pause() { p?.pauseVideo?.(); },
    seek(t) { p?.seekTo?.(t, true); },
    rate(r) { p?.setPlaybackRate?.(r); },
    on(f) { listeners.add(f); },
    destroy() { try { p?.destroy?.(); } catch {} }
  };
}

// ---------- The page ----------
export async function renderPractice(projectId) {
  const { view, setCrumbs } = ctx;
  const p = await loadProject(projectId);
  const choreo = await loadChoreo(p.project);
  const base = `/app/p/${projectId}`;
  setCrumbs([['Projects', '/app/projects'], [p.project.title, base], ['Practice']]);
  if (!choreo) {
    view.innerHTML = `<section class="page practice-page"><div class="empty"><div class="empty-icon">${ic('play', 'solo')}</div>
      <h2>No choreo video yet</h2>
      <p>${p.isOwner ? 'Add the video your team learns from, and everyone can practice it here, section by section.' : 'When the project owner adds the choreo video, you can practice it here, section by section.'}</p>
      <div class="empty-actions">${p.isOwner && schema.choreo ? '<button class="btn primary" data-add-choreo>Add a choreo video</button>' : ''}<a class="btn" href="${base}" data-link>Back to videos</a></div></div></section>`;
    $('[data-add-choreo]')?.addEventListener('click', async (e) => {
      const { data: videos } = await sb.from('videos').select('id, title, takes(id)').eq('project_id', projectId).order('created_at', { ascending: false });
      if (await chooseChoreo({ projectId, videos: videos || [], anchor: e.currentTarget })) ctx.route();
    });
    return null;
  }

  // Sections from the count sheet: the ones with a start time on this video (a YouTube choreo has no video row,
  // so its sections are the ones with a time and no video).
  const { data: rows } = await sb.from('count_sheet_rows').select('id, position, section, counts, video_id, t_start').eq('project_id', projectId).order('position');
  const mine = (rows || []).filter((r) => r.t_start !== null && (choreo.kind === 'file' ? r.video_id === choreo.video.id : !r.video_id));
  const sections = [...mine].sort((a, b) => Number(a.t_start) - Number(b.t_start));

  const params = new URLSearchParams(location.search);
  let speed = Number(read(SPEED_KEY, '1'));
  if (!SPEEDS.includes(speed)) speed = 1;
  let mirror = read(MIRROR_KEY, '1') === '1';
  let current = -1; // -1: the whole song
  const startAt = params.get('section') ? sections.findIndex((s) => s.id === params.get('section')) : -1;

  const title = choreoTitle(choreo);
  const feedbackLink = choreo.kind === 'file' ? `<a class="btn ghost small" href="${base}/v/${choreo.video.id}" data-link>${ic('note')}Feedback</a>` : '';
  view.innerHTML = `<section class="page practice-page">
    <header class="practice-head">
      <div class="practice-title"><span class="choreo-badge">Choreo</span><h1 data-practice-title>${esc(title)}</h1>${choreo.kind === 'youtube' ? '<small class="muted">YouTube</small>' : ''}</div>
      ${feedbackLink}
    </header>
    <div class="practice-stage${mirror ? ' mirrored' : ''}" data-stage>
      <div class="practice-media" data-media></div>
      ${choreo.kind === 'file' ? '<button type="button" class="practice-tap" data-tap aria-label="Play or pause"></button>' : ''}
      <span class="practice-flag" data-flag hidden></span>
    </div>
    <div class="practice-sections" role="group" aria-label="Sections">
      <button type="button" class="sec-chip" data-sec="-1" aria-pressed="true">Whole song</button>
      ${sections.map((s, i) => `<button type="button" class="sec-chip" data-sec="${i}" aria-pressed="false" data-no-i18n>${esc(s.section || `Section ${i + 1}`)}${s.counts ? `<small>${esc(s.counts)}</small>` : ''}</button>`).join('')}
    </div>
    ${sections.length ? '' : `<p class="practice-hint">Add sections with start times in the count sheet to loop each part. <a href="${base}/counts" data-link>Add sections</a></p>`}
    <div class="practice-controls">
      <button type="button" class="pc-btn" data-prev aria-label="Previous section" ${sections.length ? '' : 'disabled'}>${ic('back', 'solo')}</button>
      <button type="button" class="pc-btn pc-play" data-play aria-label="Play">${ic('play', 'solo')}</button>
      <button type="button" class="pc-btn" data-next aria-label="Next section" ${sections.length ? '' : 'disabled'}>${ic('right', 'solo')}</button>
      <span class="pc-time" data-time>00:00</span>
      <div class="seg pc-speed" role="group" aria-label="Speed">${SPEEDS.map((s) => `<button type="button" data-speed="${s}" aria-pressed="${s === speed}">${s}×</button>`).join('')}</div>
      <button type="button" class="pc-btn pc-mirror" data-mirror aria-pressed="${mirror}" aria-label="Mirror" title="Mirror (M)">${ic('mirror', 'solo')}<span>Mirror</span></button>
    </div>
  </section>`;

  const media = $('[data-media]');
  const flag = $('[data-flag]');
  const showError = (code) => {
    const blocked = code === 101 || code === 150;
    media.innerHTML = `<div class="practice-error"><p>${blocked ? 'This video can’t be played outside YouTube: its owner turned that off.' : 'This YouTube video isn’t available.'}</p>${blocked ? `<a class="btn" href="https://www.youtube.com/watch?v=${esc(choreo.id)}" target="_blank" rel="noopener">Open on YouTube</a>` : ''}${p.isOwner ? `<a class="btn ghost" href="${base}" data-link>Change choreo video</a>` : ''}</div>`;
  };
  let player;
  try {
    player = choreo.kind === 'file' ? filePlayer(media, await takeUrl(choreo.take.storage_path)) : youtubePlayer(media, choreo.id, showError);
  } catch (error) {
    media.innerHTML = `<div class="practice-error"><p>${esc(friendlyError(error))}</p></div>`;
    return null;
  }

  // The loop: inside a section, coming to its end jumps back to its start. The whole song loops at the end too.
  const bounds = () => {
    if (current < 0) return [0, player.duration || Infinity];
    const s = Number(sections[current].t_start);
    const next = sections.slice(current + 1).find((x) => Number(x.t_start) > s);
    return [s, next ? Number(next.t_start) : player.duration || Infinity];
  };
  let tick = 0;
  let played = 0; // seconds of practice, for the "practice_minutes" event
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    if (!player.paused) played += (now - last) / 1000;
    last = now;
    const [a, b] = bounds();
    const t = player.time;
    if (!player.paused && (t >= b - 0.08 || t < a - 0.5)) player.seek(a);
    $('[data-time]').textContent = `${fmt(t)}${player.duration ? ` / ${fmt(player.duration)}` : ''}`;
  };
  const startTick = () => { if (!tick) { last = performance.now(); tick = setInterval(loop, 100); } };
  const stopTick = () => { clearInterval(tick); tick = 0; loop(); };

  // The screen stays on while it plays (a phone propped up across the room shouldn't go dark mid-section).
  let lock = null;
  const keepAwake = async (on) => {
    try {
      if (on && !lock && navigator.wakeLock && document.visibilityState === 'visible') { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      if (!on && lock) { await lock.release(); lock = null; }
    } catch {}
  };

  const paint = () => {
    const playing = !player.paused;
    const btn = $('[data-play]');
    btn.innerHTML = ic(playing ? 'pause' : 'play', 'solo');
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $$('[data-sec]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.sec) === current)));
    if (playing) startTick(); else stopTick();
    keepAwake(playing);
    // The whole song plays to the end and starts over.
    if (player.ended) { player.seek(bounds()[0]); player.play(); }
  };
  player.on(paint);

  const pick = (i, { from = 'chip' } = {}) => {
    current = Math.max(-1, Math.min(sections.length - 1, i));
    player.seek(bounds()[0]);
    player.play();
    paint();
    $(`[data-sec="${current}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    if (current >= 0) track('practice_section_loop', { from });
  };
  const toggle = () => { if (player.paused) player.play(); else player.pause(); };
  const setSpeed = (s) => {
    speed = s;
    save(SPEED_KEY, String(s));
    player.rate(s);
    $$('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s)));
    flag.textContent = `${s}×`;
    flag.hidden = false;
    clearTimeout(flag.timer);
    flag.timer = setTimeout(() => { flag.hidden = true; }, 900);
    track('practice_speed', { speed: s });
  };
  const setMirror = (on) => {
    mirror = on;
    save(MIRROR_KEY, on ? '1' : '0');
    $('[data-stage]').classList.toggle('mirrored', on);
    $('[data-mirror]').setAttribute('aria-pressed', String(on));
  };

  $('[data-play]').addEventListener('click', toggle);
  $('[data-tap]')?.addEventListener('click', toggle);
  $('[data-prev]').addEventListener('click', () => pick(current <= 0 ? sections.length - 1 : current - 1, { from: 'prev' }));
  $('[data-next]').addEventListener('click', () => pick(current >= sections.length - 1 ? 0 : current + 1, { from: 'next' }));
  $$('[data-sec]').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.sec))));
  $$('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
  $('[data-mirror]').addEventListener('click', () => setMirror(!mirror));

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft' && sections.length) { e.preventDefault(); $('[data-prev]').click(); }
    else if (e.key === 'ArrowRight' && sections.length) { e.preventDefault(); $('[data-next]').click(); }
    else if (e.key === '[' || e.key === ']') { const i = SPEEDS.indexOf(speed) + (e.key === ']' ? 1 : -1); if (SPEEDS[i]) setSpeed(SPEEDS[i]); }
    else if (e.key === 'm' || e.key === 'M') setMirror(!mirror);
  };
  document.addEventListener('keydown', onKey);
  const onVisible = () => { if (document.visibilityState === 'visible' && !player.paused) keepAwake(true); };
  document.addEventListener('visibilitychange', onVisible);

  track('practice_open', { kind: choreo.kind, from: params.get('from') || 'direct', sections: sections.length });
  player.ready.then(() => {
    player.rate(speed);
    // A phone video is usually upright: give it an upright stage instead of a letterboxed one.
    const v = media.querySelector('video');
    if (v?.videoWidth && v.videoHeight) $('[data-stage]').style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
    if (choreo.kind === 'youtube' && !choreo.title && player.title) {
      $('[data-practice-title]').textContent = player.title;
      // Remember YouTube's title, so the card on Videos says what the video is.
      if (p.isOwner) sb.from('projects').update({ choreo_title: player.title.slice(0, 120) }).eq('id', projectId).then(() => {});
    }
    if (startAt >= 0) { current = startAt; player.seek(bounds()[0]); }
    paint();
  }).catch(() => showError(-1));

  return () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(tick);
    keepAwake(false);
    if (played >= 5) track('practice_minutes', { minutes: Math.round(played / 6) / 10, kind: choreo.kind });
    player.destroy();
  };
}

// The choreo card at the top of a project's videos: practice is one tap away.
export function choreoCard({ projectId, choreo, isOwner }) {
  const title = choreoTitle(choreo);
  const thumb = choreo.kind === 'youtube' ? `<img src="${youtubeThumb(choreo.id)}" alt="" loading="lazy" />` : '';
  return `<div class="choreo-card">
    <a class="choreo-main" href="/app/p/${projectId}/practice?from=videos" data-link>
      <span class="video-thumb choreo-thumb${thumb ? ' has-img' : ''}" ${choreo.kind === 'file' ? `data-thumb="${choreo.take.id}"` : ''}>${thumb}<i aria-hidden="true">${ic('play', 'solo')}</i></span>
      <span class="video-copy"><span class="choreo-badge">Choreo</span><b data-no-i18n>${esc(title)}</b><small>${isKo ? '구간 반복 · 속도 조절 · 거울 모드' : 'Loop a section · Slow it down · Mirror'}</small></span>
      <span class="btn primary small choreo-cta">${ic('play')}Practice</span>
    </a>
    ${isOwner ? `<button class="icon-btn row-more" data-choreo-more aria-label="Choreo video options" title="Choreo video options">${ic('more', 'solo')}</button>` : ''}
  </div>`;
}
