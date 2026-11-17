// Progress cards: Take 1 and the latest take on the same beat, as a short video (or a still) for Instagram
// Stories, Reels and TikTok. Made on the device from the takes themselves; nothing is uploaded or stored.
// Anyone on the project can make one, unless the owner turned it off (migration 034). In the sample it's a
// preview: marked SAMPLE, and the share buttons point to starting your own project instead.
import { sb, $, $$, esc, toast, friendlyError, dialog, actionSheet, cols, takeUrl, isPublicMedia, publicMediaUrl, fmtFine } from './client.js';
import { ctx } from './ctx.js';
import { track } from './onboarding.js';
import { shiftBetween } from './align.js';
import { thumbUrls } from './thumbs.js';
import { daysUntil } from './views/shared.js';
import { ic } from './icons.js';
import { W, H, LEN, STYLES, loadAssets, canMakeVideo, makePlayers, playersReady, startPreview, still, makeVideo } from './card-video.js';

const PROMPTED = 'looproom:cardPrompt:';
const LEAD = 3; // seconds of the card before the chosen moment
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// ---------- Data ----------
// Everything a card needs about one video. null when there's nothing to compare yet.
export async function loadCard(projectId, videoId) {
  const [{ data: project }, { data: video }, { data: takes }, { data: notes }, { data: owner }] = await Promise.all([
    sb.from('projects').select(cols('id, title, is_sample, created_by, allow_share_cards, target_event_id')).eq('id', projectId).single(),
    sb.from('videos').select('id, title').eq('id', videoId).single(),
    sb.from('takes').select(cols('id, number, created_at, storage_path, thumb_path, count_start, align')).eq('video_id', videoId).order('number'),
    sb.from('notes').select('id, take_id, t_start, status, resolved_at, private_to, body, created_at').eq('video_id', videoId),
    sb.from('project_members').select('user_id').eq('project_id', projectId).eq('role', 'owner').eq('user_id', ctx.state.session.user.id)
  ]);
  if (!project || !video || !takes?.length) return null;
  // What a D-day can count down to: upcoming events except rehearsals (the project's goal always counts).
  // The default matches the goal chip on the project: the goal, or else the next show.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const { data: upcoming } = await sb.from('project_events').select('id, title, kind, starts_at').eq('project_id', projectId).gte('starts_at', today.toISOString()).order('starts_at').limit(30);
  const events = (upcoming || []).filter((e) => e.kind !== 'rehearsal' || e.id === project.target_event_id).slice(0, 8);
  const goal = events.find((e) => e.id === project.target_event_id) || events.find((e) => e.kind === 'show') || null;
  const team = (notes || []).filter((n) => !n.private_to); // private notes never count on a public image
  const fixedNotes = team.filter((n) => n.status === 'resolved').sort((a, b) => String(b.resolved_at).localeCompare(String(a.resolved_at)));
  const first = takes[0], latest = takes[takes.length - 1];
  // Days since Take 1: up to the latest take, or, with only one take, up to today.
  const end = takes.length > 1 ? new Date(latest.created_at) : new Date();
  const span = Math.max(1, Math.ceil((end - new Date(first.created_at)) / 864e5));
  const dates = new Set([...takes.map((t) => t.created_at), ...team.map((n) => n.created_at)].map((iso) => new Date(iso).toDateString()));
  return {
    project, video, takes, first, latest, events, goal,
    single: takes.length === 1, // one take: a rehearsal card, not a before-and-after
    isOwner: Boolean(owner?.length),
    allowed: project.allow_share_cards !== false,
    stats: { fixed: fixedNotes.length, takes: takes.length, days: span, practice: dates.size, notes: team.length },
    open: team.filter((n) => n.status !== 'resolved').length,
    fixedLine: fixedNotes[0] ? clip(fixedNotes[0].body.split('\n')[0], 46) : '',
    // Default moment: where the latest fixed note was pinned, moved onto Take 1 (lined-up takes share a beat).
    moment: (() => {
      // (With nothing fixed yet, the moment the team last talked about.)
      const n = fixedNotes.find((x) => x.t_start !== null) || [...team].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((x) => x.t_start !== null);
      if (!n) return null;
      const on = takes.find((t) => t.id === n.take_id) || first;
      return Math.max(0, Number(n.t_start) + (shiftBetween(on, first) || 0));
    })()
  };
}
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
const canMake = (c) => c.allowed || c.isOwner;

const mediaUrl = (path) => (isPublicMedia(path) ? publicMediaUrl(path) : takeUrl(path));

// ---------- What the card says ----------
const mon = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
const midnight = (iso) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); return d; };
const upper = (text, n) => clip(String(text || '').trim(), n).toUpperCase();

// Words on the card, from the project: the crew, the song, Day 1 vs now, and the show it counts down to.
// Takes filmed on the same day are told apart by take number instead of by day.
export function cardWords(c, s) {
  const gap = c.single ? 0 : Math.round((midnight(c.latest.created_at) - midnight(c.first.created_at)) / 864e5);
  const byDay = gap >= 1, n = gap + 1;
  const e = c.events.find((x) => x.id === s.eventId) || null;
  let event = null;
  if (e) {
    const d = daysUntil(e.starts_at), name = upper(e.title, 22);
    const when = d <= 0 ? 'TODAY' : d === 1 ? 'TOMORROW' : `IN ${d} DAYS`;
    event = { name, when, line: `${name} ${when}`, big: d <= 0 ? 'D-DAY' : `D-${d}`, sub: `${name} · ${mon(e.starts_at)}`, days: d };
  }
  return {
    crew: upper(s.crew || c.project.title, 28),
    song: clip(s.title.trim(), 44),
    sample: Boolean(c.project.is_sample),
    event,
    from: byDay ? 1 : c.first.number,
    to: byDay ? n : c.latest.number,
    unit: byDay ? 'DAY' : 'TAKE',
    fromTag: byDay ? `DAY 1 · ${mon(c.first.created_at)}` : `TAKE ${c.first.number}`,
    fromShort: byDay ? 'DAY 1' : `TAKE ${c.first.number}`,
    toTag: c.single ? `REHEARSAL · ${mon(c.first.created_at)}` : byDay ? `DAY ${n} · NOW` : `TAKE ${c.latest.number} · NOW`,
    payoff: byDay ? `${n} days in.` : `${c.takes.length} takes in.`
  };
}
const stylesFor = (c, s) => [...(c.single ? ['rehearsal'] : ['split', 'wipe']), ...(s.eventId ? ['countdown'] : [])];
// The style that fits best: the countdown when a show is two weeks out or closer, else the plain one.
function bestStyle(c, s) {
  const e = c.events.find((x) => x.id === s.eventId);
  if (e && daysUntil(e.starts_at) <= 14) return 'countdown';
  return c.single ? 'rehearsal' : 'split';
}
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '') || 'progress';

// ---------- Editor ----------
// Pick a style (each tile is the card itself), check the details, Create, then Share or Save. The preview plays
// the real card as it will be: the same drawing, the same takes, from the same beat.
export async function openCardEditor({ projectId, videoId, from = 'unknown' }) {
  const c = await loadCard(projectId, videoId);
  if (!c) return toast('This video has no takes yet.');
  if (!canMake(c)) return toast('The project owner turned off progress cards for this project.');
  track('card_opened', { from, sample: Boolean(c.project.is_sample) });

  const s = {
    crew: c.project.title,
    title: c.video.title, // only on the card, e.g. to add the song; the video keeps its name
    eventId: c.goal?.id || null,
    startA: 0, startB: 0,
    format: 'video',
    style: 'split'
  };
  s.style = bestStyle(c, s);
  const shift = c.single ? 0 : shiftBetween(c.first, c.latest) || 0;
  const [urlA, urlB] = c.single
    ? [null, await mediaUrl(c.first.storage_path)]
    : await Promise.all([mediaUrl(c.first.storage_path), mediaUrl(c.latest.storage_path)]);
  const kind = c.single ? 'Practice card' : 'Progress card';

  const el = document.createElement('dialog');
  el.className = 'dialog card-editor';
  el.innerHTML = `<div class="ce" data-state="loading" tabindex="-1">
    <header class="ce-head"><button type="button" class="link-btn" data-ce-close>Cancel</button><b>${kind}</b><span></span></header>
    <div class="ce-body">
      <div class="ce-preview">
        <canvas data-ce-canvas width="${W / 2}" height="${H / 2}" role="img" aria-label="Preview of your ${kind.toLowerCase()}"></canvas>
        <video class="ce-result" data-ce-result playsinline muted loop hidden aria-label="Your ${kind.toLowerCase()}"></video>
        <p class="ce-loading" data-ce-loading><span class="spinner" aria-hidden="true"></span>Loading your takes…</p>
      </div>
      <div class="ce-panel">
        <div class="ce-edit">
          <div class="seg ce-seg" role="group" aria-label="Format" data-ce-formats hidden>
            <button type="button" data-ce-format="video" aria-pressed="true">${ic('video')}Video</button>
            <button type="button" data-ce-format="image" aria-pressed="false">${ic('image')}Image</button>
          </div>
          <section class="ce-section" aria-labelledby="ce-style-h">
            <h3 class="ce-label" id="ce-style-h">Style</h3>
            <div class="ce-styles" role="radiogroup" aria-labelledby="ce-style-h" data-ce-styles></div>
          </section>
          <section class="ce-section" aria-labelledby="ce-details-h">
            <h3 class="ce-label" id="ce-details-h">Details</h3>
            <label class="field"><span>Team name</span><input data-ce-crew maxlength="40" value="${esc(s.crew)}" autocomplete="off" /></label>
            <label class="field"><span>Song or section</span><input data-ce-title maxlength="60" value="${esc(s.title)}" placeholder="e.g. Supernova · Chorus" autocomplete="off" /></label>
            ${c.events.length ? `<label class="field"><span>Counting down to</span><select data-ce-event>
              <option value="">No countdown</option>
              ${c.events.map((e) => `<option value="${e.id}" ${e.id === s.eventId ? 'selected' : ''}>${esc(e.title)} · ${esc(day(e.starts_at))}</option>`).join('')}
            </select></label>` : ''}
            <div class="ce-moment">
              <img alt="" data-ce-thumb />
              <div><b>Moment <span data-ce-at>00:00</span></b><small>${c.single ? 'The card plays the 7 seconds around it' : `The card plays the 7 seconds around it, Take ${c.latest.number} on the same beat`}</small></div>
              <button type="button" class="btn small" data-ce-pick>Change</button>
            </div>
          </section>
          <p class="ce-tip">${ic('music')}Add the song with Instagram or TikTok’s music sticker. The card itself is silent.</p>
        </div>
        <div class="ce-done" data-ce-done hidden>
          <p class="ce-done-title">${ic('check')}<span data-ce-done-what>Your video is ready</span></p>
          <p class="fine">Share it to your story, or save it and post it anywhere. Anyone you share it with can see it.</p>
          <button type="button" class="link-btn" data-ce-back>${ic('back')}Back to editing</button>
        </div>
        ${c.project.is_sample
          ? `<div class="ce-sample"><p><b>This is the sample.</b> Make one from your own team’s takes and share it to Instagram.</p><button type="button" class="btn primary wide" data-ce-own>Start my own project</button></div>`
          : `<div class="ce-actions" data-ce-actions>
              <button type="button" class="btn primary ce-create" data-ce-create disabled><span data-ce-create-label>Create video</span></button>
              <button type="button" class="btn primary" data-ce-share hidden>${ic('share')}Share</button>
              <button type="button" class="btn" data-ce-save hidden>${ic('download')}Save</button>
            </div>`}
      </div>
    </div>
  </div>`;
  document.body.append(el);
  el.showModal();
  const root = $('.ce', el);
  root.focus(); // not the Cancel button: no focus ring on open
  const canvas = $('[data-ce-canvas]', el);
  const result = $('[data-ce-result]', el);
  let preview = null;
  let job = null; // the video being made: { abort }
  let made = null; // { blob, name, format }
  el.addEventListener('close', () => { preview?.stop(); job?.abort(); if (result.src) URL.revokeObjectURL(result.src); el.remove(); });
  el.addEventListener('cancel', (e) => { if (job) { e.preventDefault(); job.abort(); return; } el.close(); });
  $('[data-ce-close]', el).addEventListener('click', () => el.close());

  const players = makePlayers($('.ce-preview', el), urlA, urlB);
  const [{ logo }, video, ok] = await Promise.all([loadAssets(), canMakeVideo(), playersReady(players)]);
  if (!el.isConnected) return;
  if (!ok) {
    $('[data-ce-loading]', el).innerHTML = 'Couldn’t load this take in this browser.';
    return toast('Couldn’t read this take in this browser. Try Safari or Chrome on your phone.', 'error');
  }
  if (!video) s.format = 'image';
  $('[data-ce-formats]', el).hidden = !video;
  // The moment the card is about: the one the team last fixed (or talked about), else a third in. The card
  // plays the 7 seconds around it, with the moment 3 seconds in (where the Wipe swaps takes); near either end
  // the window shifts so it stays inside the take, and the moment is always in it.
  const durA = (players.a || players.b).duration || LEN;
  setMoment(c.moment !== null ? c.moment : durA / 3);
  function setMoment(at) {
    s.moment = Math.max(0, Math.min(at, durA));
    s.startA = Math.max(0, Math.min(s.moment - LEAD, durA - LEN));
    s.startB = c.single ? s.startA : Math.max(0, s.startA + shift);
    $('[data-ce-at]', el).textContent = fmtFine(s.moment);
  }
  const state = () => ({ style: s.style, card: cardWords(c, s), startA: s.startA, startB: s.startB });

  // Style tiles: each one is the card itself, drawn from these takes.
  const tiles = async () => {
    preview?.stop(); preview = null;
    const keys = stylesFor(c, s);
    const box = $('[data-ce-styles]', el);
    box.innerHTML = keys.map((k) => `<button type="button" role="radio" class="ce-style" data-ce-style="${k}" aria-checked="${k === s.style}">
      <span class="ce-style-art"><img alt="" data-ce-art="${k}" /></span><b>${STYLES[k].name}</b><small>${k === 'countdown' && cardWords(c, s).event ? esc(cardWords(c, s).event.big) : STYLES[k].hint}</small></button>`).join('');
    const small = document.createElement('canvas');
    small.width = W / 4; small.height = H / 4;
    for (const k of keys) {
      await still(small, players, { ...state(), style: k }, logo);
      const img = $(`[data-ce-art="${k}"]`, el);
      if (img) img.src = small.toDataURL('image/jpeg', 0.75);
    }
    // The thumbnail is the chosen frame itself.
    const frame = players.a || players.b;
    await new Promise((res) => { frame.addEventListener('seeked', res, { once: true }); frame.currentTime = Math.min(s.moment, durA - 0.05); });
    const t = document.createElement('canvas');
    t.width = 160; t.height = 100;
    const tg = t.getContext('2d');
    const k = Math.max(t.width / frame.videoWidth, t.height / frame.videoHeight);
    tg.drawImage(frame, (t.width - frame.videoWidth * k) / 2, (t.height - frame.videoHeight * k) / 2, frame.videoWidth * k, frame.videoHeight * k);
    $('[data-ce-thumb]', el).src = t.toDataURL('image/jpeg', 0.7);
    play();
  };
  const play = () => {
    if (!el.isConnected || made) return;
    preview?.stop();
    if (s.format === 'image') {
      preview = null;
      still(canvas, players, state(), logo);
    } else preview = startPreview(canvas, players, state, logo);
  };
  const paint = () => {
    root.dataset.format = s.format;
    $$('[data-ce-format]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ceFormat === s.format)));
    $$('[data-ce-style]', el).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.ceStyle === s.style)));
    const label = $('[data-ce-create-label]', el);
    if (label && !job) label.textContent = s.format === 'video' ? 'Create video' : 'Create image';
    if (s.format === 'image' && !made) still(canvas, players, state(), logo); // a still doesn't redraw itself
  };

  await tiles();
  $('[data-ce-loading]', el)?.remove();
  root.dataset.state = 'edit';
  const create = $('[data-ce-create]', el);
  if (create) create.disabled = false;
  paint();

  // Typing changes the words on the card as you go.
  let again = 0;
  const later = () => { clearTimeout(again); again = setTimeout(() => { if (s.format === 'image') paint(); }, 120); };
  $('[data-ce-crew]', el).addEventListener('input', (e) => { s.crew = e.target.value.trim() || c.project.title; later(); });
  $('[data-ce-title]', el).addEventListener('input', (e) => { s.title = e.target.value; later(); });
  $('[data-ce-event]', el)?.addEventListener('change', async (e) => {
    s.eventId = e.target.value || null;
    if (!stylesFor(c, s).includes(s.style)) s.style = c.single ? 'rehearsal' : 'split';
    await tiles(); paint();
  });

  const finish = (blob, format) => {
    const name = `dancerly-${slug(s.title || c.video.title)}.${format === 'video' ? 'mp4' : 'png'}`;
    made = { blob, name, format };
    preview?.stop(); preview = null;
    if (format === 'video') { result.src = URL.createObjectURL(blob); result.hidden = false; canvas.hidden = true; result.play().catch(() => {}); }
    $('[data-ce-done-what]', el).textContent = format === 'video' ? 'Your video is ready' : 'Your image is ready';
    root.dataset.state = 'done';
    $('[data-ce-close]', el).textContent = 'Done';
    $('.ce-edit', el).hidden = true; $('[data-ce-done]', el).hidden = false;
    create.hidden = true;
    const share = $('[data-ce-share]', el), save = $('[data-ce-save]', el);
    share.hidden = !navigator.canShare?.({ files: [new File([blob], name, { type: blob.type })] });
    save.hidden = false;
    save.classList.toggle('primary', share.hidden);
    (share.hidden ? save : share).focus();
  };
  const back = () => {
    made = null;
    if (result.src) { URL.revokeObjectURL(result.src); result.removeAttribute('src'); }
    result.hidden = true; canvas.hidden = false;
    root.dataset.state = 'edit';
    $('[data-ce-close]', el).textContent = 'Cancel';
    $('.ce-edit', el).hidden = false; $('[data-ce-done]', el).hidden = true;
    create.hidden = false; $('[data-ce-share]', el).hidden = true; $('[data-ce-save]', el).hidden = true;
    play(); paint();
  };

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || job) return;
    if (t.dataset.ceFormat && t.dataset.ceFormat !== s.format) { s.format = t.dataset.ceFormat; paint(); return play(); }
    if (t.dataset.ceStyle) { s.style = t.dataset.ceStyle; paint(); return play(); }
    if (t.hasAttribute('data-ce-pick')) {
      preview?.stop(); preview = null;
      const at = await pickMoment(urlA || urlB, s.moment, c.first.number, durA);
      if (at !== null) setMoment(at);
      return tiles().then(paint);
    }
    if (t.hasAttribute('data-ce-back')) return back();
    if (t.hasAttribute('data-ce-own')) { el.close(); return ctx.startAction('project'); }
    if (t.hasAttribute('data-ce-create')) {
      const started = performance.now();
      if (s.format === 'image') {
        preview?.stop(); preview = null;
        const big = document.createElement('canvas');
        big.width = W; big.height = H;
        await still(big, players, state(), logo);
        const blob = await new Promise((res) => big.toBlob(res, 'image/png'));
        if (!blob) return toast('Couldn’t make the image. Try again.', 'error');
        track('card_created', { format: 'image', style: s.style });
        return finish(blob, 'image');
      }
      const ctrl = new AbortController();
      job = { abort: () => ctrl.abort() };
      root.dataset.state = 'making';
      const label = $('[data-ce-create-label]', el);
      create.setAttribute('aria-busy', 'true');
      const onProgress = (p) => { create.style.setProperty('--p', `${Math.round(p * 100)}%`); label.textContent = `Creating video… ${Math.round(p * 100)}%`; };
      onProgress(0);
      try {
        const blob = await makeVideo({ ...state(), urlA, urlB, logo, onProgress, signal: ctrl.signal });
        track('card_created', { format: 'video', style: s.style, secs: Math.round((performance.now() - started) / 1000) });
        job = null;
        create.removeAttribute('aria-busy'); create.style.removeProperty('--p');
        finish(blob, 'video');
      } catch (err) {
        job = null;
        create.removeAttribute('aria-busy'); create.style.removeProperty('--p');
        root.dataset.state = 'edit';
        paint();
        if (err?.name === 'AbortError') return;
        // The image always works: offer it instead.
        s.format = 'image'; paint(); play();
        toast('Couldn’t make the video on this device. You can share it as an image instead.', 'error');
      }
      return;
    }
    if (made && (t.hasAttribute('data-ce-share') || t.hasAttribute('data-ce-save'))) {
      const file = new File([made.blob], made.name, { type: made.blob.type });
      if (t.hasAttribute('data-ce-share')) {
        try {
          await navigator.share({ files: [file] });
          track('card_shared', { via: 'share', format: made.format, style: s.style });
        } catch (err) { if (err?.name !== 'AbortError') toast(friendlyError(err), 'error'); }
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(made.blob);
      a.download = made.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      track('card_shared', { via: 'download', format: made.format, style: s.style });
      toast(made.format === 'video' ? 'Video saved.' : 'Image saved.');
    }
  });
}

// Pick the moment in a take: drag the bar (or step a tenth of a second), or play and tap Use this moment.
// Our own bar rather than the browser's controls: on iPhone those can report a stale time right after a drag.
function pickMoment(url, at, number, dur) {
  return new Promise((resolve) => {
    const el = document.createElement('dialog');
    el.className = 'dialog ce-picker';
    el.innerHTML = `<div class="dialog-card">
      <h2>Choose the moment</h2>
      <p class="muted">Take ${number}. Drag to it, or play and tap the button when it comes up.</p>
      <div class="pk-stage"><video src="${esc(url)}" playsinline muted preload="auto" crossorigin="anonymous"></video>
        <button type="button" class="pk-play" data-pk-play aria-label="Play">${ic('play', 'solo')}</button></div>
      <div class="pk-scrub">
        <button type="button" class="btn small ghost icon" data-pk-step="-0.1" aria-label="Back a tenth of a second">${ic('back', 'solo')}</button>
        <input type="range" min="0" max="${dur.toFixed(2)}" step="0.01" value="${(at || 0).toFixed(2)}" data-pk-bar aria-label="Moment" />
        <button type="button" class="btn small ghost icon" data-pk-step="0.1" aria-label="Forward a tenth of a second">${ic('right', 'solo')}</button>
        <span class="pk-time" data-pk-time>${fmtFine(at || 0)}</span>
      </div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-no>Cancel</button><button type="button" class="btn primary" data-yes>Use this moment</button></div></div>`;
    document.body.append(el);
    const v = $('video', el), bar = $('[data-pk-bar]', el), time = $('[data-pk-time]', el), playBtn = $('[data-pk-play]', el);
    let chosen = Math.min(at || 0, dur), raf = 0;
    const show = (t) => { chosen = Math.max(0, Math.min(t, dur)); bar.value = chosen.toFixed(2); time.textContent = fmtFine(chosen); };
    const seek = (t) => { show(t); v.pause(); v.currentTime = chosen; };
    const follow = () => { if (!v.paused) { show(v.currentTime); raf = requestAnimationFrame(follow); } };
    const paintPlay = () => { const on = !v.paused; playBtn.innerHTML = ic(on ? 'pause' : 'play', 'solo'); playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play'); el.classList.toggle('playing', on); };
    v.addEventListener('loadedmetadata', () => { v.currentTime = chosen; }, { once: true });
    v.addEventListener('play', () => { paintPlay(); cancelAnimationFrame(raf); follow(); });
    v.addEventListener('pause', () => { paintPlay(); cancelAnimationFrame(raf); });
    v.addEventListener('ended', () => show(dur));
    const toggle = () => (v.paused ? v.play().catch(() => {}) : v.pause());
    playBtn.addEventListener('click', toggle);
    v.addEventListener('click', toggle);
    bar.addEventListener('input', () => seek(Number(bar.value)));
    el.querySelectorAll('[data-pk-step]').forEach((b) => b.addEventListener('click', () => seek(chosen + Number(b.dataset.pkStep))));
    let out = null;
    // While playing, the moment is where it is right now; paused, it's what the bar shows.
    $('[data-yes]', el).addEventListener('click', () => { out = v.paused ? chosen : v.currentTime; el.close(); });
    $('[data-no]', el).addEventListener('click', () => el.close());
    el.addEventListener('close', () => { cancelAnimationFrame(raf); v.pause(); v.removeAttribute('src'); v.load(); el.remove(); resolve(out); });
    el.showModal();
  });
}

// ---------- Ways in ----------
// The video's Share button: a progress card, or the read-only link for people outside the team.
export async function shareChoice({ projectId, videoId, videoTitle, sample, takes, latest, linkShare }) {
  // One take: a rehearsal card (the take itself); two or more: Take 1 next to the latest.
  const card = takes >= 2
    ? { value: 'card', label: 'Make a progress card', hint: `Take 1 and Take ${latest} on the same beat, as a short video for your story` }
    : { value: 'card', label: 'Make a practice card', hint: 'Your take as a short video for your story' };
  const choice = await actionSheet({ title: 'Share', actions: [card, { value: 'link', label: 'Send a link', hint: 'A read-only link for a coach or family, no account needed' }] });
  if (choice === 'card') return openCardEditor({ projectId, videoId, from: 'share' });
  if (choice !== 'link') return;
  return linkShare(videoId, videoTitle);
}

// Right after the last open note on a video is fixed: a one-time nudge to make a card. Once per video.
export async function celebrate({ projectId, videoId }) {
  try { if (localStorage.getItem(PROMPTED + videoId)) return; } catch { return; }
  const c = await loadCard(projectId, videoId);
  if (!c || c.single || c.open || !c.stats.fixed || !canMake(c)) return;
  try { localStorage.setItem(PROMPTED + videoId, '1'); } catch {}
  const urls = await thumbUrls([c.first.thumb_path, c.latest.thumb_path].filter(Boolean));
  const thumb = (t) => (t.thumb_path && urls[t.thumb_path] ? `<img src="${esc(urls[t.thumb_path])}" alt="" />` : '<span class="ce-blank"></span>');
  track('card_prompted', { sample: Boolean(c.project.is_sample) });
  const yes = await dialog({
    title: `All clear on ${c.video.title}!`,
    body: `<span>${`${c.stats.fixed} ${c.stats.fixed === 1 ? 'note' : 'notes'} fixed since Take 1. Want to keep ${c.stats.days} ${c.stats.days === 1 ? 'day' : 'days'} of progress?`}</span>
      <span class="ce-celebrate" aria-hidden="true">${thumb(c.first)}${thumb(c.latest)}<i>${ic('right', 'solo')}</i></span>`,
    confirm: 'Make a progress card',
    cancel: 'Not now'
  });
  if (yes) openCardEditor({ projectId, videoId, from: 'celebrate' });
}
