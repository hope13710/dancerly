// People: everyone you share a project with, and what each person is working on.
import { sb, esc, initials, timeAgo } from '../client.js';
import { ctx } from '../ctx.js';
import { NOTE_SELECT, noteRow, pageHead, empty, namesFor, tabs } from './shared.js';

async function roster() {
  const { data, error } = await sb.from('project_members').select('user_id, role, project_id, joined_at, projects(title)');
  if (error) throw error;
  const names = await namesFor(data.map((m) => m.user_id));
  const people = {};
  for (const m of data) {
    const p = (people[m.user_id] ||= { id: m.user_id, name: names[m.user_id] || 'Member', projects: [] });
    p.projects.push({ id: m.project_id, title: m.projects?.title || '', role: m.role, joined_at: m.joined_at });
  }
  return Object.values(people).sort((a, b) => a.name.localeCompare(b.name));
}

export async function renderPeople() {
  const { state, view, setCrumbs } = ctx;
  setCrumbs([['People']]);
  const me = state.session.user.id;
  const people = await roster();
  const ids = people.map((p) => p.id);
  // Activity counts in two light queries.
  const [{ data: notes }, { data: takes }] = await Promise.all([
    sb.from('notes').select('author_id, created_at').in('author_id', ids).order('created_at', { ascending: false }).limit(1000),
    sb.from('takes').select('uploaded_by, created_at').in('uploaded_by', ids).order('created_at', { ascending: false }).limit(1000)
  ]);
  const stat = (id) => {
    const n = (notes || []).filter((x) => x.author_id === id);
    const t = (takes || []).filter((x) => x.uploaded_by === id);
    const last = [n[0]?.created_at, t[0]?.created_at].filter(Boolean).sort().pop();
    return { notes: n.length, takes: t.length, last };
  };

  view.innerHTML = `<section class="page">
    ${pageHead('People', { sub: `${people.length} ${people.length === 1 ? 'person' : 'people'} across your projects` })}
    ${people.length > 1 ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th class="hide-sm">Projects</th><th class="num">Notes given</th><th class="num">Takes</th><th class="hide-sm">Last active</th></tr></thead>
      <tbody>${people.map((p) => {
        const s = stat(p.id);
        return `<tr data-href="/app/people/${p.id}">
          <td><a class="person" href="/app/people/${p.id}" data-link><span class="avatar sm">${esc(initials(p.name))}</span><b>${esc(p.name)}</b>${p.id === me ? '<span class="tag">You</span>' : ''}</a></td>
          <td class="hide-sm"><span class="chips">${p.projects.map((x) => `<span class="chip">${esc(x.title)}${x.role === 'owner' ? ' · Owner' : ''}</span>`).join('')}</span></td>
          <td class="num">${s.notes}</td><td class="num">${s.takes}</td><td class="muted hide-sm">${s.last ? timeAgo(s.last) : '—'}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`
      : empty('◎', 'It’s just you so far', 'Invite teammates to a project. Everyone you share a project with shows up here.', '<button class="btn primary" data-invite-any>Invite people</button>')}
  </section>`;
  view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) ctx.navigate(tr.dataset.href); }));
  view.querySelector('[data-invite-any]')?.addEventListener('click', () => ctx.startAction('invite'));
}

export async function renderPerson(userId) {
  const { state, view, setCrumbs } = ctx;
  const me = state.session.user.id;
  const people = await roster();
  const person = people.find((p) => p.id === userId);
  if (!person) throw new Error('You don’t share a project with this person.');
  setCrumbs([['People', '/app/people'], [person.name]]);
  const tab = new URLSearchParams(location.search).get('show') === 'received' ? 'received' : 'given';
  const [{ data: given }, { data: theirTakes }] = await Promise.all([
    sb.from('notes').select(NOTE_SELECT).eq('author_id', userId).order('created_at', { ascending: false }).limit(100),
    sb.from('takes').select('id, video_id').eq('uploaded_by', userId)
  ]);
  let received = [];
  if (theirTakes?.length) {
    const { data } = await sb.from('notes').select(NOTE_SELECT).in('take_id', theirTakes.map((t) => t.id)).neq('author_id', userId).order('created_at', { ascending: false }).limit(100);
    received = data || [];
  }
  const list = tab === 'given' ? given || [] : received;
  const names = await namesFor(list.map((n) => n.author_id));
  const resolvedRate = received.length ? Math.round((received.filter((n) => n.status === 'resolved').length / received.length) * 100) : null;
  const base = `/app/people/${userId}`;

  view.innerHTML = `<section class="page narrow-wide">
    <div class="me-card">
      <span class="avatar xl">${esc(initials(person.name))}</span>
      <div><h1>${esc(person.name)}${userId === me ? ' <span class="tag">You</span>' : ''}</h1>
        <p class="chips">${person.projects.map((x) => `<a class="chip" href="/app/p/${x.id}" data-link>${esc(x.title)}${x.role === 'owner' ? ' · Owner' : ''}</a>`).join('')}</p></div>
    </div>
    <div class="stats">
      <div class="stat"><small>Notes given</small><b>${given?.length ?? 0}</b></div>
      <div class="stat"><small>Takes uploaded</small><b>${theirTakes?.length ?? 0}</b></div>
      <div class="stat"><small>Notes received</small><b>${received.length}</b></div>
      <div class="stat"><small>Received & fixed</small><b>${resolvedRate === null ? '—' : `${resolvedRate}%`}</b></div>
    </div>
    ${tabs([['given', 'Notes given', base], ['received', 'Notes on their takes', `${base}?show=received`]], tab)}
    ${list.length ? `<div class="list">${list.map((n) => noteRow(n, names, { showAuthor: tab === 'received' })).join('')}</div>`
      : `<p class="panel-empty">${tab === 'given' ? 'No notes from them yet.' : 'No notes on their takes yet.'}</p>`}
  </section>`;
}
