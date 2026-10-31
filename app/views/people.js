// People: everyone you share a project with, and what each person is working on.
import { sb, $$, esc, initials, timeAgo, avatar, isSamplePerson, cols } from '../client.js';
import { ctx } from '../ctx.js';
import { samplePeek } from '../onboarding.js';
import { NOTE_SELECT, noteRow, pageHead, previewEmpty, namesFor, tabs, noSample } from './shared.js';
import { paintThumbs } from './project.js';
import { openCardEditor } from '../progress-card.js';

// Your real teammates. The sample's made-up teammates appear only inside the sample (and on their own page).
async function roster({ withSample = false } = {}) {
  await ctx.state.projectsReady;
  const q = sb.from('project_members').select('user_id, role, project_id, joined_at, projects(title)');
  const { data, error } = await (withSample ? q : noSample(q));
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
    noSample(sb.from('notes').select('author_id, created_at')).in('author_id', ids).order('created_at', { ascending: false }).limit(1000),
    noSample(sb.from('takes').select('uploaded_by, created_at')).in('uploaded_by', ids).order('created_at', { ascending: false }).limit(1000)
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
          <td><a class="person" href="/app/people/${p.id}" data-link>${avatar(p.name, p.id, 'sm')}<b>${esc(p.name)}</b>${p.id === me ? '<span class="tag">You</span>' : ''}</a></td>
          <td class="hide-sm"><span class="chips">${p.projects.map((x) => `<span class="chip">${esc(x.title)}${x.role === 'owner' ? ' · Owner' : ''}</span>`).join('')}</span></td>
          <td class="num">${s.notes}</td><td class="num">${s.takes}</td><td class="muted hide-sm">${s.last ? timeAgo(s.last) : '—'}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`
      : previewEmpty('rows', 'It’s just you so far', 'Invite teammates to a project. Everyone you share a project with shows up here, with the notes they give and the takes they send.', `<button class="btn primary" data-invite-any>Invite people</button>${samplePeek('people')}`, 'people')}
  </section>`;
  view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) ctx.navigate(tr.dataset.href); }));
  view.querySelector('[data-invite-any]')?.addEventListener('click', () => ctx.startAction('invite'));
}

export async function renderPerson(userId) {
  const { state, view, setCrumbs } = ctx;
  const me = state.session.user.id;
  const sampleOnly = isSamplePerson(userId);
  const people = await roster({ withSample: sampleOnly });
  const person = people.find((p) => p.id === userId);
  const scope = (q) => (sampleOnly ? q : noSample(q));
  if (!person) throw new Error('You don’t share a project with this person.');
  setCrumbs([['People', '/app/people'], [person.name]]);
  const show = new URLSearchParams(location.search).get('show');
  const tab = ['received', 'videos', 'progress'].includes(show) ? show : 'given';
  const [{ data: given }, { data: theirTakes }] = await Promise.all([
    scope(sb.from('notes').select(NOTE_SELECT)).eq('author_id', userId).order('created_at', { ascending: false }).limit(100),
    scope(sb.from('takes').select('id, number, created_at, thumb_path, storage_path, project_id, video_id, videos(title), projects(title)')).eq('uploaded_by', userId).order('created_at', { ascending: false })
  ]);
  // The videos they put takes into, newest first: each opens at their latest take there.
  const videos = [];
  for (const t of theirTakes || []) {
    const v = videos.find((x) => x.video_id === t.video_id);
    if (v) v.count += 1; else videos.push({ video_id: t.video_id, latest: t, count: 1 });
  }
  let received = [];
  if (theirTakes?.length) {
    const { data } = await scope(sb.from('notes').select(NOTE_SELECT)).in('take_id', theirTakes.map((t) => t.id)).neq('author_id', userId).order('created_at', { ascending: false }).limit(100);
    received = data || [];
  }
  const list = tab === 'given' ? given || [] : tab === 'received' ? received : [];
  // Progress: their videos with two or more takes, Take 1 next to the latest, and how many notes got fixed.
  let growth = [];
  if (tab === 'progress' && videos.length) {
    const ids = videos.map((v) => v.video_id);
    const [{ data: all }, { data: notes }, { data: projects }] = await Promise.all([
      sb.from('takes').select('id, number, created_at, thumb_path, storage_path, project_id, video_id').in('video_id', ids).order('number'),
      sb.from('notes').select('video_id, status, private_to').in('video_id', ids),
      sb.from('projects').select(cols('id, created_by, allow_share_cards')).in('id', [...new Set(videos.map((v) => v.latest.project_id))])
    ]);
    growth = videos.map((v) => {
      const takes = (all || []).filter((t) => t.video_id === v.video_id);
      const team = (notes || []).filter((n) => n.video_id === v.video_id && !n.private_to);
      const p = (projects || []).find((x) => x.id === v.latest.project_id);
      return { ...v, takes, first: takes[0], last: takes[takes.length - 1], fixed: team.filter((n) => n.status === 'resolved').length, total: team.length,
        days: takes.length > 1 ? Math.max(1, Math.ceil((new Date(takes[takes.length - 1].created_at) - new Date(takes[0].created_at)) / 864e5)) : 0,
        canCard: p?.allow_share_cards !== false || p?.created_by === me };
    }).filter((v) => v.takes.length > 1).sort((a, b) => b.fixed - a.fixed || b.last.created_at.localeCompare(a.last.created_at));
  }
  const names = await namesFor(list.map((n) => n.author_id));
  const resolvedRate = received.length ? Math.round((received.filter((n) => n.status === 'resolved').length / received.length) * 100) : null;
  const base = `/app/people/${userId}`;

  view.innerHTML = `<section class="page narrow-wide">
    <div class="me-card">
      ${avatar(person.name, person.id, 'xl')}
      <div><h1>${esc(person.name)}${userId === me ? ' <span class="tag">You</span>' : ''}${sampleOnly ? ' <span class="tag sample-tag">Sample teammate</span>' : ''}</h1>
        <p class="chips">${person.projects.map((x) => `<a class="chip" href="/app/p/${x.id}" data-link>${esc(x.title)}${x.role === 'owner' ? ' · Owner' : ''}</a>`).join('')}</p></div>
    </div>
    <div class="stats">
      <div class="stat"><small>Notes given</small><b>${given?.length ?? 0}</b></div>
      <div class="stat"><small>Takes uploaded</small><b>${theirTakes?.length ?? 0}</b></div>
      <div class="stat"><small>Notes received</small><b>${received.length}</b></div>
      <div class="stat"><small>Received & fixed</small><b>${resolvedRate === null ? '—' : `${resolvedRate}%`}</b></div>
    </div>
    ${tabs([['given', 'Notes given', base], ['received', 'Notes on their takes', `${base}?show=received`], ['videos', 'Videos', `${base}?show=videos`, videos.length], ['progress', 'Progress', `${base}?show=progress`]], tab)}
    ${tab === 'progress'
      ? (growth.length ? `<div class="growth-list">${growth.map((v) => `<div class="growth-item">
          <a class="growth-thumbs" href="/app/p/${v.last.project_id}/v/${v.video_id}?take=${v.last.number}" data-link aria-label="${esc(v.latest.videos?.title || 'Video')}">
            <span class="video-thumb" data-thumb="${v.first.id}"><i aria-hidden="true">▶</i><em>Take ${v.first.number}</em></span><span class="video-thumb" data-thumb="${v.last.id}"><i aria-hidden="true">▶</i><em>Take ${v.last.number}</em></span></a>
          <div class="growth-copy"><b>${esc(v.latest.videos?.title || 'Video')}</b>
            <small>${esc(v.latest.projects?.title || '')} · Take ${v.first.number} → ${v.last.number} · ${v.days} ${v.days === 1 ? 'day' : 'days'}</small>
            ${v.total ? `<span class="growth-bar" role="img" aria-label="${v.fixed} of ${v.total} notes fixed"><i style="width:${Math.round((v.fixed / v.total) * 100)}%"></i></span><small>${v.fixed} of ${v.total} notes fixed</small>` : '<small>No notes yet</small>'}
            ${v.canCard ? `<button class="btn small" type="button" data-make-card="${v.video_id}" data-project="${v.last.project_id}">✦ Make a card</button>` : ''}</div>
        </div>`).join('')}</div>`
        : `<p class="panel-empty">${videos.length ? 'Progress shows up once a video has a second take.' : 'No videos from them yet.'}</p>`)
      : tab === 'videos'
      ? (videos.length ? `<div class="video-list">${videos.map(({ latest: t, count }) => `<div class="video-item"><a class="video-row" href="/app/p/${t.project_id}/v/${t.video_id}?take=${t.number}" data-link>
          <span class="video-thumb" data-thumb="${t.id}"><i aria-hidden="true">▶</i>${count > 1 ? `<em>${count} takes</em>` : ''}</span>
          <span class="video-copy"><b>${esc(t.videos?.title || 'Video')}</b><small>${esc(t.projects?.title || '')} · Take ${t.number} · ${timeAgo(t.created_at)}</small></span>
          <span class="chev">→</span>
        </a></div>`).join('')}</div>`
        : `<p class="panel-empty">No videos from them yet.</p>`)
      : list.length ? `<div class="list">${list.map((n) => noteRow(n, names, { showAuthor: tab === 'received' })).join('')}</div>`
      : `<p class="panel-empty">${tab === 'given' ? 'No notes from them yet.' : 'No notes on their takes yet.'}</p>`}
  </section>`;
  if (tab === 'videos') paintThumbs(videos.map((v) => v.latest));
  if (tab === 'progress') {
    paintThumbs(growth.flatMap((v) => [v.first, v.last]));
    $$('[data-make-card]').forEach((b) => b.addEventListener('click', () => openCardEditor({ projectId: b.dataset.project, videoId: b.dataset.makeCard, from: 'profile' })));
  }  if (sampleOnly) ctx.sampleBar(state.projects.find((p) => p.is_sample) || null);
}
