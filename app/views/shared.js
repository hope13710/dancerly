// Pieces several screens share: note rows, tabs, empty states, people names.
import { sb, esc, initials, fmt, timeAgo, avatar, rememberPhotos } from '../client.js';

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

export function noteRow(n, names, { showAuthor = true, showProject = true } = {}) {
  const author = names[n.author_id] || 'Former member';
  const agrees = n.note_reactions?.length || 0;
  return `<a class="row note-row" href="${noteHref(n)}" data-link>
    ${showAuthor ? avatar(author, n.author_id, 'sm') : ''}
    <span class="row-main">
      <span class="row-title">${n.private_to ? '<span class="lock" title="Private: only the two of you">🔒</span> ' : ''}${esc(n.body)}</span>
      <span class="row-meta">${showAuthor ? `<b>${esc(author)}</b> · ` : ''}<span class="time-tag">${n.t_end === null ? '▸' : '⟷'} ${noteTime(n)}</span> ${esc(n.videos?.title || '')}${n.takes ? ` · Take ${n.takes.number}` : ''}${showProject && n.projects ? ` · ${esc(n.projects.title)}` : ''}</span>
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
  const { data, error } = await sb.from('notes').select(NOTE_SELECT).or(parts.join(',')).neq('author_id', me).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

// Event types: the built-in ones, plus any a team names (shown in one of five steady colors).
export const EVENT_KINDS = { rehearsal: 'Rehearsal', show: 'Show', other: 'Other', due: 'Due' };
export const kindLabel = (k) => EVENT_KINDS[k] || k;
export function kindClass(k) {
  if (EVENT_KINDS[k]) return `k-${k}`;
  let h = 0;
  for (const ch of String(k).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `k-c${h % 5}`;
}
