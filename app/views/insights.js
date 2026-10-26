// Insights: what to work on next. Where feedback piles up in each video, what's been stuck, what the team agrees on,
// who still owes a video — then the trend and the numbers. Cards with too little data behind them stay hidden.
import { sb, $, $$, esc, timeAgo, avatar, cols, fmt } from '../client.js';
import { ctx } from '../ctx.js';
import { pageHead, empty, namesFor, statusPill } from './shared.js';
import { dueLabel } from './requests.js';
import { shiftBetween } from '../align.js';
import { isKo, t } from '../i18n.js';
import { samplePeek, sampleMoment } from '../onboarding.js';

const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']];
const DAY = 86400000;
const STUCK_DAYS = 3;
const MIN_FOR_RATE = 5; // fewer notes than this and a percentage says nothing

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const duration = (ms) => (ms === null ? '—' : ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))}m` : ms < DAY ? `${Math.round(ms / 3600000)}h` : `${(ms / DAY).toFixed(ms < 10 * DAY ? 1 : 0)}d`);
const snippet = (text, n = 90) => (text.length > n ? `${text.slice(0, n)}…` : text);

// Where notes sit along one video, in steps of a few seconds on the latest take's timeline — the same clock as the
// player. Short videos get 5-second squares, longer ones 10 or 15 so a row stays readable. When the video has counts,
// each square also says which eight it starts in. Notes from earlier takes move onto the latest take when lined up.
function hotSpots(video, notes, takesOfVideo) {
  const latest = takesOfVideo.reduce((a, b) => (b.number > a.number ? b : a), takesOfVideo[0]);
  let unaligned = 0;
  const spans = notes.map((n) => {
    let shift = shiftBetween(takesOfVideo.find((t) => t.id === n.take_id), latest);
    if (shift === null) { shift = 0; unaligned += 1; }
    const a = Math.max(0, Number(n.t_start) + shift);
    // A range ends where the next part begins, so its last instant doesn't count toward the next square.
    const b = n.t_end === null ? a : Math.max(a, Number(n.t_end) + shift - 0.01);
    return { n, a, b };
  });
  const end = Math.max(20, ...spans.map((x) => x.b));
  const size = end <= 75 ? 5 : end <= 180 ? 10 : 15;
  const binOf = (t) => Math.floor(t / size + 1e-6);
  const bins = new Map();
  for (const { n, a, b } of spans) {
    for (let i = binOf(a); i <= binOf(b); i += 1) {
      const bin = bins.get(i) || { open: 0, fixed: 0 };
      bin[n.status === 'resolved' ? 'fixed' : 'open'] += 1;
      bins.set(i, bin);
    }
  }
  const bpm = video.bpm === null || video.bpm === undefined ? null : Number(video.bpm);
  const one = latest?.count_start === null || latest?.count_start === undefined ? null : Number(latest.count_start);
  const eightAt = (t) => (bpm && one !== null && t >= one ? Math.floor((t - one) / ((8 * 60) / bpm) + 1e-6) + 1 : null);
  const cells = [];
  for (let i = 0; i <= binOf(end); i += 1) {
    const at = i * size;
    cells.push({ ...(bins.get(i) || { open: 0, fixed: 0 }), at, eight: eightAt(at), label: `${fmt(at)}–${fmt(at + size)}`, short: fmt(at) });
  }
  const top = cells.reduce((a, c) => (c.open > a.open ? c : a), cells[0]);
  return { video, latest, size, cells, top: top?.open ? top : null, unaligned, open: notes.filter((n) => n.status !== 'resolved').length };
}

export async function renderInsights() {
  const { state, view, setCrumbs, navigate } = ctx;
  setCrumbs([['Insights']]);
  await state.projectsReady;
  const params = new URLSearchParams(location.search);
  const days = RANGES.some(([d]) => d === params.get('range')) ? Number(params.get('range')) : 30;
  const project = params.get('project') || '';
  const url = (changes) => {
    const next = new URLSearchParams({ range: String(days), ...(project ? { project } : {}), ...changes });
    if (!next.get('project')) next.delete('project');
    return `/app/insights?${next}`;
  };
  const sample = state.projects.find((p) => p.is_sample);
  const demo = Boolean(sample && project === sample.id);
  // Everything is scoped to one project, or to all projects except the sample.
  const scope = (q) => (project ? q.eq('project_id', project) : sample ? q.neq('project_id', sample.id) : q);

  const [{ data: notes, error }, { data: takes, error: tErr }, { data: videos }, { data: requests }, { data: submitted }, { data: roster }] = await Promise.all([
    scope(sb.from('notes').select('id, project_id, video_id, take_id, author_id, status, created_at, resolved_at, t_start, t_end, body, videos(title), takes(number, uploaded_by), note_reactions(user_id)')).order('created_at', { ascending: false }).limit(5000),
    scope(sb.from('takes').select(cols('id, project_id, video_id, number, uploaded_by, created_at, count_start, align'))).limit(5000),
    scope(sb.from('videos').select('id, project_id, title, bpm')).limit(1000),
    scope(sb.from('requests').select('id, project_id, title, due_at, everyone, created_by, request_assignees(user_id)')).eq('status', 'active').limit(100),
    scope(sb.from('videos').select('request_id, created_by')).not('request_id', 'is', null).limit(2000),
    scope(sb.from('project_members').select('project_id, user_id')).limit(2000)
  ]);
  if (error || tErr) throw error || tErr;

  // No data of your own yet: show what this page does, using the sample project.
  if (!project && !notes.length && !takes.length && sample) return navigate(url({ project: sample.id }), { replace: true });

  const since = Date.now() - days * DAY;
  const inRange = (iso) => iso && new Date(iso).getTime() >= since;
  const left = notes.filter((n) => inRange(n.created_at));
  const fixed = notes.filter((n) => n.status === 'resolved' && inRange(n.resolved_at));
  const openNow = notes.filter((n) => n.status !== 'resolved');
  const takesInRange = takes.filter((t) => inRange(t.created_at));
  const takeById = Object.fromEntries(takes.map((t) => [t.id, t]));
  const takesByVideo = {};
  for (const t of takes) (takesByVideo[t.video_id] ||= []).push(t);

  // ---------- Where feedback piles up ----------
  const notesByVideo = {};
  for (const n of notes) (notesByVideo[n.video_id] ||= []).push(n);
  const spots = (videos || [])
    .filter((v) => (notesByVideo[v.id] || []).length >= 2 && takesByVideo[v.id]?.length)
    .map((v) => hotSpots(v, notesByVideo[v.id], takesByVideo[v.id]))
    .sort((a, b) => b.open - a.open || b.cells.reduce((s, c) => s + c.fixed, 0) - a.cells.reduce((s, c) => s + c.fixed, 0))
    .slice(0, 4);

  // ---------- Stuck: not fixed after a few days ----------
  const stuck = openNow.filter((n) => Date.now() - new Date(n.created_at) >= STUCK_DAYS * DAY).sort((a, b) => a.created_at.localeCompare(b.created_at));

  // ---------- The team agrees: open notes with the most 👍 ----------
  const agreed = openNow.filter((n) => n.note_reactions.length >= 2).sort((a, b) => b.note_reactions.length - a.note_reactions.length).slice(0, 4);

  // ---------- Waiting on videos ----------
  const sentBy = {};
  for (const v of submitted || []) (sentBy[v.request_id] ||= new Set()).add(v.created_by);
  const waiting = (requests || []).map((rq) => {
    const expected = rq.everyone
      ? (roster || []).filter((m) => m.project_id === rq.project_id && m.user_id !== rq.created_by).map((m) => m.user_id)
      : rq.request_assignees.map((a) => a.user_id);
    const sent = sentBy[rq.id] || new Set();
    return { ...rq, expected, sent: expected.filter((u) => sent.has(u)), missing: expected.filter((u) => !sent.has(u)) };
  }).filter((rq) => rq.expected.length && rq.missing.length).sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9'));

  // ---------- Numbers, only where there's enough behind them ----------
  // Takes to fix: from the take a note was left on to the newest take uploaded before it was marked fixed.
  const takesToFix = notes.filter((n) => n.status === 'resolved' && n.resolved_at && n.takes).map((n) => {
    const before = (takesByVideo[n.video_id] || []).filter((t) => t.created_at <= n.resolved_at).reduce((m, t) => Math.max(m, t.number), n.takes.number);
    return before - n.takes.number;
  });
  const avgTakesToFix = takesToFix.length >= 3 ? takesToFix.reduce((a, b) => a + b, 0) / takesToFix.length : null;
  // First feedback: from a take going up to the first note someone else leaves on it.
  const firstNote = {};
  for (const n of notes) {
    const t = takeById[n.take_id];
    if (!t || n.author_id === t.uploaded_by) continue;
    if (!firstNote[t.id] || n.created_at < firstNote[t.id]) firstNote[t.id] = n.created_at;
  }
  const waits = takesInRange.filter((t) => firstNote[t.id]).map((t) => new Date(firstNote[t.id]) - new Date(t.created_at)).filter((ms) => ms >= 0);
  const firstFeedback = waits.length >= 3 ? median(waits) : null;
  const fixRate = left.length >= MIN_FOR_RATE ? Math.round((left.filter((n) => n.status === 'resolved').length / left.length) * 100) : null;

  // ---------- Who ----------
  const people = {};
  const person = (id) => (people[id] ||= { id, given: 0, received: 0, takes: 0 });
  for (const n of left) {
    person(n.author_id).given += 1;
    const owner = n.takes?.uploaded_by;
    if (owner && owner !== n.author_id) person(owner).received += 1;
  }
  for (const t of takesInRange) person(t.uploaded_by).takes += 1;
  const names = await namesFor([...Object.keys(people), ...stuck.slice(0, 5).map((n) => n.takes?.uploaded_by).filter(Boolean), ...waiting.flatMap((w) => w.missing)]);
  const peopleRows = Object.values(people).sort((a, b) => b.given + b.takes - (a.given + a.takes));
  const nameOf = (id) => names[id] || 'Former member';

  // ---------- This week in three lines ----------
  const noteLink = (n) => `/app/p/${n.project_id}/v/${n.video_id}?take=${n.takes?.number ?? ''}&note=${n.id}`;
  const spotLink = (s, c) => `/app/p/${s.video.project_id}/v/${s.video.id}?take=${s.latest.number}&t=${c.at.toFixed(1)}`;
  const lines = [];
  const hottest = spots.filter((s) => s.top).sort((a, b) => b.top.open - a.top.open)[0];
  // Full sentences in both languages here: names and titles sit inside them, so they can't be swapped piece by piece.
  const spotLabel = (c) => c.label;
  if (hottest) lines.push({ icon: '◎', html: isKo
    ? `미해결 피드백이 가장 많은 곳: <b>${esc(hottest.video.title)}</b> · <b>${spotLabel(hottest.top)}</b> (${hottest.top.open}개)`
    : `Most open feedback: <b>${esc(hottest.video.title)}</b> · <b>${hottest.top.label}</b> (${hottest.top.open} open)`, href: spotLink(hottest, hottest.top), cta: 'Watch it' });
  if (stuck.length) lines.push({ icon: '⏳', html: isKo
    ? `피드백 <b>${stuck.length}개</b>가 ${STUCK_DAYS}일 넘게 그대로예요`
    : `<b>${stuck.length}</b> ${stuck.length === 1 ? 'note has' : 'notes have'} been open for ${STUCK_DAYS}+ days`, href: '#stuck', cta: 'See them' });
  if (waiting[0]) lines.push({ icon: '↑', html: isKo
    ? `<b>${esc(waiting[0].title)}</b> · 아직 안 보낸 사람 <b>${waiting[0].missing.length}명</b> · ${esc(t(dueLabel(waiting[0].due_at)))}`
    : `<b>${waiting[0].missing.length}</b> still to send <b>${esc(waiting[0].title)}</b> · ${esc(dueLabel(waiting[0].due_at))}`, href: `/app/p/${waiting[0].project_id}/requests/${waiting[0].id}`, cta: 'Open' });
  if (avgTakesToFix !== null && lines.length < 3) lines.push({ icon: '✓', html: isKo
    ? `피드백은 평균 <b>${avgTakesToFix.toFixed(1)}테이크</b> 만에 해결돼요`
    : `Notes get fixed in <b>${avgTakesToFix.toFixed(1)}</b> takes on average`, href: null });
  if (agreed[0] && lines.length < 3) lines.push({ icon: '👍', html: isKo
    ? `팀이 가장 공감한 피드백: “${esc(snippet(agreed[0].body, 60))}”`
    : `The team agrees most on: “${esc(snippet(agreed[0].body, 60))}”`, href: noteLink(agreed[0]), cta: 'Open' });

  // ---------- Trend chart: notes left and fixed ----------
  const bucketMs = days <= 7 ? DAY : 7 * DAY;
  const count = Math.ceil((days * DAY) / bucketMs);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const firstStart = dayStart.getTime() + DAY - count * bucketMs;
  const buckets = Array.from({ length: count }, (_, i) => ({ from: firstStart + i * bucketMs, left: 0, fixed: 0 }));
  const bucketOf = (iso) => Math.floor((new Date(iso).getTime() - firstStart) / bucketMs);
  for (const n of notes) {
    const a = bucketOf(n.created_at); if (buckets[a]) buckets[a].left += 1;
    if (n.status === 'resolved' && n.resolved_at) { const b = bucketOf(n.resolved_at); if (buckets[b]) buckets[b].fixed += 1; }
  }
  const label = (b) => new Date(b.from).toLocaleDateString(undefined, bucketMs === DAY ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
  const peak = Math.max(1, ...buckets.flatMap((b) => [b.left, b.fixed]));
  const step = peak <= 4 ? 1 : Math.ceil(peak / 4);
  const top = step * Math.ceil(peak / step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const hasData = notes.length || takes.length;
  const heatMax = Math.max(1, ...spots.flatMap((s) => s.cells.map((c) => c.open + c.fixed)));
  view.innerHTML = `<section class="page">
    ${pageHead('Insights', { sub: 'What to work on next, from your team’s feedback' })}
    <div class="filters">
      <div class="seg small" role="group" aria-label="Date range">${RANGES.map(([d, l]) => `<a href="${url({ range: d })}" data-link aria-selected="${Number(d) === days}">Last ${l}</a>`).join('')}</div>
      ${state.projects.length > 1 ? `<label class="select-wrap"><span class="sr-only">Project</span><select data-project><option value="">All projects</option>${state.projects.map((p) => `<option value="${p.id}" ${p.id === project ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>` : ''}
    </div>
    ${!hasData ? empty('↗', 'Nothing to measure yet', 'Upload a rehearsal and leave a few notes. This page shows where your team keeps getting stuck and what to work on next.', samplePeek('insights', 'See it with sample data')) : `
    <section class="panel insight-lines">
      <div class="panel-head"><div><h2>Before your next rehearsal</h2><p class="muted">The few things worth your attention</p></div></div>
      ${lines.length ? `<ul class="lines">${lines.slice(0, 3).map((l) => `<li><span class="li-icon" aria-hidden="true">${l.icon}</span><span class="li-text" data-no-i18n>${l.html}</span>${l.href ? `<a class="btn small" href="${l.href}" ${l.href.startsWith('#') ? '' : 'data-link'}>${l.cta}</a>` : ''}</li>`).join('')}</ul>`
        : '<p class="panel-empty">Nothing needs you right now. Keep leaving notes and this fills in.</p>'}
    </section>

    ${spots.length ? `<section class="panel heat-panel">
      <div class="panel-head"><div><h2>Where feedback piles up</h2><p class="muted">Each square is a few seconds of the video. Darker means more notes still open. Tap one to jump there.</p></div>
        <div class="legend"><span><i class="key heat-open"></i>Open</span><span><i class="key heat-fixed"></i>Fixed</span></div></div>
      <div class="heat-list">${spots.map((s) => `<div class="heat-row">
        <div class="heat-head"><a href="/app/p/${s.video.project_id}/v/${s.video.id}" data-link>${esc(s.video.title)}</a><small data-no-i18n>${isKo ? `${s.open ? `미해결 ${s.open}개` : '모두 해결'}${s.top ? ` · ${spotLabel(s.top)}에 가장 많아요` : ''} · 한 칸 ${s.size}초` : `${s.open ? `${s.open} open` : 'All fixed'}${s.top ? ` · most at ${s.top.label}` : ''} · ${s.size}s per square`}</small></div>
        <div class="heat" style="--n:${s.cells.length}">${s.cells.map((c, i) => `<a class="heat-cell" href="${spotLink(s, c)}" data-link style="--o:${(c.open / heatMax).toFixed(2)};--f:${(c.fixed / heatMax).toFixed(2)}" title="${c.label}${c.eight ? ` · ${isKo ? `${c.eight}에잇` : `Eight ${c.eight}`}` : ''}: ${c.open} open, ${c.fixed} fixed" aria-label="${c.label}: ${c.open} open, ${c.fixed} fixed">${i % Math.ceil(s.cells.length / 12) === 0 ? `<span>${c.short}</span>` : ''}${c.open ? `<b>${c.open}</b>` : ''}</a>`).join('')}</div>
        ${s.unaligned ? `<p class="fine left">${s.unaligned} ${s.unaligned === 1 ? 'note' : 'notes'} from earlier takes placed by time only — opening the latest take lines them up.</p>` : ''}
      </div>`).join('')}</div>
    </section>` : ''}

    <div class="home-grid">
      <section class="panel" id="stuck">
        <div class="panel-head"><div><h2>Stuck for ${STUCK_DAYS}+ days</h2><p class="muted">Open or practicing, oldest first</p></div></div>
        ${stuck.length ? `<div class="list flush">${stuck.slice(0, 5).map((n) => `<a class="row" href="${noteLink(n)}" data-link><span class="row-main"><span class="row-title">${esc(snippet(n.body))}</span><span class="row-meta">${esc(n.videos?.title || '')}${n.takes?.uploaded_by ? ` · for ${esc(nameOf(n.takes.uploaded_by))}` : ''} · ${timeAgo(n.created_at)}</span></span>${statusPill(n.status)}</a>`).join('')}</div>`
          : '<p class="panel-empty">Nothing has been sitting around. 👏</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Waiting on videos</h2><p class="muted">Requests people haven’t sent yet</p></div></div>
        ${waiting.length ? `<div class="list flush">${waiting.slice(0, 4).map((w) => `<a class="row" href="/app/p/${w.project_id}/requests/${w.id}" data-link><span class="row-main"><span class="row-title">${esc(w.title)}</span><span class="row-meta">${w.sent.length} of ${w.expected.length} sent · ${esc(dueLabel(w.due_at))}</span></span><span class="who-stack">${w.missing.slice(0, 4).map((u) => avatar(nameOf(u), u, 'xs')).join('')}${w.missing.length > 4 ? `<small>+${w.missing.length - 4}</small>` : ''}</span></a>`).join('')}</div>`
          : '<p class="panel-empty">Everyone’s sent what was asked for.</p>'}
      </section>
    </div>

    ${agreed.length ? `<section class="panel">
      <div class="panel-head"><div><h2>What the team agrees on</h2><p class="muted">Open notes with the most 👍 — usually the biggest wins</p></div></div>
      <div class="list flush">${agreed.map((n) => `<a class="row" href="${noteLink(n)}" data-link><span class="row-main"><span class="row-title">${esc(snippet(n.body))}</span><span class="row-meta">${esc(n.videos?.title || '')}</span></span><span class="agree-count">👍 ${n.note_reactions.length}</span></a>`).join('')}</div>
    </section>` : ''}

    <div class="stats">
      <div class="stat"><small>Notes left</small><b>${left.length}</b><span>in this range</span></div>
      <div class="stat"><small>Notes fixed</small><b>${fixed.length}</b><span>in this range</span></div>
      <div class="stat"><small>Takes to fix</small><b>${avgTakesToFix === null ? '—' : avgTakesToFix.toFixed(1)}</b><span>${avgTakesToFix === null ? 'Needs 3+ fixed notes' : 'on average'}</span></div>
      <div class="stat"><small>Fix rate</small><b>${fixRate === null ? '—' : `${fixRate}%`}</b><span>${fixRate === null ? `Needs ${MIN_FOR_RATE}+ notes` : 'of notes left in this range'}</span></div>
      <div class="stat"><small>First feedback</small><b>${duration(firstFeedback)}</b><span>${firstFeedback === null ? 'Needs 3+ takes with notes' : 'after a take goes up'}</span></div>
      <div class="stat"><small>Still open</small><b>${openNow.length}</b><span>right now</span></div>
    </div>

    <section class="panel">
      <div class="panel-head"><div><h2>Notes left and fixed</h2><p class="muted">${bucketMs === DAY ? 'Per day' : 'Per week'}</p></div>
        <div class="legend"><span><i class="key left"></i>Left</span><span><i class="key fixed"></i>Fixed</span></div></div>
      <div class="bars" style="--cols:${count}" data-chart>
        <div class="bars-grid">${ticks.map((t) => `<div style="bottom:${(t / top) * 100}%"><span>${t}</span></div>`).join('')}</div>
        <div class="bars-plot">${buckets.map((b, i) => `<div class="bars-col" tabindex="0" data-i="${i}" aria-label="${label(b)}: ${b.left} left, ${b.fixed} fixed">
          <div class="bars-pair"><i class="bar left" style="height:${(b.left / top) * 100}%"></i><i class="bar fixed" style="height:${(b.fixed / top) * 100}%"></i></div>
          <span class="bars-x">${label(b)}</span>
        </div>`).join('')}</div>
        <div class="chart-tip" data-tip hidden></div>
      </div>
      <details class="table-toggle"><summary>Show as table</summary>
        <table class="table compact"><thead><tr><th>${bucketMs === DAY ? 'Day' : 'Week of'}</th><th class="num">Left</th><th class="num">Fixed</th></tr></thead>
        <tbody>${buckets.map((b) => `<tr><td>${label(b)}</td><td class="num">${b.left}</td><td class="num">${b.fixed}</td></tr>`).join('')}</tbody></table>
      </details>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h2>By person</h2><p class="muted">In the selected range</p></div></div>
      ${peopleRows.length ? `<table class="table compact"><thead><tr><th>Person</th><th class="num">Notes given</th><th class="num">Received</th><th class="num">Takes</th></tr></thead><tbody>
        ${peopleRows.map((p) => `<tr data-href="/app/people/${p.id}"><td><a class="person" href="/app/people/${p.id}" data-link>${avatar(nameOf(p.id), p.id, 'xs')}${esc(nameOf(p.id))}</a></td><td class="num">${p.given}</td><td class="num">${p.received}</td><td class="num">${p.takes}</td></tr>`).join('')}
      </tbody></table>` : '<p class="panel-empty">No activity in this range.</p>'}
    </section>`}
  </section>`;

  $('[data-project]')?.addEventListener('change', (event) => navigate(url({ project: event.target.value })));
  view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) navigate(tr.dataset.href); }));
  // The demo is the sample, so it gets the sample's bar (and, the first time, what to take from it).
  if (demo) { ctx.sampleBar(sample); sampleMoment('insights'); }
  $('a[href="#stuck"]')?.addEventListener('click', (e) => { e.preventDefault(); $('#stuck')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const chart = $('[data-chart]');
  if (!chart) return;
  const tip = $('[data-tip]');
  const show = (col) => {
    const b = buckets[Number(col.dataset.i)];
    tip.replaceChildren();
    const head = document.createElement('small'); head.textContent = bucketMs === DAY ? label(b) : `Week of ${label(b)}`;
    tip.append(head);
    for (const [cls, name, value] of [['left', 'Left', b.left], ['fixed', 'Fixed', b.fixed]]) {
      const row = document.createElement('div'); row.className = 'tip-row';
      row.innerHTML = `<i class="key line ${cls}"></i><b></b><span></span>`;
      row.querySelector('b').textContent = value; row.querySelector('span').textContent = name;
      tip.append(row);
    }
    tip.hidden = false;
    const box = chart.getBoundingClientRect(); const c = col.getBoundingClientRect();
    const x = Math.min(Math.max(c.left - box.left + c.width / 2, 60), box.width - 60);
    tip.style.left = `${x}px`;
    $$('.bars-col', chart).forEach((el) => el.classList.toggle('hover', el === col));
  };
  const hide = () => { tip.hidden = true; $$('.bars-col', chart).forEach((el) => el.classList.remove('hover')); };
  $$('.bars-col', chart).forEach((col) => {
    col.addEventListener('pointerenter', () => show(col));
    col.addEventListener('focus', () => show(col));
    col.addEventListener('blur', hide);
  });
  chart.addEventListener('pointerleave', hide);
}
