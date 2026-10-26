// Feedback: every note, from three angles — for me, by me, and the whole team.
import { sb, $, esc } from '../client.js';
import { ctx } from '../ctx.js';
import { samplePeek } from '../onboarding.js';
import { NOTE_SELECT, noteRow, tabs, empty, pageHead, namesFor, notesForMe, noSample, realProjects } from './shared.js';

const VIEWS = [
  ['for-me', 'For me'],
  ['by-me', 'By me'],
  ['team', 'Team']
];
const STATUSES = [
  ['todo', 'To do'],
  ['resolved', 'Resolved'],
  ['all', 'All']
];

export async function renderFeedback() {
  const { state, view, setCrumbs, navigate } = ctx;
  setCrumbs([['Feedback']]);
  await state.projectsReady;
  const me = state.session.user.id;
  const params = new URLSearchParams(location.search);
  const which = VIEWS.some(([k]) => k === params.get('view')) ? params.get('view') : 'for-me';
  const status = STATUSES.some(([k]) => k === params.get('status')) ? params.get('status') : 'todo';
  const project = params.get('project') || '';
  const url = (changes) => {
    const next = new URLSearchParams({ view: which, status, ...(project ? { project } : {}), ...changes });
    if (!next.get('project')) next.delete('project');
    return `/app/feedback?${next}`;
  };

  let notes;
  if (which === 'for-me') {
    notes = await notesForMe(me);
  } else {
    let q = noSample(sb.from('notes').select(NOTE_SELECT)).order('created_at', { ascending: false }).limit(300);
    if (which === 'by-me') q = q.eq('author_id', me);
    const { data, error } = await q;
    if (error) throw error;
    notes = data;
  }
  if (project) notes = notes.filter((n) => n.project_id === project);
  const counts = { todo: notes.filter((n) => n.status !== 'resolved').length, resolved: notes.filter((n) => n.status === 'resolved').length, all: notes.length };
  const shown = notes.filter((n) => status === 'all' || (status === 'resolved' ? n.status === 'resolved' : n.status !== 'resolved'));
  const names = await namesFor(shown.map((n) => n.author_id));

  const emptyCopy = {
    'for-me': ['Nothing waiting on you', 'Notes on videos you added, takes you uploaded, and @mentions of you collect here.'],
    'by-me': ['You haven’t left notes yet', 'Open a video, pause on a moment, and pin what you see. Your notes collect here so you can follow up.'],
    team: ['No notes yet', 'Notes everyone leaves across your projects show up here.']
  }[which];

  view.innerHTML = `<section class="page narrow-wide">
    ${pageHead('Feedback', { sub: 'Every note, wherever it was left. Open one to jump to that moment.' })}
    ${tabs(VIEWS.map(([k, label]) => [k, label, url({ view: k })]), which)}
    <div class="filters">
      <div class="seg small" role="group" aria-label="Status">${STATUSES.map(([k, label]) => `<a href="${url({ status: k })}" data-link aria-selected="${k === status}">${label} <span>${counts[k]}</span></a>`).join('')}</div>
      ${realProjects().length > 1 ? `<label class="select-wrap"><span class="sr-only">Project</span><select data-project><option value="">All projects</option>${realProjects().map((p) => `<option value="${p.id}" ${p.id === project ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>` : ''}
    </div>
    ${shown.length ? `<div class="list">${shown.map((n) => noteRow(n, names, { showAuthor: which !== 'by-me', showProject: !project })).join('')}</div>`
      : notes.length && status !== 'all' ? empty('✓', status === 'todo' ? 'All caught up' : 'Nothing resolved yet', status === 'todo' ? 'Every note here is resolved. Nice work.' : 'Notes marked fixed show up here.')
      : empty('◫', emptyCopy[0], emptyCopy[1], samplePeek('feedback'))}
  </section>`;
  $('[data-project]')?.addEventListener('change', (event) => navigate(url({ project: event.target.value })));
}
