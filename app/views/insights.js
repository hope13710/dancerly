// Insights: what to do before the next practice, then why. A one-line summary against the period before, "Next up"
// (at most three things, each with one action), focus areas you can open, three key numbers with the trend, where notes
// pile up, and for leaders who to check in with. Numbers with too little data behind them stay hidden.
import { sb, $, $$, esc, timeAgo, avatar, cols, fmt, schema, toast, friendlyError } from '../client.js';
import { ctx } from '../ctx.js';
import { pageHead, previewEmpty, hasRealVideo, namesFor, statusPill } from './shared.js';
import { dueLabel } from './requests.js';
import { shiftBetween } from '../align.js';
import { isKo, t } from '../i18n.js';
import { CATEGORIES, catChip, catLabel, catColor } from '../categories.js';
import { samplePeek, sampleMoment, teamNote } from '../onboarding.js';
import { ic } from '../icons.js';

const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']];
const DAY = 86400000;
const STUCK_DAYS = 3;
const MIN_FOR_RATE = 5; // fewer notes than this and a percentage says nothing

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

const askedToSort = new Set();
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
    scope(sb.from('notes').select(cols('id, project_id, video_id, take_id, author_id, status, created_at, resolved_at, t_start, t_end, body, category, videos(title), takes(number, uploaded_by), note_reactions(user_id)'))).order('created_at', { ascending: false }).limit(5000),
    scope(sb.from('takes').select(cols('id, project_id, video_id, number, uploaded_by, created_at, count_start, align'))).limit(5000),
    scope(sb.from('videos').select('id, project_id, title, bpm')).limit(1000),
    scope(sb.from('requests').select('id, project_id, title, due_at, everyone, created_by, request_assignees(user_id)')).eq('status', 'active').limit(100),
    scope(sb.from('videos').select('request_id, created_by')).not('request_id', 'is', null).limit(2000),
    scope(sb.from('project_members').select('project_id, user_id, role')).limit(2000)
  ]);
  if (error || tErr) throw error || tErr;

  // No data of your own yet: show what this page does, using the sample project.
  if (!project && !notes.length && !takes.length && sample) return navigate(url({ project: sample.id }), { replace: true });

  const me = state.session?.user?.id;
  const since = Date.now() - days * DAY;
  const prevSince = since - days * DAY;
  const inRange = (iso) => iso && new Date(iso).getTime() >= since;
  const inPrev = (iso) => iso && new Date(iso).getTime() >= prevSince && new Date(iso).getTime() < since;
  const left = notes.filter((n) => inRange(n.created_at));
  const fixed = notes.filter((n) => n.status === 'resolved' && inRange(n.resolved_at));
  const prevLeft = notes.filter((n) => inPrev(n.created_at));
  const prevFixed = notes.filter((n) => n.status === 'resolved' && inPrev(n.resolved_at));
  const openNow = notes.filter((n) => n.status !== 'resolved');
  // Leaders (project owners in scope) also see the Team panel: who to check in with, and a reminder button.
  const isLeader = (roster || []).some((m) => m.user_id === me && m.role === 'owner');

  // ---------- Focus areas: per category, open now and fixed in this range, and new notes vs the period before ----------
  const areas = schema.noteCategories ? CATEGORIES.map(([key]) => ({
    key,
    open: openNow.filter((n) => n.category === key).length,
    fixed: fixed.filter((n) => n.category === key).length,
    // Fewer new notes on an area than in the period before means it's getting better.
    delta: prevLeft.length ? left.filter((n) => n.category === key).length - prevLeft.filter((n) => n.category === key).length : 0
  })).filter((a) => a.open + a.fixed) : [];
  // "Other" goes last; the rest by what's open, then by what got fixed.
  areas.sort((a, b) => (a.key === 'other') - (b.key === 'other') || b.open - a.open || b.fixed - a.fixed);
  const areaMax = Math.max(1, ...areas.map((a) => a.open + a.fixed));
  const unsorted = schema.noteCategories ? notes.filter((n) => !n.category && (inRange(n.created_at) || n.status !== 'resolved')).map((n) => n.id) : [];
  const takesInRange = takes.filter((t) => inRange(t.created_at));
  const takesByVideo = {};
  for (const t of takes) (takesByVideo[t.video_id] ||= []).push(t);

  // ---------- Where feedback piles up ----------
  const notesByVideo = {};
  for (const n of notes) (notesByVideo[n.video_id] ||= []).push(n);
  const spots = (videos || [])
    .filter((v) => (notesByVideo[v.id] || []).length >= 2 && takesByVideo[v.id]?.length)
    .map((v) => hotSpots(v, notesByVideo[v.id], takesByVideo[v.id]))
    .sort((a, b) => b.open - a.open || b.cells.reduce((s, c) => s + c.fixed, 0) - a.cells.reduce((s, c) => s + c.fixed, 0))
    .slice(0, 8);

  // ---------- Stuck, agreed, waiting ----------
  const stuck = openNow.filter((n) => Date.now() - new Date(n.created_at) >= STUCK_DAYS * DAY).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const agreed = openNow.filter((n) => n.note_reactions.length >= 2).sort((a, b) => b.note_reactions.length - a.note_reactions.length);
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
  const fixRate = left.length >= MIN_FOR_RATE ? Math.round((left.filter((n) => n.status === 'resolved').length / left.length) * 100) : null;

  // ---------- People ----------
  const people = {};
  const person = (id) => (people[id] ||= { id, given: 0, received: 0, takes: 0, open: 0, last: 0 });
  for (const n of left) {
    person(n.author_id).given += 1;
    const owner = n.takes?.uploaded_by;
    if (owner && owner !== n.author_id) person(owner).received += 1;
  }
  for (const n of openNow) { const owner = n.takes?.uploaded_by; if (owner && owner !== n.author_id) person(owner).open += 1; }
  for (const t of takesInRange) person(t.uploaded_by).takes += 1;
  for (const n of notes) { const p = person(n.author_id); p.last = Math.max(p.last, new Date(n.created_at).getTime()); }
  for (const t of takes) { const p = person(t.uploaded_by); p.last = Math.max(p.last, new Date(t.created_at).getTime()); }
  const members = [...new Set((roster || []).map((m) => m.user_id))].filter((id) => id !== me);
  const names = await namesFor([...new Set([...Object.keys(people), ...members, ...waiting.flatMap((w) => w.missing)])]);
  const nameOf = (id) => names[id] || 'Former member';
  const first = (id) => esc(nameOf(id).split(' ')[0]);

  // Needs attention: owes an assignment, has a pile of open notes, or has gone quiet (leaders only).
  const attention = [];
  if (isLeader) {
    const seen = new Set();
    for (const w of waiting) for (const u of w.missing) {
      if (seen.has(u) || u === me) continue;
      seen.add(u);
      attention.push({ id: u, why: isKo ? `“${esc(w.title)}” 아직 안 보냄 · ${esc(t(dueLabel(w.due_at)))}` : `Hasn’t sent “${esc(w.title)}” · ${esc(dueLabel(w.due_at))}`, remind: w.id });
    }
    for (const id of members) {
      if (seen.has(id)) continue;
      const p = people[id];
      if (p?.open >= 3) { seen.add(id); attention.push({ id, why: isKo ? `자기 영상에 미해결 피드백 ${p.open}개` : `${p.open} open notes on their videos` }); continue; }
      if (hasActivity() && (!p || Date.now() - p.last > 7 * DAY)) { seen.add(id); attention.push({ id, why: isKo ? '7일 넘게 활동이 없어요' : 'No activity for 7+ days' }); }
    }
  }
  function hasActivity() { return notes.length + takes.length > 0; }
  const activity = Object.values(people).filter((p) => p.given + p.takes + p.received).sort((a, b) => b.given + b.takes - (a.given + a.takes));

  // ---------- Links ----------
  const noteLink = (n) => `/app/p/${n.project_id}/v/${n.video_id}?take=${n.takes?.number ?? ''}&note=${n.id}`;
  const spotLink = (s, c) => `/app/p/${s.video.project_id}/v/${s.video.id}?take=${s.latest.number}&t=${c.at.toFixed(1)}`;

  // ---------- Next up: at most three things, each with one action ----------
  // Full sentences in both languages: names and titles sit inside them, so they can't be swapped piece by piece.
  const next = [];
  const due = waiting[0];
  if (due && isLeader) next.push({ icon: ic('upload', 'solo'), html: isKo
    ? `<b>${esc(due.title)}</b> · 아직 안 보낸 사람 <b>${due.missing.length}명</b> · ${esc(t(dueLabel(due.due_at)))}`
    : `<b>${due.missing.length}</b> still to send <b>${esc(due.title)}</b> · ${esc(dueLabel(due.due_at))}`, cta: 'Remind', remind: due.id });
  else if (due && due.missing.includes(me)) next.push({ icon: ic('upload', 'solo'), html: isKo
    ? `<b>${esc(due.title)}</b> 영상을 아직 안 보냈어요 · ${esc(t(dueLabel(due.due_at)))}`
    : `You still need to send <b>${esc(due.title)}</b> · ${esc(dueLabel(due.due_at))}`, cta: 'Open', href: `/app/p/${due.project_id}/requests/${due.id}` });
  const hottest = spots.filter((s) => s.top).sort((a, b) => b.top.open - a.top.open)[0];
  if (hottest) next.push({ icon: ic('target', 'solo'), html: isKo
    ? `미해결 피드백이 몰린 곳: <b>${esc(hottest.video.title)}</b> · <b>${hottest.top.label}</b> (${hottest.top.open}개)`
    : `Open notes pile up in <b>${esc(hottest.video.title)}</b> at <b>${hottest.top.label}</b> (${hottest.top.open})`, cta: 'Watch it', href: spotLink(hottest, hottest.top) });
  if (stuck.length) next.push({ icon: ic('clock', 'solo'), html: isKo
    ? `피드백 <b>${stuck.length}개</b>가 ${STUCK_DAYS}일 넘게 그대로예요`
    : `<b>${stuck.length}</b> ${stuck.length === 1 ? 'note has' : 'notes have'} been open for ${STUCK_DAYS}+ days`, cta: 'See them', sheet: 'stuck' });
  if (agreed[0]) next.push({ icon: ic('agree', 'solo'), html: isKo
    ? `팀이 가장 공감한 피드백(공감 ${agreed[0].note_reactions.length}): “${esc(snippet(agreed[0].body, 60))}”`
    : `Most agreed on (${agreed[0].note_reactions.length} agreed): “${esc(snippet(agreed[0].body, 60))}”`, cta: 'Open', href: noteLink(agreed[0]) });
  const topArea = areas.find((a) => a.key !== 'other' && a.open);
  if (topArea) next.push({ icon: '<i class="li-dot"></i>', color: catColor(topArea.key), html: isKo
    ? `<b>${catLabel(topArea.key)}</b> 피드백이 가장 많이 남아 있어요 (${topArea.open}개)`
    : `<b>${catLabel(topArea.key)}</b> has the most open notes (${topArea.open})`, cta: 'See notes', sheet: `area:${topArea.key}` });

  // ---------- Getting started: what makes this page useful ----------
  const steps = [
    ['Upload a second take of a video', Object.values(takesByVideo).some((list) => list.length >= 2)],
    ['Leave 5 notes', notes.length >= 5],
    ['Mark a note fixed', notes.some((n) => n.status === 'resolved')]
  ];
  const showSteps = !demo && steps.some(([, done]) => !done);

  // ---------- Summary: what got fixed, against the period before ----------
  const diff = fixed.length - prevFixed.length;
  const summary = isKo
    ? (fixed.length
      ? `최근 ${days}일 동안 피드백 <b>${fixed.length}개</b>를 해결했어요${prevFixed.length || diff ? `. 이전 ${days}일보다 <b>${Math.abs(diff)}개 ${diff >= 0 ? '많아요' : '적어요'}</b>` : ''}.`
      : `최근 ${days}일 동안 해결된 피드백이 아직 없어요. 다음 테이크를 올리면 무엇이 나아졌는지 확인할 수 있어요.`)
    : (fixed.length
      ? `<b>${fixed.length}</b> ${fixed.length === 1 ? 'note' : 'notes'} fixed in the last ${days} days${prevFixed.length || diff ? `, <b>${Math.abs(diff)} ${diff >= 0 ? 'more' : 'fewer'}</b> than the ${days} days before` : ''}.`
      : `No notes fixed in the last ${days} days yet. Upload the next take to see what got better.`);

  // ---------- Key numbers: three, the ones with enough behind them ----------
  const delta = (cur, prev, goodUp = true) => (!prevLeft.length && !prevFixed.length) || cur === prev ? '' : `<em class="${(cur > prev) === goodUp ? 'up' : 'down'}" data-no-i18n>${cur > prev ? '↑' : '↓'} ${Math.abs(cur - prev)}</em>`;
  const stats = [
    fixRate !== null && { label: 'Fix rate', value: `${fixRate}%`, sub: 'of notes left in this range' },
    { label: 'Notes fixed', value: fixed.length, sub: 'in this range', extra: delta(fixed.length, prevFixed.length) },
    avgTakesToFix !== null && { label: 'Takes to fix', value: avgTakesToFix.toFixed(1), sub: 'on average' },
    { label: 'Still open', value: openNow.length, sub: 'right now' },
    { label: 'Notes left', value: left.length, sub: 'in this range', extra: delta(left.length, prevLeft.length, false) }
  ].filter(Boolean).slice(0, 3);
  const locked = [fixRate === null && (isKo ? `해결률은 이 기간 피드백이 ${MIN_FOR_RATE}개 이상이면 보여요.` : `Fix rate shows once there are ${MIN_FOR_RATE}+ notes in this range.`), avgTakesToFix === null && (isKo ? '해결까지 걸린 테이크 수는 해결된 피드백이 3개 이상이면 보여요.' : 'Takes to fix shows after 3 notes are fixed.')].filter(Boolean);

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
  const noVideo = !hasData && !(await hasRealVideo());
  const heatMax = Math.max(1, ...spots.flatMap((s) => s.cells.map((c) => c.open + c.fixed)));
  const heatRow = (s) => `<div class="heat-row">
        <div class="heat-head"><a href="/app/p/${s.video.project_id}/v/${s.video.id}" data-link>${esc(s.video.title)}</a><small data-no-i18n>${isKo ? `${s.open ? `미해결 ${s.open}개` : '모두 해결'}${s.top ? ` · ${s.top.label}에 가장 많아요` : ''} · 한 칸 ${s.size}초` : `${s.open ? `${s.open} open` : 'All fixed'}${s.top ? ` · most at ${s.top.label}` : ''} · ${s.size}s per square`}</small></div>
        <div class="heat" style="--n:${s.cells.length}">${s.cells.map((c, i) => `<a class="heat-cell" href="${spotLink(s, c)}" data-link style="--o:${(c.open / heatMax).toFixed(2)};--f:${(c.fixed / heatMax).toFixed(2)}" title="${c.label}${c.eight ? ` · ${isKo ? `${c.eight}에잇` : `Eight ${c.eight}`}` : ''}: ${c.open} open, ${c.fixed} fixed" aria-label="${c.label}: ${c.open} open, ${c.fixed} fixed">${i % Math.ceil(s.cells.length / 12) === 0 ? `<span>${c.short}</span>` : ''}${c.open ? `<b>${c.open}</b>` : ''}</a>`).join('')}</div>
        ${s.unaligned ? `<p class="fine left">${s.unaligned} ${s.unaligned === 1 ? 'note' : 'notes'} from earlier takes placed by time only — opening the latest take lines them up.</p>` : ''}
      </div>`;

  view.innerHTML = `<section class="page">
    ${pageHead('Insights', { sub: 'What to work on next, from your feedback' })}
    ${demo ? teamNote('insights') : ''}
    <div class="filters">
      <div class="seg small" role="group" aria-label="Date range">${RANGES.map(([d, l]) => `<a href="${url({ range: d })}" data-link aria-selected="${Number(d) === days}">Last ${l}</a>`).join('')}</div>
      ${state.projects.length > 1 ? `<label class="select-wrap"><span class="sr-only">Project</span><select data-project><option value="">All projects</option>${state.projects.map((p) => `<option value="${p.id}" ${p.id === project ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>` : ''}
    </div>
    ${!hasData ? previewEmpty('bars', 'Nothing to measure yet', 'Upload a practice video and leave a few notes. This page shows where things keep getting stuck and what to work on next.', `${noVideo ? '<button class="btn primary" data-start-action="video">Upload video</button>' : ''}${samplePeek('insights', 'See it with sample data')}`, noVideo ? 'insights' : '') : `
    <p class="ins-summary" data-no-i18n>${summary}</p>

    <section class="panel insight-lines next-panel">
      <div class="panel-head"><div><h2>Next up</h2><p class="muted">The few things worth doing before the next practice</p></div></div>
      ${next.length ? `<ul class="lines next-list">${next.slice(0, 3).map((l, i) => `<li><span class="li-icon" aria-hidden="true" ${l.color ? `style="color:${l.color}"` : ''}>${l.icon}</span><span class="li-text" data-no-i18n>${l.html}</span>${l.href ? `<a class="btn small" href="${l.href}" data-link>${l.cta}</a>` : l.remind ? `<button class="btn small" type="button" data-remind="${l.remind}">${l.cta}</button>` : `<button class="btn small" type="button" data-sheet="${l.sheet}">${l.cta}</button>`}</li>`).join('')}</ul>`
        : `<p class="next-done">${ic('check_circle')}Nothing needs you before the next practice.</p>`}
    </section>

    ${showSteps ? `<section class="panel steps-panel">
      <div class="panel-head"><div><h2>Get more from Insights</h2><p class="muted">Each step adds something to this page</p></div><span class="steps-count" data-no-i18n>${steps.filter(([, d]) => d).length}/${steps.length}</span></div>
      <ul class="steps-list">${steps.map(([text, done]) => `<li class="${done ? 'done' : ''}"><span class="tick" aria-hidden="true">${done ? ic('check', 'solo') : ''}</span>${text}</li>`).join('')}</ul>
    </section>` : ''}

    ${areas.length ? `<section class="panel focus-panel">
      <div class="panel-head"><div><h2>Focus areas</h2><p class="muted">Open now and fixed in this range. Tap one to see its notes.</p></div></div>
      <div class="focus-list">${areas.map((a) => `<button type="button" class="focus-row" data-sheet="area:${a.key}" style="--cat:${catColor(a.key)}">
        ${catChip(a.key)}
        <span class="focus-bar" role="img" aria-label="${catLabel(a.key)}: ${a.open} open, ${a.fixed} fixed"><i class="open" style="width:${(a.open / areaMax) * 100}%"></i><i class="fixed" style="width:${(a.fixed / areaMax) * 100}%"></i></span>
        <span class="focus-num" data-no-i18n>${isKo ? `미해결 ${a.open} · 해결 ${a.fixed}` : `${a.open} open · ${a.fixed} fixed`}${a.delta ? ` <em class="${a.delta < 0 ? 'up' : 'down'}" title="${isKo ? `새 피드백이 이전 ${days}일보다 ${Math.abs(a.delta)}개 ${a.delta < 0 ? '적어요' : '많아요'}` : `${Math.abs(a.delta)} ${a.delta < 0 ? 'fewer' : 'more'} new notes than the ${days} days before`}">${a.delta < 0 ? '↓' : '↑'} ${Math.abs(a.delta)}</em>` : ''}</span>
      </button>`).join('')}</div>
      ${unsorted.length ? `<p class="fine left" data-no-i18n>${isKo ? `피드백 ${unsorted.length}개는 아직 분류 중이에요.` : `${unsorted.length} ${unsorted.length === 1 ? 'note is' : 'notes are'} still being sorted.`}</p>` : ''}
    </section>` : ''}

    <section class="panel progress-panel">
      <div class="panel-head"><div><h2>Progress</h2><p class="muted">${bucketMs === DAY ? 'Per day' : 'Per week'}</p></div>
        <div class="legend"><span><i class="key left"></i>Left</span><span><i class="key fixed"></i>Fixed</span></div></div>
      <div class="stats three">${stats.map((s) => `<div class="stat"><small>${s.label}</small><b>${s.value}${s.extra || ''}</b><span>${s.sub}</span></div>`).join('')}</div>
      <div class="bars" style="--cols:${count}" data-chart>
        <div class="bars-grid">${ticks.map((t) => `<div style="bottom:${(t / top) * 100}%"><span>${t}</span></div>`).join('')}</div>
        <div class="bars-plot">${buckets.map((b, i) => `<div class="bars-col" tabindex="0" data-i="${i}" aria-label="${label(b)}: ${b.left} left, ${b.fixed} fixed">
          <div class="bars-pair"><i class="bar left" style="height:${(b.left / top) * 100}%"></i><i class="bar fixed" style="height:${(b.fixed / top) * 100}%"></i></div>
          <span class="bars-x">${label(b)}</span>
        </div>`).join('')}</div>
        <div class="chart-tip" data-tip hidden></div>
      </div>
      ${locked.length ? `<p class="fine left" data-no-i18n>${locked.join(' ')}</p>` : ''}
      <details class="table-toggle"><summary>Show as table</summary>
        <table class="table compact"><thead><tr><th>${bucketMs === DAY ? 'Day' : 'Week of'}</th><th class="num">Left</th><th class="num">Fixed</th></tr></thead>
        <tbody>${buckets.map((b) => `<tr><td>${label(b)}</td><td class="num">${b.left}</td><td class="num">${b.fixed}</td></tr>`).join('')}</tbody></table>
      </details>
    </section>

    ${spots.length ? `<section class="panel heat-panel">
      <div class="panel-head"><div><h2>Where feedback piles up</h2><p class="muted">Each square is a few seconds of the video. Darker means more notes still open. Tap one to jump there.</p></div>
        <div class="legend"><span><i class="key heat-open"></i>Open</span><span><i class="key heat-fixed"></i>Fixed</span></div></div>
      <div class="heat-list">${spots.slice(0, 3).map(heatRow).join('')}</div>
      ${spots.length > 3 ? `<details class="heat-more"><summary data-no-i18n>${isKo ? `영상 ${spots.length - 3}개 더 보기` : `Show ${spots.length - 3} more ${spots.length - 3 === 1 ? 'video' : 'videos'}`}</summary><div class="heat-list">${spots.slice(3).map(heatRow).join('')}</div></details>` : ''}
    </section>` : ''}

    ${isLeader ? `<section class="panel team-panel">
      <div class="panel-head"><div><h2>Team</h2><p class="muted">Who to check in with</p></div></div>
      ${attention.length ? `<div class="list flush">${attention.slice(0, 6).map((a) => `<div class="row attn-row"><a class="row-main" href="/app/people/${a.id}" data-link>${avatar(nameOf(a.id), a.id, 'sm')}<span><span class="row-title">${esc(nameOf(a.id))}</span><span class="row-meta" data-no-i18n>${a.why}</span></span></a>${a.remind ? `<button class="btn small" type="button" data-remind="${a.remind}">Remind</button>` : `<a class="btn small ghost" href="/app/people/${a.id}" data-link>View</a>`}</div>`).join('')}</div>`
        : '<p class="panel-empty">Everyone’s on track.</p>'}
      ${activity.length ? `<details class="team-activity"><summary>Activity by person</summary><div class="list flush">${activity.map((p) => `<a class="row" href="/app/people/${p.id}" data-link><span class="row-main">${avatar(nameOf(p.id), p.id, 'xs')}<span class="row-title">${esc(nameOf(p.id))}</span></span><span class="row-meta" data-no-i18n>${isKo ? `테이크 ${p.takes} · 남긴 피드백 ${p.given} · 받은 피드백 ${p.received}` : `${p.takes} ${p.takes === 1 ? 'take' : 'takes'} · ${p.given} given · ${p.received} received`}</span></a>`).join('')}</div></details>` : ''}
    </section>` : ''}`}
  </section>`;

  $('[data-project]')?.addEventListener('change', (event) => navigate(url({ project: event.target.value })));

  // A list of notes in a sheet: the stuck ones, or one focus area (open first, then fixed in this range).
  const sheet = (title, list) => {
    const el = document.createElement('dialog');
    el.className = 'dialog sheet notes-sheet';
    el.innerHTML = `<div class="dialog-card"><h2></h2><div class="list flush">${list.slice(0, 30).map((n) => `<a class="row" href="${noteLink(n)}" data-link><span class="row-main"><span class="row-title" data-no-i18n>${esc(snippet(n.body))}</span><span class="row-meta">${esc(n.videos?.title || '')}${n.takes?.uploaded_by ? ` · ${first(n.takes.uploaded_by)}` : ''} · ${timeAgo(n.created_at)}</span></span>${statusPill(n.status)}</a>`).join('')}</div><form method="dialog"><button class="btn ghost wide">Close</button></form></div>`;
    el.querySelector('h2').textContent = title;
    document.body.append(el);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('a[data-link]')) el.close(); });
    el.addEventListener('close', () => el.remove());
    el.showModal();
  };
  view.firstElementChild.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-sheet]');
    if (open) {
      const key = open.dataset.sheet;
      if (key === 'stuck') return sheet(isKo ? `${STUCK_DAYS}일 넘게 미해결` : `Open for ${STUCK_DAYS}+ days`, stuck);
      const cat = key.slice(5);
      const list = [...openNow.filter((n) => n.category === cat).sort((a, b) => a.created_at.localeCompare(b.created_at)), ...fixed.filter((n) => n.category === cat)];
      return sheet(catLabel(cat), list);
    }
    const remind = e.target.closest('[data-remind]');
    if (remind) {
      remind.disabled = true;
      const { data: sentCount, error: rErr } = await sb.rpc('remind_request', { p_request: remind.dataset.remind });
      if (rErr) { remind.disabled = false; return toast(friendlyError(rErr), 'error'); }
      toast(sentCount ? `Reminded ${sentCount} ${sentCount === 1 ? 'person' : 'people'}.` : 'Nobody to remind — or they turned these off.');
      $$(`[data-remind="${remind.dataset.remind}"]`).forEach((b) => { b.disabled = true; b.textContent = isKo ? '보냄' : 'Sent'; });
    }
  });

  // Notes that haven't been sorted into a focus area yet: ask once, then redraw with them.
  const ask = unsorted.filter((id) => !askedToSort.has(id)).slice(0, 40);
  if (ask.length) {
    ask.forEach((id) => askedToSort.add(id));
    sb.functions.invoke('classify-notes', { body: { note_ids: ask } }).then(({ data }) => {
      if (data?.classified?.length && location.pathname === '/app/insights') renderInsights();
    });
  }
  // The demo is the sample, so it gets the sample's bar (and, the first time, what to take from it).
  if (demo) { ctx.sampleBar(sample); sampleMoment('insights'); }
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
