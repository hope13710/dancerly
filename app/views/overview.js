// Project › Overview (goal, music, what's next, how it's going) and › Count sheet (the piece, section by section).
import { sb, $, $$, esc, initials, fmt, timeAgo, toast, friendlyError, dialog, schema, isEnter } from '../client.js';
import { track } from '../onboarding.js';
import { ctx } from '../ctx.js';
import { kindClass, daysUntil, daysLabel } from './shared.js';
import { showEvent } from './calendar.js';
import { loadProject, projectHead } from './project.js';

const STATUS = [['learning', 'Learning'], ['practicing', 'Practicing'], ['clean', 'Clean']];

export async function renderProjectOverview(projectId) {
  const { view, setCrumbs } = ctx;
  const nowIso = new Date().toISOString();
  const [p, { data: extra }, { data: rows }, { data: events }, { count: openNotes }, { data: requests }, { data: videos }] = await Promise.all([
    loadProject(projectId),
    sb.from('projects').select('goal, music_title, music_url').eq('id', projectId).single(),
    sb.from('count_sheet_rows').select('status').eq('project_id', projectId),
    sb.from('project_events').select('id, project_id, title, kind, starts_at, ends_at, location, details, created_by').eq('project_id', projectId).gte('starts_at', nowIso).order('starts_at').limit(5),
    sb.from('notes').select('id', { count: 'exact', head: true }).eq('project_id', projectId).neq('status', 'resolved'),
    sb.from('requests').select('id, title, due_at').eq('project_id', projectId).eq('status', 'active').order('due_at', { ascending: true, nullsFirst: false }).limit(3),
    sb.from('videos').select('id, title, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(3)
  ]);
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Overview']]);
  const goal = p.goal; // picked by the owner, else the next show
  const next = (events || [])[0];
  const clean = (rows || []).filter((r) => r.status === 'clean').length;
  const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'overview')}
    <div class="overview-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>Goal</h2></div>${p.isOwner ? '<button class="btn ghost small" data-edit-goal>Edit</button>' : ''}</div>
        ${extra?.goal ? `<p class="brief">${esc(extra.goal)}</p>` : `<p class="panel-empty">${p.isOwner ? 'What is this project for? “Clean, confident chorus for the spring showcase.”' : 'The owner hasn’t written a goal yet.'}</p>`}
        ${extra?.music_title || extra?.music_url ? `<p class="music">♪ ${extra.music_url ? `<a class="link" href="${esc(extra.music_url)}" target="_blank" rel="noopener noreferrer">${esc(extra.music_title || extra.music_url)} ↗</a>` : esc(extra.music_title)}</p>` : ''}
      </section>
      <section class="panel countdown">
        ${goal ? `<p class="eyebrow">${goal.picked ? '🎯 Goal' : 'Next show'}</p><b class="big-num">${daysLabel(daysUntil(goal.starts_at))}</b><p class="muted"><button class="text-btn" data-event="${goal.id}">${esc(goal.title)}</button> · ${when(goal.starts_at)}${goal.location ? ` · ${esc(goal.location)}` : ''}</p>${!goal.picked && p.isOwner && schema.goal ? '<p class="fine left">Working toward something else? Open an event and set it as the goal.</p>' : ''}`
          : `<p class="eyebrow">Next</p>${next ? `<b class="big-num small"><button class="text-btn" data-event="${next.id}">${esc(next.title)}</button></b><p class="muted">${when(next.starts_at)}</p>${p.isOwner && schema.goal ? '<p class="fine left">Working toward a show or competition? Open its event and set it as the goal for a countdown.</p>' : ''}` : `<p class="panel-empty">Nothing scheduled. <a class="link" href="/app/p/${projectId}/calendar" data-link>Add a rehearsal or show →</a></p>`}`}
      </section>
    </div>
    <div class="stats">
      <a class="stat link-stat" href="/app/p/${projectId}/counts" data-link><small>Sections clean</small><b>${rows?.length ? `${clean}/${rows.length}` : '—'}</b><span>${rows?.length ? 'on the count sheet' : 'start a count sheet'}</span></a>
      <a class="stat link-stat" href="/app/p/${projectId}/notes" data-link><small>Open notes</small><b>${openNotes ?? 0}</b><span>to practice</span></a>
      <a class="stat link-stat" href="/app/p/${projectId}/requests" data-link><small>Open requests</small><b>${requests?.length ?? 0}</b><span>${requests?.[0]?.due_at ? `next due ${new Date(requests[0].due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'videos asked for'}</span></a>
      <a class="stat link-stat" href="/app/p/${projectId}/people" data-link><small>People</small><b>${p.members.length}</b><span>on this project</span></a>
    </div>
    <div class="home-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>Coming up</h2></div><a class="link" href="/app/p/${projectId}/calendar" data-link>Calendar →</a></div>
        ${events?.length ? `<div class="list flush">${events.map((e) => `<button type="button" class="row" data-event="${e.id}"><span class="cal-dot ${kindClass(e.kind)}"></span><span class="row-main"><span class="row-title">${e.id === goal?.id && goal.picked ? '🎯 ' : ''}${esc(e.title)}</span><span class="row-meta">${when(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ''}</span></span><span class="chev">›</span></button>`).join('')}</div>` : '<p class="panel-empty">Nothing scheduled yet.</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Latest videos</h2></div><a class="link" href="/app/p/${projectId}" data-link>All videos →</a></div>
        ${videos?.length ? `<div class="list flush">${videos.map((v) => `<a class="row" href="/app/p/${projectId}/v/${v.id}" data-link><span class="video-thumb sm">▶</span><span class="row-main"><span class="row-title">${esc(v.title)}</span><span class="row-meta">${timeAgo(v.created_at)}</span></span><span class="chev">›</span></a>`).join('')}</div>` : '<p class="panel-empty">No videos yet.</p>'}
      </section>
    </div>
  </section>`;
  // Any event on this page opens its details (and, for the owner, "Set as project goal").
  const byId = Object.fromEntries([...(events || []), ...(goal ? [goal] : [])].map((e) => [e.id, e]));
  $$('[data-event]').forEach((b) => b.addEventListener('click', () => showEvent(byId[b.dataset.event], () => renderProjectOverview(projectId), projectId)));
  $('[data-edit-goal]')?.addEventListener('click', async () => {
    const values = await dialog({
      title: 'Goal and music',
      fields: [
        { name: 'goal', label: 'Goal', value: extra?.goal || '', max: 1000, placeholder: 'Clean, confident chorus for the spring showcase' },
        { name: 'music_title', label: 'Music', value: extra?.music_title || '', max: 200, placeholder: 'Song — Artist' },
        { name: 'music_url', label: 'Music link (optional)', type: 'url', value: extra?.music_url || '', max: 500, placeholder: 'https://…' }
      ]
    });
    if (!values) return;
    const { error } = await sb.from('projects').update({ goal: values.goal || null, music_title: values.music_title || null, music_url: values.music_url || null }).eq('id', projectId);
    if (error) return toast(/music_url/.test(error.message) ? 'The music link must start with http:// or https://' : friendlyError(error), 'error');
    renderProjectOverview(projectId);
  });
}

// ---------- Count sheet ----------
const parseTime = (text) => {
  const m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export async function renderCountSheet(projectId) {
  const { view, setCrumbs } = ctx;
  const [p, { data: rows, error }, { data: videos }] = await Promise.all([
    loadProject(projectId),
    sb.from('count_sheet_rows').select(`id, position, section, counts, focus, video_id, t_start, status, updated_by, updated_at${schema.sheetTake ? ', take_id' : ''}`).eq('project_id', projectId).order('position').order('created_at'),
    sb.from('videos').select('id, title, takes(id, number)').eq('project_id', projectId).order('created_at', { ascending: false })
  ]);
  if (error) throw error;
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Overview', `/app/p/${projectId}/overview`], ['Count sheet']]);
  // Kept, but out of the tab bar until we see teams using it.
  track('count_sheet_opened', { rows: rows.length });
  // A reference time belongs to the take that was newest when it was set; opening it later lands on the same moment.
  const latestTake = (videoId) => (videos || []).find((v) => v.id === videoId)?.takes.reduce((a, t) => (!a || t.number > a.number ? t : a), null) || null;
  const clean = rows.filter((r) => r.status === 'clean').length;
  const videoOptions = (selected) => `<option value="">—</option>${(videos || []).map((v) => `<option value="${v.id}" ${v.id === selected ? 'selected' : ''}>${esc(v.title)}</option>`).join('')}`;
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'overview', '<button class="btn primary" data-add-row>+ Add section</button>')}
    ${rows.length ? `<div class="sheet-summary"><div class="progress"><i style="width:${(clean / rows.length) * 100}%"></i></div><span>${clean} of ${rows.length} sections clean</span></div>
    <div class="table-wrap"><table class="table sheet">
      <thead><tr><th class="grip"></th><th>Section</th><th>Counts</th><th>Focus</th><th>Reference</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-row="${r.id}">
        <td class="grip"><button class="icon-btn" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="icon-btn" data-move="1" ${i === rows.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></td>
        <td><input class="cell" data-field="section" value="${esc(r.section)}" maxlength="80" aria-label="Section" /></td>
        <td><input class="cell narrow" data-field="counts" value="${esc(r.counts || '')}" maxlength="80" placeholder="1–8 ×2" aria-label="Counts" /></td>
        <td><input class="cell wide" data-field="focus" value="${esc(r.focus || '')}" maxlength="500" placeholder="What to watch for" aria-label="Focus" /></td>
        <td class="ref"><select class="cell" data-field="video_id" aria-label="Reference video">${videoOptions(r.video_id)}</select><input class="cell time" data-field="t_start" value="${r.t_start === null ? '' : fmt(Number(r.t_start))}" placeholder="0:00" aria-label="Time" />${r.video_id ? `<a class="link play" href="/app/p/${projectId}/v/${r.video_id}${r.t_start !== null ? `?t=${Number(r.t_start)}${r.take_id ? `&from=${r.take_id}` : ''}` : ''}" data-link aria-label="Play reference">▶</a>` : ''}</td>
        <td><select class="cell status s-${r.status}" data-field="status" aria-label="Status">${STATUS.map(([k, l]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><button class="icon-btn" data-delete-row aria-label="Delete section">✕</button></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="fine left">Everyone on the project can edit. Changes save as you type.</p>`
      : `<div class="empty"><div class="empty-icon">#</div><h2>Break the piece into sections</h2><p>One row per section — intro, verse, chorus, ending — with its counts, what to focus on, and a reference moment. Mark each one Clean when it’s ready.</p><button class="btn primary" data-add-row>+ Add the first section</button></div>`}
  </section>`;

  const timers = {};
  let edited = false;
  const save = async (id, patch) => {
    if (!edited) { edited = true; track('count_sheet_edited', { field: Object.keys(patch)[0] }); }
    if (schema.sheetTake && ('t_start' in patch || 'video_id' in patch)) {
      const row = rows.find((r) => r.id === id);
      patch.take_id = latestTake('video_id' in patch ? patch.video_id : row?.video_id)?.id || null;
    }
    const { error: e } = await sb.from('count_sheet_rows').update(patch).eq('id', id);
    if (e) toast(friendlyError(e), 'error');
  };
  $$('[data-row]').forEach((tr) => {
    const id = tr.dataset.row;
    tr.querySelectorAll('[data-field]').forEach((input) => {
      const field = input.dataset.field;
      const commit = () => {
        let value = input.value.trim();
        if (field === 'section' && !value) return toast('A section needs a name.', 'error');
        if (field === 't_start') { value = value ? parseTime(value) : null; if (input.value.trim() && value === null) return toast('Use minutes:seconds, like 1:05.', 'error'); }
        if (field === 'status') input.className = `cell status s-${value}`;
        save(id, { [field]: value === '' ? null : value });
        if (field === 'status' || field === 'video_id') setTimeout(() => renderCountSheet(projectId), 150);
      };
      if (input.tagName === 'SELECT') input.addEventListener('change', commit);
      else {
        input.addEventListener('input', () => { clearTimeout(timers[id + field]); timers[id + field] = setTimeout(commit, 600); });
        // Enter saves now and moves down a row, like a spreadsheet.
        input.addEventListener('keydown', (e) => {
          if (!isEnter(e)) return;
          e.preventDefault();
          if (timers[id + field]) { clearTimeout(timers[id + field]); timers[id + field] = null; commit(); }
          const below = tr.nextElementSibling?.querySelector(`[data-field="${field}"]`);
          if (below) below.focus(); else input.blur();
        });
      }
    });
    tr.querySelector('[data-delete-row]').addEventListener('click', async () => {
      const ok = await dialog({ title: 'Delete this section?', confirm: 'Delete', danger: true });
      if (!ok) return;
      const { error: e } = await sb.from('count_sheet_rows').delete().eq('id', id);
      if (e) return toast(friendlyError(e), 'error');
      renderCountSheet(projectId);
    });
    tr.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
      const i = rows.findIndex((r) => r.id === id);
      const j = i + Number(b.dataset.move);
      const order = rows.map((r) => r.id);
      [order[i], order[j]] = [order[j], order[i]];
      await Promise.all(order.map((rid, pos) => sb.from('count_sheet_rows').update({ position: pos }).eq('id', rid)));
      renderCountSheet(projectId);
    }));
  });
  $$('[data-add-row]').forEach((b) => b.addEventListener('click', async () => {
    const values = await dialog({ title: 'Add section', fields: [{ name: 'section', label: 'Section', placeholder: 'Chorus', required: true, max: 80 }, { name: 'counts', label: 'Counts (optional)', placeholder: '1–8 ×4', max: 80 }], confirm: 'Add' });
    if (!values?.section) return;
    const { error: e } = await sb.from('count_sheet_rows').insert({ project_id: projectId, section: values.section, counts: values.counts || null, position: rows.length });
    if (e) return toast(friendlyError(e), 'error');
    renderCountSheet(projectId);
  }));
}
