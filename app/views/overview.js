// Project › Overview: goal, music, what's next, and how it's going. (Sections live in Practice.)
import { sb, $, $$, esc, timeAgo, toast, friendlyError, dialog, schema, notChoreo } from '../client.js';
import { ctx } from '../ctx.js';
import { isKo } from '../i18n.js';
import { kindClass, daysUntil, daysLabel } from './shared.js';
import { showEvent } from './calendar.js';
import { loadProject, projectHead } from './project.js';
import { ic } from '../icons.js';
import { renderInsights } from './insights.js';
import { loadChoreo, chooseChoreo, choreoTitle, canChoreo } from './practice.js';

export async function renderProjectOverview(projectId) {
  const { view, setCrumbs } = ctx;
  const nowIso = new Date().toISOString();
  const [p, { data: extra }, { data: rows }, { data: events }, { count: openNotes }, { data: requests }, { data: videos }] = await Promise.all([
    loadProject(projectId),
    sb.from('projects').select('goal, music_title, music_url').eq('id', projectId).single(),
    sb.from('count_sheet_rows').select('status, video_id, t_start').eq('project_id', projectId),
    sb.from('project_events').select('id, project_id, title, kind, starts_at, ends_at, location, details, created_by').eq('project_id', projectId).gte('starts_at', nowIso).order('starts_at').limit(5),
    sb.from('notes').select('id', { count: 'exact', head: true }).eq('project_id', projectId).neq('status', 'resolved'),
    sb.from('requests').select('id, title, due_at').eq('project_id', projectId).eq('status', 'active').order('due_at', { ascending: true, nullsFirst: false }).limit(3),
    notChoreo(sb.from('videos').select('id, title, created_at')).eq('project_id', projectId).order('created_at', { ascending: false }).limit(3)
  ]);
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Overview']]);
  // What the team dances: the choreo video sits with the goal and the music (Practice is one tap away).
  const choreo = schema.choreo ? await loadChoreo(p.project) : null;
  const choreoId = choreo?.kind === 'file' ? choreo.video.id : null;
  const parts = choreo ? (rows || []).filter((r) => r.t_start !== null && (choreoId ? r.video_id === choreoId : !r.video_id)).length : 0;
  const practiceHref = `/app/p/${projectId}/practice?from=overview`;
  const choreoLine = choreo
    ? `<p class="music choreo-line">${ic('loop')}<span class="muted">${isKo ? '원본 안무' : 'Choreo'} · </span><a class="link" href="${practiceHref}" data-link data-no-i18n>${esc(choreoTitle(choreo))}${ic('right', 'after')}</a>${parts ? `<span class="muted" data-no-i18n> · ${isKo ? `파트 ${parts}개` : `${parts} ${parts === 1 ? 'part' : 'parts'}`}</span>` : ''}</p>`
    : canChoreo(p) && schema.choreo && !p.project.is_sample ? `<p class="music choreo-line">${ic('loop')}<button type="button" class="text-btn link" data-add-choreo>Add a choreo video</button></p>` : '';
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
        ${extra?.music_title || extra?.music_url ? `<p class="music">${ic('music')}${extra.music_url ? `<a class="link" href="${esc(extra.music_url)}" target="_blank" rel="noopener noreferrer">${esc(extra.music_title || extra.music_url)}${ic('arrow', 'after')}</a>` : esc(extra.music_title)}</p>` : ''}
        ${choreoLine}
      </section>
      <section class="panel countdown">
        ${goal ? `<p class="eyebrow">${goal.picked ? 'Goal' : 'Next show'}</p><b class="big-num">${daysLabel(daysUntil(goal.starts_at))}</b><p class="muted"><button class="text-btn" data-event="${goal.id}">${esc(goal.title)}</button> · ${when(goal.starts_at)}${goal.location ? ` · ${esc(goal.location)}` : ''}</p>${!goal.picked && p.isOwner && schema.goal ? '<p class="fine left">Working toward something else? Open an event and set it as the goal.</p>' : ''}`
          : `<p class="eyebrow">Next</p>${next ? `<b class="big-num small"><button class="text-btn" data-event="${next.id}">${esc(next.title)}</button></b><p class="muted">${when(next.starts_at)}</p>${p.isOwner && schema.goal ? '<p class="fine left">Working toward a show or competition? Open its event and set it as the goal for a countdown.</p>' : ''}` : `<p class="panel-empty">Nothing scheduled. <a class="link" href="/app/p/${projectId}/calendar" data-link>Add a rehearsal or show${ic('right', 'after')}</a></p>`}`}
      </section>
    </div>
    <div class="stats">
      <a class="stat link-stat" href="${practiceHref}" data-link><small>Sections clean</small><b>${choreo && rows?.length ? `${clean}/${rows.length}` : '—'}</b><span>${!choreo ? 'Add the choreo video first' : rows?.length ? 'in Practice' : 'Mark them in Practice'}</span></a>
      <a class="stat link-stat" href="/app/p/${projectId}/notes" data-link><small>Open notes</small><b>${openNotes ?? 0}</b><span>to practice</span></a>
      <a class="stat link-stat" href="/app/p/${projectId}/requests" data-link><small>Open assignments</small><b>${requests?.length ?? 0}</b><span>${requests?.[0]?.due_at ? `Next due ${new Date(requests[0].due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'videos asked for'}</span></a>
      <a class="stat link-stat" href="/app/p/${projectId}/people" data-link><small>People</small><b>${p.members.length}</b><span>on this project</span></a>
    </div>
    <div data-project-insights><div class="ins-embed-head"><h2>How it’s going</h2></div><span class="sk ins-embed-loading" aria-hidden="true"></span></div>
    <div class="home-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>Coming up</h2></div><a class="link" href="/app/p/${projectId}/calendar" data-link>Calendar${ic('right', 'after')}</a></div>
        ${events?.length ? `<div class="list flush">${events.map((e) => `<button type="button" class="row" data-event="${e.id}"><span class="cal-dot ${kindClass(e.kind)}"></span><span class="row-main"><span class="row-title">${e.id === goal?.id && goal.picked ? ic('flag') : ''}${esc(e.title)}</span><span class="row-meta">${when(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ''}</span></span><span class="chev">${ic('right', 'solo')}</span></button>`).join('')}</div>` : '<p class="panel-empty">Nothing scheduled yet.</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>${schema.videoKind ? 'Latest takes' : 'Latest videos'}</h2></div><a class="link" href="/app/p/${projectId}" data-link>All videos${ic('right', 'after')}</a></div>
        ${videos?.length ? `<div class="list flush">${videos.map((v) => `<a class="row" href="/app/p/${projectId}/v/${v.id}" data-link><span class="video-thumb sm">${ic('play', 'solo')}</span><span class="row-main"><span class="row-title">${esc(v.title)}</span><span class="row-meta">${timeAgo(v.created_at)}</span></span><span class="chev">${ic('right', 'solo')}</span></a>`).join('')}</div>` : '<p class="panel-empty">No videos yet.</p>'}
      </section>
    </div>
  </section>`;
  // How it's going: the Insights picture for this project, filled in after the rest of the page is up.
  const insightsHost = view.querySelector('[data-project-insights]');
  renderInsights({ projectId, root: insightsHost }).catch(() => { if (insightsHost.isConnected) insightsHost.remove(); });
  // Any event on this page opens its details (and, for the owner, "Set as project goal").
  const byId = Object.fromEntries([...(events || []), ...(goal ? [goal] : [])].map((e) => [e.id, e]));
  $$('[data-event]').forEach((b) => b.addEventListener('click', () => showEvent(byId[b.dataset.event], () => renderProjectOverview(projectId), projectId)));
  $('[data-add-choreo]')?.addEventListener('click', async (e) => { if (await chooseChoreo({ projectId, anchor: e.currentTarget })) ctx.navigate(practiceHref); });
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
