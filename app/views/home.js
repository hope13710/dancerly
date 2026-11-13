// Home: what needs you today, what changed, and how to get started.
import { sb, $, $$, esc, initials, timeAgo, avatar, schema, cols, toast } from '../client.js';
import { isKo } from '../i18n.js';
import { ctx } from '../ctx.js';
import { NOTE_SELECT, noteRow, noteTime, noteHref, namesFor, notesForMe, kindClass, noSample, watchNav, projectGoal, daysUntil } from './shared.js';
import { homeRecapCard } from './recaps.js';
import { showEvent } from './calendar.js';
import { myOpenRequests, dueLabel } from './requests.js';
import { unseenVideos, QUEUE_KEY } from './queue.js';
import { needsWelcome, onboarding, saveOnboarding, sampleOffer, seen, markSeen, sampleCleanupCard, track } from '../onboarding.js';
import { ic } from '../icons.js';
import { homeGreeting } from '../greeting.js';

// What each getting-started step leads to, drawn with the app's own pieces and marked as an example:
// seeing the result is what makes the step worth doing. Example text follows the app's language.
function stepPreview(kind, project, goal, days) {
  const ex = `<span class="pv-ex">${isKo ? '예시' : 'Example'}</span>`;
  const note = isKo ? '팔 뻗을 때 끝까지 뻗기' : 'Reach all the way out on the arm hit';
  const cap = (t) => `<p class="pv-cap">${t}</p>`;
  // The same circle-and-arrow sketch as the landing page, on the same frame.
  const sketch = '<svg class="pv-sketch" viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><ellipse class="pv-sk" cx="142" cy="102" rx="24" ry="20" /><path class="pv-sk pv-sk-2" d="M114 96 C100 88 86 86 70 88 M70 88 L82 80 M70 88 L81 96" /></svg>';
  // The real sketch toolbar: pen, arrow, circle · four colors · undo, clear · Done.
  const sketchBar = `<div class="pv-skbar" aria-hidden="true"><span class="pv-skg"><b>${ic('pen', 'solo')}</b><b>${ic('arrow', 'solo')}</b><b class="on">${ic('circle', 'solo')}</b></span><span class="pv-skg"><i class="on" style="--c:#ffd60a"></i><i style="--c:#ff453a"></i><i style="--c:#64d2ff"></i><i style="--c:#ffffff"></i></span><span class="pv-skg"><b>${ic('undo', 'solo')}</b><b>${ic('x', 'solo')}</b></span><em>${isKo ? '완료' : 'Done'}</em></div>`;
  const player = (withNote) => `<div class="pv-player"><div class="pv-frame"><img src="/samples/hero-preview.jpg" alt="" />${sketch}</div><div class="pv-tl"><span class="pv-bar"></span><span class="pv-prog"></span><i class="pop" style="left:19%"></i><i style="left:68%"></i><i style="left:89%"></i></div>${withNote ? `<div class="pv-note"><span class="pv-av">JL</span><span class="pv-t">0:01</span><span>${note}</span><span class="pv-sktag">${ic('pen', 'solo')}</span></div>` : ''}</div>`;
  const title = esc(project?.title || (isKo ? '봄 쇼케이스' : 'Spring Showcase'));
  const html = {
    project: `<div class="pv-proj"><div class="pv-k">${isKo ? '프로젝트' : 'Project'}</div><h4><span class="pv-mk">${esc(initials(project?.title || 'Spring Showcase'))}</span>${title}</h4>
      <span class="pv-goal">${ic('flag')}${goal ? `${esc(goal.title)} · ${days <= 0 ? 'D-DAY' : `D-${days}`}` : `${isKo ? '봄 쇼케이스' : 'Spring Showcase'} · D-12`}</span>
      <div class="pv-tabs"><span>${isKo ? '개요' : 'Overview'}</span><span class="on">${isKo ? '영상' : 'Videos'}</span><span>${isKo ? '과제' : 'Assignments'}</span></div>
      <div class="pv-vrow"><span class="pv-ph">${ic('plus', 'solo')}</span>${isKo ? '팀의 영상이 여기에 모여요' : 'Your team’s videos land here'}</div></div>${cap(isKo ? '공연 하나를 위한 팀 공간' : 'One place for one show')}`,
    video: `${player(true)}${cap(isKo ? '영상 위 그 순간에 피드백이 붙어요' : 'Feedback lands on the exact moment')}`,
    note: `<div class="pv-compose"><div class="pv-frame pv-frame-draw"><img src="/samples/hero-preview.jpg" alt="" />${sketch}${sketchBar}</div><div class="pv-crow"><span class="pv-t">${ic('at')}0:01.4</span>${isKo ? '이 순간에 남기기' : 'At this moment'}</div><div class="pv-box">${note} <b>@Maya</b></div><div class="pv-pin"><em class="pv-skchip">${ic('pen')}${isKo ? '스케치' : 'Sketch'}</em><span>${isKo ? '피드백 남기기' : 'Pin note'}</span></div></div>${cap(isKo ? '멈추고, 스케치하고, 쓰면 끝' : 'Pause, sketch, type. Done')}`,
    invite: `<div class="pv-invite"><div class="pv-avs"><span class="a">MC</span><span class="b">JL</span><span class="c">HK</span><span class="d">+4</span></div>
      <div class="pv-joined">${isKo ? 'Jordan님이 합류했어요' : 'Jordan joined'}</div><div class="pv-copy"><span>dancerly.app/join/7f3k…</span><b>${isKo ? '복사' : 'Copy'}</b></div></div>${cap(isKo ? '링크 하나면 팀이 모여요' : 'One link brings the team in')}`
  }[kind] || '';
  return `<div class="pv-wrap" data-no-i18n>${ex}${html}</div>`;
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
  // Today through next week, for the line under the greeting (a show soon, rehearsal today or just done).
  const todayStart = new Date(new Date().toDateString()).toISOString();
  const weekAhead = new Date(Date.now() + 7 * 864e5).toISOString();
  const [recapCard, dueFromMe, toReview, { data: upcoming }, { data: soon }, forMe, { data: takes }, { data: notes }, { count: myNotes }, { data: roster }, { count: myTakes }, { count: myReplies }, { count: myViews }] = await Promise.all([
    homeRecapCard(),
    myOpenRequests(),
    unseenVideos(),
    real.length ? sb.from('project_events').select('id, project_id, title, kind, starts_at, ends_at, location, details, created_by, projects!project_events_project_id_fkey(title)').in('project_id', real.map((p) => p.id)).gte('starts_at', new Date().toISOString()).order('starts_at').limit(3) : { data: [] },
    real.length ? sb.from('project_events').select('id, project_id, title, kind, starts_at, ends_at').in('project_id', real.map((p) => p.id)).gte('starts_at', todayStart).lte('starts_at', weekAhead).order('starts_at').limit(30) : { data: [] },
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
  const names = await namesFor([...todo.slice(0, 5).map((n) => n.author_id), ...todo.map((n) => n.author_id), ...activity.map((a) => a.who)]);

  // Leaders set things up; people who were invited mostly watch, practice, and send their own videos.
  const owned = real.filter((p) => p.created_by === me);
  const leader = owned.length > 0 || !real.length;
  const firstReal = (owned[0] || real[0])?.id;
  const latestVideo = (takes || []).find((t) => t.uploaded_by === me) || (takes || [])[0];
  const steps = leader ? [
    ['Create a project', real.length > 0, 'project'],
    ['Upload a practice video', (myTakes || 0) > 0, 'video'],
    // The first note is written on a video: open the newest one (yours if there is one).
    ['Pin your first note', (myNotes || 0) > 0, latestVideo ? `/app/p/${latestVideo.project_id}/v/${latestVideo.video_id}` : firstReal ? `/app/p/${firstReal}` : null],
    ['Invite people', (roster || []).length > 0, 'invite']
  ] : [
    ['Watch a project video', (myViews || 0) > 0, toReview[0] ? `/app/p/${toReview[0].project_id}/v/${toReview[0].video_id}` : firstReal ? `/app/p/${firstReal}` : null],
    ['Check feedback for you', !todo.length, todo.length ? '/app/feedback' : null],
    ['Submit your video', (myTakes || 0) > 0, dueFromMe[0] ? `/app/p/${dueFromMe[0].project_id}/requests/${dueFromMe[0].id}` : 'video'],
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
      <span class="sample-dot" aria-hidden="true">${ic('sample', 'solo')}</span>
      <div class="grow">${sample
        ? '<h2>Pick up the sample where you left off</h2><p class="muted">A finished team project to try things in. Only you can see it, and it never mixes into your own work.</p>'
        : '<h2>See a finished project first</h2><p class="muted">A sample project with practice videos, notes on the moment, and an AI recap. Only you can see it — try anything.</p>'}</div>
      ${sample ? `<a class="btn primary" href="/app/p/${sample.id}" data-link>Open the sample</a>` : '<button class="btn primary" data-open-sample="home">Explore the sample</button>'}
      <button class="btn ghost small" data-hide-sample-card title="Hide for a week">Not now</button>
    </section>` : '';

  const cleanup = sampleCleanupCard();

  const first = state.profile.display_name.split(' ')[0];
  // The team recap dancerly wrote for an upcoming rehearsal, if any (migration 049).
  const rehearsalIds = (soon || []).filter((e) => e.kind === 'rehearsal').map((e) => `rehearsal:${e.id}`);
  const { data: teamRecaps } = schema.teamRecaps && rehearsalIds.length
    ? await sb.from('recaps').select('id, cycle').eq('team', true).in('cycle', rehearsalIds).order('created_at', { ascending: false })
    : { data: [] };
  const greetingFor = (activationShown) => homeGreeting({
    name: first, userId: me, firstVisit: !real.length,
    events: soon, takes, forMe, names,
    recapFor: (eventId) => (teamRecaps || []).find((r) => r.cycle === `rehearsal:${eventId}`)?.id,
    // The getting-started card already asks for the invite; the line doesn't repeat it.
    soloLeader: owned.length > 0 && !(roster || []).length && graduated && !activationShown
  });

  // A leader gets one getting-started card with the one thing to do next, until all four steps are done (or
  // they hide it). Before the first real video it's the whole Home instead of a dashboard of empty boxes;
  // after that it sits on top of the regular Home, so the first note and the first teammate get the same help.
  let activation = null;
  if (leader && !hideChecklist) {
    // These places are empty for now; the sidebar points at each once something lands there.
    if (!graduated) watchNav('queue', 'feedback', 'people', 'insights');
    const NEXT = {
      'Create a project': ['Create your project', 'One project per goal: a show, a competition, a class, or your own practice.', 'Create project', 'project'],
      'Upload a practice video': ['Upload your first practice video', 'A phone video from your last practice is plenty. Pause on any moment and leave feedback right on it.', 'Upload video', 'video'],
      'Pin your first note': ['Pin your first note', 'Open your video, pause on a moment, and write what should change.', 'Open my video', 'note'],
      'Invite people': ['Invite people', 'A coach, your team, anyone you want feedback from. They’ll see your video and can leave feedback on any moment.', 'Invite people', 'invite']
    };
    const SHORT = { 'Create a project': 'Project', 'Upload a practice video': 'Upload video', 'Pin your first note': 'First note', 'Invite people': 'Invite people' };
    const next = steps.find(([, ok, action]) => !ok && action);
    const [title, text, cta, kind] = NEXT[next?.[0]] || NEXT['Upload a practice video'];
    const action = next?.[2] || 'video';
    const left = steps.filter(([, ok]) => !ok).length;
    // The project's goal, as on the project's own header: a countdown makes each step part of the show.
    const project = real.find((p) => p.id === firstReal);
    const goal = project ? await projectGoal({ ...project, target_event_id: (await sb.from('projects').select(cols('target_event_id')).eq('id', project.id).maybeSingle()).data?.target_event_id }) : null;
    const days = goal ? daysUntil(goal.starts_at) : null;
    // On a computer, the video is usually still on the phone: offer to continue there.
    const handoff = kind === 'video' && project && !matchMedia('(pointer: coarse)').matches;
    const html = `
      <section class="panel activate">
        <div class="activate-main">
          <p class="activate-meta"><span>Get started · ${done} of ${steps.length} done</span><span class="muted">· ${left <= 1 ? 'About 1 min left' : `About ${left} min left`}</span>${goal ? `<span class="goal-chip activate-goal">${ic('flag')}<span class="goal-name">${esc(goal.title)}</span><b>${days <= 0 ? 'Today' : `D-${days}`}</b></span>` : ''}</p>
          <h2>${title}</h2>
          <p class="muted lead">${text}</p>
          <div class="activate-ctas">
            ${action.startsWith('/') ? `<a class="btn primary big" href="${action}" data-link>${cta}</a>` : `<button class="btn primary big" data-step="${action}">${cta}</button>`}
            ${sampleOffer() ? (sample ? `<a class="btn big ghost-border" href="/app/p/${sample.id}" data-link>${ic('sample')}Open the sample first</a>` : `<button type="button" class="btn big ghost-border" data-open-sample="home">${ic('sample')}See a sample first</button>`) : ''}
          </div>
          ${handoff ? `<div class="handoff">
            <span class="handoff-qr" data-qr aria-hidden="true"></span>
            <div><b>Is the video on your phone?</b><small>Point your phone’s camera at the code. The upload for ${esc(project.title)} opens right there.</small>
              <button type="button" class="link-btn inline" data-send-link>Or email the link to myself${ic('right', 'after')}</button></div>
          </div>` : ''}
          <ol class="activate-steps">${steps.map(([label, ok], i) => `<li class="${ok ? 'done' : label === next?.[0] ? 'now' : ''}"><span class="check">${ok ? ic('check', 'solo') : i + 1}</span>${SHORT[label] || label}</li>`).join('')}${graduated ? '<li class="activate-hide"><button type="button" class="link-btn inline" data-hide-checklist>Hide</button></li>' : ''}</ol>
        </div>
        <div class="activate-preview" aria-hidden="true">${stepPreview(kind, project, goal, days)}</div>
      </section>`;
    const wire = () => {
      if (handoff) {
        const url = `${location.origin}/app/p/${project.id}?upload=1&ref=qr_home`;
        import('../vendor/qrcode-generator-1.4.4.js').then(({ default: qrcode }) => {
          const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
          const box = $('[data-qr]'); if (box) box.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
        }).catch(() => $('.handoff')?.classList.add('no-qr'));
        $('[data-send-link]').addEventListener('click', async (e) => {
          const b = e.currentTarget; b.disabled = true;
          const { data, error } = await sb.functions.invoke('send-upload-link', { body: { project_id: project.id } });
          b.disabled = false;
          if (error) {
            let msg = 'Couldn’t send the email. Try again in a minute.';
            try { msg = (await error.context.json()).error || msg; } catch {}
            return toast(msg, 'error');
          }
          track('upload_link_sent');
          toast(`Sent to ${data.to}. Open it on your phone.`);
        });
      }
    };
    activation = { html, wire };
  }
  if (activation && !graduated) {
    view.innerHTML = `<section class="page">
      ${greetingFor(true)}
      ${activation.html}
    </section>`;
    activation.wire();
    view.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => ctx.startAction(b.dataset.step)));
    return;
  }

  view.innerHTML = `<section class="page">
    ${greetingFor(Boolean(activation))}
    ${activation?.html || ''}
    ${sampleCard}${cleanup?.html || ''}
    ${recapCard.html}
    <div class="home-strip">
      <section class="panel">
        <div class="panel-head"><div><h2>Your assignments</h2><p class="muted">Videos to submit</p></div></div>
        ${dueFromMe.length ? `<div class="list flush">${dueFromMe.slice(0, 3).map((r) => `<a class="row" href="/app/p/${r.project_id}/requests/${r.id}" data-link><span class="row-main"><span class="row-title">${esc(r.title)}</span><span class="row-meta"><span class="due ${r.due_at && new Date(r.due_at) < new Date() ? 'overdue' : ''}">${esc(dueLabel(r.due_at))}</span></span></span><span class="chev">${ic('right', 'solo')}</span></a>`).join('')}</div>` : '<p class="panel-empty">Nothing due.</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>To review</h2><p class="muted">New takes you haven’t watched</p></div>${toReview.length ? `<a class="link" href="/app/queue" data-link>See all ${toReview.length}${ic('right', 'after')}</a>` : ''}</div>
        ${toReview.length ? `<div class="list flush">${toReview.slice(0, 3).map((v) => `<a class="row" href="/app/p/${v.project_id}/v/${v.video_id}?take=${v.latest.number}" data-link data-review-link><span class="row-main"><span class="row-title">${esc(v.title)}</span><span class="row-meta">${v.latest.number === 1 ? 'New video' : `Take ${v.latest.number}`} · ${timeAgo(v.latest.created_at)}</span></span><span class="chev">${ic('right', 'solo')}</span></a>`).join('')}</div>` : '<p class="panel-empty">You’re all caught up.</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Coming up</h2><p class="muted">Rehearsals and shows</p></div><a class="link" href="/app/calendar" data-link>Calendar${ic('right', 'after')}</a></div>
        ${upcoming?.length ? `<div class="list flush">${upcoming.map((e) => `<button type="button" class="row" data-event="${e.id}"><span class="cal-dot ${kindClass(e.kind)}"></span><span class="row-main"><span class="row-title">${esc(e.title)}</span><span class="row-meta">${new Date(e.starts_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${e.location ? ` · ${esc(e.location)}` : ''}${e.projects?.title ? ` · ${esc(e.projects.title)}` : ''}</span></span><span class="chev">${ic('right', 'solo')}</span></button>`).join('')}</div>` : '<p class="panel-empty">Nothing scheduled. Add rehearsals from the Calendar.</p>'}
      </section>
    </div>
    ${hideChecklist || activation ? '' : `<section class="panel checklist">
      <div class="panel-head"><div><h2>Get started</h2><p class="muted">${done} of ${steps.length} done</p></div><button class="btn ghost small" data-hide-checklist>Hide</button></div>
      <div class="progress" aria-hidden="true"><i style="width:${(done / steps.length) * 100}%"></i></div>
      <ol>${steps.map(([label, ok, action]) => `<li class="${ok ? 'done' : ''}"><span class="check">${ok ? ic('check', 'solo') : ''}</span><span>${label}</span>${ok || !action ? '' : action.startsWith('/') ? `<a class="btn small" href="${action}" data-link>Open</a>` : `<button class="btn small" data-step="${action}">Start</button>`}</li>`).join('')}</ol>
    </section>`}
    <div class="home-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>For you</h2><p class="muted">Notes on your videos and @mentions that aren’t fixed yet</p></div>${todo.length ? `<a class="link" href="/app/feedback" data-link>See all ${todo.length}${ic('right', 'after')}</a>` : ''}</div>
        ${todo.length ? `<div class="list flush">${todo.slice(0, 5).map((n) => noteRow(n, names)).join('')}</div>`
          : '<p class="panel-empty">Nothing waiting on you. When someone leaves notes on your videos or @mentions you, it shows up here.</p>'}
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
          return `<li><a href="${noteHref(n)}" data-link>${avatar(names[a.who], a.who, 'xs')}<span><b>${who}</b> left a note at <span class="time-tag">${noteTime(n)}</span> on <b>${esc(n.videos?.title || '')}</b><small>“${esc(n.body.slice(0, 80))}${n.body.length > 80 ? '…' : ''}” · ${timeAgo(n.created_at)}</small></span></a></li>`;
        }).join('')}</ul>` : '<p class="panel-empty">No activity yet. Upload a practice video to get things moving.</p>'}
      </section>
    </div>
  </section>`;

  recapCard.wire();
  // Opening from Home walks the same queue as the Review queue page.
  try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(toReview.map((v) => `/app/p/${v.project_id}/v/${v.video_id}?take=${v.latest.number}`))); } catch {}
  $$('[data-event]').forEach((b) => b.addEventListener('click', () => showEvent((upcoming || []).find((e) => e.id === b.dataset.event), () => ctx.route())));
  activation?.wire();
  $('[data-hide-checklist]')?.addEventListener('click', () => {
    saveOnboarding({ checklist_hidden: true });
    ($('.panel.activate') || $('.checklist'))?.remove();
  });
  cleanup?.wire(view);
  $('[data-hide-sample-card]')?.addEventListener('click', () => {
    try { localStorage.setItem('looproom:sample-card', String(Date.now() + 7 * 864e5)); } catch {}
    $('.home-sample').remove();
  });
  view.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => ctx.startAction(b.dataset.step)));
}
