const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  view: 'home',
  reviewFilter: 'all',
  selectedNote: 'timing',
  // Notes are plain text: no label to pick while reviewing. AI labels them later, in reports and the dashboard.
  // `end` is null for a single moment, or a second mark for a range.
  notes: [
    { id: 'timing', start: 16, end: 20, body: '@Maya Chen we split on “5-and-6” — let’s hit the shoulder together.', author: 'Jordan Smith', status: 'Open' },
    { id: 'pathway', start: 42, end: 48, body: 'Keep the arm pathway wider through this transition. @Sora Kim can you check her arms in Thursday’s class too?', author: 'Alex Lee', status: 'Practicing' },
    { id: 'energy', start: 63, end: null, body: 'Back row is late into the final shape. Let’s all watch Riko’s count here.', author: 'Maya Chen', status: 'Resolved' }
  ],
  inboxUnread: 3,
  mirror: false
};

const reviewData = [
  { title: 'Week 04 — Chorus timing', group: 'Commercial Team', due: 'Due Friday', submitted: '12 / 16 submitted', reviewed: '8 reviewed', progress: 50, status: 'Needs review', statusClass: 'status-review', symbol: '◫' },
  { title: 'Showcase formation', group: 'Performance Lab', due: 'Due next Tuesday', submitted: '10 / 10 submitted', reviewed: '10 reviewed', progress: 100, status: 'Ready to close', statusClass: 'status-ready', symbol: '⌁' },
  { title: 'Freestyle foundations', group: 'Open Training', due: 'Due in 6 days', submitted: '6 / 12 submitted', reviewed: '3 reviewed', progress: 25, status: 'New activity', statusClass: 'status-new', symbol: '✦' },
  { title: 'Audition cut — v1', group: 'Solo coaching', due: 'No due date', submitted: '4 / 5 submitted', reviewed: '4 reviewed', progress: 80, status: 'Ready to close', statusClass: 'status-ready', symbol: '◒' }
];

const activities = [
  ['↗', 'Maya Chen submitted Version 2', 'Week 04 — Chorus timing · 12 min ago'],
  ['◌', 'Jordan Smith replied to your note', 'Showcase formation · 42 min ago'],
  ['✓', 'You resolved a note', 'Maya Chen · 1 hour ago'],
  ['+', 'You created a new review', 'Freestyle foundations · Yesterday']
];

const viewLabels = { home: 'Home', reviews: 'Reviews', groups: 'Groups', inbox: 'Inbox', progress: 'Progress', settings: 'Settings', reviewDetail: 'Reviews' };
const toast = $('[data-toast]');
let toastTimer;
function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3200); }

function shell(title, eyebrow, description, action = '') {
  return `<div class="page-heading"><div><span class="eyebrow-app">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

function renderHome() {
  return `${shell('Good morning, Alex', 'MONDAY, OCTOBER 26', 'Here’s what needs your attention today.', '<button class="primary-action" data-action="create-review">+&nbsp; Create review</button>')}
    <div class="stats-grid"><div class="stat-card"><span class="stat-label">Active reviews</span><div class="stat-value">4</div><div class="stat-foot"><span class="up">↗ 1</span> from last week</div></div><div class="stat-card"><span class="stat-label">To review</span><div class="stat-value">8</div><div class="stat-foot"><span class="up">3 new</span> submissions</div></div><div class="stat-card"><span class="stat-label">Reviewed this week</span><div class="stat-value">72%</div><div class="stat-foot"><span class="up">↗ 12%</span> vs last week</div></div><div class="stat-card"><span class="stat-label">Open notes</span><div class="stat-value">14</div><div class="stat-foot">Across 3 groups</div></div></div>
    <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Needs your attention</h2><p>Submissions waiting for a review</p></div><button class="panel-link" data-view-button="reviews">View all →</button></div>${reviewData.slice(0,3).map((review) => `<div class="review-row"><span class="review-symbol">${review.symbol}</span><div class="review-row-copy"><b>${review.title}</b><small>${review.group} · ${review.submitted}</small></div><span class="status-pill ${review.statusClass}">${review.status}</span><button class="row-arrow" data-action="open-review">→</button></div>`).join('')}</section><section class="panel"><div class="panel-head"><div><h2>Recent activity</h2><p>Your workspace, in motion</p></div><button class="panel-link" data-view-button="inbox">See inbox →</button></div><div class="activity-list">${activities.slice(0,4).map(([icon, title, meta]) => `<div class="activity-item"><span class="activity-icon">${icon}</span><div class="activity-copy"><b>${title}</b><p>${meta.split(' · ')[0]}</p><time>${meta.split(' · ')[1]}</time></div></div>`).join('')}</div></section></div>`;
}

function renderReviews() {
  const filtered = state.reviewFilter === 'all' ? reviewData : reviewData.filter((r) => state.reviewFilter === 'needs' ? r.status === 'Needs review' : r.status === 'Ready to close');
  return `${shell('Reviews', 'YOUR WORKSPACE', 'Keep every take, note, and next version connected.', '<button class="primary-action" data-action="create-review">+&nbsp; Create review</button>')}
    <section class="review-table"><div class="review-filters"><div class="filter-tabs"><button class="filter-tab ${state.reviewFilter === 'all' ? 'active' : ''}" data-filter="all">All <span>4</span></button><button class="filter-tab ${state.reviewFilter === 'needs' ? 'active' : ''}" data-filter="needs">Needs review <span>1</span></button><button class="filter-tab ${state.reviewFilter === 'ready' ? 'active' : ''}" data-filter="ready">Ready to close <span>2</span></button></div><button class="secondary-action" data-toast-action="Review filters are coming next.">Filter ⌄</button></div><div class="review-table-head"><span>REVIEW</span><span>SUBMISSIONS</span><span>PROGRESS</span><span>STATUS</span><span></span></div>${filtered.map((review) => `<div class="review-table-row"><div class="review-name"><span class="review-name-icon">${review.symbol}</span><span><b>${review.title}</b><small>${review.group} · ${review.due}</small></span></div><span class="table-muted">${review.submitted}</span><span><div class="progress-mini"><span style="width:${review.progress}%"></span></div><small class="table-muted">${review.reviewed}</small></span><span class="status-pill ${review.statusClass}">${review.status}</span><button class="row-arrow" data-action="open-review">→</button></div>`).join('')}</section>`;
}

// ---------- Video review ----------
// People invited to this project: the only ones you can @mention in a note.
// Two roles only: the project owner (who created it) and members. Everyone can write notes.
const projectMembers = [
  { name: 'Riko Kato', role: 'Owner', initials: 'RK' },
  { name: 'Maya Chen', role: 'Member', initials: 'MC' },
  { name: 'Jordan Smith', role: 'Member', initials: 'JS' },
  { name: 'Sam Lee', role: 'Member', initials: 'SL' },
  { name: 'Sora Kim', role: 'Member', initials: 'SK' }
];
const roleOf = (name) => projectMembers.find((m) => m.name === name)?.role || 'Member';
const review = { t: 18, duration: 72, playing: false, speed: 1, loop: null, videoUrl: null, mode: 'point', rangeStart: null, rangeEnd: null, frame: 0, last: 0 };
const speeds = [1, 0.75, 0.5, 0.25];
const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const fmtFine = (sec) => `${fmt(sec)}.${Math.floor((sec % 1) * 10)}`;
const noteTime = (note) => note.end === null ? fmt(note.start) : `${fmt(note.start)}–${fmt(note.end)}`;
const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const withMentions = (text) => projectMembers.reduce((html, m) => html.split(`@${m.name}`).join(`<span class="mention">@${m.name}</span>`), escapeHtml(text));
const pct = (sec) => `${(sec / review.duration) * 100}%`;
// A single moment loops two seconds either side; a range loops exactly.
const loopRangeFor = (note) => note.end === null ? { start: Math.max(0, note.start - 2), end: Math.min(review.duration, note.start + 2) } : { start: note.start, end: note.end };

function noteCard(note) {
  const looping = review.loop?.noteId === note.id;
  return `<div class="detail-note ${state.selectedNote === note.id ? 'selected' : ''} ${looping ? 'looping' : ''}" data-note-id="${note.id}" tabindex="0">
    <div class="note-line"><button class="note-time" data-seek-note="${note.id}" title="Jump to ${noteTime(note)}">${note.end === null ? '▸' : '⟷'} ${noteTime(note)}</button><span class="note-state state-${note.status.toLowerCase()}">${note.status}</span></div>
    <p>${withMentions(note.body)}</p>
    <div class="note-foot"><small>${note.author} <span class="role-tag role-${roleOf(note.author).toLowerCase()}">${roleOf(note.author)}</span></small><button class="note-loop ${looping ? 'on' : ''}" data-loop-note="${note.id}" aria-pressed="${looping}">↻ ${looping ? 'Looping' : note.end === null ? 'Loop ±2s' : 'Loop this part'}</button></div>
  </div>`;
}

function renderReviewDetail() {
  return `<div class="review-detail-top"><button class="back-button" data-view-button="reviews">← Back to reviews</button><div><h1 class="review-detail-title">Showcase 2026 — Full run-through</h1><div class="review-detail-meta">Commercial Team · Take 3 · uploaded by Riko · 12 min ago · 5 members can add notes</div></div></div>
    <div class="review-player-layout"><div class="player-column">
      <div class="player-video" data-player-video>${review.videoUrl ? `<video src="${review.videoUrl}" playsinline data-video></video>` : '<div class="demo-dancer"><span class="head"></span><span class="body"></span><span class="arm arm-one"></span><span class="arm arm-two"></span><span class="leg leg-one"></span><span class="leg leg-two"></span></div>'}<span class="player-overlay-label"><b class="mirror-badge">⇋ Mirrored</b><span data-time-overlay></span></span><button class="pause-control" data-action="play" aria-label="Play or pause (Space)"></button></div>
      <div class="player-timeline"><span>00:00</span><div class="timeline-line" data-timeline title="Click to jump"><span class="timeline-loop" data-timeline-loop></span><span class="timeline-draft" data-timeline-draft></span><span class="timeline-progress" data-progress></span><span data-markers></span><span class="timeline-head" data-head></span></div><span data-duration>${fmt(review.duration)}</span></div>
      <div class="player-toolbar"><button data-action="play" aria-label="Play or pause (Space)"></button><button data-action="speed" title="Playback speed"></button><span class="loop-chip" data-loop-chip></span><span class="toolbar-spacer"></span><strong data-time></strong><button class="mirror-button" data-action="mirror" title="Mirror mode (M)">⇋ Mirror</button><button data-action="upload-video">Upload version</button></div>
    </div>
    <aside class="detail-notes"><div class="detail-notes-head"><div><span class="panel-kicker">VIDEO REVIEW</span><h3>Notes <small data-note-count></small></h3></div><button class="more-button" data-toast-action="More review actions are coming next.">•••</button></div>
      <div class="detail-note-list" data-note-list></div>
      <form class="composer" data-composer>
        <div class="composer-mode" role="tablist"><button type="button" data-mode="point" role="tab">▸ At <span data-composer-point></span></button><button type="button" data-mode="range" role="tab">⟷ Range</button></div>
        <div class="composer-range" data-composer-range><button type="button" data-set="start">Start <b data-range-start></b></button><span>→</span><button type="button" data-set="end">End <b data-range-end></b></button><small>or press [ and ]</small></div>
        <div class="composer-field"><textarea data-composer-input rows="2" placeholder="Write a note for the team… type @ to mention someone"></textarea><div class="mention-menu" data-mention-menu role="listbox" hidden></div></div>
        <div class="composer-foot"><small>No label needed — AI sorts notes in your reports.</small><button type="submit" class="composer-submit">Pin note ↵</button></div>
      </form>
      <div class="detail-footer"><span>Version 2 of 2</span><button data-action="mark-resolved">Resolve selected ✓</button></div>
    </aside></div>`;
}

function mediaEl() { return $('[data-video]'); }
function seek(sec, { play = false } = {}) {
  review.t = Math.min(Math.max(0, sec), review.duration);
  if (mediaEl()) mediaEl().currentTime = review.t;
  if (play) setPlaying(true);
  paintPlayer();
}
function setPlaying(playing) {
  review.playing = playing;
  const video = mediaEl();
  if (video) { video.playbackRate = review.speed; playing ? video.play().catch(() => {}) : video.pause(); }
  paintPlayer();
}
function setLoop(note) {
  if (!note || review.loop?.noteId === note.id) { review.loop = null; } else { review.loop = { ...loopRangeFor(note), noteId: note.id }; state.selectedNote = note.id; seek(review.loop.start, { play: true }); }
  paintNotes();
  paintPlayer();
}

function tickReview(now) {
  if (state.view !== 'reviewDetail') { review.frame = 0; return; }
  const dt = review.last ? (now - review.last) / 1000 : 0;
  review.last = now;
  const video = mediaEl();
  if (video) { review.t = video.currentTime || 0; if (video.duration) review.duration = video.duration; }
  else if (review.playing) review.t += dt * review.speed;
  if (review.loop && review.playing && review.t >= review.loop.end) seek(review.loop.start);
  if (review.t >= review.duration) { review.t = review.duration; if (!video) setPlaying(false); }
  paintPlayer();
  review.frame = requestAnimationFrame(tickReview);
}

function paintPlayer() {
  const root = $('.review-player-layout');
  if (!root) return;
  $('[data-player-video]').classList.toggle('playing', review.playing);
  $('[data-player-video]').classList.toggle('mirrored', state.mirror);
  $$('[data-action="play"]').forEach((b) => { b.textContent = review.playing ? 'Ⅱ' : '▶'; });
  $('[data-action="speed"]').textContent = `${review.speed}×`;
  $('[data-action="mirror"]').classList.toggle('on', state.mirror);
  $('[data-action="mirror"]').setAttribute('aria-pressed', String(state.mirror));
  $('[data-time]').textContent = fmtFine(review.t);
  $('[data-time-overlay]').textContent = fmtFine(review.t);
  $('[data-duration]').textContent = fmt(review.duration);
  $('[data-progress]').style.width = pct(review.t);
  $('[data-head]').style.left = pct(review.t);
  const loopBar = $('[data-timeline-loop]');
  loopBar.hidden = !review.loop;
  if (review.loop) { loopBar.style.left = pct(review.loop.start); loopBar.style.width = pct(review.loop.end - review.loop.start); }
  $('[data-loop-chip]').innerHTML = review.loop ? `↻ Looping ${fmt(review.loop.start)}–${fmt(review.loop.end)} <button type="button" data-action="clear-loop" aria-label="Stop looping">✕</button>` : '';
  const draft = $('[data-timeline-draft]');
  const showDraft = review.mode === 'range' && review.rangeStart !== null;
  draft.hidden = !showDraft;
  if (showDraft) { const end = review.rangeEnd ?? review.t; draft.style.left = pct(Math.min(review.rangeStart, end)); draft.style.width = pct(Math.abs(end - review.rangeStart)); }
  $('[data-composer-point]').textContent = fmtFine(review.t);
  $('[data-range-start]').textContent = review.rangeStart === null ? '—' : fmt(review.rangeStart);
  $('[data-range-end]').textContent = review.rangeEnd === null ? '—' : fmt(review.rangeEnd);
}

function paintNotes() {
  const list = $('[data-note-list]');
  if (!list) return;
  const notes = [...state.notes].sort((x, y) => x.start - y.start);
  list.innerHTML = notes.length ? notes.map(noteCard).join('') : '<p class="notes-empty">No notes yet. Pause on a moment and write a correction below.</p>';
  $('[data-note-count]').textContent = state.notes.length;
  $('[data-markers]').innerHTML = notes.map((n) => n.end === null
    ? `<button class="timeline-pin ${state.selectedNote === n.id ? 'active' : ''}" style="left:${pct(n.start)}" data-seek-note="${n.id}" aria-label="Note at ${noteTime(n)}"></button>`
    : `<button class="timeline-range ${state.selectedNote === n.id ? 'active' : ''}" style="left:${pct(n.start)};width:${pct(n.end - n.start)}" data-seek-note="${n.id}" aria-label="Note from ${noteTime(n)}"></button>`).join('');
  $$('[data-seek-note]').forEach((el) => el.addEventListener('click', (event) => {
    event.stopPropagation();
    const note = state.notes.find((n) => n.id === el.dataset.seekNote);
    state.selectedNote = note.id;
    // A moment starts a second early so you see the lead-in; a range starts at its first mark.
    seek(note.end === null ? Math.max(0, note.start - 1) : note.start, { play: true });
    paintNotes();
  }));
  $$('[data-loop-note]').forEach((el) => el.addEventListener('click', (event) => { event.stopPropagation(); setLoop(state.notes.find((n) => n.id === el.dataset.loopNote)); }));
  $$('[data-note-id]').forEach((el) => el.addEventListener('click', () => { state.selectedNote = el.dataset.noteId; paintNotes(); }));
}

function setComposerMode(mode) {
  review.mode = mode;
  if (mode === 'range' && review.rangeStart === null) { review.rangeStart = review.t; review.rangeEnd = null; }
  if (mode === 'point') { review.rangeStart = null; review.rangeEnd = null; }
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  $('[data-composer-range]').hidden = mode !== 'range';
  paintPlayer();
}
function markRange(which) {
  if (review.mode !== 'range') setComposerMode('range');
  if (which === 'start') { review.rangeStart = review.t; if (review.rangeEnd !== null && review.rangeEnd <= review.t) review.rangeEnd = null; }
  else { if (review.rangeStart === null || review.t <= review.rangeStart) { showToast('Set the end after the start.'); return; } review.rangeEnd = review.t; }
  paintPlayer();
}

// @mention autocomplete: the word after the last "@" before the caret filters project members.
function mentionQuery(input) {
  const before = input.value.slice(0, input.selectionStart);
  const match = before.match(/@([\w ]{0,20})$/);
  return match && !match[1].includes('  ') ? match : null;
}
function paintMentionMenu() {
  const input = $('[data-composer-input]');
  const menu = $('[data-mention-menu]');
  const match = mentionQuery(input);
  const options = match ? projectMembers.filter((m) => m.name.toLowerCase().startsWith(match[1].toLowerCase().trimStart())) : [];
  menu.hidden = !options.length;
  menu.innerHTML = `<span class="mention-scope">People on Showcase 2026</span>${options.map((m, i) => `<button type="button" role="option" class="${i === 0 ? 'active' : ''}" data-mention="${m.name}"><span class="mention-avatar">${m.initials}</span>${m.name}<small>${m.role}</small></button>`).join('')}`;
  $$('[data-mention]', menu).forEach((b) => b.addEventListener('mousedown', (event) => { event.preventDefault(); insertMention(b.dataset.mention); }));
}
function insertMention(name) {
  const input = $('[data-composer-input]');
  const match = mentionQuery(input);
  if (!match) return;
  const caret = input.selectionStart;
  const start = caret - match[0].length;
  input.value = `${input.value.slice(0, start)}@${name} ${input.value.slice(caret)}`;
  input.selectionStart = input.selectionEnd = start + name.length + 2;
  input.focus();
  paintMentionMenu();
}

function pinNote() {
  const input = $('[data-composer-input]');
  const body = input.value.trim();
  if (!body) { input.focus(); return; }
  let start = review.t;
  let end = null;
  if (review.mode === 'range') {
    if (review.rangeStart === null || review.rangeEnd === null) { showToast('Mark where the range ends — press ] or tap End.'); return; }
    start = review.rangeStart;
    end = review.rangeEnd;
  }
  const note = { id: `note-${Date.now()}`, start, end, body, author: 'Alex Lee', status: 'Open' };
  state.notes.push(note);
  state.selectedNote = note.id;
  input.value = '';
  // Leave the text box so review shortcuts (Space, M, R…) work right away.
  input.blur();
  setComposerMode('point');
  paintMentionMenu();
  paintNotes();
  const mentioned = projectMembers.filter((m) => body.includes(`@${m.name}`)).map((m) => m.name.split(' ')[0]);
  showToast(`Note pinned at ${noteTime(note)}.${mentioned.length ? ` ${mentioned.join(' and ')} will be notified.` : ''}`);
}

function mountReview() {
  paintNotes();
  setComposerMode('point');
  const timeline = $('[data-timeline]');
  timeline.addEventListener('click', (event) => {
    const box = timeline.getBoundingClientRect();
    seek(((event.clientX - box.left) / box.width) * review.duration);
  });
  $$('[data-action="play"]').forEach((b) => b.addEventListener('click', () => setPlaying(!review.playing)));
  $('[data-action="speed"]').addEventListener('click', () => { review.speed = speeds[(speeds.indexOf(review.speed) + 1) % speeds.length]; if (mediaEl()) mediaEl().playbackRate = review.speed; paintPlayer(); });
  $('[data-loop-chip]').addEventListener('click', (event) => { if (event.target.closest('[data-action="clear-loop"]')) setLoop(null); });
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => setComposerMode(b.dataset.mode)));
  $$('[data-set]').forEach((b) => b.addEventListener('click', () => markRange(b.dataset.set)));
  const input = $('[data-composer-input]');
  // Writing a note pauses the video so the moment doesn't slip away.
  input.addEventListener('focus', () => setPlaying(false));
  input.addEventListener('input', paintMentionMenu);
  input.addEventListener('keydown', (event) => {
    const menu = $('[data-mention-menu]');
    if (!menu.hidden && (event.key === 'Enter' || event.key === 'Tab')) { event.preventDefault(); insertMention($('[data-mention].active', menu).dataset.mention); return; }
    if (event.key === 'Escape') { if (!menu.hidden) menu.hidden = true; else input.blur(); return; }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); pinNote(); }
  });
  $('[data-composer]').addEventListener('submit', (event) => { event.preventDefault(); pinNote(); });
  if (mediaEl()) mediaEl().addEventListener('loadedmetadata', () => { review.duration = mediaEl().duration; seek(0); paintNotes(); });
  review.last = 0;
  if (!review.frame) review.frame = requestAnimationFrame(tickReview);
  paintPlayer();
}

function renderGroups() {
  const groups = [['CT', 'Commercial Team', '16 dancers · 3 coaches', 'Active review this week'], ['PL', 'Performance Lab', '10 dancers · 2 coaches', 'Showcase formation'], ['OT', 'Open Training', '12 dancers · 1 coach', 'Freestyle foundations']];
  return `${shell('Groups', 'YOUR PEOPLE', 'Invite dancers, keep the room focused, and coach together.', '<button class="primary-action" data-action="invite">+&nbsp; Invite dancers</button>')}<div class="groups-grid">${groups.map(([initials, name, meta, review]) => `<article class="group-card"><div class="group-card-head"><span class="group-initials">${initials}</span><button class="more-button" data-toast-action="Group actions are coming next.">•••</button></div><h3>${name}</h3><p>${meta}</p><div class="group-members"><span class="member-dot">MC</span><span class="member-dot">JS</span><span class="member-dot">RK</span><span class="member-count">+ ${name === 'Commercial Team' ? '13' : name === 'Performance Lab' ? '7' : '9'} more</span></div><div class="group-card-footer"><span>${review}</span><button data-action="open-review">Open →</button></div></article>`).join('')}</div>`;
}

function renderInbox() {
  const inbox = [['◫', 'Maya Chen submitted Version 2', 'Week 04 — Chorus timing is ready for your review.', '12 min ago', true], ['↩', 'Jordan Smith replied to your note', '“Got it — I’ll try the wider pathway on the next take.”', '42 min ago', true], ['✓', 'You resolved a note', 'Maya Chen · 00:42–00:48 · Pathway', '1 hour ago', false], ['+', 'New review created', 'Freestyle foundations · Open Training', 'Yesterday', false]];
  return `${shell('Inbox', 'STAY IN THE LOOP', 'The moments that need a response, all in one place.', '<button class="secondary-action" data-action="mark-read">Mark all as read</button>')}<section class="inbox-list">${inbox.map(([icon, title, body, time, unread], index) => `<button class="inbox-item ${unread && state.inboxUnread > index ? 'unread' : ''}" data-action="open-review"><span class="inbox-icon">${icon}</span><span class="inbox-copy"><b>${title}</b><p>${body}</p><time>${time}</time></span>${unread && state.inboxUnread > index ? '<span class="unread-dot"></span>' : ''}</button>`).join('')}</section>`;
}

function renderProgress() {
  const values = [35, 48, 42, 67, 54, 76, 45, 84];
  return `${shell('Progress', 'YOUR PRACTICE LOOP', 'Activity over time, without reducing people to a score.', '<button class="secondary-action" data-toast-action="Date range selector is coming next.">Last 30 days ⌄</button>')}<div class="stats-grid"><div class="stat-card"><span class="stat-label">Videos submitted</span><div class="stat-value">42</div><div class="stat-foot"><span class="up">↗ 18%</span> vs last period</div></div><div class="stat-card"><span class="stat-label">Notes resolved</span><div class="stat-value">28</div><div class="stat-foot"><span class="up">↗ 6</span> this month</div></div><div class="stat-card"><span class="stat-label">Review loop</span><div class="stat-value">68%</div><div class="stat-foot">Submissions with a next version</div></div><div class="stat-card"><span class="stat-label">Top focus</span><div class="stat-value" style="font-size:20px">Timing</div><div class="stat-foot">9 notes this month</div></div></div><div class="progress-layout"><section class="progress-chart-panel"><div class="chart-panel-head"><div><h2>Review activity</h2><p>Submissions and resolved notes</p></div><button class="chart-select">This month ⌄</button></div><div class="big-progress">${values.map((value, i) => `<i class="${i === 7 ? 'active' : ''}" style="height:${value}%" data-value="${value}"></i>`).join('')}</div><div class="chart-axis"><span>Oct 1</span><span>Oct 8</span><span>Oct 15</span><span>Oct 22</span><span>Today</span></div></section><section class="tag-panel"><div class="chart-panel-head"><div><h2>Focus areas</h2><p>✦ Notes sorted by AI — you never pick a label</p></div></div>${[['Timing','9 notes','84%'],['Pathway','6 notes','62%'],['Energy','5 notes','48%'],['Musicality','4 notes','38%']].map(([tag,count,width]) => `<div class="tag-row"><span class="tag-badge">${tag}</span><span class="tag-row-copy"><b>${count}</b><small>this month</small></span><span class="tag-bar"><span style="width:${width}"></span></span></div>`).join('')}</section></div>`;
}

function renderSettings() {
  return `${shell('Settings', 'WORKSPACE CONTROL', 'Keep Looproom aligned with the way your team works.')}<div class="settings-layout"><div class="settings-menu"><button class="active">Workspace</button><button>Members & roles</button><button>Notifications</button><button>Privacy & storage</button><button>Billing</button></div><section class="settings-panel"><h2>Workspace settings</h2><p>These details help your team know where they are and what this room is for.</p><div class="setting-row"><div><b>Workspace name</b><small>Shown in navigation and invitation emails.</small></div><button class="secondary-action" data-toast-action="Workspace name editing is coming next.">Alex Lee Studio</button></div><div class="setting-row"><div><b>Private workspace</b><small>Only invited members can access your videos and notes.</small></div><button class="toggle on" data-toggle><i></i></button></div><div class="setting-row"><div><b>New feedback emails</b><small>Get an email when someone leaves a note on your video.</small></div><button class="toggle on" data-toggle><i></i></button></div><div class="setting-row"><div><b>Public profile</b><small>Looproom does not publish your workspace by default.</small></div><button class="toggle" data-toggle><i></i></button></div><div class="setting-row"><div><b>Video retention</b><small>Videos are kept while your workspace is active.</small></div><button class="secondary-action" data-toast-action="Retention controls are coming next.">Default policy</button></div></section></div>`;
}

function renderView() {
  const content = $('[data-content]');
  const view = state.view;
  content.innerHTML = view === 'home' ? renderHome() : view === 'reviews' ? renderReviews() : view === 'reviewDetail' ? renderReviewDetail() : view === 'groups' ? renderGroups() : view === 'inbox' ? renderInbox() : view === 'progress' ? renderProgress() : renderSettings();
  $('[data-breadcrumb]').textContent = viewLabels[view] || 'Home';
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === (view === 'reviewDetail' ? 'reviews' : view)));
  bindViewEvents();
}

function openView(view) { state.view = view; renderView(); window.scrollTo({ top: 0, behavior: 'smooth' }); closeSidebar(); }
function closeSidebar() { $('[data-sidebar]').classList.remove('open'); $('[data-sidebar-backdrop]').classList.remove('open'); }
function bindViewEvents() {
  $$('[data-view-button]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.viewButton)));
  $$('[data-view]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.view)));
  $$('[data-action="open-review"]').forEach((button) => button.addEventListener('click', () => openView('reviewDetail')));
  $$('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.reviewFilter = button.dataset.filter; renderView(); }));
  $$('[data-toast-action]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.toastAction)));
  $('[data-action="create-review"]')?.addEventListener('click', () => showToast('Review creation is ready for the next step.'));
  $('[data-action="invite"]')?.addEventListener('click', async () => { const link = `${location.origin}/join/alex-lee-studio`; try { await navigator.clipboard.writeText(link); showToast('Invite link copied to your clipboard.'); } catch { showToast(link); } });
  $('[data-action="mark-read"]')?.addEventListener('click', () => { state.inboxUnread = 0; renderView(); showToast('Inbox marked as read.'); });
  $('[data-action="mark-resolved"]')?.addEventListener('click', resolveSelected);
  $('[data-action="mirror"]')?.addEventListener('click', toggleMirror);
  $$('[data-action="upload-video"]').forEach((button) => button.addEventListener('click', () => $('[data-video-input]').click()));
  $$('[data-toggle]').forEach((toggle) => toggle.addEventListener('click', () => { toggle.classList.toggle('on'); showToast(`Setting turned ${toggle.classList.contains('on') ? 'on' : 'off'}.`); }));
  if (state.view === 'reviewDetail') mountReview();
}

function toggleMirror() { state.mirror = !state.mirror; paintPlayer(); showToast(state.mirror ? 'Mirror mode on — the video is flipped like a studio mirror.' : 'Mirror mode off.'); }
function resolveSelected() { const note = state.notes.find((item) => item.id === state.selectedNote); if (!note) return; note.status = 'Resolved'; paintNotes(); showToast(`Note at ${noteTime(note)} resolved.`); }
function selectAdjacentNote(step) {
  const notes = [...state.notes].sort((x, y) => x.start - y.start);
  const next = notes[Math.min(notes.length - 1, Math.max(0, notes.findIndex((n) => n.id === state.selectedNote) + step))];
  if (next) { state.selectedNote = next.id; seek(next.start); paintNotes(); }
}
// Review shortcuts, ignored while typing a note.
document.addEventListener('keydown', (event) => {
  if (state.view !== 'reviewDetail' || event.target.closest('input, textarea') || event.metaKey || event.ctrlKey) return;
  const actions = {
    ' ': () => setPlaying(!review.playing), k: () => setPlaying(false),
    j: () => seek(review.t - 5), l: () => seek(review.t + 5), arrowleft: () => seek(review.t - 5), arrowright: () => seek(review.t + 5),
    m: toggleMirror, n: () => { setComposerMode('point'); $('[data-composer-input]').focus(); },
    '[': () => markRange('start'), ']': () => { markRange('end'); if (review.rangeEnd !== null) $('[data-composer-input]').focus(); },
    r: resolveSelected, escape: () => setLoop(null), arrowup: () => selectAdjacentNote(-1), arrowdown: () => selectAdjacentNote(1)
  };
  const action = actions[event.key.toLowerCase()];
  if (action) { event.preventDefault(); action(); }
});

$('[data-open-sidebar]').addEventListener('click', () => { $('[data-sidebar]').classList.add('open'); $('[data-sidebar-backdrop]').classList.add('open'); });
$('[data-sidebar-backdrop]').addEventListener('click', closeSidebar);
$('[data-video-input]').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  // Prototype: the file plays from this browser only; nothing is uploaded yet.
  if (review.videoUrl) URL.revokeObjectURL(review.videoUrl);
  review.videoUrl = URL.createObjectURL(file);
  review.playing = false;
  review.loop = null;
  openView('reviewDetail');
  showToast(`${file.name} is playing from this browser — try pinning a note.`);
});
$('[data-workspace-switcher]').addEventListener('click', () => showToast('Workspace switching is coming next.'));

renderView();
