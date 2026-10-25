// Home: what needs you today, what changed, and how to get started.
import { sb, $, esc, initials, timeAgo } from '../client.js';
import { ctx } from '../ctx.js';
import { NOTE_SELECT, noteRow, noteTime, noteHref, namesFor, notesForMe } from './shared.js';
import { homeRecapCard } from './recaps.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export async function renderHome() {
  const { state, view, setCrumbs } = ctx;
  setCrumbs([['Home']]);
  const me = state.session.user.id;
  const [recapCard, forMe, { data: takes }, { data: notes }, { count: myNotes }, { data: roster }] = await Promise.all([
    homeRecapCard(),
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
  $('[data-hide-checklist]')?.addEventListener('click', () => {
    try { localStorage.setItem('looproom:checklist', 'hidden'); } catch {}
    $('.checklist').remove();
  });
  view.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => ctx.startAction(b.dataset.step)));
}
