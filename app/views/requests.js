// Requests: "everyone send a run-through of the chorus by Friday 6pm".
// A submission is a video linked to the request; re-uploading adds a take to it.
import { sb, $, $$, esc, initials, timeAgo, toast, friendlyError, dialog, loadMembers } from '../client.js';
import { ctx } from '../ctx.js';
import { loadProject, projectHead, createVideo } from './project.js';
import { empty } from './shared.js';

const STATUS = {
  missing: ['Not submitted', ''],
  overdue: ['Overdue', 'danger'],
  submitted: ['Submitted', 'info'],
  reviewed: ['Reviewed', 'warn'],
  fixed: ['All fixed', 'ok']
};
const pill = (key) => `<span class="pill ${STATUS[key][1]}">${STATUS[key][0]}</span>`;

export function dueLabel(iso) {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  const ms = d - Date.now();
  const when = d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (ms < 0) return `Was due ${when}`;
  if (ms < 864e5) return `Due in ${Math.max(1, Math.round(ms / 36e5))}h · ${when}`;
  return `Due ${when}`;
}
const dueClass = (r) => (r.status === 'active' && r.due_at && new Date(r.due_at) < new Date() ? 'overdue' : r.status === 'active' && r.due_at && new Date(r.due_at) - Date.now() < 864e5 ? 'soon' : '');

// Who the request is for, and where each of them stands.
export function submissionsFor(request, members, videos) {
  // "Everyone" means everyone except the person asking.
  const people = request.everyone ? members.filter((m) => m.user_id !== request.created_by) : members.filter((m) => (request.request_assignees || []).some((a) => a.user_id === m.user_id));
  const late = request.due_at && new Date(request.due_at) < new Date();
  return people.map((m) => {
    const video = videos.find((v) => v.request_id === request.id && v.created_by === m.user_id);
    let state = late ? 'overdue' : 'missing';
    if (video) {
      const others = (video.notes || []).filter((n) => n.author_id !== m.user_id);
      state = !others.length ? 'submitted' : others.every((n) => n.status === 'resolved') ? 'fixed' : 'reviewed';
    }
    const takes = video ? [...video.takes].sort((a, b) => b.number - a.number) : [];
    return { member: m, video, state, latest: takes[0] || null };
  });
}

async function loadRequests(projectId) {
  const [{ data: requests, error }, { data: videos, error: vErr }] = await Promise.all([
    sb.from('requests').select('id, project_id, title, brief, due_at, everyone, status, created_by, created_at, closed_at, last_reminded_at, reference_video_id, request_assignees(user_id)').eq('project_id', projectId).order('created_at', { ascending: false }),
    sb.from('videos').select('id, title, created_by, request_id, takes(id, number, created_at), notes(status, author_id)').eq('project_id', projectId).not('request_id', 'is', null)
  ]);
  if (error || vErr) throw error || vErr;
  return { requests, videos };
}

// ---------- Project › Requests ----------
export async function renderProjectRequests(projectId) {
  const { view, setCrumbs } = ctx;
  const me = ctx.state.session.user.id;
  const show = new URLSearchParams(location.search).get('show') === 'closed' ? 'closed' : 'active';
  const [p, { requests, videos }] = await Promise.all([loadProject(projectId), loadRequests(projectId)]);
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Requests']]);
  const shown = requests.filter((r) => r.status === show)
    .sort((a, b) => (show === 'active' ? (a.due_at || '9999').localeCompare(b.due_at || '9999') : b.closed_at?.localeCompare(a.closed_at || '') || 0));
  const counts = { active: requests.filter((r) => r.status === 'active').length, closed: requests.filter((r) => r.status === 'closed').length };
  const base = `/app/p/${projectId}/requests`;
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'requests', '<button class="btn primary" data-new-request>+ New request</button>')}
    <div class="filters"><div class="seg small" role="group" aria-label="Show">${[['active', 'Active'], ['closed', 'Closed']].map(([k, l]) => `<a href="${base}${k === 'active' ? '' : '?show=closed'}" data-link aria-selected="${k === show}">${l} <span>${counts[k]}</span></a>`).join('')}</div></div>
    ${shown.length ? `<div class="list">${shown.map((r) => {
      const subs = submissionsFor(r, p.members, videos);
      const done = subs.filter((s) => s.video).length;
      const mine = subs.find((s) => s.member.user_id === me);
      return `<a class="row request-row" href="${base}/${r.id}" data-link>
        <span class="row-main">
          <span class="row-title">${esc(r.title)}</span>
          <span class="row-meta"><span class="due ${dueClass(r)}">${esc(dueLabel(r.due_at))}</span> · ${r.everyone ? 'Everyone' : `${subs.length} ${subs.length === 1 ? 'person' : 'people'}`}${mine ? ` · You: ${STATUS[mine.state][0].toLowerCase()}` : ''}</span>
        </span>
        <span class="row-side"><span class="meter" title="${done} of ${subs.length} submitted"><i style="width:${subs.length ? (done / subs.length) * 100 : 0}%"></i></span><small class="count-fig">${done}/${subs.length}</small><span class="chev">›</span></span>
      </a>`;
    }).join('')}</div>`
      : empty('⇪', show === 'active' ? 'No open requests' : 'No closed requests', show === 'active' ? 'Ask your team for a video by a date — “Everyone send a run-through of the chorus by Friday 6pm.” You’ll see who has submitted at a glance.' : 'Requests you close show up here.', show === 'active' ? '<button class="btn primary" data-new-request>+ New request</button>' : '')}
  </section>`;
  $$('[data-new-request]').forEach((b) => b.addEventListener('click', () => newRequest(projectId)));
}

// ---------- New / edit ----------
export async function newRequest(projectId) {
  const [members, { data: videos }] = await Promise.all([
    loadMembers(projectId),
    sb.from('videos').select('id, title').eq('project_id', projectId).order('created_at', { ascending: false })
  ]);
  const me = ctx.state.session.user.id;
  const el = document.createElement('dialog');
  el.className = 'dialog';
  const nextFri = new Date(); nextFri.setDate(nextFri.getDate() + ((5 - nextFri.getDay() + 7) % 7 || 7));
  el.innerHTML = `<form method="dialog" class="dialog-card request-form">
    <h2>New request</h2>
    <p>Ask for a video by a date. Everyone it’s for gets it in their Inbox.</p>
    <label class="field"><span>What do you need?</span><input name="title" maxlength="120" required placeholder="Chorus run-through, full out" /></label>
    <label class="field"><span>Brief <small>optional</small></span><textarea name="brief" rows="3" maxlength="4000" placeholder="Film from the front, full out, with the track. Watch the 5-6 arms."></textarea></label>
    <div class="date-row">
      <label class="field"><span>Due date <small>optional</small></span><input type="date" name="date" value="${nextFri.toISOString().slice(0, 10)}" /></label>
      <label class="field"><span>Time</span><input type="time" name="time" value="18:00" /></label>
    </div>
    <div class="field"><span>Who it’s for</span><div class="choices">
      <label><input type="radio" name="who" value="all" checked /><b>Everyone</b><small>All ${members.length} on the project</small></label>
      <label><input type="radio" name="who" value="some" /><b>Choose people</b><small>Only the people you pick</small></label>
    </div></div>
    <div class="pick-people" data-pick hidden>${members.filter((m) => m.user_id !== me).map((m) => `<label><input type="checkbox" name="person" value="${m.user_id}" /><span class="avatar xs">${esc(initials(m.name))}</span>${esc(m.name)}</label>`).join('') || '<p class="muted">Invite people to the project first.</p>'}</div>
    ${videos?.length ? `<label class="field"><span>Reference video <small>optional</small></span><select name="reference"><option value="">None</option>${videos.map((v) => `<option value="${v.id}">${esc(v.title)}</option>`).join('')}</select></label>` : ''}
    <div class="dialog-actions"><button value="cancel" formnovalidate class="btn ghost">Cancel</button><button value="ok" class="btn primary">Send request</button></div>
  </form>`;
  document.body.append(el);
  const form = el.querySelector('form');
  form.querySelectorAll('[name=who]').forEach((r) => r.addEventListener('change', () => { el.querySelector('[data-pick]').hidden = form.querySelector('[name=who]:checked').value !== 'some'; }));
  el.showModal();
  form.elements.namedItem('title').focus();
  const values = await new Promise((resolve) => el.addEventListener('close', () => {
    const f = form.elements;
    resolve(el.returnValue === 'ok' ? {
      title: f.namedItem('title').value.trim(),
      brief: f.namedItem('brief').value,
      date: f.namedItem('date').value,
      time: f.namedItem('time').value || '23:59',
      some: form.querySelector('[name=who]:checked').value === 'some',
      people: $$('[name=person]:checked', form).map((x) => x.value),
      reference: f.namedItem('reference')?.value || null
    } : null);
    el.remove();
  }));
  if (!values?.title) return;
  if (values.some && !values.people.length) return toast('Pick at least one person, or choose Everyone.', 'error');
  const due = values.date ? new Date(`${values.date}T${values.time}`).toISOString() : null;
  const { data: rid, error } = await sb.rpc('create_request', { p_project: projectId, p_title: values.title, p_brief: values.brief, p_due: due, p_assignees: values.some ? values.people : [], p_reference: values.reference });
  if (error) return toast(friendlyError(error), 'error');
  toast('Request sent.');
  ctx.navigate(`/app/p/${projectId}/requests/${rid}`);
}

// ---------- One request ----------
export async function renderRequest(projectId, requestId) {
  const { view, setCrumbs, navigate } = ctx;
  const me = ctx.state.session.user.id;
  const [p, { requests, videos }] = await Promise.all([loadProject(projectId), loadRequests(projectId)]);
  const r = requests.find((x) => x.id === requestId);
  if (!r) throw new Error('This request was deleted or isn’t in this project.');
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Requests', `/app/p/${projectId}/requests`], [r.title]]);
  const subs = submissionsFor(r, p.members, videos);
  const mine = subs.find((s) => s.member.user_id === me);
  const canManage = r.created_by === me || p.isOwner;
  const submitted = subs.filter((s) => s.video).length;
  const missing = subs.length - submitted;
  const ready = r.status === 'active' && subs.length && subs.every((s) => s.state === 'fixed');
  const author = p.members.find((m) => m.user_id === r.created_by)?.name || 'A former member';
  const reference = r.reference_video_id ? (await sb.from('videos').select('id, title').eq('id', r.reference_video_id).maybeSingle()).data : null;
  view.innerHTML = `<section class="page narrow-wide">
    <header class="page-head"><div>
      <p class="eyebrow">Request${r.status === 'closed' ? ' · Closed' : ''}</p>
      <h1>${esc(r.title)}</h1>
      <p class="muted sub"><span class="due ${dueClass(r)}">${esc(dueLabel(r.due_at))}</span> · from ${esc(author)} · ${timeAgo(r.created_at)}</p>
    </div>
    <div class="head-actions">
      ${mine && r.status === 'active' ? `<button class="btn primary" data-submit>${mine.video ? `Upload Take ${(mine.latest?.number || 0) + 1}` : 'Submit your video'}</button>` : ''}
      ${canManage ? '<button class="btn ghost icon" data-manage aria-label="Request settings">•••</button>' : ''}
    </div></header>
    ${ready ? '<div class="banner ok"><span>Everyone submitted and every note is fixed.</span><button class="btn small" data-close>Close request</button></div>' : ''}
    ${r.brief || reference ? `<section class="panel"><div class="panel-head"><div><h2>Brief</h2></div></div>
      ${r.brief ? `<p class="brief">${esc(r.brief)}</p>` : ''}
      ${reference ? `<p class="brief-ref">Reference: <a class="link" href="/app/p/${projectId}/v/${reference.id}" data-link>▶ ${esc(reference.title)}</a></p>` : ''}
    </section>` : ''}
    <section class="panel">
      <div class="panel-head"><div><h2>Submissions</h2><p class="muted">${submitted} of ${subs.length} submitted${missing && r.status === 'active' ? ` · ${missing} still to go` : ''}</p></div>
        ${canManage && missing && r.status === 'active' ? `<button class="btn small" data-remind ${r.last_reminded_at && Date.now() - new Date(r.last_reminded_at) < 36e5 ? 'disabled title="You can remind again an hour after the last reminder"' : ''}>Remind ${missing === 1 ? '1 person' : `${missing} people`}</button>` : ''}</div>
      <div class="progress"><i style="width:${subs.length ? (submitted / subs.length) * 100 : 0}%"></i></div>
      <div class="list flush">${subs.map((s) => `<${s.video ? `a href="/app/p/${projectId}/v/${s.video.id}" data-link` : 'div'} class="row">
        <span class="avatar sm">${esc(initials(s.member.name))}</span>
        <span class="row-main"><span class="row-title">${esc(s.member.name)}${s.member.user_id === me ? ' <span class="tag">You</span>' : ''}</span>
          <span class="row-meta">${s.video ? `${esc(s.video.title)} · ${s.latest ? `Take ${s.latest.number} · ${timeAgo(s.latest.created_at)}` : 'no take yet'}` : 'Nothing yet'}</span></span>
        <span class="row-side">${pill(s.state)}${s.video ? '<span class="chev">›</span>' : ''}</span>
      </${s.video ? 'a' : 'div'}>`).join('') || '<p class="panel-empty">Nobody is assigned.</p>'}</div>
    </section>
  </section>`;

  $('[data-submit]')?.addEventListener('click', () => createVideo(projectId, { request: r }));
  $('[data-close]')?.addEventListener('click', () => setStatus('closed'));
  $('[data-remind]')?.addEventListener('click', async () => {
    const { data: sent, error } = await sb.rpc('remind_request', { p_request: r.id });
    if (error) return toast(friendlyError(error), 'error');
    toast(sent ? `Reminded ${sent} ${sent === 1 ? 'person' : 'people'}.` : 'Nobody to remind — or they turned these off.');
    renderRequest(projectId, requestId);
  });
  $('[data-manage]')?.addEventListener('click', async () => {
    const local = r.due_at ? new Date(new Date(r.due_at).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
    const values = await dialog({
      title: 'Edit request',
      fields: [
        { name: 'title', label: 'Title', value: r.title, required: true },
        { name: 'due', label: 'Due', type: 'datetime-local', value: local, hint: 'Leave empty for no due date' }
      ],
      confirm: 'Save',
      extra: r.status === 'active' ? 'Close request' : 'Reopen request'
    });
    if (!values) return;
    if (values.extra) return setStatus(r.status === 'active' ? 'closed' : 'active');
    const { error } = await sb.from('requests').update({ title: values.title, due_at: values.due ? new Date(values.due).toISOString() : null }).eq('id', r.id);
    if (error) return toast(friendlyError(error), 'error');
    renderRequest(projectId, requestId);
  });

  async function setStatus(status) {
    const { error } = await sb.from('requests').update({ status, closed_at: status === 'closed' ? new Date().toISOString() : null }).eq('id', r.id);
    if (error) return toast(friendlyError(error), 'error');
    toast(status === 'closed' ? 'Request closed. Submissions stay in Videos.' : 'Request reopened.');
    renderRequest(projectId, requestId);
  }
  // Deleting is offered once a request is closed, to keep it out of the way.
  if (canManage && r.status === 'closed') {
    const del = document.createElement('button');
    del.className = 'btn ghost danger small';
    del.textContent = 'Delete request';
    del.addEventListener('click', async () => {
      const ok = await dialog({ title: 'Delete this request?', body: 'Submitted videos and their notes stay in the project.', confirm: 'Delete', danger: true });
      if (!ok) return;
      const { error } = await sb.from('requests').delete().eq('id', r.id);
      if (error) return toast(friendlyError(error), 'error');
      navigate(`/app/p/${projectId}/requests?show=closed`, { replace: true });
    });
    view.querySelector('.page').append(del);
  }
}

// Requests waiting on you across every project (Home, Review queue).
export async function myOpenRequests() {
  const me = ctx.state.session.user.id;
  const [{ data: requests }, { data: assigned }, { data: mineVideos }] = await Promise.all([
    sb.from('requests').select('id, project_id, title, due_at, everyone, status, created_by, projects(title)').eq('status', 'active').order('due_at', { ascending: true, nullsFirst: false }).limit(200),
    sb.from('request_assignees').select('request_id').eq('user_id', me),
    sb.from('videos').select('request_id').eq('created_by', me).not('request_id', 'is', null)
  ]);
  const mineIds = new Set((assigned || []).map((a) => a.request_id));
  const done = new Set((mineVideos || []).map((v) => v.request_id));
  return (requests || []).filter((r) => (r.everyone || mineIds.has(r.id)) && !done.has(r.id) && r.created_by !== me);
}
