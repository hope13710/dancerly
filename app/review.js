import { sb, $, $$, esc, initials, fmt, fmtFine, timeAgo, toast, friendlyError, dialog, uploadTake, withUploadBar, loadMembers, TAKE_BUCKET } from './client.js';

const SPEEDS = [1, 0.75, 0.5, 0.25];

// The review screen: one video, its takes, and the team's notes on them.
export async function mountReview({ projectId, videoId, me, view, navigate, setCrumbs }) {
  const [{ data: project, error: pErr }, { data: video, error: vErr }, { data: takes, error: tErr }, members] = await Promise.all([
    sb.from('projects').select('id, title').eq('id', projectId).single(),
    sb.from('videos').select('id, title, created_by').eq('id', videoId).eq('project_id', projectId).single(),
    sb.from('takes').select('id, number, storage_path, created_at, uploaded_by').eq('video_id', videoId).order('number'),
    loadMembers(projectId)
  ]);
  if (pErr || vErr || tErr) throw pErr || vErr || tErr;
  setCrumbs([['Projects', '/app'], [project.title, `/app/p/${projectId}`], [video.title]]);
  const base = `/app/p/${projectId}/v/${videoId}`;
  const isOwner = members.some((m) => m.user_id === me.id && m.role === 'owner');
  const nameOf = (id) => members.find((m) => m.user_id === id)?.name || 'Former member';
  const roleOf = (id) => (members.find((m) => m.user_id === id)?.role === 'owner' ? 'Owner' : 'Member');

  if (!takes.length) {
    view.innerHTML = `<section class="page"><div class="empty"><div class="empty-icon">▶</div><h2>No takes yet</h2><p>Upload the first take of “${esc(video.title)}”.</p><button class="btn primary" data-upload>Upload Take 1</button></div></section><input type="file" accept="video/mp4,video/quicktime,video/webm" hidden data-file />`;
    wireUpload();
    return null;
  }

  const wanted = Number(new URLSearchParams(location.search).get('take'));
  const take = takes.find((t) => t.number === wanted) || takes[takes.length - 1];
  const takeNo = Object.fromEntries(takes.map((t) => [t.id, t.number]));
  const { data: signed, error: sErr } = await sb.storage.from(TAKE_BUCKET).createSignedUrl(take.storage_path, 60 * 60 * 3);
  if (sErr) throw sErr;

  const r = { notes: [], selected: null, loop: null, mode: 'point', rangeStart: null, rangeEnd: null, speed: 1, mirror: localStorage.getItem('looproom:mirror') === '1', frame: 0 };

  view.innerHTML = `<section class="review">
    <header class="review-head">
      <div><h1>${esc(video.title)}</h1><p class="muted">${esc(project.title)} · uploaded by ${esc(nameOf(take.uploaded_by))} · ${timeAgo(take.created_at)}</p></div>
      <div class="take-tabs" role="tablist" aria-label="Takes">${takes.map((t) => `<a role="tab" href="${base}?take=${t.number}" data-link aria-selected="${t.id === take.id}">Take ${t.number}</a>`).join('')}<button class="btn small" data-upload>+ New take</button></div>
    </header>
    <div class="review-layout">
      <div class="player-col">
        <div class="player ${r.mirror ? 'mirrored' : ''}" data-player>
          <video src="${esc(signed.signedUrl)}" playsinline preload="metadata" data-video></video>
          <span class="player-badge"><b class="mirror-badge">⇋ Mirrored</b><span data-time-overlay>00:00.0</span></span>
          <button class="big-play" data-play aria-label="Play or pause (Space)">▶</button>
        </div>
        <div class="timeline"><span data-cur>00:00</span><div class="track" data-track title="Click to jump"><span class="t-loop" data-tloop hidden></span><span class="t-draft" data-tdraft hidden></span><span class="t-fill" data-tfill></span><span data-markers></span><span class="t-head" data-thead></span></div><span data-dur>--:--</span></div>
        <div class="controls"><button data-play aria-label="Play or pause (Space)">▶</button><button data-speed title="Playback speed">1×</button><span class="loop-chip" data-loopchip></span><span class="spacer"></span><button class="toggle-btn" data-mirror aria-pressed="${r.mirror}" title="Mirror mode (M)">⇋ Mirror</button></div>
      </div>
      <aside class="notes-col">
        <div class="take-summary" data-summary></div>
        <div class="note-list" data-list></div>
        <form class="composer" data-composer>
          <div class="seg dark" role="tablist"><button type="button" role="tab" data-mode="point">▸ At <span data-at>00:00.0</span></button><button type="button" role="tab" data-mode="range">⟷ Range</button></div>
          <div class="range-row" data-range hidden><button type="button" data-mark="start">Start <b data-rs>—</b></button><span>→</span><button type="button" data-mark="end">End <b data-re>—</b></button><small>or press [ and ]</small></div>
          <div class="composer-field"><textarea data-input rows="2" maxlength="2000" placeholder="What should change at this moment? Type @ to mention someone"></textarea><div class="mention-menu" data-mentions role="listbox" hidden></div></div>
          <div class="composer-foot"><small>No label needed — AI sorts notes in recaps.</small><button class="btn primary small" type="submit">Pin note ↵</button></div>
        </form>
      </aside>
    </div>
  </section>
  <input type="file" accept="video/mp4,video/quicktime,video/webm" hidden data-file />`;

  const videoEl = $('[data-video]');
  const duration = () => (Number.isFinite(videoEl.duration) ? videoEl.duration : 0);
  const pct = (sec) => `${duration() ? (sec / duration()) * 100 : 0}%`;

  // ---------- Notes ----------
  async function loadNotes() {
    const { data, error } = await sb.from('notes')
      .select('id, take_id, t_start, t_end, body, status, author_id, created_at, resolved_at, note_reactions(user_id)')
      .eq('video_id', videoId).order('t_start');
    if (error) return toast(friendlyError(error), 'error');
    r.notes = data.map((n) => ({ ...n, t_start: Number(n.t_start), t_end: n.t_end === null ? null : Number(n.t_end) }));
    paintNotes();
  }
  // On this take you see its own notes plus anything from earlier takes that isn't fixed yet.
  const visibleNotes = () => r.notes.filter((n) => takeNo[n.take_id] <= take.number && (n.take_id === take.id || n.status !== 'resolved'));
  const noteTime = (n) => (n.t_end === null ? fmt(n.t_start) : `${fmt(n.t_start)}–${fmt(n.t_end)}`);
  const withMentions = (text) => members.reduce((html, m) => html.split(`@${esc(m.name)}`).join(`<span class="mention">@${esc(m.name)}</span>`), esc(text));
  const canResolve = (n) => n.author_id === me.id || isOwner;

  function paintNotes() {
    const notes = visibleNotes();
    const list = $('[data-list]');
    if (!list) return;
    list.innerHTML = notes.length ? notes.map((n) => {
      const agrees = n.note_reactions.length;
      const iAgree = n.note_reactions.some((x) => x.user_id === me.id);
      const looping = r.loop?.id === n.id;
      const from = n.take_id !== take.id ? `<span class="from">from Take ${takeNo[n.take_id]}</span>` : '';
      const statusBtn = n.status === 'resolved'
        ? (canResolve(n) ? `<button class="mini" data-status="open" data-id="${n.id}">Reopen</button>` : '')
        : `${n.status === 'open' ? `<button class="mini" data-status="practicing" data-id="${n.id}">I’m on it</button>` : ''}${canResolve(n) ? `<button class="mini ok" data-status="resolved" data-id="${n.id}">Resolve ✓</button>` : ''}`;
      return `<article class="note ${r.selected === n.id ? 'selected' : ''} ${looping ? 'looping' : ''}" data-note="${n.id}">
        <div class="note-top"><button class="time-chip" data-seek="${n.id}">${n.t_end === null ? '▸' : '⟷'} ${noteTime(n)}</button>${from}<span class="status s-${n.status}">${n.status === 'practicing' ? 'Practicing' : n.status === 'resolved' ? 'Resolved' : 'Open'}</span></div>
        <p>${withMentions(n.body)}</p>
        <div class="note-foot"><span class="who"><span class="avatar xs">${esc(initials(nameOf(n.author_id)))}</span>${esc(nameOf(n.author_id))} <i class="role r-${roleOf(n.author_id).toLowerCase()}">${roleOf(n.author_id)}</i> · ${timeAgo(n.created_at)}</span></div>
        <div class="note-actions">
          <button class="mini ${looping ? 'on' : ''}" data-loop="${n.id}" aria-pressed="${looping}">↻ ${looping ? 'Looping' : n.t_end === null ? 'Loop ±2s' : 'Loop this part'}</button>
          ${n.author_id !== me.id ? `<button class="mini ${iAgree ? 'on' : ''}" data-agree="${n.id}" aria-pressed="${iAgree}">👍 ${agrees || ''}</button>` : agrees ? `<span class="agrees">👍 ${agrees}</span>` : ''}
          ${statusBtn}
          ${canResolve(n) ? `<button class="mini ghost" data-delete="${n.id}" aria-label="Delete note">🗑</button>` : ''}
        </div>
      </article>`;
    }).join('') : '<p class="notes-empty">No notes on this take yet. Pause on a moment and write what should change.</p>';
    paintMarkers(notes);
    paintSummary();
  }

  function paintSummary() {
    const earlierResolved = r.notes.filter((n) => takeNo[n.take_id] < take.number && n.status === 'resolved').length;
    const open = visibleNotes().filter((n) => n.status !== 'resolved').length;
    $('[data-summary]').innerHTML = take.number === 1
      ? `<b>Take 1</b> · <span class="open">${open} open</span>`
      : `<b>Take ${take.number}</b> · <span class="ok">✓ ${earlierResolved} resolved from earlier takes</span> · <span class="open">${open} still open</span>`;
  }

  function paintMarkers(notes) {
    if (!duration()) return;
    $('[data-markers]').innerHTML = notes.map((n) => n.t_end === null
      ? `<button class="t-pin ${r.selected === n.id ? 'on' : ''}" style="left:${pct(n.t_start)}" data-seek="${n.id}" aria-label="Note at ${noteTime(n)}"></button>`
      : `<button class="t-range ${r.selected === n.id ? 'on' : ''}" style="left:${pct(n.t_start)};width:${pct(n.t_end - n.t_start)}" data-seek="${n.id}" aria-label="Note from ${noteTime(n)}"></button>`).join('');
  }

  // ---------- Player ----------
  const play = (on) => { if (on) videoEl.play().catch(() => {}); else videoEl.pause(); };
  const seek = (sec, { start = false } = {}) => { videoEl.currentTime = Math.max(0, Math.min(sec, duration() || sec)); if (start) play(true); paintPlayer(); };
  function setLoop(note) {
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
    const t = videoEl.currentTime || 0;
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
    loopBar.hidden = !r.loop;
    if (r.loop) { loopBar.style.left = pct(r.loop.start); loopBar.style.width = pct(r.loop.end - r.loop.start); }
    $('[data-loopchip]').innerHTML = r.loop ? `↻ Looping ${fmt(r.loop.start)}–${fmt(r.loop.end)} <button type="button" data-clearloop aria-label="Stop looping">✕</button>` : '';
    const draft = $('[data-tdraft]');
    const showDraft = r.mode === 'range' && r.rangeStart !== null;
    draft.hidden = !showDraft;
    if (showDraft) { const end = r.rangeEnd ?? t; draft.style.left = pct(Math.min(r.rangeStart, end)); draft.style.width = pct(Math.abs(end - r.rangeStart)); }
    $('[data-rs]').textContent = r.rangeStart === null ? '—' : fmt(r.rangeStart);
    $('[data-re]').textContent = r.rangeEnd === null ? '—' : fmt(r.rangeEnd);
  }
  function tick() {
    if (r.loop && !videoEl.paused && videoEl.currentTime >= r.loop.end) videoEl.currentTime = r.loop.start;
    paintPlayer();
    r.frame = requestAnimationFrame(tick);
  }
  videoEl.addEventListener('loadedmetadata', () => { $('[data-dur]').textContent = fmt(duration()); paintNotes(); paintPlayer(); });
  videoEl.addEventListener('error', () => toast('This take couldn’t be played in this browser. Try MP4 (H.264).', 'error'));
  $$('[data-play]').forEach((b) => b.addEventListener('click', () => play(videoEl.paused)));
  $('[data-speed]').addEventListener('click', () => { r.speed = SPEEDS[(SPEEDS.indexOf(r.speed) + 1) % SPEEDS.length]; videoEl.playbackRate = r.speed; paintPlayer(); });
  const toggleMirror = () => { r.mirror = !r.mirror; localStorage.setItem('looproom:mirror', r.mirror ? '1' : '0'); paintPlayer(); };
  $('[data-mirror]').addEventListener('click', toggleMirror);
  $('[data-loopchip]').addEventListener('click', (e) => { if (e.target.closest('[data-clearloop]')) setLoop(null); });
  $('[data-track]').addEventListener('click', (e) => {
    if (e.target.closest('[data-seek]')) return;
    const box = $('[data-track]').getBoundingClientRect();
    seek(((e.clientX - box.left) / box.width) * duration());
  });

  // ---------- Note actions (one delegated listener) ----------
  async function onClick(e) {
    const el = e.target.closest('[data-seek],[data-loop],[data-agree],[data-status],[data-delete],[data-note]');
    if (!el || !view.contains(el)) return;
    const id = el.dataset.seek || el.dataset.loop || el.dataset.agree || el.dataset.id || el.dataset.delete || el.dataset.note;
    const note = r.notes.find((n) => n.id === id);
    if (!note) return;
    if (el.dataset.seek) { r.selected = id; seek(note.t_end === null ? Math.max(0, note.t_start - 1) : note.t_start, { start: true }); paintNotes(); return; }
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

  // ---------- Composer: a moment or a range, @mentions, no labels ----------
  const input = $('[data-input]');
  function setMode(mode) {
    r.mode = mode;
    if (mode === 'range' && r.rangeStart === null) { r.rangeStart = videoEl.currentTime || 0; r.rangeEnd = null; }
    if (mode === 'point') { r.rangeStart = null; r.rangeEnd = null; }
    $$('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    $('[data-range]').hidden = mode !== 'range';
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
    const options = m ? members.filter((x) => x.user_id !== me.id && x.name.toLowerCase().startsWith(m[1].toLowerCase())) : [];
    menu.hidden = !options.length;
    menu.innerHTML = `<span class="menu-label">People on ${esc(project.title)}</span>${options.map((x, i) => `<button type="button" role="option" class="${i === 0 ? 'active' : ''}" data-pick="${esc(x.name)}"><span class="avatar xs">${esc(initials(x.name))}</span>${esc(x.name)}<small>${x.role === 'owner' ? 'Owner' : 'Member'}</small></button>`).join('')}`;
    $$('[data-pick]', menu).forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(b.dataset.pick); }));
  }
  function pick(name) {
    const m = mentionMatch();
    if (!m) return;
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
    if (!menu.hidden && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick($('[data-pick].active', menu).dataset.pick); return; }
    if (e.key === 'Escape') { if (!menu.hidden) menu.hidden = true; else input.blur(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pin(); }
  });
  $('[data-composer]').addEventListener('submit', (e) => { e.preventDefault(); pin(); });

  let pinning = false;
  async function pin() {
    const body = input.value.trim();
    if (!body || pinning) return input.focus();
    let start = videoEl.currentTime || 0;
    let end = null;
    if (r.mode === 'range') {
      if (r.rangeStart === null || r.rangeEnd === null) return toast('Mark where the range ends — press ] or tap End.');
      start = r.rangeStart;
      end = r.rangeEnd;
    }
    pinning = true;
    const { data: note, error } = await sb.from('notes').insert({ take_id: take.id, t_start: start.toFixed(2), t_end: end === null ? null : end.toFixed(2), body }).select('id').single();
    pinning = false;
    if (error) return toast(friendlyError(error), 'error');
    const mentioned = members.filter((m) => m.user_id !== me.id && body.includes(`@${m.name}`));
    if (mentioned.length) await sb.from('note_mentions').insert(mentioned.map((m) => ({ note_id: note.id, user_id: m.user_id })));
    input.value = '';
    input.blur();
    setMode('point');
    paintMentions();
    r.selected = note.id;
    await loadNotes();
    toast(`Note pinned at ${end === null ? fmt(start) : `${fmt(start)}–${fmt(end)}`}.${mentioned.length ? ` ${mentioned.map((m) => m.name.split(' ')[0]).join(' and ')} will see it in their feedback.` : ''}`);
  }

  // ---------- Keyboard ----------
  function onKey(e) {
    if (e.target.closest('input, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    const notes = visibleNotes();
    const step = (dir) => {
      const i = notes.findIndex((n) => n.id === r.selected);
      const n = notes[Math.max(0, Math.min(notes.length - 1, i + dir))];
      if (n) { r.selected = n.id; seek(n.t_start); paintNotes(); }
    };
    const actions = {
      ' ': () => play(videoEl.paused), k: () => play(false), j: () => seek(videoEl.currentTime - 5), l: () => seek(videoEl.currentTime + 5),
      arrowleft: () => seek(videoEl.currentTime - 5), arrowright: () => seek(videoEl.currentTime + 5),
      m: toggleMirror, n: () => { setMode('point'); input.focus(); }, '[': () => mark('start'), ']': () => { mark('end'); if (r.rangeEnd !== null) input.focus(); },
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
    .subscribe();

  wireUpload();
  setMode('point');
  await loadNotes();
  r.frame = requestAnimationFrame(tick);

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
    cancelAnimationFrame(r.frame);
    document.removeEventListener('keydown', onKey);
    view.removeEventListener('click', onClick);
    sb.removeChannel(channel);
    videoEl.pause();
  };
}
