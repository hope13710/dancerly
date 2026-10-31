// Pieces several screens share: note rows, tabs, empty states, people names.
import { sb, esc, initials, fmt, timeAgo, avatar, rememberPhotos } from '../client.js';
import { ctx } from '../ctx.js';
import { isKo } from '../i18n.js';

// The sample project is a sandbox: it shows up only inside itself (and Insights' demo), never in the
// screens that gather work across projects — Home, Feedback, Inbox, Calendar, People, Queue, Search, Recaps.
export const sampleIds = () => (ctx.state?.projects || []).filter((p) => p.is_sample).map((p) => p.id);
export const realProjects = () => (ctx.state?.projects || []).filter((p) => !p.is_sample);
export function noSample(q, col = 'project_id') {
  const ids = sampleIds();
  return ids.length ? q.not(col, 'in', `(${ids.join(',')})`) : q;
}

export const NOTE_SELECT = 'id, project_id, video_id, take_id, t_start, t_end, body, status, author_id, private_to, created_at, resolved_at, takes(number), videos(title), projects(title), note_reactions(user_id), note_replies(count)';

// Opens the review on that take with the note selected and the video at its moment.
export const noteHref = (n) => `/app/p/${n.project_id}/v/${n.video_id}?take=${n.takes?.number ?? ''}&note=${n.id}`;
export const noteTime = (n) => (n.t_end === null || n.t_end === undefined ? fmt(Number(n.t_start)) : `${fmt(Number(n.t_start))}–${fmt(Number(n.t_end))}`);

const STATUS = { open: ['Open', 'warn'], practicing: ['Practicing', 'info'], resolved: ['Resolved', 'ok'] };
export const statusPill = (status) => `<span class="pill ${STATUS[status][1]}">${STATUS[status][0]}</span>`;

export async function namesFor(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await sb.from('profiles').select('id, display_name, avatar_url').in('id', unique);
  rememberPhotos(data);
  return Object.fromEntries((data || []).map((p) => [p.id, p.display_name]));
}

// Someone's photo and name, opening their profile. Rows here are whole links already and a link can't sit
// inside another, so it's a span that acts as a link (main.js routes clicks and Enter on [data-person]).
// Someone no longer around (no name) stays plain text.
export function personLink(name, id, { photo = true } = {}) {
  if (!id || !name) return esc(name || 'a teammate');
  return `<span class="person-link" role="link" tabindex="0" data-person="${id}">${photo ? avatar(name, id, 'xs') : ''}<span>${esc(name)}</span></span>`;
}
// "by Maya" / "Maya님", with Maya linked.
export const byPerson = (name, id) => `<span data-no-i18n>${isKo ? `${personLink(name, id)}님` : `by ${personLink(name, id).replace('class="person-link"', 'class="person-link after-text"')}`}</span>`;

export function noteRow(n, names, { showAuthor = true, showProject = true } = {}) {
  const author = names[n.author_id] || 'Former member';
  const agrees = n.note_reactions?.length || 0;
  return `<a class="row note-row" href="${noteHref(n)}" data-link>
    ${showAuthor ? (names[n.author_id] ? `<span class="person-link" role="link" tabindex="-1" aria-hidden="true" data-person="${n.author_id}">${avatar(author, n.author_id, 'sm')}</span>` : avatar(author, n.author_id, 'sm')) : ''}
    <span class="row-main">
      <span class="row-title">${n.private_to ? '<span class="lock" title="Private: only the two of you">🔒</span> ' : ''}${esc(n.body)}</span>
      <span class="row-meta">${showAuthor ? `<b>${names[n.author_id] ? personLink(author, n.author_id, { photo: false }) : esc(author)}</b> · ` : ''}<span class="time-tag">${n.t_end === null ? '▸' : '⟷'} ${noteTime(n)}</span> ${esc(n.videos?.title || '')}${n.takes ? ` · Take ${n.takes.number}` : ''}${showProject && n.projects ? ` · ${esc(n.projects.title)}` : ''}</span>
    </span>
    <span class="row-side">${n.note_replies?.[0]?.count ? `<span class="agree-count" title="Replies">💬 ${n.note_replies[0].count}</span>` : ''}${agrees ? `<span class="agree-count" title="${agrees} agree">👍 ${agrees}</span>` : ''}${statusPill(n.status)}<small>${timeAgo(n.created_at)}</small></span>
  </a>`;
}

// Underline tabs as links, so each tab has its own URL.
export function tabs(items, current) {
  return `<nav class="tabs" aria-label="Views">${items.map(([key, label, href, count]) => `<a href="${href}" data-link ${key === current ? 'aria-current="page"' : ''}>${esc(label)}${count ? `<span class="count">${count}</span>` : ''}</a>`).join('')}</nav>`;
}

export function empty(icon, title, text, action = '') {
  return `<div class="empty"><div class="empty-icon">${icon}</div><h2>${esc(title)}</h2><p>${text}</p>${action}</div>`;
}

// An empty page for someone just starting: a faint picture of what will fill it, then the next step.
// `kind` picks the picture: rows (a list of videos or people), notes (feedback on moments), bars (a chart).
// It also remembers the page was seen empty, so the sidebar can point back once something lands (main.js).
export function previewEmpty(kind, title, text, action = '', watch = '') {
  if (watch) watchNav(watch);
  const row = (i) => kind === 'notes'
    ? `<span class="pv-row"><span class="pv-chip">${['0:42', '1:15', '2:03'][i]}</span><span class="pv-lines"><i></i><i></i></span></span>`
    : `<span class="pv-row"><span class="pv-dot"></span><span class="pv-lines"><i></i><i></i></span><span class="pv-pill"></span></span>`;
  const picture = kind === 'bars'
    ? `<span class="pv-bars">${'<i></i>'.repeat(7)}</span>`
    : [0, 1, 2].map(row).join('');
  return `<div class="empty preview-empty"><div class="pv-art pv-art-${kind}" aria-hidden="true">${picture}</div><h2>${esc(title)}</h2><p>${text}</p>${action}</div>`;
}

// Sidebar places someone has seen while they were empty (see paintNavDots in main.js).
// One save for all of them, so a few at once don't overwrite each other.
export function watchNav(...keys) {
  const seen = ctx.state.profile?.onboarding?.seen || {};
  const fresh = keys.filter((k) => !seen[`nav_watch_${k}`] && !seen[`nav_new_${k}`]);
  if (!fresh.length) return;
  import('../onboarding.js').then((m) => m.saveOnboarding({ seen: { ...(m.onboarding().seen || {}), ...Object.fromEntries(fresh.map((k) => [`nav_watch_${k}`, true])) } }));
}

// Whether anyone else is in your real projects (sample teammates don't count).
export async function hasTeammates() {
  const ids = realProjects().map((p) => p.id);
  if (!ids.length) return false;
  const { data } = await sb.from('project_members').select('user_id').in('project_id', ids).neq('user_id', ctx.state.session.user.id).limit(1);
  return Boolean(data?.length);
}

// Whether any real project has a video yet.
export async function hasRealVideo() {
  if (!realProjects().length) return false;
  const { data } = await noSample(sb.from('videos').select('id')).limit(1);
  return Boolean(data?.length);
}

export function pageHead(title, { eyebrow = '', actions = '', sub = '' } = {}) {
  return `<header class="page-head"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h1>${esc(title)}</h1>${sub ? `<p class="muted sub">${sub}</p>` : ''}</div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</header>`;
}

// Notes that concern you: on videos you added, takes you uploaded, or where you were @mentioned.
export async function notesForMe(me, { limit = 200 } = {}) {
  const [{ data: vids }, { data: takes }, { data: mentions }] = await Promise.all([
    sb.from('videos').select('id').eq('created_by', me),
    sb.from('takes').select('id').eq('uploaded_by', me),
    sb.from('note_mentions').select('note_id').eq('user_id', me)
  ]);
  const parts = [`private_to.eq.${me}`]; // private notes addressed to you
  if (vids?.length) parts.push(`video_id.in.(${vids.map((v) => v.id).join(',')})`);
  if (takes?.length) parts.push(`take_id.in.(${takes.map((t) => t.id).join(',')})`);
  if (mentions?.length) parts.push(`id.in.(${mentions.map((m) => m.note_id).join(',')})`);
  const { data, error } = await noSample(sb.from('notes').select(NOTE_SELECT).or(parts.join(',')).neq('author_id', me)).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

// A project's goal: the event its owner picked (projects.target_event_id), else its next show.
// Only events from today on count; a goal that has passed simply stops showing.
export async function projectGoal(project) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data } = await sb.from('project_events').select('id, project_id, title, kind, starts_at, ends_at, location, details, created_by')
    .eq('project_id', project.id).gte('starts_at', today.toISOString()).order('starts_at').limit(30);
  const upcoming = data || [];
  const picked = project.target_event_id && upcoming.find((e) => e.id === project.target_event_id);
  if (picked) return { ...picked, picked: true };
  const show = upcoming.find((e) => e.kind === 'show');
  return show ? { ...show, picked: false } : null;
}
// Calendar days from today, not 24-hour blocks: an evening show tomorrow is "Tomorrow", not "Today".
export function daysUntil(iso) {
  const a = new Date();
  const b = new Date(iso);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 864e5);
}
export const daysLabel = (n) => (n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${n} days`);

// Event types: the built-in ones, plus any a team names (shown in one of five steady colors).
export const EVENT_KINDS = { rehearsal: 'Rehearsal', show: 'Show', other: 'Other', due: 'Due' };
export const kindLabel = (k) => EVENT_KINDS[k] || k;
export function kindClass(k) {
  if (EVENT_KINDS[k]) return `k-${k}`;
  let h = 0;
  for (const ch of String(k).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `k-c${h % 5}`;
}
