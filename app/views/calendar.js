// Calendar: rehearsals, shows, and request due dates — per project, or across all of them.
// Month grid on wide screens, an agenda list on phones (or when chosen).
import { sb, $, $$, esc, toast, friendlyError, dialog } from '../client.js';
import { ctx } from '../ctx.js';
import { loadProject, projectHead } from './project.js';
import { subscribeCalendar } from './share.js';
import { kindLabel, kindClass } from './shared.js';

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const timeOf = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

async function loadItems(projectIds, from, to) {
  const [{ data: events, error }, { data: requests, error: rErr }] = await Promise.all([
    sb.from('project_events').select('id, project_id, title, kind, starts_at, ends_at, location, details, created_by, projects(title)').in('project_id', projectIds).gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at'),
    sb.from('requests').select('id, project_id, title, due_at, status, projects(title)').in('project_id', projectIds).not('due_at', 'is', null).gte('due_at', from.toISOString()).lt('due_at', to.toISOString())
  ]);
  if (error || rErr) throw error || rErr;
  return [
    ...events.map((e) => ({ type: 'event', kind: e.kind, at: new Date(e.starts_at), end: e.ends_at ? new Date(e.ends_at) : null, title: e.title, project_id: e.project_id, project: e.projects?.title || '', raw: e })),
    ...requests.map((r) => ({ type: 'due', kind: 'due', at: new Date(r.due_at), end: null, title: r.title, project_id: r.project_id, project: r.projects?.title || '', closed: r.status === 'closed', raw: r }))
  ].sort((a, b) => a.at - b.at);
}

export async function renderCalendar(projectId = null) {
  const { view, setCrumbs, state, navigate } = ctx;
  const params = new URLSearchParams(location.search);
  const phone = matchMedia('(max-width: 700px)').matches;
  const mode = params.get('view') === 'agenda' || (phone && params.get('view') !== 'month') ? 'agenda' : 'month';
  const now = new Date();
  const [y, m] = (params.get('m') || `${now.getFullYear()}-${now.getMonth() + 1}`).split('-').map(Number);
  const month = new Date(y, m - 1, 1);
  const p = projectId ? await loadProject(projectId) : null;
  await state.projectsReady;
  const projectIds = projectId ? [projectId] : state.projects.map((x) => x.id);
  setCrumbs(projectId ? [['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Calendar']] : [['Calendar']]);
  const base = projectId ? `/app/p/${projectId}/calendar` : '/app/calendar';
  const link = (changes) => `${base}?${new URLSearchParams({ view: mode, m: `${month.getFullYear()}-${month.getMonth() + 1}`, ...changes })}`;
  const shift = (n) => { const d = new Date(month.getFullYear(), month.getMonth() + n, 1); return `${d.getFullYear()}-${d.getMonth() + 1}`; };

  // Month: the weeks covering it (Mon–Sun). Agenda: today through 60 days out.
  const gridStart = new Date(month); gridStart.setDate(1 - ((month.getDay() + 6) % 7));
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const agendaEnd = new Date(today); agendaEnd.setDate(today.getDate() + 60);
  const items = projectIds.length ? await loadItems(projectIds, mode === 'month' ? gridStart : today, mode === 'month' ? gridEnd : agendaEnd) : [];
  const byDay = new Map();
  for (const it of items) { const k = dayKey(it.at); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(it); }

  const chip = (it, i) => `<button class="cal-item ${kindClass(it.kind)} ${it.closed ? 'closed' : ''}" data-item="${i}" title="${esc(it.title)}">${it.type === 'due' ? 'Due · ' : `${timeOf(it.at)} `}${esc(it.title)}</button>`;
  const head = `${projectId ? projectHead(p, 'calendar', '<button class="btn primary" data-new-event>+ Add event</button>') : `<header class="page-head"><div><h1>Calendar</h1><p class="muted sub">Rehearsals, shows, and request due dates across your projects.</p></div><div class="head-actions"><button class="btn primary" data-new-event>+ Add event</button></div></header>`}`;
  const toolbar = `<div class="cal-toolbar">
    ${mode === 'month' ? `<div class="cal-nav"><a class="btn small ghost icon" href="${link({ m: shift(-1) })}" data-link aria-label="Previous month">‹</a><h2>${month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><a class="btn small ghost icon" href="${link({ m: shift(1) })}" data-link aria-label="Next month">›</a><a class="btn small" href="${link({ m: `${now.getFullYear()}-${now.getMonth() + 1}` })}" data-link>Today</a></div>` : '<h2>Next 60 days</h2>'}
    <div class="cal-right"><div class="seg small" role="group" aria-label="View"><a href="${link({ view: 'month' })}" data-link aria-selected="${mode === 'month'}">Month</a><a href="${link({ view: 'agenda' })}" data-link aria-selected="${mode === 'agenda'}">Agenda</a></div>
      <button class="btn small ghost" data-subscribe title="Keep Google, Apple, or Outlook Calendar in sync">Subscribe</button><button class="btn small ghost" data-ics title="Download upcoming events as a calendar file">Export .ics</button></div>
  </div>
  <div class="cal-legend"><span class="k-rehearsal">Rehearsal</span><span class="k-show">Show</span><span class="k-other">Other</span>${[...new Set(items.filter((it) => it.type === 'event' && !['rehearsal', 'show', 'other'].includes(it.kind)).map((it) => it.kind))].map((k) => `<span class="${kindClass(k)}">${esc(k)}</span>`).join('')}<span class="k-due">Request due</span></div>`;

  let body;
  if (mode === 'month') {
    const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
    body = `<div class="cal-grid" role="grid">
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}
      ${cells.map((d) => {
        const list = byDay.get(dayKey(d)) || [];
        return `<div class="cal-cell ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${dayKey(d) === dayKey(today) ? 'today' : ''}" role="gridcell" data-day="${dayKey(d)}">
          <span class="cal-date">${d.getDate()}</span>
          ${list.slice(0, 3).map((it) => chip(it, items.indexOf(it))).join('')}${list.length > 3 ? `<button class="cal-more" data-day-more="${dayKey(d)}">+${list.length - 3} more</button>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  } else {
    body = byDay.size ? `<div class="agenda">${[...byDay].map(([k, list]) => {
      const d = new Date(`${k}T00:00`);
      return `<section class="agenda-day ${k === dayKey(today) ? 'today' : ''}"><h3><b>${d.toLocaleDateString(undefined, { weekday: 'short' })}</b> ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</h3>
        <div class="list">${list.map((it) => `<button class="row agenda-item" data-item="${items.indexOf(it)}">
          <span class="cal-dot ${kindClass(it.kind)}"></span>
          <span class="row-main"><span class="row-title">${it.type === 'due' ? 'Due: ' : ''}${esc(it.title)}</span><span class="row-meta">${it.type === 'due' ? timeOf(it.at) : `${timeOf(it.at)}${it.end ? `–${timeOf(it.end)}` : ''}`}${it.raw.location ? ` · ${esc(it.raw.location)}` : ''}${projectId ? '' : ` · ${esc(it.project)}`}</span></span>
          <span class="row-side"><span class="pill ${it.kind === 'due' ? (it.closed ? '' : 'warn') : it.kind === 'show' ? 'info' : ''}">${esc(kindLabel(it.kind))}</span></span>
        </button>`).join('')}</div></section>`;
    }).join('')}</div>` : '<div class="empty"><div class="empty-icon">◷</div><h2>Nothing in the next 60 days</h2><p>Add your rehearsals and shows. Request due dates show up here on their own.</p><button class="btn primary" data-new-event>+ Add event</button></div>';
  }

  view.innerHTML = `<section class="page">${head}${toolbar}${body}</section>`;

  $$('[data-new-event]').forEach((b) => b.addEventListener('click', () => editEvent({ projectId, date: null })));
  $$('[data-item]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openItem(items[Number(b.dataset.item)]); }));
  $$('[data-day-more]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); navigate(link({ view: 'agenda' })); }));
  // Click an empty part of a day to add an event on that day.
  $$('[data-day]').forEach((cell) => cell.addEventListener('click', () => editEvent({ projectId, date: cell.dataset.day })));
  $('[data-subscribe]').addEventListener('click', subscribeCalendar);
  $('[data-ics]').addEventListener('click', () => exportIcs(items, projectId ? p.project.title : 'Looproom'));

  function openItem(it) {
    if (it.type === 'due') return navigate(`/app/p/${it.project_id}/requests/${it.raw.id}`);
    showEvent(it.raw, () => renderCalendar(projectId), projectId);
  }
}

async function showEvent(e, refresh, projectId) {
  const me = ctx.state.session.user.id;
  const project = ctx.state.projects.find((p) => p.id === e.project_id);
  const start = new Date(e.starts_at);
  const when = `${start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${timeOf(start)}${e.ends_at ? `–${timeOf(new Date(e.ends_at))}` : ''}`;
  const choice = await dialog({
    title: e.title,
    body: `<span class="pill ${e.kind === 'show' ? 'info' : ''}">${esc(kindLabel(e.kind))}</span> ${esc(when)}${e.location ? `<br>${esc(e.location)}` : ''}${projectId ? '' : `<br>${esc(project?.title || '')}`}${e.details ? `<br><br>${esc(e.details)}` : ''}`,
    confirm: e.created_by === me ? 'Edit' : 'Close',
    extra: e.created_by === me ? 'Delete' : null
  });
  if (!choice || e.created_by !== me) return;
  if (choice.extra) {
    const sure = await dialog({ title: 'Delete this event?', confirm: 'Delete', danger: true });
    if (!sure) return;
    const { error } = await sb.from('project_events').delete().eq('id', e.id);
    if (error) return toast(friendlyError(error), 'error');
    return refresh();
  }
  editEvent({ projectId: e.project_id, event: e, refresh });
}

// Add or edit an event. date: "YYYY-MM-DD" to prefill.
export async function editEvent({ projectId = null, date = null, event = null, refresh = null }) {
  const projects = ctx.state.projects;
  if (!projects.length) { toast('Events belong to a project. Create one first.'); return; }
  const local = (iso) => { const d = new Date(iso); return { date: dayKey(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }; };
  const s = event ? local(event.starts_at) : { date: date || dayKey(new Date()), time: '18:00' };
  const e2 = event?.ends_at ? local(event.ends_at) : { time: event ? '' : '20:00' };
  // Built-in types first, then the ones your teams already use.
  const { data: used } = await sb.from('project_events').select('kind').in('project_id', projects.map((p) => p.id)).order('created_at', { ascending: false }).limit(300);
  const kinds = [...new Set(['rehearsal', 'show', 'other', ...(used || []).map((u) => u.kind), ...(event ? [event.kind] : [])])];
  const el = document.createElement('dialog');
  el.className = 'dialog';
  el.innerHTML = `<form method="dialog" class="dialog-card">
    <h2>${event ? 'Edit event' : 'Add event'}</h2>
    ${!projectId && !event && projects.length > 1 ? `<label class="field"><span>Project</span><select name="project">${projects.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></label>` : ''}
    <label class="field"><span>Title</span><input name="title" maxlength="120" required value="${esc(event?.title || '')}" placeholder="Full rehearsal" /></label>
    <label class="field"><span>Type</span><select name="kind" data-kind>${kinds.map((k) => `<option value="${esc(k)}" ${(event?.kind || 'rehearsal') === k ? 'selected' : ''}>${esc(kindLabel(k))}</option>`).join('')}<option value="__new">＋ New type…</option></select></label>
    <label class="field" data-new-kind hidden><span>New type</span><input name="newKind" maxlength="30" placeholder="Class, Workshop, Filming…" /></label>
    <div class="date-row three">
      <label class="field"><span>Date</span><input type="date" name="date" required value="${s.date}" /></label>
      <label class="field"><span>Starts</span><input type="time" name="start" required value="${s.time}" /></label>
      <label class="field"><span>Ends <small>optional</small></span><input type="time" name="end" value="${e2.time}" /></label>
    </div>
    <label class="field"><span>Where <small>optional</small></span><input name="location" maxlength="200" value="${esc(event?.location || '')}" placeholder="Studio B" /></label>
    <label class="field"><span>Notes <small>optional</small></span><textarea name="details" rows="2" maxlength="2000">${esc(event?.details || '')}</textarea></label>
    <div class="dialog-actions"><button value="cancel" formnovalidate class="btn ghost">Cancel</button><button value="ok" class="btn primary">${event ? 'Save' : 'Add event'}</button></div>
  </form>`;
  document.body.append(el);
  el.showModal();
  const f = el.querySelector('form').elements;
  const kindSelect = el.querySelector('[data-kind]');
  kindSelect.addEventListener('change', () => {
    const custom = kindSelect.value === '__new';
    el.querySelector('[data-new-kind]').hidden = !custom;
    f.namedItem('newKind').required = custom;
    if (custom) f.namedItem('newKind').focus();
  });
  const values = await new Promise((resolve) => el.addEventListener('close', () => {
    resolve(el.returnValue === 'ok' ? {
      project: f.namedItem('project')?.value || projectId || event?.project_id || projects[0].id,
      title: f.namedItem('title').value.trim(), kind: f.namedItem('kind').value === '__new' ? f.namedItem('newKind').value.trim().slice(0, 30) : f.namedItem('kind').value, date: f.namedItem('date').value,
      start: f.namedItem('start').value, end: f.namedItem('end').value, location: f.namedItem('location').value.trim(), details: f.namedItem('details').value.trim()
    } : null);
    el.remove();
  }));
  if (!values?.title) return;
  if (!values.kind) values.kind = 'other';
  const starts = new Date(`${values.date}T${values.start}`);
  let ends = values.end ? new Date(`${values.date}T${values.end}`) : null;
  if (ends && ends < starts) ends = new Date(ends.getTime() + 864e5); // ends after midnight
  const row = { title: values.title, kind: values.kind, starts_at: starts.toISOString(), ends_at: ends?.toISOString() || null, location: values.location || null, details: values.details || null };
  const { error } = event
    ? await sb.from('project_events').update(row).eq('id', event.id)
    : await sb.from('project_events').insert({ ...row, project_id: values.project });
  if (error) return toast(friendlyError(error), 'error');
  toast(event ? 'Event updated.' : 'Event added.');
  if (refresh) refresh(); else ctx.route();
}

// A standard calendar file, so people can add the schedule to Google/Apple/Outlook calendars.
function exportIcs(items, name) {
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const text = (t) => String(t || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const upcoming = items.filter((it) => it.at >= new Date(Date.now() - 864e5) && !it.closed);
  if (!upcoming.length) return toast('Nothing upcoming to export in this view.');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Looproom//Calendar//EN', `X-WR-CALNAME:${text(name)}`];
  for (const it of upcoming) {
    const end = it.end || new Date(it.at.getTime() + (it.type === 'due' ? 15 : 60) * 6e4);
    lines.push('BEGIN:VEVENT', `UID:${it.type}-${it.raw.id}@looproom`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(it.at)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${text(it.type === 'due' ? `Due: ${it.title}` : it.title)}`, ...(it.raw.location ? [`LOCATION:${text(it.raw.location)}`] : []),
      `DESCRIPTION:${text(`${it.project}${it.raw.details ? `\n${it.raw.details}` : ''}`)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = `${name.replace(/[^\w-]+/g, '-').toLowerCase() || 'looproom'}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
