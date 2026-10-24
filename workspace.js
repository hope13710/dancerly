const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  view: 'home',
  reviewFilter: 'all',
  selectedNote: 'timing',
  notes: [
    { id: 'timing', time: '00:18', category: 'TIMING', body: 'Land on the beat before the shoulder hits. Try counting “5-and-6” here.', author: 'Alex Lee', status: 'Open' },
    { id: 'pathway', time: '00:42–00:48', category: 'PATHWAY', body: 'Keep the arm pathway wider through this transition.', author: 'Alex Lee', status: 'Open' },
    { id: 'energy', time: '01:03', category: 'ENERGY', body: 'This shape is working. Keep that same level of intent through the final count.', author: 'Alex Lee', status: 'Resolved' }
  ],
  inboxUnread: 3
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

function noteCard(note) { return `<button class="detail-note ${state.selectedNote === note.id ? 'selected' : ''}" data-note-id="${note.id}"><div class="note-line"><span class="note-time">${note.time}</span><span class="note-category">${note.category}</span>${note.status === 'Resolved' ? '<span class="note-state">Resolved</span>' : ''}</div><p>${note.body}</p><small>${note.author}</small></button>`; }

function renderReviewDetail() {
  const selected = state.notes.find((note) => note.id === state.selectedNote) || state.notes[0];
  const markerPosition = selected.id === 'timing' ? 33 : selected.id === 'pathway' ? 65 : 87;
  const currentTime = selected.id === 'timing' ? '00:18.0' : selected.id === 'pathway' ? '00:42.0' : '01:03.0';
  return `<div class="review-detail-top"><button class="back-button" data-view-button="reviews">← Back to reviews</button><div><h1 class="review-detail-title">Week 04 — Chorus timing</h1><div class="review-detail-meta">Commercial Team · Maya Chen · Version 2 · Uploaded 12 min ago</div></div></div>
    <div class="review-player-layout"><div class="player-column"><div class="player-video"><div class="demo-dancer"><span class="head"></span><span class="body"></span><span class="arm arm-one"></span><span class="arm arm-two"></span><span class="leg leg-one"></span><span class="leg leg-two"></span></div><span class="player-overlay-label">${currentTime}</span><span class="pause-control">Ⅱ</span></div><div class="player-timeline"><span>00:00</span><div class="timeline-line"><span class="timeline-progress" style="width:${markerPosition}%"></span><span class="timeline-pin" style="left:${markerPosition}%"></span></div><span>01:12</span></div><div class="player-toolbar"><button data-toast-action="Playback controls are ready for the video file.">▶</button><button data-toast-action="Playback speed set to 0.5×">0.5×</button><span class="toolbar-spacer"></span><strong>${currentTime}</strong><button data-toast-action="Section looping is ready for this note.">↻ Loop</button><button data-action="upload-video">Upload version</button></div></div><aside class="detail-notes"><div class="detail-notes-head"><div><span class="panel-kicker">VIDEO REVIEW</span><h3>Notes <small>${state.notes.length}</small></h3></div><button class="more-button" data-toast-action="More review actions are coming next.">•••</button></div><div class="notes-tabs"><button class="active">All <span>${state.notes.length}</span></button><button>Open <span>${state.notes.filter((n) => n.status === 'Open').length}</span></button></div><div class="detail-note-list">${state.notes.map(noteCard).join('')}</div><div class="note-actions"><button data-action="add-note">+ Add note at current time</button><button data-action="upload-video">↑ Upload improved version</button></div><div class="detail-footer"><span>Version 2 of 2</span><button data-action="mark-resolved">Resolve selected note ✓</button></div></aside></div>`;
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
  return `${shell('Progress', 'YOUR PRACTICE LOOP', 'Activity over time, without reducing people to a score.', '<button class="secondary-action" data-toast-action="Date range selector is coming next.">Last 30 days ⌄</button>')}<div class="stats-grid"><div class="stat-card"><span class="stat-label">Videos submitted</span><div class="stat-value">42</div><div class="stat-foot"><span class="up">↗ 18%</span> vs last period</div></div><div class="stat-card"><span class="stat-label">Notes resolved</span><div class="stat-value">28</div><div class="stat-foot"><span class="up">↗ 6</span> this month</div></div><div class="stat-card"><span class="stat-label">Review loop</span><div class="stat-value">68%</div><div class="stat-foot">Submissions with a next version</div></div><div class="stat-card"><span class="stat-label">Top focus</span><div class="stat-value" style="font-size:20px">Timing</div><div class="stat-foot">9 notes this month</div></div></div><div class="progress-layout"><section class="progress-chart-panel"><div class="chart-panel-head"><div><h2>Review activity</h2><p>Submissions and resolved notes</p></div><button class="chart-select">This month ⌄</button></div><div class="big-progress">${values.map((value, i) => `<i class="${i === 7 ? 'active' : ''}" style="height:${value}%" data-value="${value}"></i>`).join('')}</div><div class="chart-axis"><span>Oct 1</span><span>Oct 8</span><span>Oct 15</span><span>Oct 22</span><span>Today</span></div></section><section class="tag-panel"><div class="chart-panel-head"><div><h2>Focus areas</h2><p>What your team is working on</p></div></div>${[['Timing','9 notes','84%'],['Pathway','6 notes','62%'],['Energy','5 notes','48%'],['Musicality','4 notes','38%']].map(([tag,count,width]) => `<div class="tag-row"><span class="tag-badge">${tag}</span><span class="tag-row-copy"><b>${count}</b><small>this month</small></span><span class="tag-bar"><span style="width:${width}"></span></span></div>`).join('')}</section></div>`;
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
  $$('[data-note-id]').forEach((button) => button.addEventListener('click', () => { state.selectedNote = button.dataset.noteId; renderView(); }));
  $('[data-action="add-note"]')?.addEventListener('click', () => { state.notes.unshift({ id: `new-${Date.now()}`, time: '00:18', category: 'NEW NOTE', body: 'Add a clear, actionable correction for this moment.', author: 'Alex Lee', status: 'Open' }); state.selectedNote = state.notes[0].id; renderView(); showToast('New note draft added at 00:18.'); });
  $('[data-action="mark-resolved"]')?.addEventListener('click', () => { const note = state.notes.find((item) => item.id === state.selectedNote); if (note) note.status = 'Resolved'; renderView(); showToast('Note marked as resolved.'); });
  $$('[data-action="upload-video"]').forEach((button) => button.addEventListener('click', () => $('[data-video-input]').click()));
  $$('[data-toggle]').forEach((toggle) => toggle.addEventListener('click', () => { toggle.classList.toggle('on'); showToast(`Setting turned ${toggle.classList.contains('on') ? 'on' : 'off'}.`); }));
}

$('[data-open-sidebar]').addEventListener('click', () => { $('[data-sidebar]').classList.add('open'); $('[data-sidebar-backdrop]').classList.add('open'); });
$('[data-sidebar-backdrop]').addEventListener('click', closeSidebar);
$('[data-video-input]').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) showToast(`${file.name} is ready to process.`); event.target.value = ''; });
$('[data-workspace-switcher]').addEventListener('click', () => showToast('Workspace switching is coming next.'));

renderView();
