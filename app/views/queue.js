// Review queue: new takes you haven't watched yet, oldest first, plus requests that are past due.
// Opening a video marks it seen; "Next in queue" walks the list without coming back here.
import { sb, $, esc, initials, timeAgo, avatar } from '../client.js';
import { ctx } from '../ctx.js';
import { samplePeek } from '../onboarding.js';
import { pageHead, tabs, empty, previewEmpty, hasTeammates, namesFor, noSample, realProjects } from './shared.js';
import { myOpenRequests, dueLabel } from './requests.js';

export const QUEUE_KEY = 'looproom:queue';

// Videos with a take someone else uploaded after you last opened them.
export async function unseenVideos() {
  const me = ctx.state.session.user.id;
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const [{ data: takes, error }, { data: views }] = await Promise.all([
    noSample(sb.from('takes').select('id, number, created_at, uploaded_by, video_id, project_id, videos(title, request_id), projects(title)')).neq('uploaded_by', me).gte('created_at', since).order('created_at', { ascending: true }).limit(1000),
    sb.from('video_views').select('video_id, seen_at').eq('user_id', me)
  ]);
  if (error) throw error;
  const seen = Object.fromEntries((views || []).map((v) => [v.video_id, v.seen_at]));
  const byVideo = new Map();
  for (const t of takes || []) {
    if (seen[t.video_id] && t.created_at <= seen[t.video_id]) continue;
    const item = byVideo.get(t.video_id) || { video_id: t.video_id, project_id: t.project_id, title: t.videos?.title || 'Video', project: t.projects?.title || '', request_id: t.videos?.request_id, waiting_since: t.created_at, takes: [] };
    item.takes.push(t);
    byVideo.set(t.video_id, item);
  }
  return [...byVideo.values()].map((v) => ({ ...v, latest: v.takes[v.takes.length - 1], resubmitted: v.takes[v.takes.length - 1].number > 1 }))
    .sort((a, b) => a.waiting_since.localeCompare(b.waiting_since));
}

export async function renderQueue() {
  const { state, view, setCrumbs, navigate } = ctx;
  setCrumbs([['Review queue']]);
  await state.projectsReady;
  const params = new URLSearchParams(location.search);
  const show = ['needs', 'resubmitted', 'overdue'].includes(params.get('show')) ? params.get('show') : 'needs';
  const project = params.get('project') || '';
  const url = (changes) => {
    const next = new URLSearchParams({ show, ...(project ? { project } : {}), ...changes });
    if (!next.get('project')) next.delete('project');
    if (next.get('show') === 'needs') next.delete('show');
    return `/app/queue${next.toString() ? `?${next}` : ''}`;
  };
  const [videos, open] = await Promise.all([unseenVideos(), myOpenRequests()]);
  const inProject = (x) => !project || x.project_id === project;
  const needs = videos.filter(inProject);
  const resubmitted = needs.filter((v) => v.resubmitted);
  const overdue = open.filter(inProject).filter((r) => r.due_at && new Date(r.due_at) < new Date());
  const names = await namesFor(needs.map((v) => v.latest.uploaded_by));
  const list = show === 'resubmitted' ? resubmitted : needs;
  // Nobody else on the team yet: "all caught up" would be misleading, so show what this page is for.
  const alone = !list.length && show !== 'overdue' && !(await hasTeammates());

  view.innerHTML = `<section class="page narrow-wide">
    ${pageHead('Review queue', { sub: 'New takes you haven’t watched yet, oldest first.', actions: list.length && show !== 'overdue' ? '<button class="btn primary" data-start>Start reviewing</button>' : '' })}
    ${tabs([['needs', 'Needs review', url({ show: 'needs' }), needs.length], ['resubmitted', 'Re-submitted', url({ show: 'resubmitted' }), resubmitted.length], ['overdue', 'Late', url({ show: 'overdue' }), overdue.length]], show)}
    ${realProjects().length > 1 ? `<div class="filters"><label class="select-wrap"><span class="sr-only">Project</span><select data-project><option value="">All projects</option>${realProjects().map((p) => `<option value="${p.id}" ${p.id === project ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label></div>` : ''}
    ${show === 'overdue'
      ? (overdue.length ? `<div class="list">${overdue.map((r) => `<a class="row" href="/app/p/${r.project_id}/requests/${r.id}" data-link>
          <span class="row-main"><span class="row-title">${esc(r.title)}</span><span class="row-meta"><span class="due overdue">${esc(dueLabel(r.due_at))}</span> · ${esc(r.projects?.title || '')}</span></span>
          <span class="row-side"><span class="pill danger">Not submitted</span><span class="chev">›</span></span></a>`).join('')}</div>`
        : empty('✓', 'Nothing late', 'Assignments you haven’t submitted show up here once they’re past due.'))
      : list.length ? `<div class="list" data-queue>${list.map((v) => `<a class="row" href="${hrefFor(v)}" data-link data-queue-item>
          ${avatar(names[v.latest.uploaded_by], v.latest.uploaded_by, 'sm')}
          <span class="row-main"><span class="row-title">${esc(v.title)}</span>
            <span class="row-meta"><b>${esc(names[v.latest.uploaded_by] || 'Someone')}</b> · ${v.latest.number === 1 ? 'new video' : `Take ${v.latest.number}`}${v.takes.length > 1 ? ` · ${v.takes.length} new takes` : ''} · ${esc(v.project)}</span></span>
          <span class="row-side">${v.resubmitted ? '<span class="pill info">Re-submitted</span>' : ''}${v.request_id ? '<span class="pill">Assignment</span>' : ''}<small>waiting ${timeAgo(v.waiting_since).replace(' ago', '')}</small><span class="chev">›</span></span>
        </a>`).join('')}</div>`
      : alone ? previewEmpty('rows', 'Your team’s new videos land here', 'When a teammate uploads a video or a new take, it waits here until you’ve watched it. Invite your team to get started.', `<button class="btn primary" data-start-action="invite">Invite your team</button>${samplePeek('queue')}`, 'queue')
      : empty('✓', 'You’re all caught up', 'When teammates upload a video or a new take, it waits here until you’ve watched it.', samplePeek('queue'))}
  </section>`;

  $('[data-project]')?.addEventListener('change', (e) => navigate(url({ project: e.target.value })));
  // Remember the order so the review screen can offer "Next in queue".
  const remember = () => { try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(list.map(hrefFor))); } catch {} };
  view.querySelectorAll('[data-queue-item]').forEach((a) => a.addEventListener('click', remember));
  $('[data-start]')?.addEventListener('click', () => { remember(); navigate(hrefFor(list[0])); });
}

const hrefFor = (v) => `/app/p/${v.project_id}/v/${v.video_id}?take=${v.latest.number}`;

// For the review screen: where to go after this video, if it came from the queue.
export function nextInQueue(projectId, videoId) {
  let list = [];
  try { list = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]'); } catch {}
  const here = list.findIndex((href) => href.startsWith(`/app/p/${projectId}/v/${videoId}`));
  if (here < 0) return null;
  return { next: list[here + 1] || null, position: here + 1, total: list.length };
}
