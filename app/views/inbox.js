// Inbox: what happened that you should know about. Opening an item marks it read and jumps to the moment.
import { sb, $, esc, toast, friendlyError, timeAgo, avatar, schema, dialog, actionSheet } from '../client.js';
import { ctx } from '../ctx.js';
import { samplePeek } from '../onboarding.js';
import { noteTime, tabs, empty, pageHead, namesFor, noSample } from './shared.js';
import { ic } from '../icons.js';

const BASE_SELECT = 'id, kind, created_at, read_at, actor_id, project_id, take_id, note_id, recap_id, recaps(content), request_id, requests(title, due_at), projects(title), takes(number, video_id, videos(title, request_id, requests!videos_request_id_fkey(title))), notes(body, t_start, t_end, video_id, take_id, takes(number), videos(title))';
// Requests to join (migration 040) carry the requester's name: owners can't read a non-member's profile.
// @mentions on a page (migration 075) carry the page and the line they're on.
const select = () => `${BASE_SELECT}${schema.joinRequests ? ', join_request_id, join_requests(requester_name, status)' : ''}${schema.pageMentions ? ', page_id, detail, project_pages(title)' : ''}`;

const VERB = {
  mention: 'mentioned you',
  note_on_your_video: 'left a note on',
  new_take: 'uploaded',
  note_resolved: 'marked your note fixed on',
  joined: 'joined'
};

function describe(item, names) {
  const who = `<b>${esc(names[item.actor_id] || 'Someone')}</b>`;
  const video = item.notes?.videos?.title || item.takes?.videos?.title || '';
  const takeNo = item.notes?.takes?.number ?? item.takes?.number;
  const project = esc(item.projects?.title || '');
  if (item.kind === 'joined') return `${who} joined <b>${project}</b>`;
  if (item.kind === 'join_request') return `<b>${esc(item.join_requests?.requester_name || 'Someone')}</b> asked to join <b>${project}</b>${item.join_requests?.status === 'approved' ? ' · approved' : item.join_requests?.status === 'declined' ? ' · declined' : ''}`;
  if (item.kind === 'join_approved') return `${who} let you into <b>${project}</b>`;
  if (item.kind === 'added_to_project') return `${who} added you to <b>${project}</b>`;
  if (item.kind === 'ownership_transferred') return `${who} made you the owner of <b>${project}</b>`;
  // Written on schedule before practice: from dancerly, not a person.
  if (item.kind === 'recap_shared' && !item.actor_id) return `Your team’s recap for <b>${project}</b> is ready. Have a look before practice.`;
  if (item.kind === 'recap_shared') return `${who} shared a recap in <b>${project}</b>`;
  if (item.kind === 'request_new') return `${who} gave you an assignment: <b>${esc(item.requests?.title || '')}</b>`;
  if (item.kind === 'request_due') return `Due in 24 hours: <b>${esc(item.requests?.title || '')}</b> — not submitted yet`;
  if (item.kind === 'request_all_in') return `Everyone submitted <b>${esc(item.requests?.title || '')}</b>. Time to review.`;
  if (item.kind === 'request_reminder') return `${who} reminded you: <b>${esc(item.requests?.title || '')}</b>`;
  const forRequest = item.kind === 'new_take' && item.takes?.videos?.request_id && item.takes.videos.requests?.title;
  if (forRequest) return `${who} submitted ${takeNo === 1 ? 'a video' : `Take ${takeNo}`} for <b>${esc(forRequest)}</b>`;
  if (item.kind === 'new_take') return `${who} uploaded ${takeNo === 1 ? 'a new video' : `Take ${takeNo} of`} <b>${esc(video)}</b>`;
  if (item.kind === 'private_note') return `${ic('lock')}${who} left you a private note on <b>${esc(video)}</b>${takeNo ? ` · Take ${takeNo}` : ''}`;
  if (item.kind === 'reply') return `${who} replied to a note on <b>${esc(video)}</b>${takeNo ? ` · Take ${takeNo}` : ''}`;
  if (item.kind === 'page_mention') return `${who} mentioned you in <b>${esc(item.project_pages?.title || 'a page')}</b>`;
  if (item.kind === 'mention') return `${who} mentioned you on <b>${esc(video)}</b>${takeNo ? ` · Take ${takeNo}` : ''}`;
  return `${who} ${VERB[item.kind]} <b>${esc(video)}</b>${takeNo ? ` · Take ${takeNo}` : ''}`;
}

function hrefFor(item) {
  if (item.kind === 'joined' || item.kind === 'join_request' || item.kind === 'ownership_transferred') return `/app/p/${item.project_id}/people`;
  if (item.kind === 'recap_shared') return `/app/recaps/${item.recap_id}`;
  if (item.kind === 'page_mention') return `/app/p/${item.project_id}/pages/${item.page_id}`;
  if (item.request_id) return `/app/p/${item.project_id}/requests/${item.request_id}`;
  if (item.notes) return `/app/p/${item.project_id}/v/${item.notes.video_id}?take=${item.notes.takes?.number ?? ''}&note=${item.note_id}`;
  if (item.takes) return `/app/p/${item.project_id}/v/${item.takes.video_id}?take=${item.takes.number}`;
  return `/app/p/${item.project_id}`;
}

// Today / Yesterday / This week / Earlier, as Linear and GitHub group their inboxes.
function dayGroup(iso) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t = new Date(iso).getTime();
  if (t >= start.getTime()) return 'Today';
  if (t >= start.getTime() - 864e5) return 'Yesterday';
  if (t >= start.getTime() - 6 * 864e5) return 'This week';
  return 'Earlier';
}

// Dismissed items wait out their Undo before they're deleted (the toast's 8 seconds); leaving the page doesn't cancel it.
const pendingDismiss = new Map();

export async function renderInbox() {
  const { state, view, setCrumbs } = ctx;
  setCrumbs([['Inbox']]);
  await state.projectsReady;
  const filter = new URLSearchParams(location.search).get('show') || 'all';
  let query = noSample(sb.from('notifications').select(select())).order('created_at', { ascending: false }).limit(100);
  if (filter === 'unread') query = query.is('read_at', null);
  if (filter === 'mentions') query = schema.pageMentions ? query.in('kind', ['mention', 'page_mention']) : query.eq('kind', 'mention');
  const [{ data: items, error }, { count: unreadCount }] = await Promise.all([
    query,
    noSample(sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null))
  ]);
  if (error) throw error;
  // A note or take deleted since then leaves nothing to open; one being dismissed right now is already gone.
  const live = items.filter((i) => !pendingDismiss.has(i.id) && (i.kind === 'joined' || i.kind === 'join_request' || i.kind === 'join_approved' || i.kind === 'added_to_project' || i.kind === 'ownership_transferred' || i.notes || i.takes || i.recaps || i.requests || i.project_pages));
  const names = await namesFor(live.map((i) => i.actor_id));
  let unread = Math.max(0, (unreadCount || 0) - items.filter((i) => pendingDismiss.has(i.id) && !i.read_at).length);

  const row = (item) => `<div class="row inbox-row ${item.read_at ? '' : 'unread'}" data-item="${item.id}">
        <a class="inbox-row-link" href="${hrefFor(item)}" data-link>
        <span class="dot" aria-hidden="true"></span>
        ${item.actor_id ? avatar(names[item.actor_id] || '?', item.actor_id, 'sm') : '<span class="avatar sm app-avatar" aria-hidden="true"><img src="/favicon.svg" alt="" width="28" height="28" /></span>'}
        <span class="row-main">
          <span class="row-text">${describe(item, names)}</span>
          ${item.notes ? `<span class="row-quote"><span class="time-tag">${noteTime(item.notes)}</span> ${esc(item.notes.body)}</span>` : ''}
          ${item.kind === 'page_mention' && item.detail ? `<span class="row-quote">${ic('file')}${esc(item.detail)}</span>` : ''}
          ${item.recaps ? `<span class="row-quote">${ic('recap')}${esc(item.recaps.content?.headline || 'Recap')}</span>` : ''}
          <span class="row-meta">${esc(item.projects?.title || '')} · ${timeAgo(item.created_at)}<span class="sr-only">${item.read_at ? '' : ' · Unread'}</span></span>
        </span>
        </a>
        <div class="inbox-actions">
          <button type="button" class="icon-btn inbox-act" data-toggle-read aria-label="${item.read_at ? 'Mark as unread' : 'Mark as read'}" title="${item.read_at ? 'Mark as unread' : 'Mark as read'}">${ic(item.read_at ? 'circle' : 'check', 'solo')}</button>
          <button type="button" class="icon-btn inbox-act" data-dismiss aria-label="Dismiss" title="Dismiss">${ic('x', 'solo')}</button>
        </div>
      </div>`;
  const groups = [];
  for (const item of live) {
    const g = dayGroup(item.created_at);
    if (groups[groups.length - 1]?.label !== g) groups.push({ label: g, items: [] });
    groups[groups.length - 1].items.push(item);
  }

  view.innerHTML = `<section class="page narrow-wide">
    ${pageHead('Inbox', { actions: `<span data-inbox-head>${unread ? '<button class="btn" data-read-all>Mark all as read</button>' : ''}</span>${live.length ? `<button class="btn ghost icon" data-inbox-more aria-label="More inbox actions" title="More">${ic('more', 'solo')}</button>` : ''}` })}
    ${tabs([['all', 'All', '/app/inbox'], ['unread', 'Unread', '/app/inbox?show=unread', unread], ['mentions', 'Mentions', '/app/inbox?show=mentions'], ['review', 'To review', '/app/queue']], filter)}
      ${live.length ? groups.map((g) => `<section class="inbox-group" data-group><h2 class="section-label">${g.label}</h2><div class="list">${g.items.map(row).join('')}</div></section>`).join('')
      : emptyState(filter)}
  </section>`;

  const byId = Object.fromEntries(live.map((i) => [i.id, i]));
  // Small changes happen in place (no reload, so the list doesn't jump); the badge and the counts follow.
  const paintCounts = () => {
    ctx.refreshUnread();
    const tabLink = view.querySelector('.tabs a[href="/app/inbox?show=unread"]');
    let tab = tabLink?.querySelector('.count');
    if (!tab && tabLink && unread) { tab = document.createElement('span'); tab.className = 'count'; tabLink.append(tab); }
    if (tab) { tab.textContent = unread || ''; tab.hidden = !unread; }
    const head = view.querySelector('[data-inbox-head]');
    if (head) head.innerHTML = unread ? '<button class="btn" data-read-all>Mark all as read</button>' : '';
    head?.querySelector('[data-read-all]')?.addEventListener('click', readAll);
  };
  const setRead = async (el, read) => {
    const item = byId[el.dataset.item];
    if (!item || Boolean(item.read_at) === read) return;
    const at = read ? new Date().toISOString() : null;
    const { error: e } = await sb.from('notifications').update({ read_at: at }).eq('id', item.id);
    if (e) return toast(friendlyError(e), 'error');
    item.read_at = at;
    unread += read ? -1 : 1;
    if (filter === 'unread' && read) el.remove(); else el.outerHTML = row(item);
    tidy();
    paintCounts();
  };
  // Empty groups go; with nothing left, the empty state shows.
  const tidy = () => {
    view.querySelectorAll('[data-group]').forEach((g) => { if (!g.querySelector('[data-item]')) g.remove(); });
    if (!view.querySelector('[data-item]') && !view.querySelector('.empty')) {
      view.querySelector('[data-inbox-more]')?.remove();
      view.querySelector('.page').insertAdjacentHTML('beforeend', emptyState(filter));
    }
  };
  const dismiss = (el) => {
    const item = byId[el.dataset.item];
    if (!item) return;
    const parent = el.parentElement, next = el.nextElementSibling, group = el.closest('[data-group]'), groupNext = group?.nextElementSibling;
    el.remove();
    if (!item.read_at) { unread -= 1; paintCounts(); }
    const timer = setTimeout(async () => {
      pendingDismiss.delete(item.id);
      const { error: e } = await sb.from('notifications').delete().eq('id', item.id);
      if (e) toast(friendlyError(e), 'error');
      ctx.refreshUnread();
    }, 8000);
    pendingDismiss.set(item.id, timer);
    const groupGone = group && !group.querySelector('[data-item]');
    if (groupGone) group.remove();
    tidy();
    toast('Notification dismissed.', 'info', { label: 'Undo', run: () => {
      clearTimeout(pendingDismiss.get(item.id));
      pendingDismiss.delete(item.id);
      if (!view.isConnected || !parent.isConnected && !groupGone) return renderInbox();
      view.querySelector('.page > .empty, .page > .empty-state')?.remove();
      if (groupGone) { const holder = groupNext?.isConnected ? groupNext : null; if (holder) holder.before(group); else view.querySelector('.page').append(group); }
      if (next?.isConnected) next.before(el); else parent.append(el);
      if (!item.read_at) { unread += 1; paintCounts(); }
    } });
  };
  const bindRow = (el) => {
    el.querySelector('[data-toggle-read]')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setRead(el, !byId[el.dataset.item]?.read_at); });
    el.querySelector('[data-dismiss]')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(el); });
    // Opening an item reads it.
    el.querySelector('.inbox-row-link')?.addEventListener('click', () => {
      const item = byId[el.dataset.item];
      if (!item || item.read_at) return;
      item.read_at = new Date().toISOString();
      sb.from('notifications').update({ read_at: item.read_at }).eq('id', item.id).then(() => ctx.refreshUnread());
    });
  };
  // A row that changes is replaced in place; the new one is wired as it's added.
  view.querySelectorAll('[data-item]').forEach(bindRow);
  const observer = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.matches?.('[data-item]') && !n.dataset.wired) { n.dataset.wired = '1'; bindRow(n); } })));
  view.querySelectorAll('[data-item]').forEach((n) => { n.dataset.wired = '1'; });
  view.querySelectorAll('.list').forEach((l) => observer.observe(l, { childList: true }));

  async function readAll() {
    const { error: readErr } = await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', state.session.user.id).is('read_at', null);
    if (readErr) return toast(friendlyError(readErr), 'error');
    ctx.refreshUnread();
    renderInbox();
  }
  view.querySelector('[data-read-all]')?.addEventListener('click', readAll);
  view.querySelector('[data-inbox-more]')?.addEventListener('click', async (e) => {
    const anyRead = live.some((i) => i.read_at);
    const choice = await actionSheet({ title: 'Inbox', anchor: e.currentTarget, actions: [
      ...(anyRead ? [{ value: 'clear-read', icon: 'x', label: 'Clear read notifications', hint: 'Unread ones stay' }] : []),
      { value: 'clear', icon: 'trash', label: 'Clear all', hint: 'The notes and videos they link to stay', danger: true }
    ] });
    if (choice === 'read') return readAll();
    if (choice === 'clear-read') {
      const { error: e2 } = await sb.from('notifications').delete().eq('user_id', state.session.user.id).not('read_at', 'is', null);
      if (e2) return toast(friendlyError(e2), 'error');
      toast('Read notifications cleared.');
      return renderInbox();
    }
    if (choice === 'clear') {
      const ok = await dialog({ title: 'Clear your Inbox?', body: 'This removes all of your notifications. It won’t delete the notes, videos, or projects they link to.', confirm: 'Clear all', danger: true });
      if (!ok) return;
      const { error: clearErr } = await sb.from('notifications').delete().eq('user_id', state.session.user.id);
      if (clearErr) return toast(friendlyError(clearErr), 'error');
      ctx.refreshUnread();
      renderInbox();
    }
  });
}

function emptyState(filter) {
  return empty('inbox', filter === 'unread' ? 'You’re all caught up' : 'Nothing here yet', filter === 'mentions' ? 'When someone @mentions you in a note or on a page, it shows up here.' : 'Notes on your videos, @mentions, new takes, and fixes will show up here.', filter === 'all' ? samplePeek('inbox') : '');
}
