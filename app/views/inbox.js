// Inbox: what happened that you should know about. Opening an item marks it read and jumps to the moment.
import { sb, $, $$, esc, initials, toast, friendlyError, timeAgo, avatar } from '../client.js';
import { ctx } from '../ctx.js';
import { noteTime, tabs, empty, pageHead, namesFor, noSample } from './shared.js';

const SELECT = 'id, kind, created_at, read_at, actor_id, project_id, take_id, note_id, recap_id, recaps(content), request_id, requests(title, due_at), projects(title), takes(number, video_id, videos(title)), notes(body, t_start, t_end, video_id, take_id, takes(number), videos(title))';

const VERB = {
  mention: 'mentioned you',
  note_on_your_video: 'left a note on',
  new_take: 'uploaded',
  note_resolved: 'resolved your note on',
  joined: 'joined'
};

function describe(item, names) {
  const who = `<b>${esc(names[item.actor_id] || 'Someone')}</b>`;
  const video = item.notes?.videos?.title || item.takes?.videos?.title || '';
  const takeNo = item.notes?.takes?.number ?? item.takes?.number;
  const project = esc(item.projects?.title || '');
  if (item.kind === 'joined') return `${who} joined <b>${project}</b>`;
  if (item.kind === 'recap_shared') return `${who} shared a recap in <b>${project}</b>`;
  if (item.kind === 'request_new') return `${who} asked you for a video: <b>${esc(item.requests?.title || '')}</b>`;
  if (item.kind === 'request_due') return `Due in 24 hours: <b>${esc(item.requests?.title || '')}</b> — you haven’t submitted yet`;
  if (item.kind === 'request_reminder') return `${who} reminded you: <b>${esc(item.requests?.title || '')}</b>`;
  if (item.kind === 'new_take') return `${who} uploaded ${takeNo === 1 ? 'a new video' : `Take ${takeNo} of`} <b>${esc(video)}</b>`;
  if (item.kind === 'private_note') return `🔒 ${who} left you a private note on <b>${esc(video)}</b>${takeNo ? ` · Take ${takeNo}` : ''}`;
  if (item.kind === 'reply') return `${who} replied to a note on <b>${esc(video)}</b>${takeNo ? ` · Take ${takeNo}` : ''}`;
  if (item.kind === 'mention') return `${who} mentioned you on <b>${esc(video)}</b>${takeNo ? ` · Take ${takeNo}` : ''}`;
  return `${who} ${VERB[item.kind]} <b>${esc(video)}</b>${takeNo ? ` · Take ${takeNo}` : ''}`;
}

function hrefFor(item) {
  if (item.kind === 'joined') return `/app/p/${item.project_id}/people`;
  if (item.kind === 'recap_shared') return `/app/recaps/${item.recap_id}`;
  if (item.request_id) return `/app/p/${item.project_id}/requests/${item.request_id}`;
  if (item.notes) return `/app/p/${item.project_id}/v/${item.notes.video_id}?take=${item.notes.takes?.number ?? ''}&note=${item.note_id}`;
  if (item.takes) return `/app/p/${item.project_id}/v/${item.takes.video_id}?take=${item.takes.number}`;
  return `/app/p/${item.project_id}`;
}

export async function renderInbox() {
  const { state, view, setCrumbs } = ctx;
  setCrumbs([['Inbox']]);
  await state.projectsReady;
  const filter = new URLSearchParams(location.search).get('show') || 'all';
  let query = noSample(sb.from('notifications').select(SELECT)).order('created_at', { ascending: false }).limit(100);
  if (filter === 'unread') query = query.is('read_at', null);
  if (filter === 'mentions') query = query.eq('kind', 'mention');
  const [{ data: items, error }, { count: unread }] = await Promise.all([
    query,
    sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  ]);
  if (error) throw error;
  // A note or take deleted since then leaves nothing to open.
  const live = items.filter((i) => i.kind === 'joined' || i.notes || i.takes || i.recaps || i.requests);
  const names = await namesFor(live.map((i) => i.actor_id));

  view.innerHTML = `<section class="page narrow-wide">
    ${pageHead('Inbox', { actions: unread ? '<button class="btn" data-read-all>Mark all as read</button>' : '' })}
    ${tabs([['all', 'All', '/app/inbox'], ['unread', 'Unread', '/app/inbox?show=unread', unread], ['mentions', 'Mentions', '/app/inbox?show=mentions']], filter)}
    ${live.length ? `<div class="list">${live.map((item) => `<a class="row inbox-row ${item.read_at ? '' : 'unread'}" href="${hrefFor(item)}" data-link data-item="${item.id}">
        ${avatar(names[item.actor_id] || '?', item.actor_id, 'sm')}
        <span class="row-main">
          <span class="row-text">${describe(item, names)}</span>
          ${item.notes ? `<span class="row-quote"><span class="time-tag">${noteTime(item.notes)}</span> ${esc(item.notes.body)}</span>` : ''}
          ${item.recaps ? `<span class="row-quote">✦ ${esc(item.recaps.content?.headline || 'Recap')}</span>` : ''}
          <span class="row-meta">${esc(item.projects?.title || '')} · ${timeAgo(item.created_at)}</span>
        </span>
        ${item.read_at ? '' : '<span class="dot" aria-label="Unread"></span>'}
      </a>`).join('')}</div>`
      : empty('✉', filter === 'unread' ? 'You’re all caught up' : 'Nothing here yet', filter === 'mentions' ? 'When a teammate @mentions you in a note, it shows up here.' : 'Notes on your videos, @mentions, new takes, and fixes your team makes will show up here.')}
  </section>`;

  $$('[data-item]').forEach((a) => a.addEventListener('click', () => {
    if (!a.classList.contains('unread')) return;
    sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', a.dataset.item).then(() => ctx.refreshUnread());
  }));
  $('[data-read-all]')?.addEventListener('click', async () => {
    const { error: readErr } = await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', state.session.user.id).is('read_at', null);
    if (readErr) return toast(friendlyError(readErr), 'error');
    ctx.refreshUnread();
    renderInbox();
  });
}
