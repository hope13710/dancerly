// AI recaps: made per project × period, saved automatically, pinned per person, shared on purpose.
// They live in Project › Recaps, show up on Home, and collect in Me › My recaps.
import { sb, $, $$, esc, fmt, timeAgo, toast, friendlyError, dialog, enterConfirms, cols, schema, actionSheet } from '../client.js';
import { ctx } from '../ctx.js';
import { getLang } from '../i18n.js';
import { sampleMoment, samplePeek, teamNote, track } from '../onboarding.js';
import { loadProject, projectHead, inviteLink } from './project.js';
import { empty, namesFor, tabs, noSample, realProjects, byPerson } from './shared.js';
import { ic } from '../icons.js';
import { catChip, catLabel } from '../categories.js';

const SECTIONS = [
  ['worked_on', 'Worked on'],
  ['next', 'What to do next'],
  ['landed', 'What landed'],
  ['recurring', 'Keeps coming up']
];
const PERIODS = { last: 'Last practice', week: 'This week', month: 'This month', custom: 'Custom' };
// Marks a recap. The words next to it ("Summary by AI") say it's AI; the icon stays plain, like the rest of the app.
export function sparkle(cls = '') {
  return ic('recap', `ai-spark${cls ? ` ${cls}` : ''}`);
}
const FRESH_KEY = 'looproom:fresh-recap';

const SELECT = () => cols('id, project_id, created_by, scope, period, period_start, period_end, video_id, notes_up_to, note_count, content, sources, checked, shared_at, has_private, team, cycle, auto, created_at, projects(title), videos(title), recap_pins(user_id)');

// A team recap read in another language shows its saved translation (made once, when someone asks).
let showOriginal = false;
function localize(r) {
  const t = r?.content?.translations?.[getLang()];
  if (!r || !t || showOriginal || (r.content.lang || 'en') === getLang()) return r;
  const content = { ...r.content, headline: t.headline || r.content.headline };
  for (const [k] of SECTIONS) content[k] = (r.content[k] || []).map((it, i) => ({ ...it, text: t[k]?.[i] || it.text }));
  return { ...r, content };
}

const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const periodLabel = (r) => (r.period === 'custom' ? `${day(r.period_start)} – ${day(r.period_end)}` : PERIODS[r.period]);
const scopeLabel = (r) => (r.team ? 'Team recap' : r.scope === 'me' ? 'Just me' : 'Whole project');
// Who made it: dancerly (on schedule) or the member who made or updated it.
const byLine = (r, names) => (r.auto ? '<span>Made by dancerly</span>' : byPerson(names[r.created_by], r.created_by));
const visibility = (r) => (r.team ? '<span class="pill info">Team</span>' : r.shared_at ? '<span class="pill info">Shared</span>' : '<span class="pill">Only you</span>');
const isPinned = (r) => (r.recap_pins || []).some((p) => p.user_id === ctx.state.session.user.id);
// Re-running the same scope + period + video replaces the card; earlier runs fold under it.
// A team recap's updates are versions of that practice's recap, whoever pressed Update.
const versionKey = (r) => r.team ? ['team', r.project_id, r.cycle, r.video_id || ''].join('|') : [r.created_by, r.project_id, r.scope, r.period, r.video_id || '', r.period === 'custom' ? r.period_start.slice(0, 10) : ''].join('|');

function groupVersions(recaps) {
  const groups = new Map();
  for (const r of recaps) {
    const key = versionKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].map(([latest, ...older]) => ({ latest, older }));
}

function weekLabel(iso) {
  const d = new Date(iso);
  const monday = (x) => { const m = new Date(x); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m.getTime(); };
  const diff = Math.round((monday(new Date()) - monday(d)) / (7 * 864e5));
  return diff === 0 ? 'This week' : diff === 1 ? 'Last week' : `Week of ${day(new Date(monday(d)).toISOString())}`;
}

// ---------- Generating ----------
async function invokeErrorMessage(error) {
  try { const body = await error.context.json(); if (body?.error) return body.error; } catch {}
  return friendlyError(error);
}

export async function generateRecap(params) {
  const { data, error } = await sb.functions.invoke('generate-recap', { body: { ...params, lang: getLang() } });
  if (error) throw new Error(await invokeErrorMessage(error));
  return data;
}

// The New recap form. Resolves to the saved recap, or null.
export async function newRecap({ projectId = null, scope = 'me' } = {}) {
  // From outside a project, only real projects are offered; the sample's recap is made from inside it.
  const projects = projectId ? ctx.state.projects : realProjects();
  if (!projects.length) { toast('Recaps summarize a project’s notes. Create a project first.'); return null; }
  const pid = projectId || projects[0].id;
  const { data: videos } = await sb.from('videos').select('id, title, project_id').in('project_id', projects.map((p) => p.id)).order('created_at', { ascending: false });
  const el = document.createElement('dialog');
  el.className = 'dialog';
  el.innerHTML = `<form method="dialog" class="dialog-card recap-form">
    <h2>Custom recap</h2>
    <p>An AI summary of the notes in a period you pick: what you worked on, what to do next, and what keeps coming up.</p>
    ${projects.length > 1 ? `<label class="field"><span>Project</span><select name="project">${projects.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>` : `<input type="hidden" name="project" value="${pid}" />`}
    <div class="field"><span>Whose notes</span><div class="choices" role="radiogroup">
      <label><input type="radio" name="scope" value="me" ${scope === 'me' ? 'checked' : ''} /><b>Just me</b><small>Notes by you, on your takes, or mentioning you. Yours until you share it.</small></label>
      <label><input type="radio" name="scope" value="project" ${scope === 'project' ? 'checked' : ''} /><b>Team</b><small>Everyone on the project sees it. Private notes are left out.</small></label>
    </div></div>
    <label class="field"><span>Period</span><select name="period">${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}" ${k === 'week' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="date-row" data-dates hidden>
      <label class="field"><span>From</span><input type="date" name="from" /></label>
      <label class="field"><span>To</span><input type="date" name="to" /></label>
    </div>
    <label class="field"><span>Video</span><select name="video"></select></label>
    <div class="dialog-actions"><button value="cancel" formnovalidate class="btn ghost">Cancel</button><button value="ok" class="btn primary">Generate</button></div>
  </form>`;
  document.body.append(el);
  const form = el.querySelector('form');
  const fillVideos = () => {
    const list = (videos || []).filter((v) => v.project_id === form.elements.namedItem('project').value);
    form.elements.namedItem('video').innerHTML = `<option value="">All videos</option>${list.map((v) => `<option value="${v.id}">${esc(v.title)}</option>`).join('')}`;
  };
  fillVideos();
  form.elements.namedItem('project').addEventListener?.('change', () => fillVideos());
  const period = form.elements.namedItem('period');
  period.addEventListener('change', () => {
    const custom = period.value === 'custom';
    el.querySelector('[data-dates]').hidden = !custom;
    form.elements.namedItem('from').required = custom;
  });
  enterConfirms(el);
  el.showModal();
  const values = await new Promise((resolve) => el.addEventListener('close', () => {
    const f = form.elements;
    resolve(el.returnValue === 'ok' ? { project_id: f.namedItem('project').value, scope: form.querySelector('[name=scope]:checked').value, period: period.value, from: f.namedItem('from').value || undefined, to: f.namedItem('to').value || undefined, video_id: f.namedItem('video').value || null } : null);
    el.remove();
  }));
  if (!values) return null;
  return runGeneration(values);
}

// One shared "writing…" overlay, then open the result.
async function runGeneration(params) {
  const busy = document.createElement('div');
  busy.className = 'recap-busy';
  busy.setAttribute('role', 'status');
  busy.innerHTML = `<div class="busy-card">
    <p class="ai-label">${sparkle()}Summary by AI</p>
    <b>Writing your recap…</b>
    <small>Reading the notes in this period. Usually a few seconds.</small>
    <div class="ai-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
  </div>`;
  document.body.append(busy);
  const started = Date.now();
  try {
    const result = await generateRecap(params);
    // The sample hands back a ready-made recap at once; it still takes a moment to "write", like the real one.
    if (result.sample) await new Promise((r) => setTimeout(r, Math.max(0, 2200 - (Date.now() - started))));
    if (result.empty) { toast(result.message || 'No notes in this period yet.'); return null; }
    if (result.sample) toast('In the sample, recaps are ready-made. Your own projects get fresh ones.');
    else if (result.cached) toast(result.recap?.team ? 'No new notes since the team’s latest recap — here it is.' : 'No new notes since your last recap — here it is.');
    if (!result.cached) { try { sessionStorage.setItem(FRESH_KEY, result.recap.id); } catch {} }
    ctx.navigate(`/app/recaps/${result.recap.id}`);
    return result.recap;
  } catch (err) {
    toast(err.message, 'error');
    return null;
  } finally {
    busy.remove();
  }
}

// The group-chat version of a recap: headline, the top three to-dos, and links. In the app's language.
function chatMessage(r, link, invite, pulse = null) {
  const ko = getLang() === 'ko';
  const next = (r.content?.next || []).slice(0, 3).map((it) => `• ${it.text}`).join('\n');
  return [
    `${ko ? 'AI 요약' : 'Recap'}: ${r.content?.headline || ''}`,
    pulse ? pulseText(pulse) : '',
    next ? `\n${ko ? '다음 연습 할 일' : 'Next up'}:\n${next}` : '',
    `\n${ko ? 'dancerly에서 전체 보기' : 'Read it in dancerly'}: ${link}`,
    invite ? `${ko ? '아직 팀에 없다면 여기서 합류하세요' : 'Not in this project yet? Join here'}: ${invite}` : ''
  ].filter(Boolean).join('\n');
}

// ---------- The team's numbers since the last practice ----------
// A team recap is words; this is the one line of numbers that goes with it: what got fixed since the practice
// before, what's still open now, and where most of it is. Team-visible notes only, like the recap itself.
async function teamPulse(r) {
  const { data } = await sb.from('notes').select('status, resolved_at, category').eq('project_id', r.project_id).is('private_to', null).limit(5000);
  if (!data) return null;
  const from = new Date(r.period_start).getTime();
  const fixed = data.filter((n) => n.status === 'resolved' && n.resolved_at && new Date(n.resolved_at).getTime() >= from).length;
  const open = data.filter((n) => n.status !== 'resolved');
  const counts = {};
  for (const n of open) if (n.category && n.category !== 'other') counts[n.category] = (counts[n.category] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const since = String(r.cycle || '').startsWith('rehearsal:') ? 'practice' : String(r.cycle || '').startsWith('week:') ? 'week' : 'period';
  return { fixed, open: open.length, top: top && top[1] >= 2 ? top[0] : null, since };
}
function pulseText(p) {
  const ko = getLang() === 'ko';
  const lead = ko ? { practice: '지난 연습 이후', week: '이번 주', period: '이 기간' }[p.since] : { practice: 'Since the last practice', week: 'This week', period: 'In this period' }[p.since];
  const parts = ko
    ? [`해결 ${p.fixed}개`, `남은 피드백 ${p.open}개`, p.top ? `가장 많은 분야: ${catLabel(p.top)}` : '']
    : [`${p.fixed} fixed`, `${p.open} still open`, p.top ? `most open: ${catLabel(p.top)}` : ''];
  return `${lead}: ${parts.filter(Boolean).join(' · ')}`;
}
function pulseHtml(p) {
  const ko = getLang() === 'ko';
  const lead = ko ? { practice: '지난 연습 이후', week: '이번 주', period: '이 기간' }[p.since] : { practice: 'Since the last practice', week: 'This week', period: 'In this period' }[p.since];
  return `<p class="recap-pulse" data-no-i18n><span class="pulse-lead">${lead}</span>
    <span class="pulse-num ok">${ic('check')}${ko ? `해결 <b>${p.fixed}</b>개` : `<b>${p.fixed}</b> fixed`}</span>
    <span class="pulse-num">${ko ? `남은 피드백 <b>${p.open}</b>개` : `<b>${p.open}</b> still open`}</span>
    ${p.top ? `<span class="pulse-num">${ko ? '가장 많은 분야' : 'Most open'} ${catChip(p.top)}</span>` : ''}</p>`;
}

// ---------- Rendering ----------
function citeChips(cites, sources) {
  return cites.map((ref) => {
    const i = sources.findIndex((s) => s.ref === ref);
    return i < 0 ? '' : `<button class="cite" data-cite="${esc(ref)}" aria-label="Source note ${i + 1}">${i + 1}</button>`;
  }).join('');
}

export function recapBody(r, { interactive = false } = {}) {
  const sources = r.sources || [];
  const mine = r.created_by === ctx.state.session.user.id && !r.team; // a team recap's ticks would be everyone's
  let order = 0; // reveal order for the first-open animation
  return SECTIONS.map(([key, label]) => {
    const items = r.content?.[key] || [];
    if (!items.length) return '';
    return `<section class="recap-section" style="--i:${order++}"><h3>${label}</h3><ul class="${key === 'next' ? 'todo' : ''}">${items.map((it, i) => {
      const done = key === 'next' && (r.checked || []).includes(i);
      const box = key === 'next' && interactive && mine ? `<input type="checkbox" data-check="${i}" ${done ? 'checked' : ''} aria-label="Done" />` : key === 'next' ? `<span class="todo-dot ${done ? 'done' : ''}"></span>` : '';
      return `<li class="${done ? 'done' : ''}" style="--i:${order++}">${box}<span>${esc(it.text)} ${citeChips(it.cites, sources)}</span></li>`;
    }).join('')}</ul></section>`;
  }).join('');
}

function recapMeta(r, names) {
  return `<span class="chip ai">${scopeLabel(r)}</span><span>${periodLabel(r)}</span><span>${r.note_count} ${r.note_count === 1 ? 'note' : 'notes'}</span>${r.videos ? `<span>${esc(r.videos.title)}</span>` : ''}<span>${byLine(r, names)}</span>`;
}

function recapRow(group, names, { showProject = false } = {}) {
  const r = group.latest;
  return `<div class="recap-row">
    <a class="row" href="/app/recaps/${r.id}" data-link>
      <span class="spark-mark">${sparkle()}</span>
      <span class="row-main">
        <span class="row-title">${esc(r.content?.headline || 'Recap')}</span>
        <span class="row-meta">${scopeLabel(r)} · ${periodLabel(r)}${showProject && r.projects ? ` · ${esc(r.projects.title)}` : ''} · ${byLine(r, names)}</span>
      </span>
      <span class="row-side">${isPinned(r) ? `<span title="Pinned">${ic('pin', 'solo')}</span>` : ''}${visibility(r)}<small>${timeAgo(r.created_at)}</small></span>
    </a>
    ${group.older.length ? `<details class="versions"><summary>${ic('right')}${group.older.length} earlier ${group.older.length === 1 ? 'version' : 'versions'}</summary>${group.older.map((o) => `<a href="/app/recaps/${o.id}" data-link>${timeAgo(o.created_at)} · ${o.note_count} notes · ${esc(o.content?.headline || '')}</a>`).join('')}</details>` : ''}
  </div>`;
}

function pinnedFirst(groups) {
  return [...groups].sort((a, b) => Number(isPinned(b.latest)) - Number(isPinned(a.latest)));
}

// "My recap": your own to-do list, made when you ask for it (not on a schedule, so nobody pays for recaps nobody reads).
// It covers the same stretch as the team's latest recap, or the past week before there is one.
export async function myRecap(projectId) {
  const { data } = schema.teamRecaps
    ? await sb.from('recaps').select('period_start').eq('project_id', projectId).eq('team', true).order('created_at', { ascending: false }).limit(1)
    : { data: [] };
  const since = data?.[0]?.period_start;
  return runGeneration(since
    ? { project_id: projectId, scope: 'me', period: 'custom', range: { from: since, to: new Date().toISOString() } }
    : { project_id: projectId, scope: 'me', period: 'week' });
}

// How the team recap arrives, and the owner's switch.
function autoLine(p) {
  if (!schema.teamRecaps || p.project.is_sample) return '<p class="fine left">Recaps are AI summaries of the notes in your projects.</p>';
  const on = p.project.auto_recap !== false;
  const words = on
    ? 'dancerly writes the team recap 3 hours before each rehearsal on the calendar, or Monday morning if none is scheduled, once there are 3 or more new notes. Everyone on the project sees it.'
    : 'Automatic team recaps are off for this project.';
  return `<p class="fine left">${words} ${p.isOwner ? `<button class="text-btn link" data-auto-recap>${on ? 'Turn off' : 'Turn on'}</button>` : ''}</p>`;
}

// ---------- Project › Recaps (the home of recaps) ----------
export async function renderProjectRecaps(projectId) {
  const { view, setCrumbs } = ctx;
  const me = ctx.state.session.user.id;
  const show = new URLSearchParams(location.search).get('show') || 'all';
  const [p, { data: rawRecaps, error }] = await Promise.all([
    loadProject(projectId),
    sb.from('recaps').select(SELECT()).eq('project_id', projectId).order('created_at', { ascending: false }).limit(200)
  ]);
  if (error) throw error;
  const recaps = rawRecaps.map(localize);
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Recaps']]);
  const filtered = recaps.filter((r) => show === 'team' ? r.team || r.shared_at : show === 'mine' ? r.created_by === me && !r.team : show === 'pinned' ? isPinned(r) : true);
  const groups = pinnedFirst(groupVersions(filtered));
  const names = await namesFor(recaps.map((r) => r.created_by));
  const pinned = groups.filter((g) => isPinned(g.latest));
  const rest = groups.filter((g) => !isPinned(g.latest));
  const byWeek = new Map();
  for (const g of rest) { const k = weekLabel(g.latest.created_at); if (!byWeek.has(k)) byWeek.set(k, []); byWeek.get(k).push(g); }
  const base = `/app/p/${projectId}/recaps`;
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'recaps', `<button class="btn primary" data-my-recap>My recap</button><button class="icon-btn" data-recap-more aria-label="More" title="More">${ic('more', 'solo')}</button>`)}
    <div class="filters"><div class="seg small" role="group" aria-label="Show">${[['all', 'All'], ['team', 'Team'], ['mine', 'Mine'], ['pinned', 'Pinned']].map(([k, l]) => `<a href="${base}${k === 'all' ? '' : `?show=${k}`}" data-link aria-selected="${k === show}">${l}</a>`).join('')}</div></div>
    ${groups.length ? `
      ${pinned.length ? `<h2 class="group-title">${ic('pin')}Pinned</h2><div class="list">${pinned.map((g) => recapRow(g, names)).join('')}</div>` : ''}
      ${[...byWeek].map(([label, gs]) => `<h2 class="group-title">${label}</h2><div class="list">${gs.map((g) => recapRow(g, names)).join('')}</div>`).join('')}`
      : empty('recap', recaps.length ? 'Nothing in this view' : 'No recaps yet', recaps.length ? 'Try another filter.' : 'The team recap shows up here before your next rehearsal, once there are a few notes. For your own to-do list now, make My recap.', recaps.length ? '' : `<button class="btn primary" data-my-recap>My recap</button>${samplePeek('recaps', 'See a finished recap in the sample')}`)}
    ${autoLine(p)}
  </section>`;
  $$('[data-my-recap]').forEach((b) => b.addEventListener('click', () => myRecap(projectId)));
  $('[data-recap-more]')?.addEventListener('click', async (e) => {
    const choice = await actionSheet({ title: 'Recaps', anchor: e.currentTarget, actions: [{ value: 'custom', label: 'Custom recap…', hint: 'Pick the period, the video, and whose notes', icon: 'calendar' }] });
    if (choice === 'custom') newRecap({ projectId });
  });
  $('[data-auto-recap]')?.addEventListener('click', async () => {
    const on = p.project.auto_recap === false;
    if (!on && !(await dialog({ title: 'Turn off team recaps?', body: 'dancerly stops writing the team recap before practice. Anyone can still make one from More › Custom recap.', confirm: 'Turn off' }))) return;
    const { error: e } = await sb.from('projects').update({ auto_recap: on }).eq('id', projectId);
    if (e) return toast(friendlyError(e), 'error');
    toast(on ? 'Team recaps are on.' : 'Team recaps are off for this project.');
    renderProjectRecaps(projectId);
  });
}

// ---------- Me › My recaps ----------
export async function renderMyRecaps() {
  const { view, setCrumbs } = ctx;
  const me = ctx.state.session.user.id;
  setCrumbs([['Me', '/app/me'], ['My recaps']]);
  await ctx.state.projectsReady;
  const [{ data: mine, error }, { data: pins }] = await Promise.all([
    noSample(sb.from('recaps').select(SELECT())).eq('created_by', me).order('created_at', { ascending: false }).limit(200),
    sb.from('recap_pins').select('recap_id').eq('user_id', me)
  ]);
  if (error) throw error;
  // Pinned recaps someone else shared still belong in your list.
  const extraIds = (pins || []).map((p) => p.recap_id).filter((id) => !mine.some((r) => r.id === id));
  let pinnedShared = [];
  if (extraIds.length) ({ data: pinnedShared = [] } = await noSample(sb.from('recaps').select(SELECT())).in('id', extraIds));
  const groups = pinnedFirst(groupVersions([...pinnedShared, ...mine].map(localize)));
  const names = await namesFor(groups.map((g) => g.latest.created_by));
  view.innerHTML = `<section class="page narrow-wide">
    <header class="page-head"><div><h1>My recaps</h1><p class="muted sub">Every recap you made, across all your projects. Pinned first.</p></div><button class="btn" data-new-recap>Custom recap</button></header>
    ${groups.length ? `<div class="list">${groups.map((g) => recapRow(g, names, { showProject: true })).join('')}</div>`
      : empty('recap', 'No recaps yet', 'A recap turns a week of notes into a short to-do list for your next practice.', `<button class="btn primary" data-new-recap>Custom recap</button>${samplePeek('recaps', 'See a finished recap in the sample')}`)}
  </section>`;
  $$('[data-new-recap]').forEach((b) => b.addEventListener('click', () => newRecap()));
}

// ---------- One recap ----------
export async function renderRecap(recapId) {
  const { view, setCrumbs, navigate } = ctx;
  const me = ctx.state.session.user.id;
  const { data: raw, error } = await sb.from('recaps').select(SELECT()).eq('id', recapId).maybeSingle();
  if (error) throw error;
  const r = localize(raw);
  if (!r) throw new Error('This recap isn’t available. It may be private or deleted.');
  setCrumbs([['Projects', '/app/projects'], [r.projects?.title || 'Project', `/app/p/${r.project_id}`], ['Recaps', `/app/p/${r.project_id}/recaps`], [r.content?.headline ? 'Recap' : 'Recap']]);
  const names = await namesFor([r.created_by]);
  const mine = r.created_by === me && !r.team;
  // New feedback since: for a team recap, only what it could include (team-visible, the same video).
  let newerQ = sb.from('notes').select('id', { count: 'exact', head: true }).eq('project_id', r.project_id).gt('created_at', r.notes_up_to);
  if (r.team) newerQ = newerQ.is('private_to', null);
  if (r.team && r.video_id) newerQ = newerQ.eq('video_id', r.video_id);
  const [{ count: newer }, { data: role }] = await Promise.all([
    newerQ,
    sb.from('project_members').select('role').eq('project_id', r.project_id).eq('user_id', me).maybeSingle()
  ]);
  const isOwner = role?.role === 'owner';
  const canRedo = mine || r.team;
  const pulse = r.team ? await teamPulse(r).catch(() => null) : null;
  // Written in another language: the saved translation, or a button that makes one.
  const otherLang = (raw.content?.lang || 'en') !== getLang();
  const translated = otherLang && raw.content?.translations?.[getLang()];
  const pinned = isPinned(r);
  const { data: myFeedback } = await sb.from('recap_feedback').select('helpful').eq('recap_id', r.id).eq('user_id', me).maybeSingle();
  const cited = (r.sources || []).map((src, i) => ({ ...src, n: i + 1 }));
  await ctx.state.projectsReady;
  const sampleProject = ctx.state.projects.some((p) => p.id === r.project_id && p.is_sample);
  // Just generated? A short fade-in, once.
  let fresh = false;
  try { fresh = sessionStorage.getItem(FRESH_KEY) === r.id; if (fresh) sessionStorage.removeItem(FRESH_KEY); } catch {}
  view.innerHTML = `<section class="page narrow-wide">
    <article class="recap-card ${fresh ? 'is-fresh' : ''}">
      <header class="recap-head">
        <p class="ai-label">${sparkle()}Summary by AI <span>· from ${r.note_count} ${r.note_count === 1 ? 'note' : 'notes'}</span></p>
        <h1 class="recap-headline">${esc(r.content?.headline || 'Recap')}</h1>
        <div class="recap-meta">${recapMeta(r, names)}</div>
        ${pulse ? pulseHtml(pulse) : ''}
        ${otherLang && !sampleProject ? `<p class="recap-lang">${translated ? `<span>${showOriginal ? 'Original' : 'Translated by AI'}</span> · <button class="text-btn link" data-original>${showOriginal ? 'Show translation' : 'Show original'}</button>` : `<button class="btn small ghost" data-translate>${getLang() === 'ko' ? 'Show in Korean' : 'Show in English'}</button>`}</p>` : ''}
      </header>
      ${newer ? `<div class="recap-stale"><span>${newer} new ${newer === 1 ? 'note' : 'notes'} since this recap</span>${canRedo ? `<button class="btn small primary" data-regenerate>${r.team ? 'Update' : 'Regenerate'}</button>` : ''}</div>` : ''}
      <div class="recap-body" data-body>${recapBody(r, { interactive: true })}</div>
      <footer class="recap-actions">
        <button class="btn small ${pinned ? 'on' : ''}" data-pin aria-pressed="${pinned}">${ic('pin')}${pinned ? 'Pinned' : 'Pin'}</button>
        ${r.scope === 'project' && !r.has_private && (r.shared_at || mine || r.team) && !sampleProject ? '<button class="btn small primary" data-chat-share>Share to group chat</button>' : ''}
        ${mine && !r.shared_at && !r.has_private ? '<button class="btn small" data-share>Share to project</button>' : ''}
        ${mine && r.has_private && !sampleProject ? `<button class="btn small" data-share-public title="Private notes stay between the two people, so this recap stays yours. This makes a new one without them.">${ic('lock')}Share without private feedback</button>` : ''}
        ${mine && r.shared_at ? '<button class="btn small ghost" data-unshare>Make private</button>' : ''}
        ${mine && !newer ? '<button class="btn small ghost" data-regenerate>Regenerate</button>' : ''}
        ${r.team && !newer ? `<span class="fine">${ic('check')}Up to date</span>` : ''}
        ${r.team && isOwner && !sampleProject ? `<a class="btn small ghost" href="/app/p/${r.project_id}/overview" data-link>How it’s going${ic('right', 'after')}</a>` : ''}
        ${mine || (r.team && isOwner) ? '<button class="btn small ghost danger push-right" data-delete>Delete</button>' : ''}
      </footer>
      ${cited.length ? `<details class="recap-sources"><summary>Sources · ${cited.length} ${cited.length === 1 ? 'note' : 'notes'} cited</summary><ol>${cited.map((src) => `<li><span class="src-n">${src.n}</span><a href="/app/p/${r.project_id}/v/${src.video_id}?take=${src.take_number ?? ''}&note=${src.note_id}" data-link><span class="row-meta"><b>${esc(src.author)}</b> · ${esc(src.video_title)}${src.take_number ? ` · Take ${src.take_number}` : ''} · <span class="time-tag">${src.t_end === null ? fmt(src.t_start) : `${fmt(src.t_start)}–${fmt(src.t_end)}`}</span></span><span>${esc(src.body)}</span></a></li>`).join('')}</ol></details>` : ''}
      <div class="recap-foot">
        <p class="ai-disclaimer">AI can make mistakes. Check the cited notes before acting on it. ${r.team ? (r.auto ? 'Written automatically before practice. Everyone on the project sees it.' : 'Everyone on the project sees this recap.') : r.shared_at ? `Shared with the project ${timeAgo(r.shared_at)}.` : 'Only you can see this until you share it.'}</p>
        <div class="feedback" role="group" aria-label="Was this recap useful?"><span>Useful?</span>
          <button class="icon-btn ${myFeedback?.helpful === true ? 'on' : ''}" data-feedback="up" aria-pressed="${myFeedback?.helpful === true}" aria-label="Useful" title="Useful">${ic('agree', 'solo')}</button>
          <button class="icon-btn ${myFeedback?.helpful === false ? 'on' : ''}" data-feedback="down" aria-pressed="${myFeedback?.helpful === false}" aria-label="Not useful" title="Not useful">${ic('disagree', 'solo')}</button>
        </div>
      </div>
    </article>
    <div class="cite-pop" data-pop hidden></div>
  </section>`;

  const params = r.team ? { update_of: r.id } : { project_id: r.project_id, scope: r.scope, period: r.period, video_id: r.video_id, ...(r.period === 'custom' ? { from: r.period_start.slice(0, 10), to: r.period_end.slice(0, 10) } : {}) };
  $$('[data-regenerate]').forEach((b) => b.addEventListener('click', () => runGeneration(params)));
  $('[data-original]')?.addEventListener('click', () => { showOriginal = !showOriginal; renderRecap(recapId); });
  $('[data-translate]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await generateRecap({ translate: r.id }); showOriginal = false; renderRecap(recapId); }
    catch (err) { btn.disabled = false; toast(err.message, 'error'); }
  });
  $$('[data-feedback]').forEach((b) => b.addEventListener('click', async () => {
    const helpful = b.dataset.feedback === 'up';
    const undo = myFeedback?.helpful === helpful;
    const { error: e } = undo
      ? await sb.from('recap_feedback').delete().eq('recap_id', r.id).eq('user_id', me)
      : await sb.from('recap_feedback').upsert({ recap_id: r.id, user_id: me, helpful });
    if (e) return toast(friendlyError(e), 'error');
    if (!undo) toast(helpful ? 'Thanks — glad it helped.' : 'Thanks. Regenerate or check the sources if something’s off.');
    renderRecap(recapId);
  }));
  $('[data-pin]').addEventListener('click', async () => {
    const { error: pinErr } = pinned
      ? await sb.from('recap_pins').delete().eq('recap_id', r.id).eq('user_id', me)
      : await sb.from('recap_pins').insert({ recap_id: r.id });
    if (pinErr) return toast(friendlyError(pinErr), 'error');
    renderRecap(recapId);
  });
  // A recap that used private notes stays yours. To share, make it again from team-visible notes only, then share that one.
  $('[data-share-public]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; // read before any await: the event is done by then
    const ok = await dialog({ title: 'Share without private feedback?', body: 'We’ll make a new recap for the same period without the private notes and share it with the project. This one stays just for you.', confirm: 'Make and share' });
    if (!ok) return;
    btn.disabled = true;
    toast('Making a version without private feedback…');
    try {
      const data = await generateRecap({ project_id: r.project_id, scope: r.scope, period: r.period, video_id: r.video_id, range: { from: r.period_start, to: r.period_end }, exclude_private: true });
      if (data?.empty) { btn.disabled = false; return toast(data.message || 'Nothing left to summarize without the private notes.'); }
      const fresh = data?.recap;
      if (!fresh?.id) throw new Error('Couldn’t make the recap. Try again.');
      const { error: shareErr } = await sb.from('recaps').update({ shared_at: new Date().toISOString() }).eq('id', fresh.id);
      if (shareErr) throw shareErr;
      toast('Shared with the project, without the private feedback.');
      navigate(`/app/recaps/${fresh.id}`);
    } catch (err) {
      btn.disabled = false;
      toast(err?.message || friendlyError(err), 'error');
    }
  });
  $('[data-share]')?.addEventListener('click', async () => {
    const ok = await dialog({ title: 'Share this recap?', body: 'Everyone on the project can read it, and they’ll get it in their Inbox.', confirm: 'Share to project' });
    if (!ok) return;
    const { error: shareErr } = await sb.from('recaps').update({ shared_at: new Date().toISOString() }).eq('id', r.id);
    if (shareErr) return toast(friendlyError(shareErr), 'error');
    toast('Shared with the project.');
    renderRecap(recapId);
  });
  // The recap goes where the team already talks (KakaoTalk, Discord, WhatsApp…): a short message, a link to the
  // full recap, and the invite link for anyone who isn't on dancerly yet. Sharing it also makes it visible in the project.
  $('[data-chat-share]')?.addEventListener('click', async () => {
    if (!r.shared_at && !r.team) {
      const ok = await dialog({ title: 'Share to your group chat?', body: 'This also shares the recap with the project, so members can open it from the link.', confirm: 'Continue' });
      if (!ok) return;
      const { error: shareErr } = await sb.from('recaps').update({ shared_at: new Date().toISOString() }).eq('id', r.id);
      if (shareErr) return toast(friendlyError(shareErr), 'error');
      r.shared_at = new Date().toISOString();
    }
    let invite = null;
    try { invite = (await inviteLink(r.project_id)).link; } catch {}
    const text = chatMessage(r, `${location.origin}/app/recaps/${r.id}`, invite, pulse);
    track('recap_chat_shared', { scope: r.scope });
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ text }); return renderRecap(recapId); } catch (e) { if (e?.name === 'AbortError') return renderRecap(recapId); }
    }
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it in your group chat.'); }
    catch { await dialog({ title: 'Copy this message', body: `<textarea class="chat-copy" rows="9" readonly>${esc(text)}</textarea>`, confirm: 'Done' }); }
    renderRecap(recapId);
  });
  $('[data-unshare]')?.addEventListener('click', async () => {
    const { error: e } = await sb.from('recaps').update({ shared_at: null }).eq('id', r.id);
    if (e) return toast(friendlyError(e), 'error');
    renderRecap(recapId);
  });
  $('[data-delete]')?.addEventListener('click', async () => {
    const ok = await dialog({ title: 'Delete this recap?', body: r.team ? 'It’s deleted for everyone on the project. The notes stay.' : 'Your notes stay. You can make a new recap any time.', confirm: 'Delete', danger: true });
    if (!ok) return;
    const { error: e } = await sb.from('recaps').delete().eq('id', r.id);
    if (e) return toast(friendlyError(e), 'error');
    navigate(`/app/p/${r.project_id}/recaps`, { replace: true });
  });
  // Ticking a to-do: remembered on the recap; for a personal recap, its notes move to Practicing.
  $$('[data-check]').forEach((box) => box.addEventListener('change', async () => {
    const i = Number(box.dataset.check);
    const checked = box.checked ? [...new Set([...(r.checked || []), i])] : (r.checked || []).filter((x) => x !== i);
    const { error: e } = await sb.from('recaps').update({ checked }).eq('id', r.id);
    if (e) { box.checked = !box.checked; return toast(friendlyError(e), 'error'); }
    r.checked = checked;
    box.closest('li').classList.toggle('done', box.checked);
    if (box.checked && r.scope === 'me') {
      const refs = r.content.next[i].cites;
      const open = (r.sources || []).filter((s) => refs.includes(s.ref) && s.status === 'open');
      await Promise.all(open.map((s) => sb.rpc('set_note_status', { p_note: s.note_id, p_status: 'practicing' })));
      if (open.length) toast(`Marked ${open.length} ${open.length === 1 ? 'note' : 'notes'} as Practicing.`);
    }
  }));
  wireCitations(r);
  // Recaps live outside the project's URL, so the sample bar is switched on here.
  await ctx.state.projectsReady;
  const sample = ctx.state.projects.find((p) => p.id === r.project_id && p.is_sample);
  if (sample) {
    ctx.sampleBar(sample);
    sampleMoment('recap');
    view.querySelector('.page')?.insertAdjacentHTML('beforeend', teamNote('recaps'));
  }
}

// Tap a [n] chip: the note behind the sentence, and a link to play that moment.
export function wireCitations(r, root = document) {
  // One popup, on the page itself: inside the recap it was placed twice as far right and widened the page,
  // which made phones zoom out.
  $$('[data-pop]', root).forEach((el) => { if (el.parentElement !== document.body) el.remove(); });
  const pop = document.querySelector('body > [data-pop]') || Object.assign(document.body.appendChild(document.createElement('div')), { className: 'cite-pop', hidden: true });
  pop.setAttribute('data-pop', '');
  $$('[data-cite]', root).forEach((chip) => chip.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const s = (r.sources || []).find((x) => x.ref === chip.dataset.cite);
    if (!s) return;
    const time = s.t_end === null ? fmt(s.t_start) : `${fmt(s.t_start)}–${fmt(s.t_end)}`;
    pop.innerHTML = `<p class="row-meta"><b>${esc(s.author)}</b> · ${esc(s.video_title)}${s.take_number ? ` · Take ${s.take_number}` : ''} · <span class="time-tag">${time}</span></p>
      <p>${esc(s.body)}</p>
      <a class="link" href="/app/p/${r.project_id}/v/${s.video_id}?take=${s.take_number ?? ''}&note=${s.note_id}" data-link>${ic('play')}Play this moment</a>`;
    pop.hidden = false;
    // Next to the chip, kept on screen: below it, or above when there's no room.
    const box = chip.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.min(Math.max(12, box.left - 20), vw - w - 12)}px`;
    pop.style.top = `${box.bottom + 8 + h <= innerHeight - 12 ? box.bottom + 8 : Math.max(12, box.top - 8 - h)}px`;
  }));
}
document.addEventListener('click', (e) => {
  const pop = document.querySelector('[data-pop]');
  if (pop && !e.target.closest('[data-pop]')) pop.hidden = true;
});
// It stays by its chip: scrolling closes it.
addEventListener('scroll', () => { const pop = document.querySelector('[data-pop]'); if (pop) pop.hidden = true; }, { capture: true, passive: true });

// ---------- Home card ----------
const RECAP_MIN_NOTES = 3;
export async function homeRecapCard() {
  const { data } = await noSample(sb.from('recaps').select(SELECT())).order('created_at', { ascending: false }).limit(1);
  const r = localize(data?.[0]);
  if (!r) {
    // A recap summarizes notes, so the first one is offered once there are a few to work with,
    // not to someone whose team hasn't written any yet (it would come back empty).
    const { count } = await noSample(sb.from('notes').select('id', { count: 'exact', head: true }));
    if ((count || 0) < RECAP_MIN_NOTES) return { html: '', wire: () => {} };
    return {
      html: `<section class="panel recap-teaser"><div class="panel-head"><div><p class="ai-label">${sparkle()}Summary by AI</p><h2>Get ready for your next practice</h2><p class="muted">Turn this week’s notes into a short list of what to work on.</p></div><button class="btn primary" data-home-recap>Create recap</button></div></section>`,
      wire: () => $('[data-home-recap]')?.addEventListener('click', () => newRecap())
    };
  }
  const names = await namesFor([r.created_by]);
  const next = (r.content?.next || []).slice(0, 3);
  return {
    html: `<section class="panel recap-teaser">
      <div class="panel-head"><div><p class="ai-label">${sparkle()}Summary by AI<span>· ${esc(r.projects?.title || '')}</span></p><h2>${esc(r.content?.headline || 'Recap')}</h2><p class="muted">${scopeLabel(r)} · ${periodLabel(r)} · ${byLine(r, names)} · ${timeAgo(r.created_at)}</p></div>
        <div class="head-actions"><button class="btn small ghost" data-home-recap>${r.team ? 'My recap' : 'New'}</button><a class="btn small" href="/app/recaps/${r.id}" data-link>Open</a></div></div>
      ${next.length ? `<ul class="todo compact">${next.map((it, i) => `<li class="${(r.checked || []).includes(i) ? 'done' : ''}"><span class="todo-dot ${(r.checked || []).includes(i) ? 'done' : ''}"></span><span>${esc(it.text)}</span></li>`).join('')}</ul>` : ''}
    </section>`,
    wire: () => $('[data-home-recap]')?.addEventListener('click', () => (r.team ? myRecap(r.project_id) : newRecap({ projectId: r.project_id, scope: r.scope })))
  };
}
