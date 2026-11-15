// Practice: the project's choreo video, section by section. Loop a part, slow it down, mirror it.
// The choreo video is one of the project's own videos, or a YouTube video (migration 057).
// Built for a phone propped up in a studio: big controls, tap the video to play or pause, the screen stays on.
import { sb, $, $$, esc, fmt, timeAgo, toast, friendlyError, dialog, actionSheet, schema, takeUrl, withUploadBar, TAKE_BUCKET } from '../client.js';
import { uploadTake, checkTakeFile } from '../upload.js';
import { ctx } from '../ctx.js';
import { loadProject, createVideo } from './project.js';
import { track } from '../onboarding.js';
import { ic } from '../icons.js';
import { isKo } from '../i18n.js';
import { countAt, countLabel } from '../counts.js';

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
  const { data: video } = await sb.from('videos').select('id, title, bpm, takes(id, number, created_at, storage_path, thumb_path, count_start)').eq('id', project.choreo_video_id).maybeSingle();
  const take = video?.takes?.length ? [...video.takes].sort((a, b) => b.number - a.number)[0] : null;
  return take ? { kind: 'file', video, take } : null;
}
export const choreoTitle = (choreo) => (choreo?.kind === 'file' ? choreo.video.title : choreo?.title) || (isKo ? '원본 안무 영상' : 'Choreo video');
export const youtubeThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// Owners add the choreo video: a YouTube link (nothing uploaded), or a video file uploaded as the choreo video.
// It's never one of the team's takes (migration 059). Changing it keeps the sections and removes the old file.
// Returns where to go next ('practice') or false.
export async function chooseChoreo({ projectId, current = null, anchor = null, title = null }) {
  const canUpload = schema.videoKind;
  const how = canUpload ? await actionSheet({
    title: title || (current ? 'Change the choreo video' : 'Add a choreo video'),
    anchor,
    actions: [
      { value: 'youtube', icon: 'play', label: 'Paste a YouTube link', hint: 'Plays from YouTube. Nothing to upload.' },
      { value: 'file', icon: 'upload', label: 'Upload a video file', hint: 'A choreographer’s or teacher’s video on your device' }
    ]
  }) : 'youtube';
  if (!how) return false;
  let next = null;
  if (how === 'file') {
    const got = await dialog({
      title: 'Upload the choreo video',
      body: 'The original your team learns from. It stays apart from your takes, so nobody leaves feedback on it.',
      fields: [
        { name: 'file', label: 'Video', type: 'file', accept: 'video/mp4,video/quicktime,video/webm', required: true, hint: 'MP4, MOV, or WebM · up to 15 minutes' },
        { name: 'title', label: 'Name', placeholder: 'e.g. Chorus by the choreographer', required: true, max: 120 }
      ],
      confirm: 'Upload'
    });
    if (!got) return false;
    const problem = checkTakeFile(got.file);
    if (problem) { toast(problem, 'error'); return false; }
    const { data: video, error } = await sb.from('videos').insert({ project_id: projectId, title: got.title, kind: 'choreo' }).select('id').single();
    if (error) { toast(friendlyError(error), 'error'); return false; }
    let take;
    try {
      take = await withUploadBar(got.title, (stage) => uploadTake({ projectId, videoId: video.id, file: got.file, onStage: stage }));
    } catch (err) {
      await sb.from('videos').delete().eq('id', video.id);
      toast(friendlyError(err), 'error');
      return false;
    }
    next = { videoId: video.id, takeId: take?.id || null };
  } else {
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
      if (id) { next = { youtube: id, title: got.title || null }; break; }
      toast('That doesn’t look like a YouTube video link. Copy it from the Share button on YouTube.', 'error');
      value = got.url;
    }
  }
  if (!(await setChoreo(projectId, next))) {
    if (next.videoId) await sb.from('videos').delete().eq('id', next.videoId);
    return false;
  }
  if (current) await retireChoreo(projectId, current, next);
  return 'practice';
}

// The old choreo video goes: its sections move to the new one (same song, so the times usually still fit), and an
// uploaded file is deleted for good (it isn't a take, so there's nothing to keep).
async function retireChoreo(projectId, old, next = null) {
  const to = { video_id: next?.videoId || null, ...(schema.sheetTake ? { take_id: next?.takeId || null } : {}) };
  let move = sb.from('count_sheet_rows').update(to).eq('project_id', projectId).not('t_start', 'is', null);
  move = old.kind === 'file' ? move.eq('video_id', old.video.id) : move.is('video_id', null);
  if (next && (old.kind === 'file' || next.videoId)) await move;
  if (old.kind === 'file') {
    const { error } = await sb.from('videos').delete().eq('id', old.video.id);
    if (!error) {
      const paths = [old.take.storage_path, old.take.thumb_path].filter((x) => x && !String(x).startsWith('public:'));
      if (paths.length) sb.storage.from(TAKE_BUCKET).remove(paths).then(() => {}, () => {});
    }
  }
}

export async function removeChoreo(projectId, choreo) {
  const ok = await dialog({
    title: 'Remove the choreo video?',
    body: choreo.kind === 'file' ? 'The uploaded file is deleted. Sections stay in the count sheet.' : 'Practice turns off until you add another. Sections stay in the count sheet.',
    confirm: 'Remove',
    danger: true
  });
  if (!ok || !(await setChoreo(projectId, {}))) return false;
  await retireChoreo(projectId, choreo, null);
  return true;
}

export async function setChoreo(projectId, { videoId = null, youtube = null, title = null } = {}) {
  const { error } = await sb.from('projects').update({ choreo_video_id: videoId, choreo_youtube: youtube, choreo_title: youtube ? title : null }).eq('id', projectId);
  if (error) { toast(friendlyError(error), 'error'); return false; }
  if (videoId || youtube) track('choreo_set', { kind: youtube ? 'youtube' : 'file' });
  toast(videoId || youtube ? 'Choreo video added. Everyone in the project can practice it, section by section.' : 'Choreo video removed.');
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
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, fs: 0, iv_load_policy: 3, controls: 0, disablekb: 1 },
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
// Same surfaces as the video screen (dark player, timeline, controls row, side panel), so practicing and giving
// feedback feel like one product. The side panel is the song's sections: tap one to loop it, add one where the
// video is now. Sections are the count sheet's rows, so they're the team's, shared with Overview.
const SECTION_NAMES = isKo ? ['인트로', '벌스', '프리코러스', '코러스', '댄스 브레이크', '브릿지', '아웃트로'] : ['Intro', 'Verse', 'Pre-chorus', 'Chorus', 'Dance break', 'Bridge', 'Outro'];
const BANDS = 6;

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
      if (await chooseChoreo({ projectId, anchor: e.currentTarget })) ctx.route();
    });
    return null;
  }

  const videoId = choreo.kind === 'file' ? choreo.video.id : null;
  // A YouTube choreo video has no video row: its sections are the rows with a start time and no video.
  const belongs = (r) => r.t_start !== null && (videoId ? r.video_id === videoId : !r.video_id);
  let sections = [];
  const loadSections = async () => {
    const { data } = await sb.from('count_sheet_rows').select('id, position, section, counts, video_id, t_start').eq('project_id', projectId).order('position');
    sections = (data || []).filter(belongs).sort((a, b) => Number(a.t_start) - Number(b.t_start));
  };
  await loadSections();

  const params = new URLSearchParams(location.search);
  let speed = Number(read(SPEED_KEY, '1'));
  if (!SPEEDS.includes(speed)) speed = 1;
  let mirror = read(MIRROR_KEY, '1') === '1';
  let current = -1; // -1: the whole song
  let looping = false; // a section loops only once someone picks it
  const wanted = params.get('section');
  const title = choreoTitle(choreo);
  const counts = choreo.kind === 'file' && choreo.video.bpm && choreo.take.count_start !== null && choreo.take.count_start !== undefined
    ? { bpm: Number(choreo.video.bpm), start: Number(choreo.take.count_start) } : null;

  view.innerHTML = `<section class="review practice">
    <header class="review-head">
      <div><p class="practice-eyebrow"><span class="choreo-badge">Choreo</span><span class="muted">${esc(p.project.title)}${choreo.kind === 'youtube' ? ' · YouTube' : ''}</span></p><h1 data-practice-title data-no-i18n>${esc(title)}</h1></div>
    </header>
    <div class="review-layout practice-layout">
      <div class="player-col" data-col>
        <div class="player-pair" data-pair>
          <div class="player${mirror ? ' mirrored' : ''}" data-player>
            <div class="practice-media" data-media></div>
            ${choreo.kind === 'file' ? `<button class="big-play" data-big-play aria-label="Play or pause (Space)">${ic('play', 'solo')}</button>` : ''}
            <span class="count-badge" data-count hidden></span>
            <span class="player-badge"><b class="mirror-badge">${ic('mirror')}Mirrored</b></span>
            <span class="practice-flag" data-flag hidden></span>
          </div>
        </div>
        <div class="timeline"><span data-cur>00:00</span><div class="track" data-track role="slider" tabindex="0" aria-label="Playback position" aria-valuemin="0"><span class="t-bands" data-bands></span><span class="t-loop" data-tloop hidden></span><span class="t-fill" data-tfill></span><span class="t-head" data-thead></span></div><span data-dur>--:--</span></div>
        <div class="controls practice-controls">
          <button data-play aria-label="Play (Space)">${ic('play', 'solo')}</button>
          <button data-prev aria-label="Previous section (←)" title="Previous section (←)">${ic('back', 'solo')}</button>
          <button data-next aria-label="Next section (→)" title="Next section (→)">${ic('right', 'solo')}</button>
          <div class="seg dark pc-speed" role="group" aria-label="Speed">${SPEEDS.map((s) => `<button type="button" data-speed="${s}" aria-selected="${s === speed}" title="Speed ([ and ])">${s}×</button>`).join('')}</div>
          <span class="loop-chip" data-loopchip></span>
          <span class="spacer"></span>
          <button class="toggle-btn" data-mirror aria-pressed="${mirror}" title="Mirror (M)">${ic('mirror')}<span class="wide-only">Mirror</span></button>
          <button class="toggle-btn full-btn" data-full aria-pressed="false" title="Full screen (F)" aria-label="Full screen">${ic('expand', 'solo')}</button>
        </div>
      </div>
      <aside class="notes-col practice-side">
        <div class="side-head"><h2>Sections</h2><span class="muted" data-sec-count></span></div>
        <div class="practice-next" data-next-step hidden></div>
        <div class="sec-list" data-secs></div>
        <button type="button" class="sec-add" data-add-sec>${ic('plus', 'solo')}<span>Add a section at <b data-at>00:00</b></span></button>
      </aside>
    </div>
  </section>`;

  const media = $('[data-media]');
  const flag = $('[data-flag]');
  const showError = (code) => {
    const blocked = code === 101 || code === 150;
    media.innerHTML = `<div class="practice-error"><p>${code === -1 ? 'YouTube didn’t load. Check your connection and try again.' : blocked ? 'This video can’t be played outside YouTube: its owner turned that off.' : 'This YouTube video isn’t available.'}</p>${choreo.kind === 'youtube' ? `<a class="btn small" href="https://www.youtube.com/watch?v=${esc(choreo.id)}" target="_blank" rel="noopener">Open on YouTube</a>` : ''}</div>`;
  };
  let player;
  try {
    player = choreo.kind === 'file' ? filePlayer(media, await takeUrl(choreo.take.storage_path)) : youtubePlayer(media, choreo.id, showError);
  } catch (error) {
    media.innerHTML = `<div class="practice-error"><p>${esc(friendlyError(error))}</p></div>`;
    return null;
  }

  // ---------- Sections: where each starts and ends ----------
  const bounds = (i = current) => {
    const end = player.duration || Infinity;
    if (i < 0) return [0, end];
    const s = Number(sections[i].t_start);
    const next = sections.slice(i + 1).find((x) => Number(x.t_start) > s);
    return [s, next ? Number(next.t_start) : end];
  };
  const pct = (t) => `${player.duration ? Math.min(100, Math.max(0, (t / player.duration) * 100)) : 0}%`;
  const sectionAt = (t) => { let k = -1; sections.forEach((s, i) => { if (Number(s.t_start) <= t + 0.05) k = i; }); return k; };

  const paintSections = () => {
    $('[data-sec-count]').textContent = sections.length ? `${sections.length}` : '';
    const row = (i, name, meta) => {
      const on = looping && i === current;
      return `<div class="sec-row${on ? ' on' : ''}" data-row="${i}">
        <button type="button" class="sec-main" data-loop="${i}" aria-pressed="${on}">
          <span class="sec-dot b${i < 0 ? 'w' : i % BANDS}" aria-hidden="true"></span>
          <span class="sec-text"><b ${i >= 0 ? 'data-no-i18n' : ''}>${name}</b><small>${meta}</small></span>
          <span class="sec-state">${on ? `${ic('loop')}<span>Looping</span>` : ic('loop', 'solo')}</span>
        </button>
        ${i >= 0 ? `<button type="button" class="icon-btn sec-more" data-sec-more="${i}" aria-label="Options for ${esc(sections[i].section || '')}">${ic('more', 'solo')}</button>` : ''}
      </div>`;
    };
    const time = (i) => { const [a, b] = bounds(i); return `${fmt(a)}–${Number.isFinite(b) ? fmt(b) : '…'}`; };
    $('[data-secs]').innerHTML = row(-1, isKo ? '전체' : 'Whole song', player.duration ? `${fmt(0)}–${fmt(player.duration)}` : '')
      + sections.map((s, i) => row(i, esc(s.section || `Section ${i + 1}`), `${time(i)}${s.counts ? ` · <span data-no-i18n>${esc(s.counts)}</span>` : ''}`)).join('')
      + (sections.length ? '' : `<div class="sec-empty"><b>Mark the parts of the song</b><p>Play to where a part starts (the intro, a verse, the chorus), then tap “Add a section”. Tap a section to loop it.</p></div>`);
    $('[data-bands]').innerHTML = sections.map((s, i) => { const [a, b] = bounds(i); return `<i class="t-band b${i % BANDS}" style="left:${pct(a)};width:calc(${pct(Number.isFinite(b) ? b : player.duration)} - ${pct(a)})" title="${esc(s.section || '')}"></i>`; }).join('');
    $$('[data-prev], [data-next]').forEach((b) => { b.disabled = !sections.length; });
    $$('[data-loop]').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.loop), { from: 'list' })));
    $$('[data-sec-more]').forEach((b) => b.addEventListener('click', () => sectionMenu(Number(b.dataset.secMore), b)));
    paintLoop();
  };
  const paintLoop = () => {
    const box = $('[data-tloop]');
    const chip = $('[data-loopchip]');
    if (looping && current >= 0) {
      const [a, b] = bounds();
      box.hidden = false;
      box.style.left = pct(a);
      box.style.width = `calc(${pct(Number.isFinite(b) ? b : player.duration)} - ${pct(a)})`;
      chip.innerHTML = `${ic('loop')}<span data-no-i18n>${esc(sections[current].section || '')}</span><button type="button" data-unloop aria-label="Stop looping">${ic('x', 'solo')}</button>`;
      chip.querySelector('[data-unloop]').addEventListener('click', () => { looping = false; current = -1; paintSections(); });
    } else { box.hidden = true; chip.innerHTML = ''; }
  };

  // ---------- Playback ----------
  let tick = 0;
  let played = 0;
  let last = performance.now();
  let countKey = '';
  const paintTime = () => {
    const t = player.time;
    $('[data-cur]').textContent = fmt(t);
    $('[data-at]').textContent = fmt(t);
    if (player.duration) $('[data-dur]').textContent = fmt(player.duration);
    $('[data-tfill]').style.width = pct(t);
    $('[data-thead]').style.left = pct(t);
    const track = $('[data-track]');
    track.setAttribute('aria-valuemax', String(Math.round(player.duration || 0)));
    track.setAttribute('aria-valuenow', String(Math.round(t)));
    track.setAttribute('aria-valuetext', fmt(t));
    if (counts) {
      const c = countAt(t, counts.bpm, counts.start);
      const key = c ? countLabel(c) : '';
      if (key !== countKey) {
        countKey = key;
        const badge = $('[data-count]');
        badge.hidden = !c;
        if (c) badge.innerHTML = `<small>${isKo ? `${c.eight}번째 에잇` : `Eight ${c.eight}`}</small><b>${c.count}</b>`;
      }
    }
  };
  const loop = () => {
    const now = performance.now();
    if (!player.paused) played += (now - last) / 1000;
    last = now;
    if (!player.paused) {
      const [a, b] = bounds(looping ? current : -1);
      const t = player.time;
      if (t >= b - 0.08) { player.seek(a); if (looping) lapped(); }
      else if (looping && t < a - 0.5) player.seek(a);
    }
    paintTime();
  };
  const startTick = () => { if (!tick) { last = performance.now(); tick = setInterval(loop, 50); } };

  // After a few laps of one section: practice → a take. Film it, upload it, get feedback on that part.
  // Once a day at most, and it never covers the video.
  let laps = 0;
  const NEXT_KEY = `looproom:practice-next:${projectId}`;
  const lapped = () => {
    laps += 1;
    const box = $('[data-next-step]');
    if (laps < 3 || !box.hidden || current < 0) return;
    try { if (localStorage.getItem(NEXT_KEY) === new Date().toDateString()) return; } catch {}
    const name = sections[current].section || '';
    box.innerHTML = `<b>Ready to film it?</b><p data-no-i18n>${isKo ? `‘${esc(name)}’ 테이크를 찍어 올리면 팀원이 정확한 순간에 피드백을 남길 수 있어요.` : `Upload a take of ${esc(name)}, and your team can leave feedback on the exact moment.`}</p>
      <div class="practice-next-actions"><button type="button" class="btn small primary" data-film>${ic('upload')}Upload a take</button><button type="button" class="link-btn" data-not-now>Not now</button></div>`;
    box.hidden = false;
    const done = () => { box.hidden = true; try { localStorage.setItem(NEXT_KEY, new Date().toDateString()); } catch {} };
    box.querySelector('[data-not-now]').addEventListener('click', done);
    box.querySelector('[data-film]').addEventListener('click', () => {
      done();
      player.pause();
      track('practice_to_take', { laps });
      const day = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      createVideo(projectId, { name: `${name} · ${day}` });
    });
    track('practice_next_shown', { laps });
  };
  const stopTick = () => { clearInterval(tick); tick = 0; loop(); };

  let lock = null;
  const keepAwake = async (on) => {
    try {
      if (on && !lock && navigator.wakeLock && document.visibilityState === 'visible') { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      if (!on && lock) { await lock.release(); lock = null; }
    } catch {}
  };
  const paintPlay = () => {
    const playing = !player.paused;
    const btn = $('[data-play]');
    btn.innerHTML = ic(playing ? 'pause' : 'play', 'solo');
    btn.setAttribute('aria-label', playing ? 'Pause (Space)' : 'Play (Space)');
    $('[data-player]').classList.toggle('playing', playing);
    if (playing) startTick(); else stopTick();
    keepAwake(playing);
    if (player.ended) { player.seek(bounds(looping ? current : -1)[0]); player.play(); }
  };
  player.on(paintPlay);

  const pick = (i, { from = 'list' } = {}) => {
    current = Math.max(-1, Math.min(sections.length - 1, i));
    looping = current >= 0;
    player.seek(bounds()[0]);
    player.play();
    paintSections();
    paintTime();
    $(`[data-row="${current}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (looping) track('practice_section_loop', { from });
  };
  const step = (d) => {
    if (!sections.length) return;
    const from = looping ? current : sectionAt(player.time);
    pick(from + d < 0 ? sections.length - 1 : from + d >= sections.length ? 0 : from + d, { from: d < 0 ? 'prev' : 'next' });
  };
  const toggle = () => { if (player.paused) player.play(); else player.pause(); };
  const setSpeed = (s, { quiet = false } = {}) => {
    speed = s;
    save(SPEED_KEY, String(s));
    player.rate(s);
    $$('[data-speed]').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.speed) === s)));
    if (quiet) return;
    flag.textContent = `${s}×`;
    flag.hidden = false;
    clearTimeout(flag.timer);
    flag.timer = setTimeout(() => { flag.hidden = true; }, 900);
    track('practice_speed', { speed: s });
  };
  const setMirror = (on) => {
    mirror = on;
    save(MIRROR_KEY, on ? '1' : '0');
    $('[data-player]').classList.toggle('mirrored', on);
    $('[data-mirror]').setAttribute('aria-pressed', String(on));
  };

  // Scrub: tap or drag on the timeline. Arrow keys on it move 5 seconds.
  const trackEl = $('[data-track]');
  const timeAtX = (x) => { const box = trackEl.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - box.left) / box.width)) * (player.duration || 0); };
  trackEl.addEventListener('pointerdown', (e) => {
    if (!player.duration) return;
    trackEl.setPointerCapture(e.pointerId);
    const move = (ev) => { player.seek(timeAtX(ev.clientX)); paintTime(); };
    move(e);
    const up = (ev) => { move(ev); const t = timeAtX(ev.clientX); if (looping && (t < bounds()[0] || t >= bounds()[1])) { looping = false; current = -1; paintSections(); } trackEl.removeEventListener('pointermove', move); trackEl.removeEventListener('pointerup', up); };
    trackEl.addEventListener('pointermove', move);
    trackEl.addEventListener('pointerup', up);
  });
  trackEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    player.seek(Math.max(0, player.time + (e.key === 'ArrowRight' ? 5 : -5)));
    paintTime();
  });

  // ---------- Sections: add, rename, move, delete (anyone in the project, like the count sheet) ----------
  const nameFields = (s = {}) => [
    { name: 'section', label: 'Section name', value: s.section || '', placeholder: 'Chorus', required: true, max: 80, chips: SECTION_NAMES },
    { name: 'counts', label: 'Counts (optional)', value: s.counts || '', placeholder: '1–8 ×4', max: 80 }
  ];
  const addSection = async () => {
    const t = Math.round(player.time * 10) / 10;
    player.pause();
    if (sections.some((s) => Math.abs(Number(s.t_start) - t) < 0.5)) return toast('A section already starts here. Play a little further, or edit that section.', 'error');
    const got = await dialog({ title: `${isKo ? '파트 추가' : 'Add a section'} · ${fmt(t)}`, body: 'It starts here and runs until the next section.', fields: nameFields(), confirm: 'Add section' });
    if (!got?.section) return;
    const position = sections.length ? Math.max(...sections.map((s) => Number(s.position) || 0)) + 1 : 0;
    const row = { project_id: projectId, section: got.section, counts: got.counts || null, t_start: t, video_id: videoId, position, ...(schema.sheetTake && videoId ? { take_id: choreo.take.id } : {}) };
    const { error } = await sb.from('count_sheet_rows').insert(row);
    if (error) return toast(friendlyError(error), 'error');
    track('practice_section_added', { kind: choreo.kind, count: sections.length + 1 });
    await loadSections();
    paintSections();
    toast(`“${got.section}” added. Tap it to loop.`);
  };
  const sectionMenu = async (i, anchor) => {
    const s = sections[i];
    const t = Math.round(player.time * 10) / 10;
    const choice = await actionSheet({ title: s.section || 'Section', anchor, actions: [
      { value: 'rename', icon: 'pen', label: 'Rename' },
      { value: 'move', icon: 'at', label: `${isKo ? '시작을 여기로' : 'Start here'} · ${fmt(t)}`, hint: 'Move this section’s start to where the video is now' },
      { value: 'delete', icon: 'x', label: 'Delete section', danger: true }
    ] });
    let patch = null;
    if (choice === 'rename') {
      const got = await dialog({ title: 'Rename section', fields: nameFields(s), confirm: 'Save' });
      if (got?.section) patch = { section: got.section, counts: got.counts || null };
    }
    if (choice === 'move') {
      if (sections.some((x, k) => k !== i && Math.abs(Number(x.t_start) - t) < 0.5)) return toast('Another section already starts here.', 'error');
      patch = { t_start: t, ...(schema.sheetTake && videoId ? { take_id: choreo.take.id } : {}) };
    }
    if (choice === 'delete') {
      if (!(await dialog({ title: `Delete “${s.section}”?`, body: 'It’s removed from the count sheet too. The video isn’t changed.', confirm: 'Delete', danger: true }))) return;
      const { error } = await sb.from('count_sheet_rows').delete().eq('id', s.id);
      if (error) return toast(friendlyError(error), 'error');
      if (current === i) { looping = false; current = -1; }
    }
    if (patch) {
      const { error } = await sb.from('count_sheet_rows').update(patch).eq('id', s.id);
      if (error) return toast(friendlyError(error), 'error');
    }
    if (choice) {
      const keep = current >= 0 ? sections[current]?.id : null;
      await loadSections();
      current = keep ? sections.findIndex((x) => x.id === keep) : -1;
      if (current < 0) looping = false;
      paintSections();
    }
  };

  // ---------- Full screen: the whole player column, like the video screen (iPhone: fills the window) ----------
  const col = $('[data-col]');
  const fullBtn = $('[data-full]');
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fit = () => {
    const pl = $('[data-player]');
    if (!col.classList.contains('is-full')) { pl.style.width = ''; pl.style.height = ''; return; }
    const box = $('[data-pair]').getBoundingClientRect();
    const v = media.querySelector('video');
    const ar = v?.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9;
    const w = Math.max(0, Math.min(box.width, box.height * ar));
    pl.style.width = `${Math.floor(w)}px`;
    pl.style.height = `${Math.floor(w / ar)}px`;
  };
  const setFull = (on) => {
    col.classList.toggle('is-full', on);
    document.body.classList.toggle('player-full', on);
    fullBtn.setAttribute('aria-pressed', String(on));
    fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    fullBtn.title = on ? 'Exit full screen (F)' : 'Full screen (F)';
    fullBtn.innerHTML = ic(on ? 'shrink' : 'expand', 'solo');
    requestAnimationFrame(fit);
  };
  const toggleFull = async () => {
    if (!col.classList.contains('is-full')) {
      const req = col.requestFullscreen || col.webkitRequestFullscreen;
      if (req) { try { await req.call(col); await screen.orientation?.lock?.('landscape').catch(() => {}); } catch {} }
      setFull(true);
      track('practice_full_screen');
    } else {
      if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
      try { screen.orientation?.unlock?.(); } catch {}
      setFull(false);
    }
  };
  const onFs = () => { if (!fsElement() && col.classList.contains('is-full')) setFull(false); };
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  resize?.observe($('[data-pair]'));

  // ---------- Wiring ----------
  $('[data-play]').addEventListener('click', toggle);
  $('[data-big-play]')?.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  if (choreo.kind === 'file') $('[data-player]').addEventListener('click', toggle);
  $('[data-prev]').addEventListener('click', () => step(-1));
  $('[data-next]').addEventListener('click', () => step(1));
  $$('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
  $('[data-mirror]').addEventListener('click', () => setMirror(!mirror));
  fullBtn.addEventListener('click', toggleFull);
  $('[data-add-sec]').addEventListener('click', addSection);

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable], dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); toggle(); }
    else if (k === 'arrowleft') { e.preventDefault(); step(-1); }
    else if (k === 'arrowright') { e.preventDefault(); step(1); }
    else if (k === '[' || k === ']') { const i = SPEEDS.indexOf(speed) + (k === ']' ? 1 : -1); if (SPEEDS[i]) setSpeed(SPEEDS[i]); }
    else if (k === 'm') setMirror(!mirror);
    else if (k === 'f') toggleFull();
    else if (k === 's') addSection();
    else if (k === 'escape' && col.classList.contains('is-full') && !fsElement()) toggleFull();
    else if (k === 'escape' && looping) { looping = false; current = -1; paintSections(); }
  };
  document.addEventListener('keydown', onKey);
  const onVisible = () => { if (document.visibilityState === 'visible' && !player.paused) keepAwake(true); };
  document.addEventListener('visibilitychange', onVisible);

  paintSections();
  track('practice_open', { kind: choreo.kind, from: params.get('from') || 'direct', sections: sections.length });
  player.ready.then(() => {
    setSpeed(speed, { quiet: true });
    const v = media.querySelector('video');
    // The player takes the video's shape (an upright phone video gets an upright player).
    $('[data-player]').style.aspectRatio = v?.videoWidth ? `${v.videoWidth} / ${v.videoHeight}` : '16 / 9';
    if (choreo.kind === 'youtube' && !choreo.title && player.title) {
      $('[data-practice-title]').textContent = player.title;
      if (p.isOwner) sb.from('projects').update({ choreo_title: player.title.slice(0, 120) }).eq('id', projectId).then(() => {});
    }
    const at = wanted ? sections.findIndex((s) => s.id === wanted) : -1;
    if (at >= 0) { current = at; looping = true; player.seek(bounds()[0]); }
    paintSections();
    paintTime();
    paintPlay();
  }).catch(() => showError(-1));

  return () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('fullscreenchange', onFs);
    document.removeEventListener('webkitfullscreenchange', onFs);
    document.body.classList.remove('player-full');
    resize?.disconnect();
    clearInterval(tick);
    keepAwake(false);
    if (played >= 5) track('practice_minutes', { minutes: Math.round(played / 6) / 10, kind: choreo.kind });
    player.destroy();
  };
}

// The choreo card at the top of a project's videos: practice is one tap away.
export function choreoCard({ projectId, choreo, isOwner }) {
  // The same row as a take (thumbnail, name, one line about it, chevron, ⋯): the zone heading says what it is,
  // and the whole row opens Practice.
  const title = choreoTitle(choreo);
  const thumb = choreo.kind === 'youtube' ? `<img src="${youtubeThumb(choreo.id)}" alt="" loading="lazy" />` : '';
  const meta = choreo.kind === 'youtube' ? 'YouTube' : choreo.take.created_at ? `Uploaded ${timeAgo(choreo.take.created_at)}` : '';
  return `<div class="video-list choreo-list"><div class="video-item${isOwner ? ' has-more' : ''}">
    <a class="video-row" href="/app/p/${projectId}/practice?from=videos" data-link aria-label="Practice ${esc(title)}">
      <span class="video-thumb${thumb ? ' has-img' : ''}" ${choreo.kind === 'file' ? `data-thumb="${choreo.take.id}"` : ''}>${thumb}<i aria-hidden="true">${ic('play', 'solo')}</i></span>
      <span class="video-copy"><b data-no-i18n title="${esc(title)}">${esc(title)}</b><small>${meta}</small></span>
      <span class="chev">${ic('right', 'solo')}</span>
    </a>
    ${isOwner ? `<button class="icon-btn row-more" data-choreo-more aria-label="Choreo video options" title="Choreo video options">${ic('more', 'solo')}</button>` : ''}
  </div></div>`;
}
