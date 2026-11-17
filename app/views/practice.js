// Practice: the project's choreo video, section by section. Loop a part, slow it down, mirror it.
// The choreo video is one of the project's own videos, or a YouTube video (migration 057).
// Built for a phone propped up in a studio: big controls, tap the video to play or pause, the screen stays on.
import { sb, $, $$, esc, fmt, fmtFine, timeAgo, avatar, toast, friendlyError, dialog, actionSheet, schema, takeUrl, withUploadBar, TAKE_BUCKET, canShareLinks } from '../client.js';
import { uploadTake, checkTakeFile } from '../upload.js';
import { ctx } from '../ctx.js';
import { volumeControl, wireVolume } from '../volume.js';
import { loadProject, createVideo, copyInvite } from './project.js';
import { sharePractice } from './share.js';
import { track } from '../onboarding.js';
import { ic, ytIcon } from '../icons.js';
import { countAt, countLabel, tapTempo } from '../counts.js';
import { overlayChrome } from '../player-chrome.js';
import { choreoKey, loadTakeShift, saveTakeShift, shiftByMusic, focusRange, LOOP_LENGTHS } from '../choreo-align.js';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5]; // the same speeds as a take's player
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
export const choreoTitle = (choreo) => (choreo?.kind === 'file' ? choreo.video.title : choreo?.title) || ('Choreo video');
export const youtubeThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// Anyone in the project adds the choreo video (migration 071): a YouTube link (nothing uploaded), or a video file uploaded as the choreo video.
// It's never one of the team's takes (migration 059). Changing it keeps the sections and removes the old file.
// Returns where to go next ('practice') or false.
export async function chooseChoreo({ projectId, current = null, anchor = null, title = null }) {
  const canUpload = schema.videoKind;
  const how = canUpload ? await actionSheet({
    title: title || (current ? 'Change the choreo video' : 'Add a choreo video'),
    anchor,
    actions: [
      { value: 'youtube', iconHtml: ytIcon('sheet-icon sheet-brand'), label: 'Paste a YouTube link', hint: 'Plays from YouTube. Nothing to upload.' },
      { value: 'file', icon: 'upload', label: 'Upload a video file', hint: 'A choreographer’s or teacher’s video on your device' }
    ]
  }) : 'youtube';
  if (!how) return false;
  // Changing the choreo video: keep its sections (same song, the times usually still fit) or start over. Asked in
  // the same step as the new link or file; nothing to ask when there are no sections.
  let sectionCount = 0;
  if (current) {
    let q = sb.from('count_sheet_rows').select('id', { count: 'exact', head: true }).eq('project_id', projectId).not('t_start', 'is', null);
    q = current.kind === 'file' ? q.eq('video_id', current.video.id) : q.is('video_id', null);
    sectionCount = (await q).count || 0;
  }
  const keepField = sectionCount ? [{
    name: 'keep', type: 'check', value: true,
    label: `Keep the ${sectionCount} ${sectionCount === 1 ? 'section' : 'sections'}`,
    hint: 'Same song? Their times usually still fit. Untick to clear them and mark the new video from scratch.'
  }] : [];
  let keep = true;
  let next = null;
  if (how === 'file') {
    const got = await dialog({
      title: 'Upload the choreo video',
      body: 'The original your team learns from. It stays apart from your takes, so nobody leaves feedback on it.',
      fields: [
        { name: 'file', label: 'Video', type: 'file', accept: 'video/mp4,video/quicktime,video/webm', required: true, hint: 'MP4, MOV, or WebM · up to 15 minutes' },
        { name: 'title', label: 'Name', placeholder: 'e.g. Chorus by the choreographer', required: true, max: 120 },
        ...keepField
      ],
      confirm: 'Upload'
    });
    if (!got) return false;
    if (keepField.length) keep = got.keep;
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
        title: current ? 'Change the choreo video' : 'Add a YouTube choreo video',
        body: 'Paste the link to the video your team learns from. It plays here from YouTube, so nothing is uploaded.',
        fields: [
          { name: 'url', label: 'YouTube link', placeholder: 'https://youtu.be/…', value, required: true, max: 300 },
          { name: 'title', label: 'Name (optional)', placeholder: 'e.g. Official dance practice', max: 120 },
          ...keepField
        ],
        confirm: current ? 'Change' : 'Add'
      });
      if (!got) return false;
      if (keepField.length) keep = got.keep;
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
  if (current) await retireChoreo(projectId, current, next, keep);
  if (current && sectionCount) toast(keep ? `${sectionCount} ${sectionCount === 1 ? 'section' : 'sections'} moved to the new video.` : 'Sections cleared. Mark the parts of the new video.');
  return 'practice';
}

// The old choreo video goes: its sections move to the new one when kept (same song, so the times usually still
// fit) or are cleared, and an uploaded file is deleted for good (it isn't a take, so there's nothing to keep).
async function retireChoreo(projectId, old, next = null, keep = true) {
  const mine = (q) => (old.kind === 'file' ? q.eq('video_id', old.video.id) : q.is('video_id', null)).eq('project_id', projectId).not('t_start', 'is', null);
  if (next && !keep) {
    await mine(sb.from('count_sheet_rows').delete());
  } else {
    const to = { video_id: next?.videoId || null, ...(schema.sheetTake ? { take_id: next?.takeId || null } : {}) };
    if (next && (old.kind === 'file' || next.videoId)) await mine(sb.from('count_sheet_rows').update(to));
  }
  if (old.kind === 'file') {
    const { error } = await choreoRpc('delete_choreo_video', { p_video: old.video.id }, () => sb.from('videos').delete().eq('id', old.video.id));
    if (!error) {
      const paths = [old.take.storage_path, old.take.thumb_path].filter((x) => x && !String(x).startsWith('public:'));
      if (paths.length) sb.storage.from(TAKE_BUCKET).remove(paths).then(() => {}, () => {});
    }
  }
}

// ⋯ on the choreo video, the same from the project's Videos tab and from Practice (anyone in the project once migration 071 has run): what a choreo
// video needs and nothing a take has (no takes, merge, or notes). Returns 'renamed', 'changed', 'removed' or null.
export async function choreoMenu({ projectId, choreo, anchor }) {
  const choice = await actionSheet({ title: choreoTitle(choreo), anchor, actions: [
    ...(choreo.kind === 'youtube' ? [{ value: 'youtube', icon: 'share', label: 'Open on YouTube' }] : []),
    { value: 'rename', icon: 'pen', label: 'Rename' },
    { value: 'change', icon: 'upload', label: 'Change choreo video', hint: 'A new link or file · you can keep the sections' },
    { value: 'remove', icon: 'x', label: 'Remove choreo video', danger: true }
  ] });
  if (choice === 'youtube') { window.open(`https://www.youtube.com/watch?v=${choreo.id}`, '_blank', 'noopener'); return null; }
  if (choice === 'rename') return (await renameChoreo(projectId, choreo)) ? 'renamed' : null;
  if (choice === 'change') return (await chooseChoreo({ projectId, current: choreo, anchor })) ? 'changed' : null;
  if (choice === 'remove') return (await removeChoreo(projectId, choreo)) ? 'removed' : null;
  return null;
}

// Rename the choreo video without uploading it again: a file's name lives on its video, a YouTube link's on the
// project (choreo_title). Anyone in the project, like the rest of the choreo menu. Returns true when it changed.
export async function renameChoreo(projectId, choreo) {
  const now = choreoTitle(choreo);
  const got = await dialog({ title: 'Rename choreo video', fields: [{ name: 'title', label: 'Name', value: now, required: true, max: 120, placeholder: 'e.g. Chorus by the choreographer' }], confirm: 'Save' });
  if (!got || !got.title || got.title === now) return false;
  const { error } = await choreoRpc('rename_project_choreo', { p_project: projectId, p_title: got.title }, () => (choreo.kind === 'file'
    ? sb.from('videos').update({ title: got.title }).eq('id', choreo.video.id)
    : sb.from('projects').update({ choreo_title: got.title }).eq('id', projectId)));
  if (error) { toast(friendlyError(error), 'error'); return false; }
  toast('Choreo video renamed.');
  return true;
}

export async function removeChoreo(projectId, choreo) {
  const ok = await dialog({
    title: 'Remove the choreo video?',
    body: choreo.kind === 'file' ? 'The uploaded file is deleted. Your sections stay.' : 'Practice turns off until you add another. Your sections stay.',
    confirm: 'Remove',
    danger: true
  });
  if (!ok || !(await setChoreo(projectId, {}))) return false;
  await retireChoreo(projectId, choreo, null);
  return true;
}

// Who can add, change, rename or remove the choreo video: anyone in the project once migration 071 has run.
export const canChoreo = (p) => Boolean(p?.isOwner || schema.choreoMembers);

// The choreo is the team's (migration 071): it changes through functions that let anyone in the project do it.
// Before 071 runs they don't exist, and the owner-only way still works.
async function choreoRpc(name, args, before071) {
  const res = await sb.rpc(name, args);
  if (res.error && /PGRST202|Could not find the function/i.test(`${res.error.code} ${res.error.message}`)) return before071();
  return res;
}

export async function setChoreo(projectId, { videoId = null, youtube = null, title = null } = {}) {
  const { error } = await choreoRpc('set_project_choreo', { p_project: projectId, p_video: videoId, p_youtube: youtube, p_title: youtube ? title : null },
    () => sb.from('projects').update({ choreo_video_id: videoId, choreo_youtube: youtube, choreo_title: youtube ? title : null }).eq('id', projectId));
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
    sound({ muted, volume }) { v.muted = muted; v.volume = volume; },
    on(f) { listeners.add(f); },
    // Listeners go first: pausing on the way out fires 'pause', and the page it would repaint is already gone.
    destroy() { listeners.clear(); v.pause(); v.removeAttribute('src'); v.load(); }
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
    sound({ muted, volume }) { ready.then(() => { if (muted) p?.mute?.(); else p?.unMute?.(); p?.setVolume?.(Math.round(volume * 100)); }); },
    on(f) { listeners.add(f); },
    destroy() { listeners.clear(); try { p?.destroy?.(); } catch {} }
  };
}

// ---------- The page ----------
// Same surfaces as the video screen (dark player, timeline, controls row, side panel), so practicing and giving
// feedback feel like one product. The side panel is the song's sections: tap one to loop it, add one where the
// video is now. Sections are the count sheet's rows, so they're the team's, shared with Overview.
const SECTION_NAMES = ['Intro', 'Verse', 'Pre-chorus', 'Chorus', 'Dance break', 'Bridge', 'Outro'];
const BANDS = 6;
// A section's status, as on the count sheet.
const STATUS_LABEL = { learning: 'Learning', practicing: 'Cleaning', clean: 'Clean' };
// What each stage means, shown in the menu (the value stays 'practicing' in the database).
const STATUS_HINT = {
  learning: 'Still learning the moves and their order',
  practicing: 'Moves are down; matching angles, timing, and sync',
  clean: 'Ready for the stage'
};
const STATUS_COLOR = { learning: '#8e96a3', practicing: '#64d2ff', clean: '#4fd59c' };

// guest: what a Practice share link (/app/s/:token) shows, from the shared-video function: the same screen,
// read-only (no adding or changing sections), with a way to ask to join the project.
export async function renderPractice(projectId, guest = null) {
  const { view, setCrumbs } = ctx;
  const p = guest ? { project: { id: null, title: guest.project, is_sample: false }, isOwner: false } : await loadProject(projectId);
  const choreo = guest
    ? (guest.choreo.kind === 'youtube' ? { kind: 'youtube', id: guest.choreo.id, title: guest.choreo.title || guest.title || '' }
      : { kind: 'file', url: guest.choreo.url, video: { id: null, title: guest.title, bpm: guest.choreo.bpm }, take: { id: null, count_start: guest.choreo.count_start } })
    : await loadChoreo(p.project);
  const base = guest ? null : `/app/p/${projectId}`;
  // Everyone in the project sees Share (to copy the link); turning it on or changing it follows canShareLinks.
  const canShare = !guest && schema.shareLinks && !p.project.is_sample;
  const canManageLink = schema.teamLinks ? canShareLinks(p.project, p.isOwner) : (p.isOwner || p.project.members_share_practice);
  if (!guest) setCrumbs([['Projects', '/app/projects'], [p.project.title, base], ['Practice']]);
  if (!choreo) {
    view.innerHTML = `<section class="page practice-page"><div class="empty"><div class="empty-icon">${ic('play', 'solo')}</div>
      <h2>No choreo video yet</h2>
      <p>${canChoreo(p) ? 'Add the video your team learns from, and everyone can practice it here, section by section.' : 'When the project owner adds the choreo video, you can practice it here, section by section.'}</p>
      <div class="empty-actions">${canChoreo(p) && schema.choreo ? '<button class="btn primary" data-add-choreo>Add a choreo video</button>' : ''}<a class="btn" href="${base}" data-link>Back to videos</a></div></div></section>`;
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
    if (guest) { sections = (guest.sections || []).filter((r) => r.t_start !== null).sort((a, b) => Number(a.t_start) - Number(b.t_start)); return; }
    const { data } = await sb.from('count_sheet_rows').select(`id, position, section, counts, focus, status, video_id, t_start${schema.sectionEnd ? ', t_end' : ''}${schema.sectionPeople ? ', assignees, assigned_groups' : ''}`).eq('project_id', projectId).order('position');
    sections = (data || []).filter(belongs).sort((a, b) => Number(a.t_start) - Number(b.t_start));
  };
  // Who dances each section (migration 069): members and groups; nobody picked means everyone.
  // A guest gets the names from the shared link; people who left and deleted groups just don't show.
  const groups = !guest && schema.sectionPeople ? ((await sb.from('project_groups').select('id, name, project_group_members(user_id)').eq('project_id', projectId).order('name')).data || []) : [];
  const memberName = Object.fromEntries((p.members || []).map((m) => [m.user_id, m.name]));
  const peopleOf = (s) => {
    if (guest) return (s.people || []).map((x) => ({ id: x.id, name: x.name }));
    const ids = new Set(s.assignees || []);
    for (const g of groups) if ((s.assigned_groups || []).includes(g.id)) g.project_group_members.forEach((m) => ids.add(m.user_id));
    return [...ids].filter((id) => memberName[id]).map((id) => ({ id, name: memberName[id] }));
  };
  const me = ctx.state.session?.user?.id;
  const isMine = (s) => peopleOf(s).some((x) => x.id === me);
  // My sections: mine plus the ones everyone dances. Offered once something is assigned to me; remembered per project.
  const ONLY_KEY = `looproom:my-sections:${projectId}`;
  let onlyMine = !guest && read(ONLY_KEY, '0') === '1';
  const shown = (i) => i < 0 || !onlyMine || !sections.some(isMine) || isMine(sections[i]) || !peopleOf(sections[i]).length;
  await loadSections();

  const params = new URLSearchParams(location.search);
  let speed = Number(read(SPEED_KEY, '1'));
  if (!SPEEDS.includes(speed)) speed = 1;
  let mirror = read(MIRROR_KEY, '1') === '1';
  let current = -1; // -1: the whole song; FOCUS: a note's moment (opened from a note)
  const FOCUS = -2;
  let focus = null; // { a, b } in the choreo video, while practicing a note's moment
  let onLoopChange = null; // repaints the note's bar when its loop stops or starts
  let countsUi = null; // the counts panel (set up below, once the player exists)
  let looping = false; // a section loops only once someone picks it
  const wanted = params.get('section');
  const title = choreoTitle(choreo);
  // Counts: the tempo and where count 1 falls. A choreo video file keeps them on its video and take; a YouTube one on
  // the project (migration 068). Anyone in the project sets them here, like sections.
  const has = (v) => v !== null && v !== undefined;
  const ytBpm = guest ? guest.choreo.bpm : p.project.choreo_bpm;
  const ytStart = guest ? guest.choreo.count_start : p.project.choreo_count_start;
  let counts = choreo.kind === 'file'
    ? (choreo.video.bpm && has(choreo.take.count_start) ? { bpm: Number(choreo.video.bpm), start: Number(choreo.take.count_start) } : null)
    : (ytBpm && has(ytStart) ? { bpm: Number(ytBpm), start: Number(ytStart) } : null);
  const canCount = !guest && (choreo.kind === 'file' ? Boolean(choreo.take.id) : schema.choreoCounts);

  const signedIn = Boolean(ctx.state.session);
  view.innerHTML = `${guest ? `<div class="guest-bar practice-guest-bar"><a class="guest-brand" href="/?ref=practice-share" aria-label="dancerly home"><img class="brand-logo" src="/logo-wordmark.png" alt="dancerly" width="542" height="128" /></a><span class="spacer"></span><a class="btn small ghost" href="${signedIn ? '/app' : '/?ref=practice-share'}">${signedIn ? 'Open dancerly' : 'What’s dancerly?'}</a></div>` : ''}
  <section class="review practice${guest ? ' is-guest-practice' : ''}">
    <header class="review-head">
      <div><p class="practice-eyebrow"><span class="choreo-badge">Choreo</span><span class="muted">${guest ? `Shared with you · ${esc(p.project.title)}` : esc(p.project.title)}${choreo.kind === 'youtube' ? ' · YouTube' : ''}</span></p><h1 data-practice-title>${esc(title)}</h1></div>
      ${canShare || (canChoreo(p) && !guest) ? `<div class="practice-actions">${canShare ? `<button type="button" class="btn small" data-share-practice>${ic('share')}Share</button>` : ''}${canChoreo(p) && !guest ? `<button type="button" class="icon-btn more-btn" data-choreo-more aria-label="Choreo video options" title="Choreo video options">${ic('more', 'solo')}</button>` : ''}</div>` : ''}
    </header>
    <div class="review-layout practice-layout">
      <div class="player-col" data-col>
        <div class="practice-focus" data-focus hidden></div>
        <div class="player-pair" data-pair>
          <div class="player${mirror ? ' mirrored' : ''}" data-player>
            <div class="practice-media" data-media></div>
            ${choreo.kind === 'file' ? `<button class="big-play" data-big-play aria-label="Play or pause (Space)">${ic('play', 'solo')}</button>` : ''}
            <span class="count-badge" data-count hidden></span>
            <span class="player-badge"><b class="mirror-badge">${ic('mirror')}Mirrored</b></span>
            <span class="practice-flag" data-flag hidden></span>
          </div>
        </div>
        <div class="timeline"><span data-cur>00:00</span><div class="track" data-track role="slider" tabindex="0" aria-label="Playback position" aria-valuemin="0"><span class="t-bands" data-bands></span><span class="t-loop" data-tloop hidden></span><span class="t-draft" data-tdraft hidden></span><span class="t-fill" data-tfill></span><span class="t-head" data-thead></span></div><span data-dur>--:--</span></div>
        <div class="controls practice-controls">
          <button data-play aria-label="Play (Space)">${ic('play', 'solo')}</button>
          ${volumeControl()}
          <button data-prev aria-label="Previous section (←)" title="Previous section (←)">${ic('back', 'solo')}</button>
          <button data-next aria-label="Next section (→)" title="Next section (→)">${ic('right', 'solo')}</button>
          <span class="speed-wrap"><button data-speed title="Playback speed (&lt; &gt;)" aria-haspopup="menu" aria-expanded="false">${speed}×</button><div class="speed-menu" role="menu" aria-label="Playback speed" data-speed-menu hidden>${[...SPEEDS].reverse().map((x) => `<button type="button" role="menuitemradio" aria-checked="${x === speed}" data-set-speed="${x}">${x === 1 ? 'Normal' : `${x}×`}</button>`).join('')}</div></span>
          ${canCount ? `<button class="toggle-btn" data-counts-toggle aria-pressed="false" title="Show dance counts from the tempo (T to tap)" aria-label="Counts">${ic('music')}<span class="ctl-label">Counts</span></button>` : ''}
          <span class="loop-chip" data-loopchip></span>
          <span class="spacer"></span>
          <button class="toggle-btn" data-mirror aria-pressed="${mirror}" title="Mirror (M)">${ic('mirror')}<span class="wide-only">Mirror</span></button>
          <button class="toggle-btn full-btn" data-full aria-pressed="false" title="Full screen (F)" aria-label="Full screen">${ic('expand', 'solo')}</button>
        </div>
        ${canCount ? `<div class="counts-panel" data-counts-panel hidden>
          <div class="counts-row">
            <button type="button" class="tap-btn" data-tap>Tap the beat <small>(T)</small></button>
            <label class="bpm-field"><input type="number" min="40" max="240" step="0.1" inputmode="decimal" data-bpm placeholder="120" aria-label="Tempo in BPM" /><span>BPM</span></label>
            <button type="button" class="btn small" data-count-one>Count 1 is here · <b data-count-one-at>00:00.0</b></button>
          </div>
          <p class="counts-hint" data-counts-hint></p>
          <div class="counts-actions"><span class="spacer"></span><button type="button" class="mini ghost" data-counts-clear>Clear</button><button type="button" class="btn small primary" data-counts-save>Save counts</button></div>
        </div>` : ''}
      </div>
      <aside class="notes-col practice-side">
        ${guest ? '<div class="guest-join" data-guest-join></div>' : ''}
        <div class="side-head"><h2>Sections</h2><span class="muted" data-sec-count></span>${guest ? '' : '<div class="seg small dark sec-filter" role="group" aria-label="Which sections" data-sec-filter hidden></div>'}</div>
        <div class="practice-next" data-next-step hidden></div>
        <div class="sec-list" data-secs></div>
        ${guest ? '' : `<div class="sec-mark" data-mark-box hidden></div>
        <button type="button" class="sec-add" data-add-sec>${ic('plus', 'solo')}<span>Add a section</span></button>`}
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
    player = choreo.kind === 'file' ? filePlayer(media, guest ? choreo.url : await takeUrl(choreo.take.storage_path)) : youtubePlayer(media, choreo.id, showError);
  } catch (error) {
    media.innerHTML = `<div class="practice-error"><p>${esc(friendlyError(error))}</p></div>`;
    return null;
  }
  wireVolume($('[data-vol]').parentElement, (s) => player.sound(s));

  // ---------- Sections: where each starts and ends ----------
  const bounds = (i = current) => {
    const end = player.duration || Infinity;
    if (i === FOCUS && focus) return [focus.a, Math.min(focus.b, end)];
    if (i < 0) return [0, end];
    const s = Number(sections[i].t_start);
    if (sections[i].t_end !== null && sections[i].t_end !== undefined) return [s, Math.min(Number(sections[i].t_end), end)];
    const next = sections.slice(i + 1).find((x) => Number(x.t_start) > s);
    return [s, next ? Number(next.t_start) : end];
  };
  const pct = (t) => `${player.duration ? Math.min(100, Math.max(0, (t / player.duration) * 100)) : 0}%`;
  const sectionAt = (t) => { let k = -1; sections.forEach((s, i) => { if (Number(s.t_start) <= t + 0.05) k = i; }); return k; };

  const paintSections = () => {
    // How many are clean, for the whole team (the same number Overview shows).
    const cleanCount = sections.filter((s) => s.status === 'clean').length;
    $('[data-sec-count]').textContent = !sections.length ? '' : guest ? `${sections.length}` : `${cleanCount}/${sections.length} clean`;
    const filter = $('[data-sec-filter]');
    if (filter) {
      filter.hidden = !sections.some(isMine);
      filter.innerHTML = `<button type="button" data-only="0" aria-selected="${!onlyMine}">All</button><button type="button" data-only="1" aria-selected="${onlyMine}">Mine</button>`;
      filter.querySelectorAll('[data-only]').forEach((b) => b.addEventListener('click', () => {
        onlyMine = b.dataset.only === '1';
        save(ONLY_KEY, onlyMine ? '1' : '0');
        if (onlyMine && current >= 0 && !shown(current)) { looping = false; current = -1; }
        paintSections();
        track('practice_my_sections', { on: onlyMine });
      }));
    }
    const row = (i, name, meta) => {
      const on = looping && i === current;
      if (!shown(i)) return '';
      const who = i >= 0 ? peopleOf(sections[i]) : [];
      return `<div class="sec-row${on ? ' on' : ''}${i >= 0 && who.some((x) => x.id === me) ? ' mine' : ''}" data-row="${i}">
        <button type="button" class="sec-main" data-loop="${i}" aria-pressed="${on}">
          <span class="sec-dot b${i < 0 ? 'w' : i % BANDS}" aria-hidden="true"></span>
          <span class="sec-text"><b>${name}</b><small>${meta}</small>${i >= 0 && sections[i].focus ? `<small class="sec-focus">${esc(sections[i].focus)}</small>` : ''}</span>
          ${who.length ? `<span class="sec-people" title="${esc(who.map((x) => x.name).join(', '))}" aria-label="${esc(who.map((x) => x.name).join(', '))}">${who.slice(0, 3).map((x) => avatar(x.name, guest ? null : x.id, 'xs')).join('')}${who.length > 3 ? `<i>+${who.length - 3}</i>` : ''}</span>` : ''}
          <span class="sec-state">${on ? `${ic('loop')}<span>Looping</span>` : ic('loop', 'solo')}</span>
        </button>
        ${i >= 0 && !guest && sections[i].status ? `<button type="button" class="sec-status s-${sections[i].status}" data-sec-status="${i}" title="Change status" aria-haspopup="menu">${STATUS_LABEL[sections[i].status] || ''}</button>` : ''}
        ${i >= 0 && !guest ? `<button type="button" class="icon-btn sec-more" data-sec-more="${i}" aria-label="Options for ${esc(sections[i].section || '')}">${ic('more', 'solo')}</button>` : ''}
      </div>`;
    };
    const time = (i) => { const [a, b] = bounds(i); return `${fmt(a)}–${Number.isFinite(b) ? fmt(b) : '…'}`; };
    // With counts and no counts typed in: where the section starts and ends, in eights (2·1–4·8).
    const countRange = (i) => {
      if (!counts) return '';
      const [a, b] = bounds(i);
      const c1 = countAt(a + 0.03, counts.bpm, counts.start);
      const c2 = Number.isFinite(b) ? countAt(b - 0.08, counts.bpm, counts.start) : null;
      return c1 ? ` · <span class="sec-counts">${countLabel(c1)}${c2 ? `–${countLabel(c2)}` : ''}</span>` : '';
    };
    $('[data-secs]').innerHTML = row(-1, 'Whole song', player.duration ? `${fmt(0)}–${fmt(player.duration)}` : '')
      + sections.map((s, i) => row(i, esc(s.section || `Section ${i + 1}`), `${time(i)}${s.counts ? ` · <span>${esc(s.counts)}</span>` : countRange(i)}`)).join('')
      + (sections.length || guest ? '' : `<div class="sec-empty"><b>Mark the parts of the song</b><p>Play to where a part starts (the intro, a verse, the chorus), then tap “Add a section”. Tap a section to loop it.</p></div>`);
    $('[data-bands]').innerHTML = sections.map((s, i) => { const [a, b] = bounds(i); return `<i class="t-band b${i % BANDS}" style="left:${pct(a)};width:calc(${pct(Number.isFinite(b) ? b : player.duration)} - ${pct(a)})" title="${esc(s.section || '')}"></i>`; }).join('');
    $$('[data-prev], [data-next]').forEach((b) => { b.disabled = !sections.length; });
    $$('[data-loop]').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.loop), { from: 'list' })));
    $$('[data-sec-more]').forEach((b) => b.addEventListener('click', () => sectionMenu(Number(b.dataset.secMore), b)));
    $$('[data-sec-status]').forEach((b) => b.addEventListener('click', () => pickStatus(Number(b.dataset.secStatus), b)));
    paintLoop();
  };
  const paintLoop = () => {
    const box = $('[data-tloop]');
    const chip = $('[data-loopchip]');
    if (looping && (current >= 0 || (current === FOCUS && focus))) {
      const [a, b] = bounds();
      box.hidden = false;
      box.style.left = pct(a);
      box.style.width = `calc(${pct(Number.isFinite(b) ? b : player.duration)} - ${pct(a)})`;
      chip.innerHTML = `${ic('loop')}<span>${current === FOCUS ? 'Note' : esc(sections[current].section || '')}</span><button type="button" data-unloop aria-label="Stop looping">${ic('x', 'solo')}</button>`;
      chip.querySelector('[data-unloop]').addEventListener('click', () => { looping = false; current = -1; paintSections(); });
    } else { box.hidden = true; chip.innerHTML = ''; }
    onLoopChange?.();
  };

  // ---------- Playback ----------
  let tick = 0;
  let played = 0;
  let last = performance.now();
  let countKey = '';
  const paintTime = () => {
    const t = player.time;
    $('[data-cur]').textContent = fmt(t);
    if (player.duration) $('[data-dur]').textContent = fmt(player.duration);
    $('[data-tfill]').style.width = pct(t);
    // While marking, the new section grows from its start to where the video is.
    if (mark && mark.end === null) { const d = $('[data-tdraft]'); d.hidden = t <= mark.start; d.style.left = pct(mark.start); d.style.width = `calc(${pct(t)} - ${pct(mark.start)})`; }
    $('[data-thead]').style.left = pct(t);
    const track = $('[data-track]');
    track.setAttribute('aria-valuemax', String(Math.round(player.duration || 0)));
    track.setAttribute('aria-valuenow', String(Math.round(t)));
    track.setAttribute('aria-valuetext', fmt(t));
    countsUi?.paint();
    if (counts) {
      const c = countAt(t, counts.bpm, counts.start);
      const key = c ? countLabel(c) : '';
      if (key !== countKey) {
        countKey = key;
        const badge = $('[data-count]');
        badge.hidden = !c;
        if (c) badge.innerHTML = `<small>${`Eight ${c.eight}`}</small><b>${c.count}</b>`;
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
    if (guest) return;
    const box = $('[data-next-step]');
    if (laps < 3 || !box.hidden || current < 0) return;
    try { if (localStorage.getItem(NEXT_KEY) === new Date().toDateString()) return; } catch {}
    const name = sections[current].section || '';
    box.innerHTML = `<b>Ready to film it?</b><p>${`Upload a take of ${esc(name)}, and your team can leave feedback on the exact moment.`}</p>
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

  let chrome = null; // full screen controls that float and fade (set up with full screen, below)
  let lock = null;
  const keepAwake = async (on) => {
    try {
      if (on && !lock && navigator.wakeLock && document.visibilityState === 'visible') { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      if (!on && lock) { await lock.release(); lock = null; }
    } catch {}
  };
  const paintPlay = () => {
    const btn = $('[data-play]');
    if (!btn) return; // the page is gone (a late player event)
    const playing = !player.paused;
    btn.innerHTML = ic(playing ? 'pause' : 'play', 'solo');
    btn.setAttribute('aria-label', playing ? 'Pause (Space)' : 'Play (Space)');
    $('[data-player]').classList.toggle('playing', playing);
    if (playing) startTick(); else stopTick();
    keepAwake(playing);
    chrome?.sync();
    if (player.ended) { player.seek(bounds(looping ? current : -1)[0]); player.play(); if (looping) lapped(); }
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
    const list = sections.map((_, i) => i).filter((i) => shown(i));
    if (!list.length) return;
    const from = looping ? current : sectionAt(player.time);
    let k = list.indexOf(from);
    if (k < 0) {
      const j = list.findIndex((i) => (d > 0 ? i > from : i >= from));
      k = (j < 0 ? list.length : j) - (d > 0 ? 1 : 0);
    }
    const next = list[((k + d) % list.length + list.length) % list.length];
    pick(next, { from: d < 0 ? 'prev' : 'next' });
  };
  const toggle = () => { if (player.paused) player.play(); else player.pause(); };
  const setSpeed = (s, { quiet = false, remember = true } = {}) => {
    speed = s;
    if (remember) save(SPEED_KEY, String(s));
    player.rate(s);
    const btn = $('[data-speed]');
    btn.textContent = `${s}×`;
    btn.classList.toggle('on', s !== 1);
    $$('[data-set-speed]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.setSpeed) === s)));
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
    { name: 'counts', label: 'Counts (optional)', value: s.counts || '', placeholder: '1–8 ×4', max: 80 },
    { name: 'focus', label: 'What to watch for (optional)', value: s.focus || '', placeholder: 'Arms stay sharp on 5–6', max: 500 },
    ...(schema.sectionPeople && !guest ? [{
      name: 'who', type: 'pick', label: 'Who dances it (optional)',
      hint: groups.length || (p.members || []).length > 1
        ? 'Leave it empty if everyone does. People who join later with the invite link can be added here.'
        : 'It’s just you so far. Once your team joins with the invite link, you can pick who dances each section.',
      action: p.project.is_sample ? null : { label: 'Copy invite link', run: () => copyInvite(projectId, 'section') },
      values: [...(s.assigned_groups || []).map((g) => `g:${g}`), ...(s.assignees || []).map((u) => `u:${u}`)],
      options: [
        ...groups.map((g) => ({ value: `g:${g.id}`, label: g.name, html: `<span class="pick-group">${ic('people', 'solo')}</span>` })),
        ...(p.members || []).map((m) => ({ value: `u:${m.user_id}`, label: m.user_id === me ? `${m.name} (you)` : m.name, html: avatar(m.name, m.user_id, 'xs') }))
      ]
    }] : [])
  ];
  // The dialog's people picks, as the row's two lists.
  const whoPatch = (got) => (schema.sectionPeople && Array.isArray(got.who)
    ? { assignees: got.who.filter((v) => v.startsWith('u:')).map((v) => v.slice(2)), assigned_groups: got.who.filter((v) => v.startsWith('g:')).map((v) => v.slice(2)) }
    : {});
  // Marking a new section: Start is where the video is now; play or drag on, then set End (or press [ and ]).
  let mark = null; // { start, end }
  const now10 = () => Math.round(player.time * 10) / 10;
  const paintMark = () => {
    const box = $('[data-mark-box]');
    const draft = $('[data-tdraft]');
    $('[data-add-sec]').hidden = Boolean(mark);
    box.hidden = !mark;
    if (!mark) { draft.hidden = true; return; }
    const ready = mark.end !== null && mark.end > mark.start;
    box.innerHTML = `<b>New section</b>
      <div class="range-row"><button type="button" data-mark="start">Start <b>${fmt(mark.start)}</b></button><span>${ic('right', 'solo')}</span>${schema.sectionEnd ? `<button type="button" data-mark="end">End <b>${mark.end === null ? '—' : fmt(mark.end)}</b></button>` : `<span>until the next section</span>`}</div>
      <p>${schema.sectionEnd ? 'Play or drag the timeline, then tap Start or End to set it there. Or press [ and ].' : 'Play or drag the timeline, then tap Start to set it there.'}</p>
      <div class="sec-mark-actions"><button type="button" class="btn small ghost" data-mark-cancel>Cancel</button><button type="button" class="btn small primary" data-mark-next ${ready || !schema.sectionEnd ? '' : 'disabled'}>Name it</button></div>`;
    box.querySelectorAll('[data-mark]').forEach((b) => b.addEventListener('click', () => markAt(b.dataset.mark)));
    box.querySelector('[data-mark-cancel]').addEventListener('click', cancelMark);
    box.querySelector('[data-mark-next]').addEventListener('click', saveMark);
    const end = mark.end ?? mark.start;
    draft.hidden = end <= mark.start;
    draft.style.left = pct(mark.start);
    draft.style.width = `calc(${pct(end)} - ${pct(mark.start)})`;
  };
  const startMark = () => {
    if (guest) return;
    if (looping) { looping = false; current = -1; paintSections(); }
    mark = { start: now10(), end: null };
    paintMark();
    $('[data-mark-box]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  function markAt(which) {
    if (guest) return;
    if (!mark) { startMark(); if (which === 'start') return; }
    const t = now10();
    if (which === 'start') {
      mark.start = t;
      if (mark.end !== null && mark.end <= t) mark.end = null;
    } else if (schema.sectionEnd) {
      if (t <= mark.start) return toast('The end has to come after the start. Play a little further.', 'error');
      mark.end = t;
    }
    paintMark();
  }
  function cancelMark() { mark = null; paintMark(); }
  async function saveMark() {
    if (!mark) return;
    player.pause();
    const got = await dialog({ title: `Add a section · ${fmt(mark.start)}${mark.end !== null ? `–${fmt(mark.end)}` : ''}`, fields: nameFields(), confirm: 'Add section' });
    if (!got?.section) return;
    const position = sections.length ? Math.max(...sections.map((s) => Number(s.position) || 0)) + 1 : 0;
    const t = mark.start;
    const row = { project_id: projectId, section: got.section, counts: got.counts || null, focus: got.focus || null, ...whoPatch(got), t_start: t, ...(schema.sectionEnd && mark.end !== null ? { t_end: mark.end } : {}), video_id: videoId, position, ...(schema.sheetTake && videoId ? { take_id: choreo.take.id } : {}) };
    mark = null;
    paintMark();
    const { error } = await sb.from('count_sheet_rows').insert(row);
    if (error) return toast(friendlyError(error), 'error');
    track('practice_section_added', { kind: choreo.kind, count: sections.length + 1, end: 't_end' in row });
    await loadSections();
    paintSections();
    toast(`“${got.section}” added. Tap it to loop.`);
  }
  // How far along a section is, for the whole team (Overview counts the clean ones): Learning → Practicing → Clean.
  // A section's stage, for the whole team: pick it from a menu that says what each one means (like a note's focus area).
  const pickStatus = async (i, anchor) => {
    const s = sections[i];
    const to = await actionSheet({ title: s.section || 'Section', anchor, actions: Object.keys(STATUS_LABEL).map((k) => ({ value: k, label: STATUS_LABEL[k], hint: STATUS_HINT[k], color: STATUS_COLOR[k], checked: k === s.status })) });
    if (!to || to === s.status) return;
    const before = s.status;
    s.status = to;
    paintSections();
    const { error } = await sb.from('count_sheet_rows').update({ status: to }).eq('id', s.id);
    if (error) { s.status = before; paintSections(); return toast(friendlyError(error), 'error'); }
    track('section_status', { status: to, from: 'practice' });
  };
  const sectionMenu = async (i, anchor) => {
    const s = sections[i];
    const t = Math.round(player.time * 10) / 10;
    const choice = await actionSheet({ title: s.section || 'Section', anchor, actions: [
      { value: 'rename', icon: 'pen', label: 'Edit section', hint: schema.sectionPeople ? 'Name, counts, who dances it' : 'Name, counts, what to watch for' },
      { value: 'start', icon: 'at', label: `Set start here · ${fmt(t)}`, hint: 'Where the video is now' },
      ...(schema.sectionEnd ? [{ value: 'end', icon: 'at', label: `Set end here · ${fmt(t)}`, hint: 'Where the video is now' }] : []),
      { value: 'delete', icon: 'x', label: 'Delete section', danger: true }
    ] });
    let patch = null;
    if (choice === 'rename') {
      const got = await dialog({ title: 'Edit section', fields: nameFields(s), confirm: 'Save' });
      if (got?.section) patch = { section: got.section, counts: got.counts || null, focus: got.focus || null, ...whoPatch(got) };
    }
    if (choice === 'start') {
      if (s.t_end !== null && s.t_end !== undefined && t >= Number(s.t_end)) return toast('The start has to come before the end.', 'error');
      patch = { t_start: t, ...(schema.sheetTake && videoId ? { take_id: choreo.take.id } : {}) };
    }
    if (choice === 'end') {
      if (t <= Number(s.t_start)) return toast('The end has to come after the start. Play a little further.', 'error');
      patch = { t_end: t };
    }
    if (choice === 'delete') {
      if (!(await dialog({ title: `Delete “${s.section}”?`, body: 'It’s removed for everyone on the project. The video isn’t changed.', confirm: 'Delete', danger: true }))) return;
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
      if (current !== FOCUS) {
        current = keep ? sections.findIndex((x) => x.id === keep) : -1;
        if (current < 0) looping = false;
      }
      paintSections();
    }
  };

  // ---------- Full screen: the whole player column, like the video screen (iPhone: fills the window) ----------
  const col = $('[data-col]');
  const fullBtn = $('[data-full]');
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fit = () => {
    const pl = $('[data-player]');
    if (!pl || !col.isConnected) return; // the page is gone (a late resize or animation frame)
    if (!col.classList.contains('is-full')) { pl.style.width = ''; pl.style.height = ''; return; }
    const box = $('[data-pair]').getBoundingClientRect();
    const v = media.querySelector('video');
    const ar = v?.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9;
    const w = Math.max(0, Math.min(box.width, box.height * ar));
    pl.style.width = `${Math.floor(w)}px`;
    pl.style.height = `${Math.floor(w / ar)}px`;
  };
  chrome = overlayChrome(col, { playing: () => !player.paused });
  const setFull = (on) => {
    col.classList.toggle('is-full', on);
    document.body.classList.toggle('player-full', on);
    fullBtn.setAttribute('aria-pressed', String(on));
    fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    fullBtn.title = on ? 'Exit full screen (F)' : 'Full screen (F)';
    fullBtn.innerHTML = ic(on ? 'shrink' : 'expand', 'solo');
    requestAnimationFrame(fit);
    chrome.sync();
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
  // Speed: a small menu, as on a take (a bottom sheet on a phone).
  const speedBtn = $('[data-speed]');
  const speedMenu = $('[data-speed-menu]');
  const closeSpeed = (refocus) => { if (speedMenu.hidden) return; speedMenu.hidden = true; speedBtn.setAttribute('aria-expanded', 'false'); if (refocus) speedBtn.focus(); };
  speedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!speedMenu.hidden) return closeSpeed(false);
    speedMenu.hidden = false;
    speedBtn.setAttribute('aria-expanded', 'true');
    speedMenu.querySelector('[aria-checked="true"]')?.focus();
  });
  speedMenu.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('[data-set-speed]'); if (b) { setSpeed(Number(b.dataset.setSpeed)); closeSpeed(true); } });
  speedMenu.addEventListener('keydown', (e) => {
    const items = $$('[data-set-speed]', speedMenu);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    else if (e.key === 'Escape' || e.key === 'Tab') closeSpeed(e.key === 'Escape');
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  const outsideSpeed = (e) => { if (!e.target.closest('.speed-wrap')) closeSpeed(false); };
  document.addEventListener('click', outsideSpeed);
  $('[data-mirror]').addEventListener('click', () => setMirror(!mirror));
  fullBtn.addEventListener('click', toggleFull);
  $('[data-add-sec]')?.addEventListener('click', startMark);
  $('[data-share-practice]')?.addEventListener('click', () => sharePractice(projectId, title, { isOwner: p.isOwner, canManage: canManageLink }));
  // ⋯: rename and change redraw Practice with the new video; removing it goes back to the project.
  $('[data-choreo-more]')?.addEventListener('click', async (e) => {
    const done = await choreoMenu({ projectId, choreo, anchor: e.currentTarget });
    if (done === 'removed') ctx.navigate(`/app/p/${projectId}`, { replace: true });
    else if (done) ctx.route();
  });
  if (guest) wireGuestJoin(guest);

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable], dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); toggle(); }
    else if (k === 'arrowleft') { e.preventDefault(); step(-1); }
    else if (k === 'arrowright') { e.preventDefault(); step(1); }
    else if (k === '<' || k === '>' || k === ',' || k === '.') { const i = SPEEDS.indexOf(speed) + (k === '>' || k === '.' ? 1 : -1); if (SPEEDS[i]) setSpeed(SPEEDS[i]); }
    else if (k === '[') { e.preventDefault(); markAt('start'); }
    else if (k === ']') { e.preventDefault(); markAt('end'); }
    else if (k === 'm') setMirror(!mirror);
    else if (k === 't' && canCount) countsUi.tap();
    else if (k === 'f') toggleFull();
    else if (k === 's') startMark();
    else if (k === 'escape' && col.classList.contains('is-full') && !fsElement()) toggleFull();
    else if (k === 'escape' && mark) cancelMark();
    else if (k === 'escape' && looping) { looping = false; current = -1; paintSections(); }
  };
  document.addEventListener('keydown', onKey);
  const onVisible = () => { if (document.visibilityState === 'visible' && !player.paused) keepAwake(true); };
  document.addEventListener('visibilitychange', onVisible);

  // ---------- Counts: tap the beat or type the BPM, pause on count 1, save for the team ----------
  countsUi = (() => {
    const panel = $('[data-counts-panel]');
    if (!panel) return { tap: () => {}, paint: () => {} };
    const tapper = tapTempo();
    let draft = null;
    const hint = () => {
      $('[data-counts-hint]').textContent = !draft.bpm ? 'Play the music and tap along, or type the BPM. Then pause on count 1 of the first eight.'
        : draft.start === null ? `${draft.bpm} BPM. Now pause on count 1 of the first eight and tap “Count 1 is here”.`
        : `${draft.bpm} BPM · count 1 at ${fmtFine(draft.start)}. Save to show counts for everyone.`;
    };
    const open = (on = panel.hidden) => {
      panel.hidden = !on;
      $('[data-counts-toggle]').setAttribute('aria-pressed', String(on));
      if (on) { draft = { bpm: counts?.bpm ?? null, start: counts?.start ?? null }; $('[data-bpm]').value = draft.bpm ?? ''; hint(); paint(); panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    };
    const paint = () => { if (!panel.hidden) $('[data-count-one-at]').textContent = fmtFine(draft?.start ?? player.time); };
    const tap = () => {
      if (panel.hidden) open(true);
      const bpm = tapper.tap();
      const btn = $('[data-tap]');
      btn.classList.remove('pulse'); void btn.offsetWidth; btn.classList.add('pulse');
      if (bpm && bpm >= 40 && bpm <= 240) { draft.bpm = bpm; $('[data-bpm]').value = bpm; hint(); }
    };
    const store = async (bpm, start) => {
      const { error } = choreo.kind === 'file'
        ? await sb.rpc('set_counts', { p_take: choreo.take.id, p_bpm: bpm, p_count_start: start })
        : await sb.rpc('set_choreo_counts', { p_project: projectId, p_bpm: bpm, p_count_start: start });
      if (error) { toast(friendlyError(error), 'error'); return false; }
      if (choreo.kind === 'file') { choreo.video.bpm = bpm; choreo.take.count_start = start; } else { p.project.choreo_bpm = bpm; p.project.choreo_count_start = start; }
      counts = bpm && start !== null ? { bpm, start } : null;
      countKey = '-';
      if (!counts) $('[data-count]').hidden = true;
      paintSections();
      paintTime();
      track('practice_counts', { kind: choreo.kind, set: Boolean(counts) });
      return true;
    };
    $('[data-counts-toggle]').addEventListener('click', () => open());
    $('[data-tap]').addEventListener('click', tap);
    $('[data-bpm]').addEventListener('input', (e) => { const v = Number(e.target.value); draft.bpm = v >= 40 && v <= 240 ? Math.round(v * 10) / 10 : null; hint(); });
    $('[data-count-one]').addEventListener('click', () => { player.pause(); draft.start = Math.round(player.time * 1000) / 1000; hint(); paint(); });
    $('[data-counts-save]').addEventListener('click', async () => {
      if (!draft.bpm) return toast('Set the tempo first — tap along or type the BPM.');
      if (draft.start === null) return toast('Pause on count 1 and tap “Count 1 is here”.');
      if (await store(draft.bpm, draft.start)) { open(false); toast('Counts saved. Everyone practicing sees them.'); }
    });
    $('[data-counts-clear]').addEventListener('click', async () => { if (await store(null, null)) { open(false); toast('Counts cleared.'); } });
    return { tap, paint };
  })();

  // ---------- From a note: its moment in the original, looped at 0.75× ----------
  // The note's time is on a take; the take lines up with the choreo video once (by the music for a video file,
  // by someone tapping Here on YouTube), and then every note on that video finds its spot (choreo-align.js).
  const box = $('[data-focus]');
  const key = choreoKey(p.project);
  let from = null; // { take, t0, t1, note, author }
  const backToNote = () => {
    if (history.state?.from) history.back();
    else if (from.note) ctx.navigate(`/app/p/${projectId}/v/${from.note.video_id}?take=${from.take.number}&note=${from.note.id}`);
    else ctx.navigate(base);
  };
  const noteLine = () => {
    if (!from.note) return '';
    const text = from.note.body.length > 70 ? `${from.note.body.slice(0, 70).trim()}…` : from.note.body;
    return `<span class="pf-note"><b>${esc(from.author ? `${from.author}’s note` : 'Note')}</b> “${esc(text)}”</span>`;
  };
  let wasLooping = null;
  const paintFocus = (state = 'on') => {
    box.hidden = false;
    box.className = `practice-focus is-${state}`;
    if (state === 'matching') {
      box.innerHTML = `<div class="pf-main">${noteLine()}<span class="pf-status"><span class="spinner"></span><span data-pf-stage>Matching the music…</span></span></div>`;
      return;
    }
    if (state === 'on') {
      wasLooping = looping && current === FOCUS;
      const mid = (focus.a + focus.b) / 2;
      const k = sectionAt(mid);
      const where = k >= 0 ? (sections[k].section || '') : '';
      const lengths = [['short', 'Short'], ['normal', 'Normal'], ...(holder() >= 0 ? [['section', 'Whole section']] : [])];
      if (length === 'section' && holder() < 0) length = 'normal';
      box.innerHTML = `<div class="pf-top"><div class="pf-main">${noteLine()}<span class="pf-where">${ic('loop')}${`Original ${fmt(focus.a)}–${fmt(focus.b)}`}${where ? ` · ${esc(where)}` : ''}</span></div><button type="button" class="icon-btn" data-pf-more aria-label="More" title="More">${ic('more', 'solo')}</button></div>
        <div class="pf-row"><div class="seg dark pf-len" role="group" aria-label="How much to loop">${lengths.map(([k, label]) => `<button type="button" data-pf-len="${k}" aria-pressed="${k === length}" aria-selected="${k === length}" title="${k === 'short' ? 'Just the move, a second either side' : k === 'normal' ? '4 counts before, 2 after (at least 2 seconds each)' : 'The whole section this moment is in'}">${label}</button>`).join('')}</div><span class="spacer"></span><div class="pf-actions">${looping && current === FOCUS ? '' : `<button type="button" class="btn small" data-pf-loop>${ic('loop')}Loop it again</button>`}<button type="button" class="btn small" data-pf-back>${ic('back')}Back to the note</button></div></div>`;
      box.querySelector('[data-pf-loop]')?.addEventListener('click', () => loopFocus());
      box.querySelectorAll('[data-pf-len]').forEach((b) => b.addEventListener('click', () => {
        length = b.dataset.pfLen;
        save(LENGTH_KEY, length);
        placeFocus();
        loopFocus();
        track('note_practice_length', { length });
      }));
      box.querySelector('[data-pf-back]').addEventListener('click', backToNote);
      box.querySelector('[data-pf-more]').addEventListener('click', async (e) => {
        const choice = await actionSheet({ anchor: e.currentTarget, actions: [{ value: 'again', icon: 'target', label: 'Find it again in the original', hint: 'If the loop isn’t on the right move' }] });
        if (choice === 'again') findByHand();
      });
      return;
    }
    if (state === 'outside') {
      box.innerHTML = `<div class="pf-main">${noteLine()}<span class="pf-status">This moment falls outside the choreo video. Find it by hand.</span></div>
        <div class="pf-actions"><button type="button" class="btn small primary" data-pf-find>Find it</button><button type="button" class="btn small" data-pf-back>${ic('back')}Back to the note</button></div>`;
      box.querySelector('[data-pf-find]').addEventListener('click', findByHand);
      box.querySelector('[data-pf-back]').addEventListener('click', backToNote);
    }
  };
  onLoopChange = () => {
    const now = looping && current === FOCUS;
    if (focus && from && box.classList.contains('is-on') && now !== wasLooping) { wasLooping = now; paintFocus('on'); }
  };
  const loopFocus = () => {
    current = FOCUS;
    looping = true;
    player.seek(focus.a);
    player.play();
    paintSections();
    paintTime();
    paintFocus('on');
  };
  // How much around the note's moment loops: Short, Normal (the default), or the whole section it's in.
  // The last choice is remembered for the next note.
  const LENGTH_KEY = 'looproom:note-loop';
  let length = read(LENGTH_KEY, 'normal');
  if (!LOOP_LENGTHS.includes(length)) length = 'normal';
  const holder = () => sectionAt(from.a0 + 0.05);
  const placeFocus = () => {
    const k = length === 'section' ? holder() : -1;
    const [a, b] = k >= 0 ? bounds(k) : focusRange(from.a0, from.a1, counts ? 60 / counts.bpm : null, player.duration || 0, length === 'section' ? 'normal' : length);
    focus = { a, b: Number.isFinite(b) ? b : player.duration || b };
  };
  const applyShift = (shift) => {
    const dur = player.duration || 0;
    const a0 = from.t0 + shift;
    const a1 = from.t1 === null ? null : from.t1 + shift;
    if (dur && (a0 >= dur || (a1 ?? a0) <= 0)) { paintFocus('outside'); return; }
    from.a0 = Math.max(0, a0);
    from.a1 = a1;
    placeFocus();
    setSpeed(0.75, { quiet: true, remember: false });
    loopFocus();
  };
  // By hand: the take's moment plays on a small loop next to the instructions; move the original there, tap Here.
  const findByHand = async () => {
    if (looping) { looping = false; current = -1; paintSections(); }
    box.hidden = false;
    box.className = 'practice-focus is-find';
    let ref = '';
    try { ref = `${await takeUrl(from.take.storage_path)}#t=${Math.max(0, from.t0 - 1).toFixed(2)}`; } catch {}
    box.innerHTML = `${ref ? `<video class="pf-ref" src="${esc(ref)}" muted playsinline autoplay loop preload="auto" aria-label="The moment in the take"></video>` : ''}
      <div class="pf-main">${noteLine()}<b class="pf-title">Find this move in the original</b><p class="pf-help">Go to where it happens in the choreo video, then tap Here. Once is enough: the other notes on this video find their spot too.</p>
        <div class="pf-actions"><button type="button" class="btn small primary" data-pf-here>${ic('target')}Here</button><button type="button" class="btn small" data-pf-back>${ic('back')}Back to the note</button></div></div>`;
    const v = box.querySelector('.pf-ref');
    if (v) {
      const [ra, rb] = focusRange(from.t0, from.t1, null, 0);
      v.addEventListener('timeupdate', () => { if (v.currentTime >= rb || v.currentTime < ra - 0.5) v.currentTime = ra; });
      v.play().catch(() => {});
    }
    box.querySelector('[data-pf-back]').addEventListener('click', backToNote);
    box.querySelector('[data-pf-here]').addEventListener('click', async (e) => {
      const shift = player.time - from.t0;
      e.currentTarget.disabled = true;
      const ok = await saveTakeShift(from.take.id, key, shift, 'manual');
      if (!ok) toast('Couldn’t save it for the team. It works for you now.', 'error');
      track('note_practice_align', { source: 'manual' });
      applyShift(shift);
    });
  };
  const fromNote = async () => {
    const noteId = params.get('note');
    const [{ take, shift }, got] = await Promise.all([
      loadTakeShift(params.get('take'), key),
      noteId ? sb.from('notes').select('id, body, author_id, video_id').eq('id', noteId).maybeSingle() : Promise.resolve({ data: null })
    ]);
    if (!take) return toast('That take isn’t available anymore.');
    const note = got.data || null;
    from = { take, t0: Number(params.get('t')), t1: params.has('end') ? Number(params.get('end')) : null, note, author: note ? (p.members.find((m) => m.user_id === note.author_id)?.name || '') : '' };
    track('note_practice_open', { aligned: shift !== null, kind: choreo.kind });
    if (shift !== null) return applyShift(shift);
    if (choreo.kind === 'file') {
      paintFocus('matching');
      const stage = (text) => { const el = box.querySelector('[data-pf-stage]'); if (el) el.textContent = text; };
      const found = await shiftByMusic(await takeUrl(take.storage_path), await takeUrl(choreo.take.storage_path), stage);
      if (found !== null) {
        saveTakeShift(take.id, key, found, 'music');
        track('note_practice_align', { source: 'music' });
        return applyShift(found);
      }
    }
    findByHand();
  };

  paintSections();
  track(guest ? 'practice_share_open' : 'practice_open', { kind: choreo.kind, from: params.get('from') || (guest ? 'share' : 'direct'), sections: sections.length });
  player.ready.then(() => {
    setSpeed(speed, { quiet: true });
    const v = media.querySelector('video');
    // The player takes the video's shape (an upright phone video gets an upright player).
    $('[data-player]').style.aspectRatio = v?.videoWidth ? `${v.videoWidth} / ${v.videoHeight}` : '16 / 9';
    if (choreo.kind === 'youtube' && !choreo.title && player.title) {
      $('[data-practice-title]').textContent = player.title;
      if (!guest && canChoreo(p)) choreoRpc('rename_project_choreo', { p_project: projectId, p_title: player.title.slice(0, 120) }, () => (p.isOwner ? sb.from('projects').update({ choreo_title: player.title.slice(0, 120) }).eq('id', projectId) : { error: null })).then(() => {});
    }
    const at = wanted ? sections.findIndex((s) => s.id === wanted) : -1;
    if (at >= 0) { current = at; looping = true; player.seek(bounds()[0]); }
    paintSections();
    paintTime();
    paintPlay();
    if (!guest && schema.choreoAlign && params.get('take') && params.has('t')) fromNote().catch(() => { box.hidden = true; });
  }).catch(() => showError(-1));

  return () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', outsideSpeed);
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('fullscreenchange', onFs);
    document.removeEventListener('webkitfullscreenchange', onFs);
    document.body.classList.remove('player-full');
    chrome.stop();
    resize?.disconnect();
    clearInterval(tick);
    keepAwake(false);
    if (played >= 5) track('practice_minutes', { minutes: Math.round(played / 6) / 10, kind: choreo.kind });
    player.destroy();
  };
}

// The choreo card at the top of a project's videos: practice is one tap away.
export function choreoCard({ projectId, choreo, canEdit }) {
  // The same row as a take (thumbnail, name, one line about it, chevron, ⋯): the zone heading says what it is,
  // and the whole row opens Practice.
  const title = choreoTitle(choreo);
  const thumb = choreo.kind === 'youtube' ? `<img src="${youtubeThumb(choreo.id)}" alt="" loading="lazy" />` : '';
  const meta = choreo.kind === 'youtube' ? `<span class="yt-src">${ytIcon()}YouTube</span>` : choreo.take.created_at ? `Uploaded ${timeAgo(choreo.take.created_at)}` : '';
  return `<div class="video-list choreo-list"><div class="video-item${canEdit ? ' has-more' : ''}">
    <a class="video-row" href="/app/p/${projectId}/practice?from=videos" data-link aria-label="Practice ${esc(title)}">
      <span class="video-thumb${thumb ? ' has-img' : ''}" ${choreo.kind === 'file' ? `data-thumb="${choreo.take.id}"` : ''}>${thumb}<i aria-hidden="true">${ic('play', 'solo')}</i></span>
      <span class="video-copy"><b title="${esc(title)}">${esc(title)}</b><small>${meta}</small></span>
      <span class="chev">${ic('right', 'solo')}</span>
    </a>
    ${canEdit ? `<button class="icon-btn row-more" data-choreo-more aria-label="Choreo video options" title="Choreo video options">${ic('more', 'solo')}</button>` : ''}
  </div></div>`;
}

// ---------- A Practice share link: ask to join the project ----------
// Signed out: the button signs them in (or up) and comes back here to send it. Already in: open the project.
// The owner approves in People, as with a take link (migration 061 lets requests come from Practice links).
async function wireGuestJoin(guest) {
  const host = document.querySelector('[data-guest-join]');
  if (!host) return;
  const owner = guest.owner || ('the owner');
  const project = esc(guest.project);
  const signedIn = Boolean(ctx.state.session);
  const pitch = `<b>Want to practice with this team?</b>`;
  let access = { status: 'signed_out' };
  if (signedIn) {
    const { data } = await sb.rpc('share_access', { p_token: guest.token });
    access = data || { status: 'none' };
  }
  if (access.status === 'member') {
    host.innerHTML = `<b>You’re in this project.</b><a class="btn small primary" href="/app/p/${esc(access.project_id)}/practice" data-link>Practice in the project</a>`;
    return;
  }
  if (access.status === 'pending') {
    host.innerHTML = `<b>Request sent.</b><p>${`We’ll let you know when ${esc(owner)} lets you in.`}</p>`;
    return;
  }
  if (!guest.allow_requests || access.status === 'closed' || access.status === 'unavailable') {
    if (signedIn) { host.remove(); return; }
    host.innerHTML = `<b>Practice like this with your own team.</b><p>Loop the choreo section by section, and leave feedback on the exact moment of every take.</p><a class="btn small primary" href="/app/login?mode=signup&ref=practice-share">Start free</a>`;
    return;
  }
  host.innerHTML = `${pitch}<p>${`Ask to join and ${esc(owner)} will approve it. Once you’re in, you’ll see the team’s takes and feedback too.`}</p>
    <button type="button" class="btn small primary" data-ask-join>${`Ask to join ${project}`}</button>`;
  const send = async () => {
    const btn = host.querySelector('[data-ask-join]');
    if (btn) btn.disabled = true;
    const { data, error } = await sb.rpc('request_join', { p_token: guest.token, p_body: null, p_t: 0 });
    if (error) { if (btn) btn.disabled = false; return toast(friendlyError(error), 'error'); }
    track('practice_share_join_request');
    if (data?.status === 'member') return ctx.navigate(`/app/p/${data.project_id}/practice`);
    host.innerHTML = `<b>${`Sent to ${esc(owner)}.`}</b><p>We’ll let you know by notification and email once you’re in.</p>`;
  };
  host.querySelector('[data-ask-join]').addEventListener('click', () => {
    if (!signedIn) return ctx.navigate(`/app/login?mode=signup&next=${encodeURIComponent(`/app/s/${guest.token}?ask=1`)}`);
    send();
  });
  // Back from signing in, having pressed the button: send it now.
  if (signedIn && new URLSearchParams(location.search).get('ask') === '1') {
    history.replaceState(history.state, '', location.pathname);
    send();
  }
}
