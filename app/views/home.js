// Home: what needs you today, what changed, and how to get started.
import { sb, $, esc, initials, timeAgo } from '../client.js';
import { ctx } from '../ctx.js';
import { NOTE_SELECT, noteRow, noteTime, noteHref, namesFor, notesForMe } from './shared.js';
import { homeRecapCard } from './recaps.js';
import { myOpenRequests, dueLabel } from './requests.js';
import { unseenVideos, QUEUE_KEY } from './queue.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export async function renderHome() {
  const { state, view, setCrumbs } = ctx;
  setCrumbs([['Home']]);
  const me = state.session.user.id;
  await state.projectsReady;
  const [recapCard, dueFromMe, toReview, { data: upcoming }, forMe, { data: takes }, { data: notes }, { count: myNotes }, { data: roster }] = await Promise.all([
    homeRecapCard(),
    myOpenRequests(),
    unseenVideos(),
    state.projects.length ? sb.from('project_events').select('id, project_id, title, kind, starts_at, location, projects(title)').in('project_id', state.projects.map((p) => p.id)).gte('starts_at', new Date().toISOString()).order('starts_at').limit(3) : { data: [] },
    notesForMe(me, { limit: 50 }),
    sb.from('takes').select('id, number, created_at, uploaded_by, project_id, video_id, videos(title), projects(title)').order('created_at', { ascending: false }).limit(12),
    sb.from('notes').select(NOTE_SELECT).order('created_at', { ascending: false }).limit(12),
    sb.from('notes').select('id', { count: 'exact', head: true }).eq('author_id', me),
    sb.from('project_members').select('user_id').neq('user_id', me).limit(1)
  ]);
  const todo = forMe.filter((n) => n.status !== 'resolved');
  // One timeline of takes and notes, newest first.
  const activity = [
    ...(takes || []).map((t) => ({ at: t.created_at, who: t.uploaded_by, take: t })),
    ...(notes || []).map((n) => ({ at: n.created_at, who: n.author_id, note: n }))
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  const names = await namesFor([...todo.slice(0, 5).map((n) => n.author_id), ...activity.map((a) => a.who)]);

  const steps = [
    ['Create a project', state.projects.length > 0, 'project'],
    ['Upload a rehearsal video', (takes || []).length > 0, 'video'],
    ['Pin your first note', (myNotes || 0) > 0, state.projects[0] ? `/app/p/${state.projects[0].id}` : null],
    ['Invite a teammate', (roster || []).length > 0, 'invite']
  ];
  const done = steps.filter((s) => s[1]).length;
  let hideChecklist = done === steps.length;
  try { hideChecklist ||= localStorage.getItem('looproom:checklist') === 'hidden'; } catch {}

  const first = esc(state.profile.display_name.split(' ')[0]);
  view.innerHTML = `<section class="page">
    <header class="page-head"><div><p class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p><h1>${greeting()}, ${first}</h1></div></header>
    ${recapCard.html}
    <div class="home-strip">
      <section class="panel">
        <div class="panel-head"><div><h2>Due from you</h2><p class="muted">Videos you were asked for</p></div></div>
        ${dueFromMe.length ? `<div class="list flush">${dueFromMe.slice(0, 3).map((r) => `<a class="row" href="/app/p/${r.project_id}/requests/${r.id}" data-link><span class="row-main"><span class="row-title">${esc(r.title)}</span><span class="row-meta"><span class="due ${r.due_at && new Date(r.due_at) < new Date() ? 'overdue' : ''}">${esc(dueLabel(r.due_at))}</span></span></span><span class="chev">›</span></a>`).join('')}</div>` : '<p class="panel-empty">Nothing due. 🎉</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>To review</h2><p class="muted">New takes you haven’t watched</p></div>${toReview.length ? `<a class="link" href="/app/queue" data-link>Queue (${toReview.length}) →</a>` : ''}</div>
        ${toReview.length ? `<div class="list flush">${toReview.slice(0, 3).map((v) => `<a class="row" href="/app/p/${v.project_id}/v/${v.video_id}?take=${v.latest.number}" data-link data-review-link><span class="row-main"><span class="row-title">${esc(v.title)}</span><span class="row-meta">${v.latest.number === 1 ? 'New video' : `Take ${v.latest.number}`} · ${timeAgo(v.latest.created_at)}</span></span><span class="chev">›</span></a>`).join('')}</div>` : '<p class="panel-empty">You’re all caught up.</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Coming up</h2><p class="muted">Rehearsals and shows</p></div><a class="link" href="/app/calendar" data-link>Calendar →</a></div>
        ${upcoming?.length ? `<div class="list flush">${upcoming.map((e) => `<a class="row" href="/app/p/${e.project_id}/calendar" data-link><span class="cal-dot k-${e.kind}"></span><span class="row-main"><span class="row-title">${esc(e.title)}</span><span class="row-meta">${new Date(e.starts_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${e.location ? ` · ${esc(e.location)}` : ''}</span></span></a>`).join('')}</div>` : '<p class="panel-empty">Nothing scheduled. Add rehearsals from the Calendar.</p>'}
      </section>
    </div>
    ${hideChecklist ? '' : `<section class="panel checklist">
      <div class="panel-head"><div><h2>Get your team going</h2><p class="muted">${done} of ${steps.length} done</p></div><button class="btn ghost small" data-hide-checklist>Hide</button></div>
      <div class="progress" aria-hidden="true"><i style="width:${(done / steps.length) * 100}%"></i></div>
      <ol>${steps.map(([label, ok, action]) => `<li class="${ok ? 'done' : ''}"><span class="check">${ok ? '✓' : ''}</span><span>${label}</span>${ok || !action ? '' : action.startsWith('/') ? `<a class="btn small" href="${action}" data-link>Open</a>` : `<button class="btn small" data-step="${action}">Start</button>`}</li>`).join('')}</ol>
    </section>`}
    <div class="home-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>For you</h2><p class="muted">Notes on your videos and @mentions that aren’t fixed yet</p></div>${todo.length ? `<a class="link" href="/app/feedback" data-link>See all ${todo.length} →</a>` : ''}</div>
        ${todo.length ? `<div class="list flush">${todo.slice(0, 5).map((n) => noteRow(n, names)).join('')}</div>`
          : '<p class="panel-empty">Nothing waiting on you. When teammates leave notes on your videos or @mention you, they’ll show up here.</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Recent activity</h2><p class="muted">Across your projects</p></div></div>
        ${activity.length ? `<ul class="activity">${activity.map((a) => {
          const who = esc(names[a.who] || 'Someone');
          if (a.take) {
            const t = a.take;
            return `<li><a href="/app/p/${t.project_id}/v/${t.video_id}?take=${t.number}" data-link><span class="avatar xs">${esc(initials(names[a.who]))}</span><span><b>${who}</b> uploaded ${t.number === 1 ? '' : `Take ${t.number} of `}<b>${esc(t.videos?.title || '')}</b><small>${esc(t.projects?.title || '')} · ${timeAgo(t.created_at)}</small></span></a></li>`;
          }
          const n = a.note;
          return `<li><a href="${noteHref(n)}" data-link><span class="avatar xs">${esc(initials(names[a.who]))}</span><span><b>${who}</b> noted <span class="time-tag">${noteTime(n)}</span> on <b>${esc(n.videos?.title || '')}</b><small>“${esc(n.body.slice(0, 80))}${n.body.length > 80 ? '…' : ''}” · ${timeAgo(n.created_at)}</small></span></a></li>`;
        }).join('')}</ul>` : '<p class="panel-empty">No activity yet. Upload a rehearsal to get things moving.</p>'}
      </section>
    </div>
  </section>`;

  recapCard.wire();
  // Opening from Home walks the same queue as the Review queue page.
  try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(toReview.map((v) => `/app/p/${v.project_id}/v/${v.video_id}?take=${v.latest.number}`))); } catch {}
  $('[data-hide-checklist]')?.addEventListener('click', () => {
    try { localStorage.setItem('looproom:checklist', 'hidden'); } catch {}
    $('.checklist').remove();
  });
  view.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => ctx.startAction(b.dataset.step)));
}
