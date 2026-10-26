import { cols, schema } from './client.js';
import { sb, $, $$, esc, initials, fmt, fmtFine, timeAgo, toast, friendlyError, dialog, withUploadBar, loadMembers, avatar, takeUrl } from './client.js';
import { uploadTake, checkTakeFile } from './upload.js';
import { COLORS, TOOLS, placeLayer, paintSketches, sketchShowsAt, startDrawing } from './sketch.js';
import { countAt, countLabel, eightStarts, tapTempo } from './counts.js';
import { offsetByMusic, follow } from './compare.js';

import { nextInQueue } from './views/queue.js';
import { shareVideo } from './views/share.js';
import { reviewTips, explainPrivate, track, seen, markSeen } from './onboarding.js';
import { shiftBetween, alignTake } from './align.js';

const SPEEDS = [1, 0.75, 0.5, 0.25];

// The review screen: one video, its takes, and the team's notes on them.
export async function mountReview({ projectId, videoId, me, view, navigate, setCrumbs }) {
  const [{ data: project, error: pErr }, { data: video, error: vErr }, { data: takes, error: tErr }, members] = await Promise.all([
    sb.from('projects').select(cols('id, title, is_sample')).eq('id', projectId).single(),
    sb.from('videos').select('id, title, created_by, request_id, bpm, requests!videos_request_id_fkey(title)').eq('id', videoId).eq('project_id', projectId).single(),
    sb.from('takes').select(cols('id, number, storage_path, created_at, uploaded_by, count_start, align')).eq('video_id', videoId).order('number'),
    loadMembers(projectId)
  ]);
  if (pErr || vErr || tErr) throw pErr || vErr || tErr;
  setCrumbs([['Projects', '/app/projects'], [project.title, `/app/p/${projectId}`], [video.title]]);
  const base = `/app/p/${projectId}/v/${videoId}`;
  // Remembered so a later upload from the project page can offer to stack onto this video.
  try { localStorage.setItem(`looproom:lastVideo:${projectId}`, videoId); } catch {}
  const isOwner = members.some((m) => m.user_id === me.id && m.role === 'owner');
  const canManageVideo = isOwner || video.created_by === me.id;
  const nameOf = (id) => members.find((m) => m.user_id === id)?.name || 'Former member';
  const roleOf = (id) => (members.find((m) => m.user_id === id)?.role === 'owner' ? 'Owner' : 'Member');

  if (!takes.length) {
    view.innerHTML = `<section class="page"><div class="empty"><div class="empty-icon">▶</div><h2>No takes yet</h2><p>Upload the first take of “${esc(video.title)}”. If an upload stopped, pick the same file again — it continues where it left off.</p><button class="btn primary" data-upload>Upload Take 1</button></div></section><input type="file" accept="video/mp4,video/quicktime,video/webm" hidden data-file />`;
    wireUpload();
    return null;
  }

  // Opening a video counts as having seen it (Review queue).
  sb.from('video_views').upsert({ user_id: me.id, video_id: videoId, seen_at: new Date().toISOString() }).then(() => {});
  const queue = nextInQueue(projectId, videoId);

  const wanted = Number(new URLSearchParams(location.search).get('take'));
  const take = takes.find((t) => t.number === wanted) || takes[takes.length - 1];
  const takeNo = Object.fromEntries(takes.map((t) => [t.id, t.number]));
  const signed = { signedUrl: await takeUrl(take.storage_path) };

  const showCountsPref = () => { try { return localStorage.getItem('looproom:counts') !== '0'; } catch { return true; } };
  const r = { counts: { bpm: video.bpm === null || video.bpm === undefined ? null : Number(video.bpm), start: take.count_start === null || take.count_start === undefined ? null : Number(take.count_start) }, showCounts: showCountsPref(), countDraft: null, countKey: '', compare: { on: false, offset: 0, aligned: null, src: null, url: null, options: null }, abStart: null, sketch: null, sketchAt: 0, drawing: null, tool: 'pen', color: COLORS[0], shownKey: '', openThreads: new Set(), notes: [], selected: null, loop: null, mode: 'point', rangeStart: null, rangeEnd: null, speed: 1, mirror: localStorage.getItem('looproom:mirror') === '1', frame: 0 };
  // Carried notes someone answered “Not yet” on for this take.
  try { r.notYet = new Set(JSON.parse(localStorage.getItem(`looproom:notYet:${take.id}`) || '[]')); } catch { r.notYet = new Set(); }

  view.innerHTML = `<section class="review">
    <header class="review-head">
      <div><h1>${esc(video.title)}</h1><p class="muted">${esc(project.title)}${video.request_id ? ` · for <a class="link" href="/app/p/${projectId}/requests/${video.request_id}" data-link>${esc(video.requests?.title || 'a request')}</a>` : ''} · uploaded by ${esc(nameOf(take.uploaded_by))} · ${timeAgo(take.created_at)}</p></div>
      ${queue ? `<div class="queue-nav"><small>${queue.position} of ${queue.total} in your queue</small>${queue.next ? `<a class="btn small primary" href="${queue.next}" data-link title="Shift+N">Next video →</a>` : '<a class="btn small" href="/app/queue" data-link>Back to queue</a>'}</div>` : ''}
      <div class="take-tabs" role="tablist" aria-label="Takes">${takes.length > 1 ? takes.map((t) => `<a role="tab" href="${base}?take=${t.number}" data-link aria-selected="${t.id === take.id}">Take ${t.number}</a>`).join('') : ''}<button class="btn small" data-upload title="Another try of the same piece — open notes carry over">↑ Upload a new take</button>${canManageVideo ? '<button class="btn small ghost" data-merge title="Uploaded this as a separate video by mistake?">Merge into…</button>' : ''}<button class="btn small ghost" data-compare-toggle aria-pressed="false" title="Play another take or video side by side (C)">⧉ Compare</button>${project.is_sample ? '' : '<button class="btn small ghost" data-share-video title="A read-only link for people outside the team">Share</button>'}</div>
    </header>
    <div class="review-layout">
      <div class="player-col">
        <div class="player-pair" data-pair>
        <div class="player ${r.mirror ? 'mirrored' : ''}" data-player>
          <video src="${esc(signed.signedUrl)}" playsinline preload="metadata" data-video></video>
          <span class="pair-label">Take ${take.number}</span>
          <span class="count-badge" data-count-badge hidden></span>
          <svg class="sketch-layer" data-sketch-layer aria-hidden="true"></svg>
          <div class="sketch-bar" data-sketch-bar hidden>
            <div class="sketch-group" role="group" aria-label="Tool">${TOOLS.map(([k, icon, label]) => `<button type="button" data-tool="${k}" title="${label}" aria-label="${label}" aria-pressed="${k === 'pen'}">${icon}</button>`).join('')}</div>
            <div class="sketch-group" role="group" aria-label="Color">${COLORS.map((c, i) => `<button type="button" class="swatch" data-color="${c}" style="--c:${c}" aria-label="Color ${i + 1}" aria-pressed="${i === 0}"></button>`).join('')}</div>
            <div class="sketch-group"><button type="button" data-sketch-undo title="Undo (Ctrl+Z)" aria-label="Undo">↶</button><button type="button" data-sketch-clear title="Clear" aria-label="Clear">✕</button></div>
            <button type="button" class="sketch-done" data-sketch-done>Done</button>
          </div>
          <span class="player-badge"><b class="mirror-badge">⇋ Mirrored</b><span data-time-overlay>00:00.0</span></span>
          <button class="big-play" data-play aria-label="Play or pause (Space)">▶</button>
        </div>
        <div class="player compare-pane ${r.mirror ? 'mirrored' : ''}" data-compare hidden>
          <video playsinline muted preload="auto" data-video2></video>
          <span class="pair-label" data-compare-label></span>
          <span class="count-badge" data-count-badge2 hidden></span>
        </div>
        </div>
        <div class="timeline"><span data-cur>00:00</span><div class="track" data-track title="Drag to scrub" role="slider" aria-label="Playback position"><span class="t-loop" data-tloop hidden></span><span class="t-draft" data-tdraft hidden></span><span class="t-fill" data-tfill></span><span data-eights></span><span data-markers></span><span class="t-head" data-thead></span></div><span data-dur>--:--</span></div>
        <div class="controls"><button data-play aria-label="Play or pause (Space)">▶</button><button data-speed title="Playback speed">1×</button><button class="toggle-btn" data-ab title="Loop any part: tap at the start, then at the end (B)">↻ A–B</button><button class="toggle-btn" data-counts-toggle aria-pressed="false" title="Show dance counts from the tempo (T to tap)">♩ Counts</button><span class="loop-chip" data-loopchip></span><span class="spacer"></span><button class="toggle-btn" data-mirror aria-pressed="${r.mirror}" title="Mirror mode (M)">⇋ Mirror</button></div>
        <div class="counts-panel" data-counts-panel hidden>
          <div class="counts-row">
            <button type="button" class="tap-btn" data-tap>Tap the beat <small>(T)</small></button>
            <label class="bpm-field"><input type="number" min="40" max="240" step="0.1" inputmode="decimal" data-bpm placeholder="120" aria-label="Tempo in BPM" /><span>BPM</span></label>
            <button type="button" class="btn small" data-count-one>Count 1 is here · <b data-count-one-at>00:00.0</b></button>
          </div>
          <p class="counts-hint" data-counts-hint>Play the music and tap along, or type the BPM. Then pause on count 1 of the first eight.</p>
          <div class="counts-actions"><label class="check-inline"><input type="checkbox" data-counts-show ${r.showCounts ? 'checked' : ''} /> Show counts on the video</label><span class="spacer"></span><button type="button" class="mini ghost" data-counts-clear>Clear</button><button type="button" class="btn small primary" data-counts-save>Save counts</button></div>
        </div>
        <div class="compare-bar" data-compare-bar hidden>
          <label class="compare-pick"><span>Compare with</span><select data-compare-pick></select></label>
          <div class="compare-align"><span class="compare-offset" data-compare-offset></span><button type="button" class="mini" data-nudge="-0.1" title="Move the other video 0.1 s earlier">−0.1s</button><button type="button" class="mini" data-nudge="0.1" title="Move the other video 0.1 s later">+0.1s</button><button type="button" class="mini" data-sync-music title="Line both videos up by their music">♫ Sync by music</button></div>
          <button type="button" class="mini ghost" data-compare-close aria-label="Close compare">✕</button>
        </div>
      </div>
      <aside class="notes-col">
        <div class="take-summary" data-summary></div>
        <div class="note-list" data-list></div>
        <form class="composer" data-composer>
          <div class="seg dark" role="tablist"><button type="button" role="tab" data-mode="point">▸ At <span data-at>00:00.0</span></button><button type="button" role="tab" data-mode="range">⟷ Range</button></div>
          <div class="range-row" data-range hidden><button type="button" data-mark="start">Start <b data-rs>—</b></button><span>→</span><button type="button" data-mark="end">End <b data-re>—</b></button><small>or press [ and ]</small><button type="button" class="mini" data-loop-range hidden>↻ Loop</button></div>
          <div class="composer-field"><textarea data-input rows="2" maxlength="2000" placeholder="What should change at this moment? Type @ to mention someone"></textarea><div class="mention-menu" data-mentions role="listbox" hidden></div></div>
          <div class="composer-foot"><label class="visibility"><span class="sr-only">Who can see this note</span><select data-visibility>
            <option value="">👥 Whole team</option>
            ${members.filter((m) => m.user_id !== me.id).sort((a, b) => (b.user_id === take.uploaded_by) - (a.user_id === take.uploaded_by)).map((m) => `<option value="${m.user_id}">🔒 Only ${esc(m.name)}${m.user_id === take.uploaded_by ? ' (in this take)' : ''}</option>`).join('')}
          </select></label><button type="button" class="btn small ghost draw-btn" data-draw aria-pressed="false" title="Draw on the frame (D)">✎ Draw</button><span class="sketch-chip" data-sketch-chip hidden></span><button class="btn primary small" type="submit">Pin note ↵</button></div>
        </form>
      </aside>
    </div>
  </section>
  <input type="file" accept="video/mp4,video/quicktime,video/webm" hidden data-file />`;

  const videoEl = $('[data-video]');
  // Some browsers can't decode certain phone formats (older iPhone HEVC uploads). Say so instead of showing a black box.
  const cantPlay = () => {
    if ($('[data-cant-play]')) return;
    $('[data-player]').insertAdjacentHTML('beforeend', `<div class="cant-play" data-cant-play><b>This take can’t play in this browser.</b><span>It was recorded in a format (often iPhone HEVC) this browser doesn’t support. Open it in Safari, or ask ${esc(nameOf(take.uploaded_by))} to upload it again — dancerly now converts phone videos automatically.</span></div>`);
  };
  videoEl.addEventListener('error', cantPlay);
  videoEl.addEventListener('loadedmetadata', () => { if (!videoEl.videoWidth) cantPlay(); });
  const duration = () => (Number.isFinite(videoEl.duration) ? videoEl.duration : 0);
  const pct = (sec) => `${duration() ? (sec / duration()) * 100 : 0}%`;

  // ---------- Notes ----------
  async function loadNotes() {
    const { data, error } = await sb.from('notes')
      .select('id, take_id, t_start, t_end, body, status, author_id, private_to, created_at, resolved_at, sketch, note_reactions(user_id), note_replies(id, author_id, body, created_at)')
      .eq('video_id', videoId).order('t_start');
    if (error) return toast(friendlyError(error), 'error');
    r.notes = data.map((n) => {
      // A note from another take moves to the same moment in this one, when the takes are lined up.
      const shift = n.take_id === take.id ? 0 : shiftBetween(takes.find((t) => t.id === n.take_id), take);
      const move = (t) => (t === null ? null : Math.max(0, Number(t) + (shift || 0)));
      return { ...n, t_start: move(n.t_start), t_end: move(n.t_end), shifted: Boolean(shift), unaligned: shift === null, note_replies: [...(n.note_replies || [])].sort((a, b) => a.created_at.localeCompare(b.created_at)) };
    });
    paintNotes();
  }
  // On this take you see its own notes plus anything from earlier takes that isn't fixed yet.
  const visibleNotes = () => r.notes.filter((n) => takeNo[n.take_id] <= take.number && (n.take_id === take.id || n.status !== 'resolved'));
  const noteTime = (n) => (n.t_end === null ? fmt(n.t_start) : `${fmt(n.t_start)}–${fmt(n.t_end)}`);
  // "3·5" next to the time when the video has counts (each take keeps its own count 1).
  const takeCountStart = (takeId) => { const t = takes.find((x) => x.id === takeId); return t?.count_start === null || t?.count_start === undefined ? null : Number(t.count_start); };
  const noteCount = (n) => {
    const c = countAt(n.t_start, r.counts.bpm, n.shifted ? r.counts.start : takeCountStart(n.take_id));
    return c ? `<span class="count-tag" title="Eight ${c.eight}, count ${c.count}">${countLabel(c)}</span>` : '';
  };
  const withMentions = (text) => members.reduce((html, m) => html.split(`@${esc(m.name)}`).join(`<span class="mention">@${esc(m.name)}</span>`), esc(text));
  const canResolve = (n) => n.author_id === me.id || isOwner;

  function paintNotes() {
    const notes = visibleNotes();
    const list = $('[data-list]');
    if (!list) return;
    // Keep half-typed replies (and focus) across live refreshes.
    const drafts = Object.fromEntries([...list.querySelectorAll('[data-reply-form]')].map((f) => [f.dataset.replyForm, f.elements.namedItem('reply').value]));
    const focused = document.activeElement?.closest?.('[data-reply-form]')?.dataset.replyForm;
    queueMicrotask(() => {
      for (const [id, value] of Object.entries(drafts)) { const input = list.querySelector(`[data-reply-form="${id}"] input`); if (input && value) input.value = value; }
      if (focused) list.querySelector(`[data-reply-form="${focused}"] input`)?.focus();
    });
    list.innerHTML = notes.length ? notes.map((n) => {
      const agrees = n.note_reactions.length;
      const iAgree = n.note_reactions.some((x) => x.user_id === me.id);
      const looping = r.loop?.id === n.id;
      const carried = n.take_id !== take.id;
      const from = carried ? `<span class="from" ${n.unaligned ? 'title="Time may be off: this take isn’t lined up with the earlier one yet"' : ''}>from Take ${takeNo[n.take_id]}${n.unaligned ? ' ≈' : ''}</span>` : '';
      // Watching a new take is when fixes get noticed: ask right on the note.
      const ask = carried && n.status !== 'resolved' && canResolve(n) && !r.notYet.has(n.id)
        ? `<div class="fixed-ask"><span>Fixed in Take ${take.number}?</span><button class="mini ok" data-status="resolved" data-id="${n.id}">✓ Yes</button><button class="mini" data-notyet="${n.id}">Not yet</button></div>` : '';
      const statusBtn = n.status === 'resolved'
        ? (canResolve(n) ? `<button class="mini" data-status="open" data-id="${n.id}">Reopen</button>` : '')
        : `${n.status === 'open' ? `<button class="mini" data-status="practicing" data-id="${n.id}">I’m on it</button>` : ''}${canResolve(n) ? `<button class="mini ok" data-status="resolved" data-id="${n.id}">Resolve ✓</button>` : ''}`;
      const other = n.private_to ? (n.author_id === me.id ? n.private_to : n.author_id) : null;
      const replies = n.note_replies || [];
      const open = r.openThreads.has(n.id);
      return `<article class="note ${r.selected === n.id ? 'selected' : ''} ${looping ? 'looping' : ''} ${n.private_to ? 'private' : ''}" data-note="${n.id}">
        ${n.private_to ? `<p class="private-tag" title="Only you and ${esc(nameOf(other))} can see this note and its replies">🔒 Private · you and ${esc(nameOf(other))}</p>` : ''}
        <div class="note-top"><button class="time-chip" data-seek="${n.id}">${n.t_end === null ? '▸' : '⟷'} ${noteTime(n)}</button>${noteCount(n)}${from}${n.sketch ? '<span class="sketch-tag" title="This note has a sketch on the frame">✎ Sketch</span>' : ''}<span class="status s-${n.status}">${n.status === 'practicing' ? 'Practicing' : n.status === 'resolved' ? 'Resolved' : 'Open'}</span></div>
        <p>${withMentions(n.body)}</p>
        ${ask}
        <div class="note-foot"><span class="who">${avatar(nameOf(n.author_id), n.author_id, 'xs')}${esc(nameOf(n.author_id))} <i class="role r-${roleOf(n.author_id).toLowerCase()}">${roleOf(n.author_id)}</i> · ${timeAgo(n.created_at)}</span></div>
        <div class="note-actions">
          <button class="mini ${looping ? 'on' : ''}" data-loop="${n.id}" aria-pressed="${looping}">↻ ${looping ? 'Looping' : n.t_end === null ? 'Loop ±2s' : 'Loop this part'}</button>
          ${n.author_id !== me.id ? `<button class="mini ${iAgree ? 'on' : ''}" data-agree="${n.id}" aria-pressed="${iAgree}">👍 ${agrees || ''}</button>` : agrees ? `<span class="agrees">👍 ${agrees}</span>` : ''}
          ${statusBtn}
          <button class="mini ${open ? 'on' : ''}" data-thread="${n.id}" aria-expanded="${open}">💬 ${replies.length ? replies.length : 'Reply'}</button>
          ${canResolve(n) ? `<button class="mini ghost" data-delete="${n.id}" aria-label="Delete note">🗑</button>` : ''}
        </div>
        ${open ? `<div class="thread">
          ${replies.map((rp) => `<div class="reply">${avatar(nameOf(rp.author_id), rp.author_id, 'xs')}<div><p><b>${esc(nameOf(rp.author_id))}</b> <small>${timeAgo(rp.created_at)}</small></p><p>${withMentions(rp.body)}</p></div>${rp.author_id === me.id || isOwner ? `<button class="mini ghost" data-delete-reply="${rp.id}" data-id="${n.id}" aria-label="Delete reply">✕</button>` : ''}</div>`).join('')}
          <form class="reply-form" data-reply-form="${n.id}"><input name="reply" maxlength="2000" placeholder="${n.private_to ? `Reply to ${esc(nameOf(other))}…` : 'Reply…'}" aria-label="Reply" autocomplete="off" /><button class="btn small" type="submit">Send</button></form>
        </div>` : ''}
      </article>`;
    }).join('') : '<p class="notes-empty">No notes on this take yet. Pause on a moment and write what should change.</p>';
    paintMarkers(notes);
    paintSummary();
  }

  function paintSummary() {
    const earlierResolved = r.notes.filter((n) => takeNo[n.take_id] < take.number && n.status === 'resolved').length;
    const open = visibleNotes().filter((n) => n.status !== 'resolved').length;
    // With a single take there is nothing to compare yet, so keep it to the open count.
    $('[data-summary]').innerHTML = takes.length === 1
      ? `<span class="open">${open} open ${open === 1 ? 'note' : 'notes'}</span>`
      : `<b>Take ${take.number}</b> · <span class="ok">✓ ${earlierResolved} resolved from earlier takes</span> · <span class="open">${open} still open</span>`;
  }

  function paintMarkers(notes) {
    if (!duration()) return;
    $('[data-markers]').innerHTML = notes.map((n) => n.t_end === null
      ? `<button class="t-pin ${r.selected === n.id ? 'on' : ''}" style="left:${pct(n.t_start)}" data-seek="${n.id}" aria-label="Note at ${noteTime(n)}"></button>`
      : `<button class="t-range ${r.selected === n.id ? 'on' : ''}" style="left:${pct(n.t_start)};width:${pct(n.t_end - n.t_start)}" data-seek="${n.id}" aria-label="Note from ${noteTime(n)}"></button>`).join('');
  }

  // ---------- Player ----------
  const play = (on) => { if (on) { if (r.drawing) finishSketch(); videoEl.play().catch(() => {}); } else videoEl.pause(); };
  const seek = (sec, { start = false } = {}) => { videoEl.currentTime = Math.max(0, Math.min(sec, duration() || sec)); if (start) play(true); paintPlayer(); };
  function setLoop(note) {
    r.abStart = null;
    if (!note || r.loop?.id === note.id) r.loop = null;
    else {
      r.loop = note.t_end === null ? { id: note.id, start: Math.max(0, note.t_start - 2), end: Math.min(duration(), note.t_start + 2) } : { id: note.id, start: note.t_start, end: note.t_end };
      r.selected = note.id;
      seek(r.loop.start, { start: true });
    }
    paintNotes();
    paintPlayer();
  }
  function paintPlayer() {
    const t = scrub.active ? scrub.at : videoEl.currentTime || 0;
    $$('[data-play]').forEach((b) => { b.textContent = videoEl.paused ? '▶' : 'Ⅱ'; });
    $('[data-player]').classList.toggle('playing', !videoEl.paused);
    $('[data-player]').classList.toggle('mirrored', r.mirror);
    $('[data-mirror]').setAttribute('aria-pressed', String(r.mirror));
    $('[data-speed]').textContent = `${r.speed}×`;
    $('[data-time-overlay]').textContent = fmtFine(t);
    $('[data-at]').textContent = fmtFine(t);
    $('[data-cur]').textContent = fmt(t);
    $('[data-tfill]').style.width = pct(t);
    $('[data-thead]').style.left = pct(t);
    const loopBar = $('[data-tloop]');
    loopBar.hidden = !r.loop && r.abStart === null;
    if (r.loop) { loopBar.style.left = pct(r.loop.start); loopBar.style.width = pct(r.loop.end - r.loop.start); }
    else if (r.abStart !== null) { loopBar.style.left = pct(Math.min(r.abStart, t)); loopBar.style.width = pct(Math.abs(t - r.abStart)); }
    const ab = $('[data-ab]');
    const abOn = !!r.loop && !r.loop.id;
    ab.textContent = r.abStart !== null ? `↻ Set B · from ${fmt(r.abStart)}` : abOn ? '↻ A–B on' : '↻ A–B';
    ab.setAttribute('aria-pressed', String(r.abStart !== null || abOn));
    $('[data-loop-range]').hidden = !(r.mode === 'range' && r.rangeStart !== null && r.rangeEnd !== null);
    // Repainted every frame, so only touch the chip when it changes — replacing it mid-click swallowed the ✕.
    const chip = r.loop ? `↻ Looping ${fmt(r.loop.start)}–${fmt(r.loop.end)} <button type="button" data-clearloop aria-label="Stop looping">✕</button>` : '';
    if (chip !== r.loopChip) { r.loopChip = chip; $('[data-loopchip]').innerHTML = chip; }
    const draft = $('[data-tdraft]');
    const showDraft = r.mode === 'range' && r.rangeStart !== null;
    draft.hidden = !showDraft;
    if (showDraft) { const end = r.rangeEnd ?? t; draft.style.left = pct(Math.min(r.rangeStart, end)); draft.style.width = pct(Math.abs(end - r.rangeStart)); }
    $('[data-rs]').textContent = r.rangeStart === null ? '—' : fmt(r.rangeStart);
    $('[data-re]').textContent = r.rangeEnd === null ? '—' : fmt(r.rangeEnd);
    paintSketchLayer(t);
    paintCounts(t);
    $('[data-compare]').classList.toggle('mirrored', r.mirror);
  }

  // ---------- Sketches on the frame ----------
  const layer = $('[data-sketch-layer]');
  const placeSketchLayer = () => { placeLayer(layer, videoEl); r.shownKey = ''; };
  // Shows the sketches of notes at this moment (and your unsent one while paused). Repaints only when that set changes.
  function paintSketchLayer(t) {
    if (r.drawing) return;
    const shown = visibleNotes().filter((n) => n.sketch && sketchShowsAt(n, t));
    const pending = r.sketch && videoEl.paused;
    const key = `${shown.map((n) => n.id).join()}|${pending ? r.sketch.length : ''}`;
    if (key === r.shownKey) return;
    r.shownKey = key;
    paintSketches(layer, [...shown.map((n) => n.sketch), ...(pending ? [{ strokes: r.sketch }] : [])]);
  }
  function paintSketchChip() {
    const chip = $('[data-sketch-chip]');
    chip.hidden = !r.sketch;
    chip.innerHTML = r.sketch ? `✎ Sketch${r.mode === 'point' ? ` at ${fmtFine(r.sketchAt)}` : ''} <button type="button" data-sketch-remove aria-label="Remove sketch">✕</button>` : '';
    $('[data-draw]').textContent = r.sketch ? '✎ Edit sketch' : '✎ Draw';
  }
  function startSketch() {
    if (r.drawing) return;
    play(false);
    setLoop(null);
    if (!r.sketch) r.sketchAt = videoEl.currentTime || 0;
    placeLayer(layer, videoEl);
    $('[data-player]').classList.add('drawing');
    // On phones the composer sits below the video; bring the frame into view to draw on it.
    $('[data-player]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('[data-sketch-bar]').hidden = false;
    $('[data-draw]').setAttribute('aria-pressed', 'true');
    r.drawing = startDrawing(layer, { tool: () => r.tool, color: () => r.color, mirrored: () => r.mirror });
    if (r.sketch) { r.drawing.strokes.push(...r.sketch); paintSketches(layer, [{ strokes: r.drawing.strokes }]); } else paintSketches(layer, []);
  }
  function finishSketch() {
    if (!r.drawing) return;
    r.sketch = r.drawing.strokes.length ? r.drawing.strokes.map((s) => ({ ...s, pts: [...s.pts] })) : null;
    r.drawing.stop();
    r.drawing = null;
    $('[data-player]').classList.remove('drawing');
    $('[data-sketch-bar]').hidden = true;
    $('[data-draw]').setAttribute('aria-pressed', 'false');
    r.shownKey = '';
    paintSketchChip();
    paintPlayer();
    if (r.sketch) input.focus();
  }
  function dropSketch() {
    if (r.drawing) { r.drawing.stop(); r.drawing = null; $('[data-player]').classList.remove('drawing'); $('[data-sketch-bar]').hidden = true; }
    r.sketch = null;
    r.shownKey = '';
    paintSketchChip();
    paintPlayer();
  }
  $('[data-draw]').addEventListener('click', () => (r.drawing ? finishSketch() : startSketch()));
  $('[data-sketch-chip]').addEventListener('click', (e) => { if (e.target.closest('[data-sketch-remove]')) dropSketch(); });
  $('[data-sketch-bar]').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !r.drawing) return;
    if (b.dataset.tool) { r.tool = b.dataset.tool; $$('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
    if (b.dataset.color) { r.color = b.dataset.color; $$('[data-color]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
    if ('sketchUndo' in b.dataset) r.drawing.undo();
    if ('sketchClear' in b.dataset) r.drawing.clear();
    if ('sketchDone' in b.dataset) finishSketch();
  });
  const onResize = () => { placeSketchLayer(); if (r.drawing) paintSketches(layer, [{ strokes: r.drawing.strokes }]); else paintPlayer(); };
  window.addEventListener('resize', onResize);
  function tick() {
    if (r.loop && !videoEl.paused && videoEl.currentTime >= r.loop.end) videoEl.currentTime = r.loop.start;
    if (r.compare.on) follow(videoEl, video2, r.compare.offset, r.speed);
    paintPlayer();
    r.frame = requestAnimationFrame(tick);
  }
  videoEl.addEventListener('loadedmetadata', () => { $('[data-dur]').textContent = fmt(duration()); placeSketchLayer(); paintEights(); paintNotes(); paintPlayer(); });
  videoEl.addEventListener('error', () => toast('This take couldn’t be played in this browser. Try MP4 (H.264).', 'error'));
  $$('[data-play]').forEach((b) => b.addEventListener('click', () => play(videoEl.paused)));
  $('[data-speed]').addEventListener('click', () => { r.speed = SPEEDS[(SPEEDS.indexOf(r.speed) + 1) % SPEEDS.length]; videoEl.playbackRate = r.speed; paintPlayer(); });
  const toggleMirror = () => { r.mirror = !r.mirror; localStorage.setItem('looproom:mirror', r.mirror ? '1' : '0'); paintPlayer(); };
  $('[data-mirror]').addEventListener('click', toggleMirror);
  // Free A–B loop: any part of the video, no note needed.
  function loopPart(start, end) {
    r.abStart = null;
    r.loop = { id: null, start: Math.min(start, end), end: Math.max(start, end) };
    seek(r.loop.start, { start: true });
    paintNotes();
  }
  function abLoop() {
    const t = videoEl.currentTime || 0;
    if (r.loop && !r.loop.id) return setLoop(null);
    if (r.abStart === null) { r.loop = null; r.abStart = t; paintNotes(); paintPlayer(); return toast(`A set at ${fmt(t)}. Play or scrub to the end, then tap again.`); }
    if (Math.abs(t - r.abStart) < 0.3) return toast('Move to where the loop should end, then tap again.');
    loopPart(r.abStart, t);
  }
  $('[data-ab]').addEventListener('click', abLoop);
  $('[data-loop-range]').addEventListener('click', () => loopPart(r.rangeStart, r.rangeEnd));

  // ---------- Counts: tempo + count 1 → "eight · count" on the video, the timeline, and every note ----------
  const tapper = tapTempo();
  const countsPanel = $('[data-counts-panel]');
  function paintEights() {
    const starts = r.showCounts ? eightStarts(duration(), r.counts.bpm, r.counts.start) : [];
    $('[data-eights]').innerHTML = starts.map((x, i) => `<i class="t-eight ${i % 4 === 0 ? 'major' : ''}" style="left:${pct(x)}"></i>`).join('');
  }
  function paintCounts(t) {
    const c = r.showCounts ? countAt(t, r.counts.bpm, r.counts.start) : null;
    const key = c ? countLabel(c) : '';
    if (key !== r.countKey) {
      r.countKey = key;
      const badge = $('[data-count-badge]');
      badge.hidden = !c;
      if (c) badge.innerHTML = `<small>Eight ${c.eight}</small><b>${c.count}</b>`;
    }
    if (r.compare.on) {
      const src = r.compare.src;
      const c2 = r.showCounts && src ? countAt(video2.currentTime, src.bpm, src.count_start) : null;
      const badge2 = $('[data-count-badge2]');
      badge2.hidden = !c2;
      const html = c2 ? `<small>Eight ${c2.eight}</small><b>${c2.count}</b>` : '';
      if (badge2.dataset.key !== html) { badge2.dataset.key = html; badge2.innerHTML = html; }
    }
    if (!countsPanel.hidden) $('[data-count-one-at]').textContent = fmtFine(r.countDraft?.start ?? t);
  }
  function openCounts(open = countsPanel.hidden) {
    countsPanel.hidden = !open;
    $('[data-counts-toggle]').setAttribute('aria-pressed', String(open));
    if (open) {
      r.countDraft = { bpm: r.counts.bpm, start: r.counts.start };
      $('[data-bpm]').value = r.counts.bpm ?? '';
      paintCountsHint();
    }
  }
  function paintCountsHint() {
    const d = r.countDraft;
    $('[data-counts-hint]').textContent = !d.bpm ? 'Play the music and tap along, or type the BPM. Then pause on count 1 of the first eight.'
      : d.start === null ? `${d.bpm} BPM. Now pause on count 1 of the first eight and tap “Count 1 is here”.`
      : `${d.bpm} BPM · count 1 at ${fmtFine(d.start)}. Save to show counts for everyone.`;
  }
  function tap() {
    if (countsPanel.hidden) openCounts(true);
    const bpm = tapper.tap();
    const btn = $('[data-tap]');
    btn.classList.remove('pulse'); void btn.offsetWidth; btn.classList.add('pulse');
    if (bpm && bpm >= 40 && bpm <= 240) { r.countDraft.bpm = bpm; $('[data-bpm]').value = bpm; paintCountsHint(); }
  }
  $('[data-counts-toggle]').addEventListener('click', () => openCounts());
  $('[data-tap]').addEventListener('click', tap);
  $('[data-bpm]').addEventListener('input', (e) => { const v = Number(e.target.value); r.countDraft.bpm = v >= 40 && v <= 240 ? Math.round(v * 10) / 10 : null; paintCountsHint(); });
  $('[data-count-one]').addEventListener('click', () => { play(false); r.countDraft.start = Math.round((videoEl.currentTime || 0) * 1000) / 1000; paintCountsHint(); });
  $('[data-counts-show]').addEventListener('change', (e) => {
    r.showCounts = e.target.checked;
    try { localStorage.setItem('looproom:counts', r.showCounts ? '1' : '0'); } catch {}
    r.countKey = '-'; paintEights(); paintNotes(); paintPlayer();
  });
  async function saveCounts(bpm, start) {
    const { error } = await sb.rpc('set_counts', { p_take: take.id, p_bpm: bpm, p_count_start: start });
    if (error) return toast(friendlyError(error), 'error');
    r.counts = { bpm, start };
    take.count_start = start;
    r.countKey = '-';
    paintEights(); paintNotes(); paintPlayer();
    return true;
  }
  $('[data-counts-save]').addEventListener('click', async () => {
    const d = r.countDraft;
    if (!d.bpm) return toast('Set the tempo first — tap along or type the BPM.');
    if (d.start === null) return toast('Pause on count 1 and tap “Count 1 is here”.');
    if (await saveCounts(d.bpm, d.start)) { openCounts(false); toast('Counts saved. Notes now show their count.'); }
  });
  $('[data-counts-clear]').addEventListener('click', async () => {
    if (await saveCounts(null, null)) { openCounts(false); toast('Counts cleared.'); }
  });

  // ---------- Compare: another take, or another video in the project (like the original choreo), side by side ----------
  const video2 = $('[data-video2]');
  async function compareOptions() {
    if (r.compare.options) return r.compare.options;
    const { data: others } = await sb.from('videos').select('id, title, bpm, takes(id, number, storage_path, count_start)').eq('project_id', projectId).neq('id', videoId).order('created_at', { ascending: false }).limit(50);
    const num = (v) => (v === null || v === undefined ? null : Number(v));
    const own = takes.filter((t) => t.id !== take.id).map((t) => ({ key: t.id, label: `Take ${t.number}`, group: 'this', storage_path: t.storage_path, count_start: num(t.count_start), bpm: r.counts.bpm, take: t }));
    const rest = (others || []).filter((v) => v.takes?.length).map((v) => {
      const t = [...v.takes].sort((a, b) => b.number - a.number)[0];
      return { key: t.id, label: v.takes.length > 1 ? `${v.title} · Take ${t.number}` : v.title, group: 'other', storage_path: t.storage_path, count_start: num(t.count_start), bpm: num(v.bpm) };
    });
    r.compare.options = [...own, ...rest];
    return r.compare.options;
  }
  function paintCompareOffset() {
    const o = r.compare.offset;
    $('[data-compare-offset]').textContent = r.compare.aligned === 'counts' && Math.abs(o - r.compare.countOffset) < 0.01 ? 'Lined up by count 1'
      : r.compare.aligned === 'music' && Math.abs(o - r.compare.musicOffset) < 0.01 ? 'Lined up by the music'
      : Math.abs(o) < 0.05 ? 'Starts together' : `${o > 0 ? '+' : '−'}${Math.abs(o).toFixed(1)}s`;
  }
  async function loadCompare(key) {
    const src = r.compare.options.find((o) => o.key === key);
    if (!src) return;
    let data;
    try { data = { signedUrl: await takeUrl(src.storage_path) }; } catch (error) { return toast(friendlyError(error), 'error'); }
    r.compare.src = src;
    r.compare.url = data.signedUrl;
    video2.src = data.signedUrl;
    $('[data-compare-label]').textContent = src.label;
    // Same tempo and both have count 1 → line them up count for count.
    const canCount = r.counts.start !== null && src.count_start !== null && src.bpm && r.counts.bpm && Math.abs(src.bpm - r.counts.bpm) < 0.5;
    r.compare.countOffset = canCount ? src.count_start - r.counts.start : null;
    r.compare.offset = canCount ? r.compare.countOffset : 0;
    r.compare.aligned = canCount ? 'counts' : null;
    paintCompareOffset();
  }
  async function openCompare() {
    const options = await compareOptions();
    if (!options.length) return toast('Upload another take, or another video to this project, to compare.');
    r.compare.on = true;
    const sel = $('[data-compare-pick]');
    const group = (g, label) => { const items = options.filter((o) => o.group === g); return items.length ? `<optgroup label="${label}">${items.map((o) => `<option value="${o.key}">${esc(o.label)}</option>`).join('')}</optgroup>` : ''; };
    sel.innerHTML = group('this', 'This video') + group('other', 'Other videos');
    const previous = options.find((o) => o.group === 'this' && o.take.number === take.number - 1) || options[0];
    sel.value = previous.key;
    $('[data-pair]').classList.add('comparing');
    $('[data-compare]').hidden = false;
    $('[data-compare-bar]').hidden = false;
    $('[data-compare-toggle]').setAttribute('aria-pressed', 'true');
    await loadCompare(previous.key);
    placeSketchLayer();
  }
  function closeCompare() {
    r.compare.on = false;
    video2.pause();
    video2.removeAttribute('src');
    video2.load();
    $('[data-pair]').classList.remove('comparing');
    $('[data-compare]').hidden = true;
    $('[data-compare-bar]').hidden = true;
    $('[data-compare-toggle]').setAttribute('aria-pressed', 'false');
    placeSketchLayer();
  }
  const toggleCompare = () => (r.compare.on ? closeCompare() : openCompare());
  $('[data-compare-toggle]').addEventListener('click', toggleCompare);
  $('[data-compare-close]').addEventListener('click', closeCompare);
  $('[data-compare-pick]').addEventListener('change', (e) => loadCompare(e.target.value));
  $$('[data-nudge]').forEach((b) => b.addEventListener('click', () => { r.compare.offset = Math.round((r.compare.offset + Number(b.dataset.nudge)) * 10) / 10; paintCompareOffset(); }));
  $('[data-sync-music]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const label = btn.textContent;
    btn.disabled = true;
    try {
      const offset = await offsetByMusic(signed.signedUrl, r.compare.url, (stage) => { btn.textContent = stage; });
      if (offset === null) return toast('Couldn’t find the same music in both videos. Line them up with −0.1s / +0.1s.');
      r.compare.offset = Math.round(offset * 100) / 100;
      r.compare.musicOffset = r.compare.offset;
      r.compare.aligned = 'music';
      paintCompareOffset();
      // A take of this video without counts gets them for free from the match.
      const src = r.compare.src;
      if (src.group === 'this' && src.count_start === null && r.counts.start !== null && r.counts.bpm) {
        const start = Math.round((r.counts.start + offset) * 1000) / 1000;
        if (start >= 0 && !(await sb.rpc('set_counts', { p_take: src.key, p_bpm: r.counts.bpm, p_count_start: start })).error) { src.count_start = start; src.take.count_start = start; paintNotes(); }
      }
      toast('Lined up by the music.');
    } catch {
      toast('This browser couldn’t read the audio. Line them up with −0.1s / +0.1s.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  $('[data-loopchip]').addEventListener('click', (e) => { if (e.target.closest('[data-clearloop]')) setLoop(null); });
  // Scrubbing: press anywhere on the bar and drag (mouse or finger). Playback pauses while dragging and resumes after.
  const track = $('[data-track]');
  const scrub = { active: false, resume: false, frame: 0, at: 0 };
  const timeAt = (x) => { const box = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - box.left) / box.width)) * duration(); };
  const applyScrub = () => {
    scrub.frame = 0;
    if (videoEl.fastSeek && scrub.active) videoEl.fastSeek(scrub.at); else videoEl.currentTime = scrub.at;
    paintPlayer();
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('[data-seek]') || !duration()) return;
    e.preventDefault();
    try { track.setPointerCapture(e.pointerId); } catch {}
    scrub.active = true;
    scrub.resume = !videoEl.paused;
    videoEl.pause();
    track.classList.add('scrubbing');
    scrub.at = timeAt(e.clientX);
    applyScrub();
  });
  track.addEventListener('pointermove', (e) => {
    if (!scrub.active) return;
    scrub.at = timeAt(e.clientX);
    // Show the new position right away; the video catches up once per frame.
    $('[data-tfill]').style.width = pct(scrub.at);
    $('[data-thead]').style.left = pct(scrub.at);
    $('[data-cur]').textContent = fmt(scrub.at);
    if (!scrub.frame) scrub.frame = requestAnimationFrame(applyScrub);
  });
  const endScrub = (e) => {
    if (!scrub.active) return;
    scrub.active = false;
    track.classList.remove('scrubbing');
    if (e?.clientX !== undefined && e.type === 'pointerup') scrub.at = timeAt(e.clientX);
    cancelAnimationFrame(scrub.frame);
    scrub.frame = 0;
    videoEl.currentTime = scrub.at; // exact frame at release
    paintPlayer();
    if (scrub.resume) play(true);
  };
  track.addEventListener('pointerup', endScrub);
  track.addEventListener('pointercancel', endScrub);

  // ---------- Note actions (one delegated listener) ----------
  async function onClick(e) {
    if (e.target.closest('.thread input, .reply-form')) return;
    const notYet = e.target.closest('[data-notyet]');
    if (notYet) {
      r.notYet.add(notYet.dataset.notyet);
      try { localStorage.setItem(`looproom:notYet:${take.id}`, JSON.stringify([...r.notYet])); } catch {}
      return paintNotes();
    }
    const el = e.target.closest('[data-seek],[data-loop],[data-agree],[data-status],[data-delete],[data-thread],[data-delete-reply],[data-note]');
    if (!el || !view.contains(el)) return;
    const id = el.dataset.seek || el.dataset.loop || el.dataset.agree || el.dataset.id || el.dataset.delete || el.dataset.thread || el.dataset.note;
    const note = r.notes.find((n) => n.id === id);
    if (!note) return;
    if (el.dataset.thread) {
      if (r.openThreads.has(id)) r.openThreads.delete(id); else r.openThreads.add(id);
      paintNotes();
      if (r.openThreads.has(id)) view.querySelector(`[data-reply-form="${id}"] input`)?.focus();
      return;
    }
    if (el.dataset.deleteReply) {
      const { error } = await sb.from('note_replies').delete().eq('id', el.dataset.deleteReply);
      if (error) return toast(friendlyError(error), 'error');
      return loadNotes();
    }
    if (el.dataset.seek) {
      r.selected = id;
      // A sketch note stops on its frame so the drawing can be read; others play from just before.
      if (note.sketch) { play(false); seek(note.t_start); } else seek(note.t_end === null ? Math.max(0, note.t_start - 1) : note.t_start, { start: true });
      paintNotes();
      return;
    }
    if (el.dataset.loop) return setLoop(note);
    if (el.dataset.agree) {
      const mine = note.note_reactions.some((x) => x.user_id === me.id);
      const { error } = mine
        ? await sb.from('note_reactions').delete().eq('note_id', id).eq('user_id', me.id)
        : await sb.from('note_reactions').insert({ note_id: id });
      if (error) return toast(friendlyError(error), 'error');
      return loadNotes();
    }
    if (el.dataset.status) {
      const { error } = await sb.rpc('set_note_status', { p_note: id, p_status: el.dataset.status });
      if (error) return toast(friendlyError(error), 'error');
      toast(el.dataset.status === 'resolved' ? `Correction landed ✓ ${noteTime(note)}` : el.dataset.status === 'practicing' ? 'Marked as practicing.' : 'Note reopened.');
      return loadNotes();
    }
    if (el.dataset.delete) {
      const sure = await dialog({ title: 'Delete this note?', body: 'It disappears for everyone on the project.', confirm: 'Delete', danger: true });
      if (!sure) return;
      const { error } = await sb.from('notes').delete().eq('id', id);
      if (error) return toast(friendlyError(error), 'error');
      return loadNotes();
    }
    if (!e.target.closest('button')) { r.selected = id; paintNotes(); }
  }
  view.addEventListener('click', onClick);

  // Replies: one line, Enter sends. Private threads stay between the two people (enforced by the database).
  async function onReply(e) {
    const form = e.target.closest('[data-reply-form]');
    if (!form) return;
    e.preventDefault();
    const field = form.elements.namedItem('reply');
    const body = field.value.trim();
    if (!body) return field.focus();
    field.disabled = true;
    const { error } = await sb.from('note_replies').insert({ note_id: form.dataset.replyForm, body });
    field.disabled = false;
    if (error) return toast(friendlyError(error), 'error');
    field.value = '';
    await loadNotes();
    view.querySelector(`[data-reply-form="${form.dataset.replyForm}"] input`)?.focus();
  }
  view.addEventListener('submit', onReply);

  // ---------- Composer: a moment or a range, @mentions, no labels ----------
  const input = $('[data-input]');
  function setMode(mode) {
    r.mode = mode;
    if (mode === 'range' && r.rangeStart === null) { r.rangeStart = videoEl.currentTime || 0; r.rangeEnd = null; }
    if (mode === 'point') { r.rangeStart = null; r.rangeEnd = null; }
    $$('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    $('[data-range]').hidden = mode !== 'range';
    paintSketchChip();
    paintPlayer();
  }
  function mark(which) {
    const t = videoEl.currentTime || 0;
    if (r.mode !== 'range') setMode('range');
    if (which === 'start') { r.rangeStart = t; if (r.rangeEnd !== null && r.rangeEnd <= t) r.rangeEnd = null; }
    else if (r.rangeStart === null || t <= r.rangeStart) return toast('Set the end after the start.');
    else r.rangeEnd = t;
    paintPlayer();
  }
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('[data-mark]').forEach((b) => b.addEventListener('click', () => mark(b.dataset.mark)));

  const mentionMatch = () => input.value.slice(0, input.selectionStart).match(/@([^@\n]{0,30})$/);
  function paintMentions() {
    const menu = $('[data-mentions]');
    const m = mentionMatch();
    const options = m ? rankMentions(m[1]) : [];
    menu.hidden = !options.length;
    menu.innerHTML = `<span class="menu-label">People on ${esc(project.title)}</span>${options.map((x, i) => `<button type="button" role="option" class="${i === 0 ? 'active' : ''}" data-pick="${esc(x.name)}">${avatar(x.name, x.user_id, 'xs')}${esc(x.name)}<small>${x.role === 'owner' ? 'Owner' : 'Member'}</small></button>`).join('')}`;
    $$('[data-pick]', menu).forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(b.dataset.pick); }));
  }
  // Who to suggest after @: best name match first (start of name, start of a word, anywhere, then loose letters),
  // nudged by who you mention often and who is active on this video.
  const RECENT_KEY = 'looproom:recentMentions';
  const recentMentions = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
  function rankMentions(query) {
    const q = query.trim().toLowerCase();
    const recent = recentMentions();
    const active = new Map();
    const touch = (id, at) => { if (id && (!active.has(id) || active.get(id) < at)) active.set(id, at); };
    for (const n of r.notes) { touch(n.author_id, n.created_at); for (const rp of n.note_replies || []) touch(rp.author_id, rp.created_at); }
    const byActivity = [...active.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
    const match = (name) => {
      const n = name.toLowerCase();
      if (!q) return 1;
      if (n.startsWith(q)) return 100;
      if (n.split(/\s+/).some((w) => w.startsWith(q))) return 80;
      if (n.includes(q)) return 50;
      let i = 0;
      for (const ch of n) if (ch === q[i]) i += 1;
      return i === q.length ? 20 : 0;
    };
    return members
      .filter((x) => x.user_id !== me.id)
      .map((x) => {
        const score = match(x.name);
        const ri = recent.indexOf(x.user_id);
        const ai = byActivity.indexOf(x.user_id);
        const bonus = (ri >= 0 ? 30 - ri * 3 : 0) + (x.user_id === take.uploaded_by ? 20 : 0) + (ai >= 0 ? Math.max(0, 15 - ai * 3) : 0);
        return { x, score, rank: score ? score + bonus : 0 };
      })
      .filter((o) => o.score)
      .sort((a, b) => b.rank - a.rank || a.x.name.localeCompare(b.x.name))
      .slice(0, 6)
      .map((o) => o.x);
  }
  function pick(name) {
    const m = mentionMatch();
    if (!m) return;
    const person = members.find((x) => x.name === name);
    if (person) try { localStorage.setItem(RECENT_KEY, JSON.stringify([person.user_id, ...recentMentions().filter((id) => id !== person.user_id)].slice(0, 10))); } catch {}
    const caret = input.selectionStart;
    const start = caret - m[0].length;
    input.value = `${input.value.slice(0, start)}@${name} ${input.value.slice(caret)}`;
    input.selectionStart = input.selectionEnd = start + name.length + 2;
    input.focus();
    paintMentions();
  }
  input.addEventListener('focus', () => play(false));
  input.addEventListener('input', paintMentions);
  input.addEventListener('keydown', (e) => {
    const menu = $('[data-mentions]');
    if (!menu.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = $$('[data-pick]', menu);
      const i = items.findIndex((b) => b.classList.contains('active'));
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      items.forEach((b) => b.classList.toggle('active', b === next));
      return;
    }
    if (!menu.hidden && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick($('[data-pick].active', menu).dataset.pick); return; }
    if (e.key === 'Escape') { if (!menu.hidden) menu.hidden = true; else input.blur(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pin(); }
  });
  $('[data-composer]').addEventListener('submit', (e) => { e.preventDefault(); pin(); });

  let pinning = false;
  async function pin() {
    const body = input.value.trim();
    if (!body && r.sketch && !pinning) { toast('Add a few words to go with the sketch.'); return input.focus(); }
    if (!body || pinning) return input.focus();
    if (r.drawing) finishSketch();
    // A sketch belongs to the frame it was drawn on.
    let start = r.sketch && r.mode === 'point' ? r.sketchAt : videoEl.currentTime || 0;
    let end = null;
    if (r.mode === 'range') {
      if (r.rangeStart === null || r.rangeEnd === null) return toast('Mark where the range ends — press ] or tap End.');
      start = r.rangeStart;
      end = r.rangeEnd;
    }
    pinning = true;
    const privateTo = $('[data-visibility]').value || null;
    const { data: note, error } = await sb.from('notes').insert({ take_id: take.id, t_start: start.toFixed(2), t_end: end === null ? null : end.toFixed(2), body, private_to: privateTo, sketch: r.sketch ? { v: 1, strokes: r.sketch } : null }).select('id').single();
    pinning = false;
    if (error) return toast(friendlyError(error), 'error');
    // In a private note only the recipient can be mentioned (they're notified anyway).
    const mentioned = members.filter((m) => m.user_id !== me.id && body.includes(`@${m.name}`) && (!privateTo || m.user_id === privateTo));
    if (mentioned.length) await sb.from('note_mentions').insert(mentioned.map((m) => ({ note_id: note.id, user_id: m.user_id })));
    input.value = '';
    input.blur();
    dropSketch();
    setMode('point');
    paintMentions();
    r.selected = note.id;
    await loadNotes();
    if (!seen('first_note')) { markSeen('first_note'); track('first_note', { sample: Boolean(project.is_sample), private: Boolean(privateTo) }); }
    const recipient = privateTo ? members.find((m) => m.user_id === privateTo)?.name : null;
    toast(recipient
      ? `Private note pinned. Only ${recipient.split(' ')[0]} can see it.`
      : `Note pinned at ${end === null ? fmt(start) : `${fmt(start)}–${fmt(end)}`}.${mentioned.length ? ` ${mentioned.map((m) => m.name.split(' ')[0]).join(' and ')} will see it in their feedback.` : ''}`);
  }

  // ---------- Keyboard ----------
  function onKey(e) {
    if (r.drawing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); r.drawing.undo(); return; }
    if (e.target.closest('input, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (r.drawing && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); finishSketch(); return; }
    if (e.shiftKey && e.key.toLowerCase() === 'n' && queue?.next) { e.preventDefault(); navigate(queue.next); return; }
    const notes = visibleNotes();
    const step = (dir) => {
      const i = notes.findIndex((n) => n.id === r.selected);
      const n = notes[Math.max(0, Math.min(notes.length - 1, i + dir))];
      if (n) { r.selected = n.id; seek(n.t_start); paintNotes(); }
    };
    const actions = {
      ' ': () => play(videoEl.paused), k: () => play(false), j: () => seek(videoEl.currentTime - 5), l: () => seek(videoEl.currentTime + 5),
      arrowleft: () => seek(videoEl.currentTime - 5), arrowright: () => seek(videoEl.currentTime + 5),
      d: () => (r.drawing ? finishSketch() : startSketch()), b: abLoop, t: tap, c: toggleCompare, m: toggleMirror, n: () => { setMode('point'); input.focus(); }, '[': () => mark('start'), ']': () => { mark('end'); if (r.rangeEnd !== null) input.focus(); },
      escape: () => setLoop(null), arrowup: () => step(-1), arrowdown: () => step(1)
    };
    const action = actions[e.key.toLowerCase()];
    if (action) { e.preventDefault(); action(); }
  }
  document.addEventListener('keydown', onKey);

  // ---------- Live updates: teammates' notes appear without refreshing ----------
  let reloadTimer;
  const channel = sb.channel(`notes:${videoId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `video_id=eq.${videoId}` }, () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadNotes, 300); })
    // Replies can't be filtered by video, so reload only when one belongs to a note shown here.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'note_replies' }, (payload) => {
      const noteId = payload.new?.note_id || payload.old?.note_id;
      if (!noteId || r.notes.some((n) => n.id === noteId)) { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadNotes, 300); }
    })
    .subscribe();

  wireUpload();
  $('[data-merge]')?.addEventListener('click', mergeInto);
  $('[data-share-video]')?.addEventListener('click', () => shareVideo(videoId, video.title));
  // The first private note: say who will see it.
  $('[data-visibility]').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    const name = members.find((m) => m.user_id === e.target.value)?.name || '';
    if (!(await explainPrivate(name))) e.target.value = '';
  });
  const closeTips = reviewTips({ isOwner: isOwner || project.is_sample });
  setMode('point');
  await loadNotes();
  // A later take that isn't lined up with Take 1 yet: line it up by the music in the background, then re-place notes.
  if (schema.align && take.number > 1 && take.align == null && !project.is_sample) {
    setTimeout(async () => {
      try {
        const urlFirst = await takeUrl(takes[0].storage_path);
        const align = await alignTake({ take, first: takes[0], urlFirst, urlTake: signed.signedUrl });
        if (align !== null && document.contains(videoEl)) { take.align = align; loadNotes(); }
      } catch {}
    }, 2500);
  }
  r.frame = requestAnimationFrame(tick);
  // Opened from Inbox, Feedback, or Home: select that note and go to its moment.
  const wantedNote = new URLSearchParams(location.search).get('note');
  const target = wantedNote && r.notes.find((n) => n.id === wantedNote);
  if (target) {
    r.selected = target.id;
    const jump = () => {
      seek(target.t_end === null ? Math.max(0, target.t_start - 1) : target.t_start);
      paintNotes();
      view.querySelector(`[data-note="${target.id}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    if (videoEl.readyState >= 1) jump(); else videoEl.addEventListener('loadedmetadata', jump, { once: true });
  } else {
    // ?t=42 opens at that second (count sheet references, shared moments).
    // &from=<take> means the time was read off that take: move it to the same moment in this one when they're lined up.
    const params = new URLSearchParams(location.search);
    const from = takes.find((t) => t.id === params.get('from'));
    const at = Number(params.get('t')) + ((from && shiftBetween(from, take)) || 0);
    if (at > 0) { const go = () => seek(at); if (videoEl.readyState >= 1) go(); else videoEl.addEventListener('loadedmetadata', go, { once: true }); }
  }

  // Uploaded a new take as its own video by mistake? Move its takes and notes onto the right video.
  async function mergeInto() {
    const { data: others, error } = await sb.from('videos').select('id, title, takes(count)').eq('project_id', projectId).neq('id', videoId).order('created_at', { ascending: false });
    if (error) return toast(friendlyError(error), 'error');
    if (!others.length) return toast('There’s no other video in this project to merge into.');
    const values = await dialog({
      title: `Merge “${video.title}” into another video`,
      body: `Its ${takes.length === 1 ? 'take' : `${takes.length} takes`} will become the next takes of the video you pick, and every note comes along. “${esc(video.title)}” then disappears from the list.`,
      fields: [{ name: 'target', label: 'Add these takes to', type: 'select', required: true, options: others.map((o) => ({ value: o.id, label: `${o.title} · ${o.takes[0]?.count ?? 0} ${(o.takes[0]?.count ?? 0) === 1 ? 'take' : 'takes'}` })) }],
      confirm: 'Merge'
    });
    if (!values?.target) return;
    const target = others.find((o) => o.id === values.target);
    const { error: mergeErr } = await sb.rpc('merge_video', { p_source: videoId, p_target: target.id });
    if (mergeErr) return toast(friendlyError(mergeErr), 'error');
    const first = (target.takes[0]?.count ?? 0) + 1;
    toast(`Merged. They’re now ${takes.length === 1 ? `Take ${first}` : `Takes ${first}–${first + takes.length - 1}`} of “${target.title}”.`);
    navigate(`/app/p/${projectId}/v/${target.id}?take=${first + takes.length - 1}`);
  }

  function wireUpload() {
    const fileInput = $('[data-file]');
    $$('[data-upload]').forEach((b) => b.addEventListener('click', () => fileInput.click()));
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const added = await withUploadBar(`${video.title} · new take`, (stage) => uploadTake({ projectId, videoId, file, onStage: stage }));
        toast(`Take ${added.number} is up. Open notes from earlier takes came along.`);
        navigate(`${base}?take=${added.number}`);
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
    });
  }

  return () => {
    closeTips();
    cancelAnimationFrame(r.frame);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    r.drawing?.stop();
    video2.pause();
    view.removeEventListener('click', onClick);
    view.removeEventListener('submit', onReply);
    sb.removeChannel(channel);
    videoEl.pause();
  };
}
