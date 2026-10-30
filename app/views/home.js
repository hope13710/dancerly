// Home: what needs you today, what changed, and how to get started.
import { sb, $, $$, esc, initials, timeAgo, avatar, schema } from '../client.js';
import { ctx } from '../ctx.js';
import { NOTE_SELECT, noteRow, noteTime, noteHref, namesFor, notesForMe, kindClass, noSample } from './shared.js';
import { homeRecapCard } from './recaps.js';
import { showEvent } from './calendar.js';
import { myOpenRequests, dueLabel } from './requests.js';
import { unseenVideos, QUEUE_KEY } from './queue.js';
import { needsWelcome, onboarding, saveOnboarding, sampleOffer, seen, markSeen, sampleCleanupCard } from '../onboarding.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export async function renderHome() {
  const { state, view, setCrumbs } = ctx;
  setCrumbs([['Home']]);
  const me = state.session.user.id;
  await state.projectsReady;
  if (needsWelcome()) return ctx.navigate('/app/welcome', { replace: true });
  // The sample doesn't count toward getting started.
  const sample = state.projects.find((p) => p.is_sample);
  const real = state.projects.filter((p) => !p.is_sample);
  const [recapCard, dueFromMe, toReview, { data: upcoming }, forMe, { data: takes }, { data: notes }, { count: myNotes }, { data: roster }, { count: myTakes }, { count: myReplies }, { count: myViews }] = await Promise.all([
    homeRecapCard(),
    myOpenRequests(),
    unseenVideos(),
    real.length ? sb.from('project_events').select('id, project_id, title, kind, starts_at, ends_at, location, details, created_by, projects(title)').in('project_id', real.map((p) => p.id)).gte('starts_at', new Date().toISOString()).order('starts_at').limit(3) : { data: [] },
    notesForMe(me, { limit: 50 }),
    noSample(sb.from('takes').select('id, number, created_at, uploaded_by, project_id, video_id, videos(title), projects(title)')).order('created_at', { ascending: false }).limit(12),
    noSample(sb.from('notes').select(NOTE_SELECT)).order('created_at', { ascending: false }).limit(12),
    noSample(sb.from('notes').select('id', { count: 'exact', head: true }).eq('author_id', me)),
    noSample(sb.from('project_members').select('user_id').neq('user_id', me)).limit(1),
    noSample(sb.from('takes').select('id', { count: 'exact', head: true }).eq('uploaded_by', me)),
    sb.from('note_replies').select('id', { count: 'exact', head: true }).eq('author_id', me),
    sb.from('video_views').select('video_id', { count: 'exact', head: true }).eq('user_id', me)
  ]);
  const todo = forMe.filter((n) => n.status !== 'resolved');
  // One timeline of takes and notes, newest first.
  const activity = [
    ...(takes || []).map((t) => ({ at: t.created_at, who: t.uploaded_by, take: t })),
    ...(notes || []).map((n) => ({ at: n.created_at, who: n.author_id, note: n }))
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  const names = await namesFor([...todo.slice(0, 5).map((n) => n.author_id), ...activity.map((a) => a.who)]);

  // Leaders set things up; people who were invited mostly watch, practice, and send their own videos.
  const owned = real.filter((p) => p.created_by === me);
  const leader = owned.length > 0 || !real.length;
  const firstReal = (owned[0] || real[0])?.id;
  const steps = leader ? [
    ['Create a project', real.length > 0, 'project'],
    ['Upload a rehearsal video', (myTakes || 0) > 0, 'video'],
    ['Pin your first note', (myNotes || 0) > 0, firstReal ? `/app/p/${firstReal}` : null],
    ['Invite a teammate', (roster || []).length > 0, 'invite']
  ] : [
    ['Watch a team video', (myViews || 0) > 0, toReview[0] ? `/app/p/${toReview[0].project_id}/v/${toReview[0].video_id}` : firstReal ? `/app/p/${firstReal}` : null],
    ['Check feedback for you', !todo.length, todo.length ? '/app/feedback' : null],
    ['Upload your video', (myTakes || 0) > 0, dueFromMe[0] ? `/app/p/${dueFromMe[0].project_id}/requests/${dueFromMe[0].id}` : 'video'],
    ['Reply or leave a note', (myReplies || 0) + (myNotes || 0) > 0, firstReal ? `/app/p/${firstReal}` : null]
  ];
  const done = steps.filter((s) => s[1]).length;
  let hideChecklist = done === steps.length || Boolean(onboarding().checklist_hidden);
  try { hideChecklist ||= localStorage.getItem('looproom:checklist') === 'hidden'; } catch {}

  // The sample's one place on Home: a single card for leaders who haven't uploaded a video of their own yet.
  // After that it lives only in the sidebar ("Try it out"). People who were invited don't get it pushed at them.
  const graduated = (takes || []).length > 0;
  // Already past it (videos from before this rule existed): mark it, quietly, so no screen offers the sample again.
  if (graduated && schema.firstRun && !seen('sample_graduated')) markSeen('sample_graduated');
  let sampleHidden = false;
  try { sampleHidden = Number(localStorage.getItem('looproom:sample-card')) > Date.now(); } catch {}
  const sampleCard = sampleOffer() && !graduated && !sampleHidden ? `<section class="panel home-sample">
      <span class="sample-dot" aria-hidden="true">✦</span>
      <div class="grow">${sample
        ? '<h2>Pick up the sample where you left off</h2><p class="muted">A finished team project to try things in. Only you can see it, and it never mixes into your own work.</p>'
        : '<h2>See a finished project first</h2><p class="muted">A sample team with rehearsal videos, notes on the moment, and an AI recap. Only you can see it — try anything.</p>'}</div>
      ${sample ? `<a class="btn primary" href="/app/p/${sample.id}" data-link>Open the sample</a>` : '<button class="btn primary" data-open-sample="home">Explore the sample</button>'}
      <button class="btn ghost small" data-hide-sample-card title="Hide for a week">Not now</button>
    </section>` : '';

  const cleanup = sampleCleanupCard();

  const first = esc(state.profile.display_name.split(' ')[0]);
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  // Before the first real video, a leader gets one card with the one thing to do next instead of a dashboard
  // of empty boxes. The full Home takes over once something is uploaded (or if they hide the checklist).
  if (leader && !graduated && !hideChecklist) {
    const NEXT = {
      'Create a project': ['Create your project', 'One project per show, competition, or class. Your team’s videos and feedback live inside it.', 'Create project'],
      'Upload a rehearsal video': ['Upload your first rehearsal', 'A phone video from your last practice is perfect. Your team pauses on a moment and leaves feedback right there.', 'Upload a video'],
      'Pin your first note': ['Pin your first note', 'Open your video, pause on a moment, and write what should change.', 'Open my video'],
      'Invite a teammate': ['Bring in your team', 'They’ll see your video and can leave feedback on any moment.', 'Invite your team']
    };
    const next = steps.find(([, ok, action]) => !ok && action);
    const [title, text, cta] = NEXT[next?.[0]] || NEXT['Upload a rehearsal video'];
    const action = next?.[2] || 'video';
    view.innerHTML = `<section class="page narrow">
      <header class="page-head"><div><p class="eyebrow">${dateLine}</p><h1>${greeting()}, ${first}</h1></div></header>
      <section class="panel activate">
        <p class="eyebrow">Get started · ${done} of ${steps.length} done</p>
        <h2>${title}</h2>
        <p class="muted">${text}</p>
        ${action.startsWith('/') ? `<a class="btn primary big" href="${action}" data-link>${cta}</a>` : `<button class="btn primary big" data-step="${action}">${cta}</button>`}
        <ol class="activate-steps">${steps.map(([label, ok], i) => `<li class="${ok ? 'done' : label === next?.[0] ? 'now' : ''}"><span class="check">${ok ? '✓' : i + 1}</span>${label}</li>`).join('')}</ol>
      </section>
      ${sampleOffer() ? `<p class="activate-alt">Not ready to film? ${sample ? `<a class="link" href="/app/p/${sample.id}" data-link>Open the sample project</a>` : '<button type="button" class="text-btn" data-open-sample="home">Explore a sample project</button>'} to see how a team uses it.</p>` : ''}
    </section>`;
    view.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => ctx.startAction(b.dataset.step)));
    return;
  }

  view.innerHTML = `<section class="page">
    <header class="page-head"><div><p class="eyebrow">${dateLine}</p><h1>${greeting()}, ${first}</h1></div></header>
    ${sampleCard}${cleanup?.html || ''}
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
        ${upcoming?.length ? `<div class="list flush">${upcoming.map((e) => `<button type="button" class="row" data-event="${e.id}"><span class="cal-dot ${kindClass(e.kind)}"></span><span class="row-main"><span class="row-title">${esc(e.title)}</span><span class="row-meta">${new Date(e.starts_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${e.location ? ` · ${esc(e.location)}` : ''}${e.projects?.title ? ` · ${esc(e.projects.title)}` : ''}</span></span><span class="chev">›</span></button>`).join('')}</div>` : '<p class="panel-empty">Nothing scheduled. Add rehearsals from the Calendar.</p>'}
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
            return `<li><a href="/app/p/${t.project_id}/v/${t.video_id}?take=${t.number}" data-link>${avatar(names[a.who], a.who, 'xs')}<span><b>${who}</b> uploaded ${t.number === 1 ? '' : `Take ${t.number} of `}<b>${esc(t.videos?.title || '')}</b><small>${esc(t.projects?.title || '')} · ${timeAgo(t.created_at)}</small></span></a></li>`;
          }
          const n = a.note;
          return `<li><a href="${noteHref(n)}" data-link>${avatar(names[a.who], a.who, 'xs')}<span><b>${who}</b> noted <span class="time-tag">${noteTime(n)}</span> on <b>${esc(n.videos?.title || '')}</b><small>“${esc(n.body.slice(0, 80))}${n.body.length > 80 ? '…' : ''}” · ${timeAgo(n.created_at)}</small></span></a></li>`;
        }).join('')}</ul>` : '<p class="panel-empty">No activity yet. Upload a rehearsal to get things moving.</p>'}
      </section>
    </div>
  </section>`;

  recapCard.wire();
  // Opening from Home walks the same queue as the Review queue page.
  try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(toReview.map((v) => `/app/p/${v.project_id}/v/${v.video_id}?take=${v.latest.number}`))); } catch {}
  $$('[data-event]').forEach((b) => b.addEventListener('click', () => showEvent((upcoming || []).find((e) => e.id === b.dataset.event), () => ctx.route())));
  $('[data-hide-checklist]')?.addEventListener('click', () => {
    saveOnboarding({ checklist_hidden: true });
    $('.checklist').remove();
  });
  cleanup?.wire(view);
  $('[data-hide-sample-card]')?.addEventListener('click', () => {
    try { localStorage.setItem('looproom:sample-card', String(Date.now() + 7 * 864e5)); } catch {}
    $('.home-sample').remove();
  });
  view.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => ctx.startAction(b.dataset.step)));
}
