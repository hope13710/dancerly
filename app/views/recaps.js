// AI recaps: made per project × period, saved automatically, pinned per person, shared on purpose.
// They live in Project › Recaps, show up on Home, and collect in Me › My recaps.
import { sb, $, $$, esc, fmt, timeAgo, toast, friendlyError, dialog } from '../client.js';
import { ctx } from '../ctx.js';
import { getLang } from '../i18n.js';
import { sampleMoment } from '../onboarding.js';
import { loadProject, projectHead } from './project.js';
import { empty, namesFor, tabs, noSample, realProjects } from './shared.js';

const SECTIONS = [
  ['worked_on', 'Worked on'],
  ['next', 'What to do next'],
  ['landed', 'What landed'],
  ['recurring', 'Keeps coming up']
];
const PERIODS = { last: 'Last rehearsal', week: 'This week', month: 'This month', custom: 'Custom' };
// The four-point star that marks AI output. Always shown next to words that say so.
export function sparkle(cls = '') {
  return `<svg class="ai-spark ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5c.6 4.9 2.6 8 9.5 10.5-6.9 2.5-8.9 5.6-9.5 10.5-.6-4.9-2.6-8-9.5-10.5C9.4 9.5 11.4 6.4 12 1.5Z" /></svg>`;
}
const FRESH_KEY = 'looproom:fresh-recap';

const SELECT = 'id, project_id, created_by, scope, period, period_start, period_end, video_id, notes_up_to, note_count, content, sources, checked, shared_at, has_private, created_at, projects(title), videos(title), recap_pins(user_id)';

const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const periodLabel = (r) => (r.period === 'custom' ? `${day(r.period_start)} – ${day(r.period_end)}` : PERIODS[r.period]);
const scopeLabel = (r) => (r.scope === 'me' ? 'Just me' : 'Whole project');
const isPinned = (r) => (r.recap_pins || []).some((p) => p.user_id === ctx.state.session.user.id);
// Re-running the same scope + period + video replaces the card; earlier runs fold under it.
const versionKey = (r) => [r.created_by, r.project_id, r.scope, r.period, r.video_id || '', r.period === 'custom' ? r.period_start.slice(0, 10) : ''].join('|');

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
    <h2>✦ New recap</h2>
    <p>An AI summary of the notes in a period: what you worked on, what to do next, and what keeps coming up.</p>
    ${projects.length > 1 ? `<label class="field"><span>Project</span><select name="project">${projects.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>` : `<input type="hidden" name="project" value="${pid}" />`}
    <div class="field"><span>Whose notes</span><div class="choices" role="radiogroup">
      <label><input type="radio" name="scope" value="me" ${scope === 'me' ? 'checked' : ''} /><b>Just me</b><small>Notes by you, on your takes, or mentioning you</small></label>
      <label><input type="radio" name="scope" value="project" ${scope === 'project' ? 'checked' : ''} /><b>Whole project</b><small>Everything your team noted</small></label>
    </div></div>
    <label class="field"><span>Period</span><select name="period">${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}" ${k === 'week' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="date-row" data-dates hidden>
      <label class="field"><span>From</span><input type="date" name="from" /></label>
      <label class="field"><span>To</span><input type="date" name="to" /></label>
    </div>
    <label class="field"><span>Video</span><select name="video"></select></label>
    <div class="dialog-actions"><button value="cancel" formnovalidate class="btn ghost">Cancel</button><button value="ok" class="btn primary">✦ Generate</button></div>
  </form>`;
  document.body.append(el);
  const form = el.querySelector('form');
  const fillVideos = () => {
    const list = (videos || []).filter((v) => v.project_id === form.elements.namedItem('project').value);
    form.elements.namedItem('video').innerHTML = `<option value="">All videos</option>${list.map((v) => `<option value="${v.id}">${esc(v.title)}</option>`).join('')}`;
  };
  fillVideos();
  form.elements.namedItem('project').addEventListener?.('change', fillVideos);
  const period = form.elements.namedItem('period');
  period.addEventListener('change', () => {
    const custom = period.value === 'custom';
    el.querySelector('[data-dates]').hidden = !custom;
    form.elements.namedItem('from').required = custom;
  });
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
  try {
    const result = await generateRecap(params);
    if (result.empty) { toast(result.message || 'No notes in this period yet.'); return null; }
    if (result.cached) toast('No new notes since your last recap — here it is.');
    else { try { sessionStorage.setItem(FRESH_KEY, result.recap.id); } catch {} }
    ctx.navigate(`/app/recaps/${result.recap.id}`);
    return result.recap;
  } catch (err) {
    toast(err.message, 'error');
    return null;
  } finally {
    busy.remove();
  }
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
  const mine = r.created_by === ctx.state.session.user.id;
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
  return `<span class="chip ai">${scopeLabel(r)}</span><span>${periodLabel(r)}</span><span>${r.note_count} ${r.note_count === 1 ? 'note' : 'notes'}</span>${r.videos ? `<span>${esc(r.videos.title)}</span>` : ''}<span>by ${esc(names[r.created_by] || 'a teammate')}</span>`;
}

function recapRow(group, names, { showProject = false } = {}) {
  const r = group.latest;
  return `<div class="recap-row">
    <a class="row" href="/app/recaps/${r.id}" data-link>
      <span class="spark-mark">${sparkle()}</span>
      <span class="row-main">
        <span class="row-title">${esc(r.content?.headline || 'Recap')}</span>
        <span class="row-meta">${scopeLabel(r)} · ${periodLabel(r)}${showProject && r.projects ? ` · ${esc(r.projects.title)}` : ''} · by ${esc(names[r.created_by] || 'a teammate')}</span>
      </span>
      <span class="row-side">${isPinned(r) ? '<span title="Pinned">📌</span>' : ''}${r.shared_at ? '<span class="pill info">Shared</span>' : '<span class="pill">Only you</span>'}<small>${timeAgo(r.created_at)}</small></span>
    </a>
    ${group.older.length ? `<details class="versions"><summary>▸ ${group.older.length} earlier ${group.older.length === 1 ? 'version' : 'versions'}</summary>${group.older.map((o) => `<a href="/app/recaps/${o.id}" data-link>${timeAgo(o.created_at)} · ${o.note_count} notes · ${esc(o.content?.headline || '')}</a>`).join('')}</details>` : ''}
  </div>`;
}

function pinnedFirst(groups) {
  return [...groups].sort((a, b) => Number(isPinned(b.latest)) - Number(isPinned(a.latest)));
}

// ---------- Project › Recaps (the home of recaps) ----------
export async function renderProjectRecaps(projectId) {
  const { view, setCrumbs } = ctx;
  const me = ctx.state.session.user.id;
  const show = new URLSearchParams(location.search).get('show') || 'all';
  const [p, { data: recaps, error }] = await Promise.all([
    loadProject(projectId),
    sb.from('recaps').select(SELECT).eq('project_id', projectId).order('created_at', { ascending: false }).limit(200)
  ]);
  if (error) throw error;
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Recaps']]);
  const filtered = recaps.filter((r) => show === 'shared' ? r.shared_at : show === 'mine' ? r.created_by === me : show === 'pinned' ? isPinned(r) : true);
  const groups = pinnedFirst(groupVersions(filtered));
  const names = await namesFor(recaps.map((r) => r.created_by));
  const pinned = groups.filter((g) => isPinned(g.latest));
  const rest = groups.filter((g) => !isPinned(g.latest));
  const byWeek = new Map();
  for (const g of rest) { const k = weekLabel(g.latest.created_at); if (!byWeek.has(k)) byWeek.set(k, []); byWeek.get(k).push(g); }
  const base = `/app/p/${projectId}/recaps`;
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'recaps', '<button class="btn primary" data-new-recap>✦ New recap</button>')}
    <div class="filters"><div class="seg small" role="group" aria-label="Show">${[['all', 'All'], ['shared', 'Shared'], ['mine', 'Mine'], ['pinned', '📌 Pinned']].map(([k, l]) => `<a href="${base}${k === 'all' ? '' : `?show=${k}`}" data-link aria-selected="${k === show}">${l}</a>`).join('')}</div></div>
    ${groups.length ? `
      ${pinned.length ? `<h2 class="group-title">📌 Pinned</h2><div class="list">${pinned.map((g) => recapRow(g, names)).join('')}</div>` : ''}
      ${[...byWeek].map(([label, gs]) => `<h2 class="group-title">${label}</h2><div class="list">${gs.map((g) => recapRow(g, names)).join('')}</div>`).join('')}`
      : empty('✦', recaps.length ? 'Nothing in this view' : 'No recaps yet', recaps.length ? 'Try another filter.' : 'Make one before your next rehearsal: pick <b>Just me</b> for your own to-do list, or <b>Whole project</b> to share with the team.', recaps.length ? '' : '<button class="btn primary" data-new-recap>✦ New recap</button>')}
    <p class="fine left">Recaps are AI summaries of your team’s notes. Only you see a recap until you share it.</p>
  </section>`;
  $$('[data-new-recap]').forEach((b) => b.addEventListener('click', () => newRecap({ projectId })));
}

// ---------- Me › My recaps ----------
export async function renderMyRecaps() {
  const { view, setCrumbs } = ctx;
  const me = ctx.state.session.user.id;
  setCrumbs([['Me', '/app/me'], ['My recaps']]);
  await ctx.state.projectsReady;
  const [{ data: mine, error }, { data: pins }] = await Promise.all([
    noSample(sb.from('recaps').select(SELECT)).eq('created_by', me).order('created_at', { ascending: false }).limit(200),
    sb.from('recap_pins').select('recap_id').eq('user_id', me)
  ]);
  if (error) throw error;
  // Pinned recaps someone else shared still belong in your list.
  const extraIds = (pins || []).map((p) => p.recap_id).filter((id) => !mine.some((r) => r.id === id));
  let pinnedShared = [];
  if (extraIds.length) ({ data: pinnedShared = [] } = await noSample(sb.from('recaps').select(SELECT)).in('id', extraIds));
  const groups = pinnedFirst(groupVersions([...pinnedShared, ...mine]));
  const names = await namesFor(groups.map((g) => g.latest.created_by));
  view.innerHTML = `<section class="page narrow-wide">
    <header class="page-head"><div><h1>My recaps</h1><p class="muted sub">Every recap you made, across all your projects. Pinned first.</p></div><button class="btn primary" data-new-recap>✦ New recap</button></header>
    ${groups.length ? `<div class="list">${groups.map((g) => recapRow(g, names, { showProject: true })).join('')}</div>`
      : empty('✦', 'No recaps yet', 'A recap turns a week of notes into a short to-do list for your next rehearsal.', '<button class="btn primary" data-new-recap>✦ New recap</button>')}
  </section>`;
  $$('[data-new-recap]').forEach((b) => b.addEventListener('click', () => newRecap()));
}

// ---------- One recap ----------
export async function renderRecap(recapId) {
  const { view, setCrumbs, navigate } = ctx;
  const me = ctx.state.session.user.id;
  const { data: r, error } = await sb.from('recaps').select(SELECT).eq('id', recapId).maybeSingle();
  if (error) throw error;
  if (!r) throw new Error('This recap isn’t available. It may be private or deleted.');
  setCrumbs([['Projects', '/app/projects'], [r.projects?.title || 'Project', `/app/p/${r.project_id}`], ['Recaps', `/app/p/${r.project_id}/recaps`], [r.content?.headline ? 'Recap' : 'Recap']]);
  const names = await namesFor([r.created_by]);
  const mine = r.created_by === me;
  const { count: newer } = await sb.from('notes').select('id', { count: 'exact', head: true }).eq('project_id', r.project_id).gt('created_at', r.notes_up_to);
  const pinned = isPinned(r);
  const { data: myFeedback } = await sb.from('recap_feedback').select('helpful').eq('recap_id', r.id).eq('user_id', me).maybeSingle();
  const cited = (r.sources || []).map((src, i) => ({ ...src, n: i + 1 }));
  // Just generated? A short fade-in, once.
  let fresh = false;
  try { fresh = sessionStorage.getItem(FRESH_KEY) === r.id; if (fresh) sessionStorage.removeItem(FRESH_KEY); } catch {}
  view.innerHTML = `<section class="page narrow-wide">
    <article class="recap-card ${fresh ? 'is-fresh' : ''}">
      <header class="recap-head">
        <p class="ai-label">${sparkle()}Summary by AI <span>· from ${r.note_count} ${r.note_count === 1 ? 'note' : 'notes'}</span></p>
        <h1 class="recap-headline">${esc(r.content?.headline || 'Recap')}</h1>
        <div class="recap-meta">${recapMeta(r, names)}</div>
      </header>
      ${newer ? `<div class="recap-stale"><span>${newer} new ${newer === 1 ? 'note' : 'notes'} since this recap</span>${mine ? '<button class="btn small primary" data-regenerate>Regenerate</button>' : ''}</div>` : ''}
      <div class="recap-body" data-body>${recapBody(r, { interactive: true })}</div>
      <footer class="recap-actions">
        <button class="btn small ${pinned ? 'on' : ''}" data-pin aria-pressed="${pinned}">📌 ${pinned ? 'Pinned' : 'Pin'}</button>
        ${mine && !r.shared_at && !r.has_private ? '<button class="btn small" data-share>Share to project</button>' : ''}
        ${mine && r.has_private ? '<span class="pill" title="Private notes stay between the two people, so this recap stays yours">🔒 Uses private notes · can’t be shared</span>' : ''}
        ${mine && r.shared_at ? '<button class="btn small ghost" data-unshare>Make private</button>' : ''}
        ${mine && !newer ? '<button class="btn small ghost" data-regenerate>Regenerate</button>' : ''}
        ${mine ? '<button class="btn small ghost danger push-right" data-delete>Delete</button>' : ''}
      </footer>
      ${cited.length ? `<details class="recap-sources"><summary>Sources · ${cited.length} ${cited.length === 1 ? 'note' : 'notes'} cited</summary><ol>${cited.map((src) => `<li><span class="src-n">${src.n}</span><a href="/app/p/${r.project_id}/v/${src.video_id}?take=${src.take_number ?? ''}&note=${src.note_id}" data-link><span class="row-meta"><b>${esc(src.author)}</b> · ${esc(src.video_title)}${src.take_number ? ` · Take ${src.take_number}` : ''} · <span class="time-tag">${src.t_end === null ? fmt(src.t_start) : `${fmt(src.t_start)}–${fmt(src.t_end)}`}</span></span><span>${esc(src.body)}</span></a></li>`).join('')}</ol></details>` : ''}
      <div class="recap-foot">
        <p class="ai-disclaimer">AI can make mistakes. Check the cited notes before acting on it. ${r.shared_at ? `Shared with the project ${timeAgo(r.shared_at)}.` : 'Only you can see this until you share it.'}</p>
        <div class="feedback" role="group" aria-label="Was this recap useful?"><span>Useful?</span>
          <button class="icon-btn ${myFeedback?.helpful === true ? 'on' : ''}" data-feedback="up" aria-pressed="${myFeedback?.helpful === true}" aria-label="Useful" title="Useful">👍</button>
          <button class="icon-btn ${myFeedback?.helpful === false ? 'on' : ''}" data-feedback="down" aria-pressed="${myFeedback?.helpful === false}" aria-label="Not useful" title="Not useful">👎</button>
        </div>
      </div>
    </article>
    <div class="cite-pop" data-pop hidden></div>
  </section>`;

  const params = { project_id: r.project_id, scope: r.scope, period: r.period, video_id: r.video_id, ...(r.period === 'custom' ? { from: r.period_start.slice(0, 10), to: r.period_end.slice(0, 10) } : {}) };
  $$('[data-regenerate]').forEach((b) => b.addEventListener('click', () => runGeneration(params)));
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
  $('[data-share]')?.addEventListener('click', async () => {
    const ok = await dialog({ title: 'Share this recap?', body: 'Everyone on the project can read it, and they’ll get it in their Inbox.', confirm: 'Share to project' });
    if (!ok) return;
    const { error: shareErr } = await sb.from('recaps').update({ shared_at: new Date().toISOString() }).eq('id', r.id);
    if (shareErr) return toast(friendlyError(shareErr), 'error');
    toast('Shared with the project.');
    renderRecap(recapId);
  });
  $('[data-unshare]')?.addEventListener('click', async () => {
    const { error: e } = await sb.from('recaps').update({ shared_at: null }).eq('id', r.id);
    if (e) return toast(friendlyError(e), 'error');
    renderRecap(recapId);
  });
  $('[data-delete]')?.addEventListener('click', async () => {
    const ok = await dialog({ title: 'Delete this recap?', body: 'Your notes stay. You can make a new recap any time.', confirm: 'Delete', danger: true });
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
  if (sample) { ctx.sampleBar(sample); sampleMoment('recap'); }
}

// Tap a [n] chip: the note behind the sentence, and a link to play that moment.
export function wireCitations(r, root = document) {
  const pop = $('[data-pop]', root) || Object.assign(document.body.appendChild(document.createElement('div')), { className: 'cite-pop' });
  pop.setAttribute('data-pop', '');
  $$('[data-cite]', root).forEach((chip) => chip.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const s = (r.sources || []).find((x) => x.ref === chip.dataset.cite);
    if (!s) return;
    const time = s.t_end === null ? fmt(s.t_start) : `${fmt(s.t_start)}–${fmt(s.t_end)}`;
    pop.innerHTML = `<p class="row-meta"><b>${esc(s.author)}</b> · ${esc(s.video_title)}${s.take_number ? ` · Take ${s.take_number}` : ''} · <span class="time-tag">${time}</span></p>
      <p>${esc(s.body)}</p>
      <a class="link" href="/app/p/${r.project_id}/v/${s.video_id}?take=${s.take_number ?? ''}&note=${s.note_id}" data-link>▶ Play this moment</a>`;
    pop.hidden = false;
    const box = chip.getBoundingClientRect();
    const left = Math.min(Math.max(12, box.left + window.scrollX - 20), window.scrollX + document.documentElement.clientWidth - 332);
    pop.style.left = `${left}px`;
    pop.style.top = `${box.bottom + window.scrollY + 8}px`;
  }));
}
document.addEventListener('click', (e) => {
  const pop = document.querySelector('[data-pop]');
  if (pop && !e.target.closest('[data-pop]')) pop.hidden = true;
});

// ---------- Home card ----------
export async function homeRecapCard() {
  const { data } = await noSample(sb.from('recaps').select(SELECT)).order('created_at', { ascending: false }).limit(1);
  const r = data?.[0];
  if (!r) {
    return {
      html: `<section class="panel recap-teaser"><div class="panel-head"><div><p class="ai-label">${sparkle()}Summary by AI</p><h2>Get ready for your next rehearsal</h2><p class="muted">Turn this week’s notes into a short list of what to work on.</p></div><button class="btn primary" data-home-recap>Create recap</button></div></section>`,
      wire: () => $('[data-home-recap]')?.addEventListener('click', () => newRecap())
    };
  }
  const names = await namesFor([r.created_by]);
  const next = (r.content?.next || []).slice(0, 3);
  return {
    html: `<section class="panel recap-teaser">
      <div class="panel-head"><div><p class="ai-label">${sparkle()}Summary by AI<span>· ${esc(r.projects?.title || '')}</span></p><h2>${esc(r.content?.headline || 'Recap')}</h2><p class="muted">${scopeLabel(r)} · ${periodLabel(r)} · by ${esc(names[r.created_by] || 'a teammate')} · ${timeAgo(r.created_at)}</p></div>
        <div class="head-actions"><button class="btn small ghost" data-home-recap>New</button><a class="btn small" href="/app/recaps/${r.id}" data-link>Open</a></div></div>
      ${next.length ? `<ul class="todo compact">${next.map((it, i) => `<li class="${(r.checked || []).includes(i) ? 'done' : ''}"><span class="todo-dot ${(r.checked || []).includes(i) ? 'done' : ''}"></span><span>${esc(it.text)}</span></li>`).join('')}</ul>` : ''}
    </section>`,
    wire: () => $('[data-home-recap]')?.addEventListener('click', () => newRecap({ projectId: r.project_id, scope: r.scope }))
  };
}
