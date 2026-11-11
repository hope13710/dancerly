// Projects: the list, and each project's tabs — Videos, Notes, People, Settings.
import { uploadTake, checkTakeFile } from '../upload.js';
import { thumbUrls, backfillThumbs } from '../thumbs.js';
import { cols, schema, fmtFine } from '../client.js';
import { sb, $, $$, esc, initials, timeAgo, toast, friendlyError, dialog, actionSheet, withUploadBar, loadMembers, avatar, projectMark, wireImagePicker, TAKE_BUCKET, isPublicMedia } from '../client.js';
import { ctx } from '../ctx.js';
import { isKo } from '../i18n.js';
import { NOTE_SELECT, noteRow, tabs, empty, namesFor, projectGoal, daysUntil, daysLabel, nameMatches } from './shared.js';
import { loadGroups, groupsSection, wireGroups } from './groups.js';
import { memberWelcome, sampleOffer, samplePeek, track, seen, markSeen, onboarding } from '../onboarding.js';
import { ic } from '../icons.js';

// Under every file picker: what makes a rehearsal video easy to give feedback on.
const FILE_HINT = 'Tip: film from the front, whole body in frame, with the music, start to finish · MP4, MOV, or WebM';

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
export async function renderProjects() {
  const { view, setCrumbs } = ctx;
  setCrumbs([['Projects']]);
  const { data: projects, error } = await sb.from('projects')
    .select(cols('id, title, image_url, is_sample, created_at, project_members(count), videos(count)'))
    .order('created_at', { ascending: false });
  if (error) throw error;
  // Your projects, then the sample on its own row so it never reads as one of them.
  const card = (p) => `<a class="card project-card" href="/app/p/${p.id}" data-link>
        ${projectMark(p)}
        <h3>${esc(p.title)}${p.is_sample ? ' <span class="tag sample-tag">Sample</span>' : ''}</h3>
        <p class="muted">${plural(p.videos[0]?.count ?? 0, 'video')} · ${plural(p.project_members[0]?.count ?? 1, 'member')}</p>
      </a>`;
  const real = projects.filter((p) => !p.is_sample);
  const sample = projects.find((p) => p.is_sample);
  view.innerHTML = `<section class="page">
    <header class="page-head"><div><h1>Projects</h1><p class="muted sub">One project per goal — a showcase, a competition, or weekly practice.</p></div><button class="btn primary" data-new-project>+ New project</button></header>
    ${projects.length ? `${real.length ? `<div class="cards">${real.map(card).join('')}</div>` : ''}
      ${sample ? `<h2 class="section-label">Try it out</h2><div class="cards">${card(sample)}</div>`
        : schema.firstRun ? '<p class="muted projects-sample">Want to try things without touching real work? <button type="button" class="link-btn" data-open-sample="projects">Open the sample project</button></p>' : ''}`
    : empty('folder', 'Create your first project', 'A project is one goal — a showcase, a competition, a class, or your own practice. Upload a practice video and start pinning notes.', `<button class="btn primary" data-new-project>+ New project</button>${schema.firstRun ? '<button class="btn" data-open-sample>Explore a sample first</button>' : ''}`)}
  </section>`;
  $$('[data-new-project]').forEach((b) => b.addEventListener('click', createProject));
}

export async function createProject() {
  const values = await dialog({ title: 'New project', fields: [{ name: 'title', label: 'Project name', placeholder: 'Showcase 2026', required: true }], confirm: 'Create project' });
  if (!values?.title) return;
  const { data, error } = await sb.from('projects').insert({ title: values.title }).select('id').single();
  if (error) return toast(friendlyError(error), 'error');
  ctx.navigate(`/app/p/${data.id}`);
}

// Files go right away when they're yours to remove; anything else is cleared by the hourly storage cleanup.
export function removeTakeFiles(list) {
  const paths = list.flatMap((t) => [t.storage_path, t.thumb_path]).filter((p) => p && !isPublicMedia(p));
  if (paths.length) sb.storage.from(TAKE_BUCKET).remove(paths).then(() => {}, () => {});
}

// Deleting a video (from its page or the list). With the trash (migration 032) it moves there at once, with
// Undo on the toast, the way Drive and Notion do it; before that, it asks first and deletes for good.
// afterUndo runs once a trashed video is back. True if it went.
export async function confirmDeleteVideo({ projectId, projectTitle, video, takes, afterUndo = () => ctx.route() }) {
  if (schema.trash) {
    const { error } = await sb.rpc('trash_item', { p_kind: 'video', p_id: video.id });
    if (error) { toast(friendlyError(error), 'error'); return false; }
    track('video_deleted', { takes: takes.length, trash: true });
    toast('Moved to Trash. You can restore it for 30 days.', 'info', { label: 'Undo', run: () => restoreFromTrash('video', video.id, afterUndo) });
    return true;
  }
  const { count } = await sb.from('notes').select('id', { count: 'exact', head: true }).eq('video_id', video.id);
  const parts = [takes.length > 1 ? `all ${takes.length} takes` : null, count ? `${count} ${count === 1 ? 'note' : 'notes'}` : null].filter(Boolean);
  const sure = await dialog({
    title: `Delete “${video.title}”?`,
    body: `${parts.length ? `This deletes ${parts.join(' and ')} ` : 'This deletes the video '}for everyone in ${esc(projectTitle)}. This can’t be undone.`,
    confirm: 'Delete video',
    danger: true
  });
  if (!sure) return false;
  const { error } = await sb.from('videos').delete().eq('id', video.id).eq('project_id', projectId);
  if (error) { toast(friendlyError(error), 'error'); return false; }
  removeTakeFiles(takes);
  track('video_deleted', { takes: takes.length });
  toast('Video deleted.');
  return true;
}

// Undo on the toast, or Restore in Trash. Returns the video to open, or null.
export async function restoreFromTrash(kind, id, after = () => {}) {
  const { data: videoId, error } = await sb.rpc('restore_item', { p_kind: kind, p_id: id });
  if (error) { toast(friendlyError(error), 'error'); return null; }
  track('trash_restored', { kind });
  toast(kind === 'project' ? 'Project restored.' : kind === 'video' ? 'Video restored.' : 'Take restored.');
  after(videoId);
  return videoId;
}

// Shared header + tabs for every project screen.
export async function loadProject(projectId) {
  const [{ data: project, error }, members] = await Promise.all([
    sb.from('projects').select(cols('id, title, image_url, is_sample, created_at, created_by, target_event_id, allow_share_cards, auto_recap')).eq('id', projectId).single(),
    loadMembers(projectId)
  ]);
  if (error) throw error;
  const goal = await projectGoal(project);
  const me = ctx.state.session.user.id;
  const isOwner = members.some((m) => m.user_id === me && m.role === 'owner');
  return { project, members, isOwner, me, goal };
}

// Four tabs people use every week; the rest one tap away under More, and Settings as a gear (Hick's law:
// nine equal tabs made every visit a choice, and on phones most of them were off screen).
const MAIN_TABS = [['videos', 'Videos', ''], ['notes', 'Notes', '/notes'], ['requests', 'Assignments', '/requests'], ['people', 'People', '/people']];
const MORE_TABS = [['overview', 'Overview', '/overview'], ['calendar', 'Calendar', '/calendar'], ['recaps', 'Recaps', '/recaps'], ['pages', 'Pages', '/pages']];
function projectTabs(base, current) {
  const link = ([key, label, path]) => `<a href="${base}${path}" data-link ${key === current ? 'aria-current="page"' : ''}>${esc(label)}</a>`;
  const inMore = MORE_TABS.find(([key]) => key === current);
  return `<nav class="tabs project-tabs" aria-label="Views">${MAIN_TABS.map(link).join('')}${inMore ? link(inMore) : ''}
    <details class="tabs-more"><summary>More${ic('down', 'after')}</summary><div class="tabs-more-menu" role="menu">${MORE_TABS.filter(([key]) => key !== current).map(([key, label, path]) => `<a role="menuitem" href="${base}${path}" data-link>${esc(label)}</a>`).join('')}</div></details>
    <a class="tabs-gear" href="${base}/settings" data-link aria-label="Settings" title="Settings" ${current === 'settings' ? 'aria-current="page"' : ''}>${ic('settings', 'solo')}<span class="wide-only"> Settings</span></a></nav>`;
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => { document.querySelectorAll('details.tabs-more[open], details.menu-more[open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); }); });
}

export function projectHead({ project, members, goal }, tab, actions = '') {
  const base = `/app/p/${project.id}`;
  // What the team is working toward, on every tab: "🎯 Spring Showcase · 12 days".
  const goalChip = goal ? `<a class="goal-chip" href="${base}/overview" data-link title="${goal.picked ? 'Project goal' : 'Next show'}">${ic('flag')}<span class="goal-name">${esc(goal.title)}</span><b>${daysLabel(daysUntil(goal.starts_at))}</b></a>` : '';
  return `<header class="page-head project-head">
      <div class="project-title">${projectMark(project, 'head')}<div>${project.is_sample ? '<p class="eyebrow">Sample project</p>' : ''}<h1>${esc(project.title)}</h1>
        <a class="members" href="${base}/people" data-link>${members.slice(0, 6).map((m) => `${avatar(m.name, m.user_id)}`).join('')}${members.length > 6 ? `<span class="avatar more">+${members.length - 6}</span>` : ''}<span class="link">${members.length} ${members.length === 1 ? 'member' : 'members'}</span></a>
        ${goalChip}
      </div></div>
      <div class="head-actions">${project.is_sample ? `${actions.replace(/data-invite\b/g, 'data-sample-invite')}<button class="btn ghost" data-delete-sample>Delete sample</button>` : actions}</div>
    </header>
    ${projectTabs(base, tab)}`;
}

export async function renderProject(projectId) {
  const { view, setCrumbs } = ctx;
  const [p, { data: videos, error: vErr }] = await Promise.all([
    loadProject(projectId),
    sb.from('videos').select('id, title, created_at, created_by, takes(id, number, created_at, storage_path, thumb_path, project_id, video_id), notes(status)').eq('project_id', projectId).order('created_at', { ascending: false })
  ]);
  if (vErr) throw vErr;
  setCrumbs([['Projects', '/app/projects'], [p.project.title]]);
  // The sample is its creator's sandbox: they can always clear it out, even after handing ownership away.
  const sampleMine = p.project.is_sample && p.project.created_by === p.me;
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'videos', `<button class="btn" data-invite>Invite</button><button class="btn primary" data-new-video>${ic('upload')}Upload video</button>`)}
    ${videos.length ? `<div class="video-list">${videos.map((v) => {
      const takes = [...v.takes].sort((a, b) => b.number - a.number);
      const open = v.notes.filter((n) => n.status !== 'resolved').length;
      const canDelete = p.isOwner || v.created_by === p.me || sampleMine;
      return `<div class="video-item${canDelete ? ' has-more' : ''}"><a class="video-row" href="/app/p/${projectId}/v/${v.id}" data-link>
        <span class="video-thumb" ${takes[0] ? `data-thumb="${takes[0].id}"` : ''}><i aria-hidden="true">${ic('play', 'solo')}</i>${takes.length > 1 ? `<em>${takes.length} takes</em>` : ''}</span>
        <span class="video-copy"><b>${esc(v.title)}</b><small>${takes.length > 1 ? `${takes.length} takes · latest ${timeAgo(takes[0].created_at)}` : takes.length ? `Uploaded ${timeAgo(takes[0].created_at)}` : 'No video yet'}</small></span>
        <span class="pill ${open ? 'warn' : 'ok'}">${open ? `${open} open` : 'All clear'}</span><span class="chev">${ic('right', 'solo')}</span>
      </a>${canDelete ? `<button class="icon-btn row-more" data-row-more="${v.id}" aria-label="More actions for ${esc(v.title)}" title="More actions">${ic('more', 'solo')}</button>` : ''}</div>`;
    }).join('')}</div>`
    : p.isOwner
      ? empty('video', 'Add your first practice video', 'Upload a run-through, a section, or someone’s part. Every new take of the same piece goes into the same video.', `<button class="btn primary" data-new-video>${ic('upload')}Upload video</button>${!p.project.is_sample && sampleOffer() ? '<button class="btn" data-open-sample="empty-videos">See how it works in a sample</button>' : ''}`)
      : empty('video', 'No videos yet', 'When a video is uploaded here, you’ll get a notification. Have one of your own? Upload it to start getting feedback.', `<button class="btn primary" data-new-video>${ic('upload')}Upload video</button>`)}
  </section>`;
  $$('[data-new-video]').forEach((b) => b.addEventListener('click', () => createVideo(projectId)));
  $$('[data-row-more]').forEach((b) => b.addEventListener('click', async () => {
    const v = videos.find((x) => x.id === b.dataset.rowMore);
    const choice = await actionSheet({ title: v.title, anchor: b, actions: [{ value: 'delete', label: 'Delete video', hint: `${v.takes.length > 1 ? `All ${v.takes.length} takes` : 'The video'} and its notes${schema.trash ? ' · Trash keeps it 30 days' : ''}`, danger: true }] });
    if (choice !== 'delete') return;
    if (await confirmDeleteVideo({ projectId, projectTitle: p.project.title, video: v, takes: v.takes, afterUndo: () => renderProject(projectId) })) renderProject(projectId);
  }));
  $('[data-invite]')?.addEventListener('click', () => showInvite(projectId, p.project.title));
  // People who just joined get a short welcome once.
  const mine = p.members.find((m) => m.user_id === p.me);
  if (!p.isOwner && (ctx.state.justJoined === projectId || (mine?.joined_at && Date.now() - new Date(mine.joined_at) < 3 * 86400000))) {
    ctx.state.justJoined = null;
    memberWelcome(projectId, p.project, p.members);
  }
  paintThumbs(videos.map((v) => [...v.takes].sort((a, b) => b.number - a.number)[0]).filter(Boolean));
  // Opened from Home's QR code or the "send to my phone" email: straight to the upload.
  const params = new URLSearchParams(location.search);
  if (params.get('upload') === '1') {
    params.delete('upload');
    history.replaceState(history.state, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
    track('upload_link_opened', { from: params.get('ref') || 'qr' });
    createVideo(projectId);
  }
}

// Each row shows a still from its latest take; missing ones are made in the background.
export async function paintThumbs(latest) {
  const show = (takeId, url) => {
    const box = document.querySelector(`[data-thumb="${takeId}"]`);
    if (!box || box.querySelector('img')) return;
    const img = new Image();
    img.alt = '';
    img.onload = () => box.classList.add('has-img');
    img.src = url;
    box.prepend(img);
  };
  const urls = await thumbUrls(latest.map((t) => t.thumb_path));
  latest.forEach((t) => { if (urls[t.thumb_path]) show(t.id, urls[t.thumb_path]); });
  backfillThumbs(latest.filter((t) => !urls[t.thumb_path]).slice(0, 12), (t, url) => show(t.id, url));
}

export async function renderProjectNotes(projectId) {
  const { view, setCrumbs } = ctx;
  const status = new URLSearchParams(location.search).get('status') || 'todo';
  const [p, { data: notes, error }] = await Promise.all([
    loadProject(projectId),
    sb.from('notes').select(NOTE_SELECT).eq('project_id', projectId).order('created_at', { ascending: false }).limit(500)
  ]);
  if (error) throw error;
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Notes']]);
  const counts = { todo: notes.filter((n) => n.status !== 'resolved').length, resolved: notes.filter((n) => n.status === 'resolved').length, all: notes.length };
  const shown = notes.filter((n) => status === 'all' || (status === 'resolved' ? n.status === 'resolved' : n.status !== 'resolved'));
  const names = await namesFor(shown.map((n) => n.author_id));
  const base = `/app/p/${projectId}/notes`;
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'notes')}
    <div class="filters"><div class="seg small" role="group" aria-label="Status">${[['todo', 'To do'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, l]) => `<a href="${base}?status=${k}" data-link aria-selected="${k === status}">${l} <span>${counts[k]}</span></a>`).join('')}</div></div>
    ${shown.length ? `<div class="list">${shown.map((n) => noteRow(n, names, { showProject: false })).join('')}</div>`
      : notes.length ? empty('check_circle', 'All caught up', 'Nothing in this view.') : empty('note', 'No notes yet', 'Open a video, pause on a moment, and pin what you see.', samplePeek('notes'))}
  </section>`;
}

export async function renderProjectPeople(projectId) {
  const { view, setCrumbs } = ctx;
  const [p, groups] = await Promise.all([loadProject(projectId), loadGroups(projectId)]);
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['People']]);
  // Requests to join from a shared video (migration 040): owners decide here.
  const { data: asks } = p.isOwner && schema.joinRequests
    ? await sb.from('join_requests').select('id, user_id, requester_name, body, t_start, created_at, video_id, videos(title)').eq('project_id', projectId).eq('status', 'pending').order('created_at')
    : { data: [] };
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'people', '<button class="btn primary" data-invite>Invite people</button>')}
    ${(asks || []).length ? `<div class="panel join-asks"><div class="panel-head"><div><h2>Requests to join</h2><p class="muted">They watched a video you shared. Approving adds them as a member and posts their note.</p></div></div>
      <div class="list">${asks.map((a) => `<div class="row join-ask" data-ask="${a.id}">
        ${avatar(a.requester_name || '?', a.user_id, 'sm')}<span class="row-main"><span class="row-title">${esc(a.requester_name || 'Someone')}</span><span class="row-meta">${esc(a.videos?.title || 'A shared video')} · ${timeAgo(a.created_at)}</span>
          ${a.body ? `<span class="join-ask-note"><b>${fmtFine(Number(a.t_start || 0))}</b> ${esc(a.body)}</span>` : ''}</span>
        <span class="row-side"><button class="btn small ghost" data-ask-no="${a.id}">Decline</button><button class="btn small primary" data-ask-yes="${a.id}">Approve</button></span>
      </div>`).join('')}</div></div>` : ''}
    <div class="list">${p.members.map((m) => `<div class="row member-row">
      <a class="person" href="/app/people/${m.user_id}" data-link>${avatar(m.name, m.user_id, 'sm')}<span class="row-main"><span class="row-title">${esc(m.name)}${m.user_id === p.me ? ' <span class="tag">You</span>' : ''}</span><span class="row-meta">Joined ${timeAgo(m.joined_at)}</span></span></a>
      <span class="row-side"><span class="role ${m.role}">${m.role === 'owner' ? 'Owner' : 'Member'}</span>
        ${p.isOwner && m.user_id !== p.me ? `<button class="btn ghost small icon" data-member="${m.user_id}" aria-label="Manage ${esc(m.name)}">${ic('more', 'solo')}</button>` : ''}</span>
    </div>`).join('')}</div>
    <p class="fine left">Owners can rename or delete the project and remove people. Everyone can upload, leave notes, and invite.</p>
    ${groupsSection(p, groups)}
  </section>`;
  $('[data-invite]')?.addEventListener('click', () => showInvite(projectId, p.project.title));
  // Opened from the "invite your team" email: straight to the invite link.
  const params = new URLSearchParams(location.search);
  if (params.get('invite') === '1') {
    params.delete('invite');
    history.replaceState(history.state, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
    track('invite_link_opened', { from: params.get('ref') || 'link' });
    showInvite(projectId, p.project.title);
  }
  $$('[data-ask-yes], [data-ask-no]').forEach((b) => b.addEventListener('click', async () => {
    const yes = Boolean(b.dataset.askYes);
    const ask = asks.find((a) => a.id === (b.dataset.askYes || b.dataset.askNo));
    if (yes) {
      const ok = await dialog({ title: 'Approve this request?', body: `<b>${esc(ask.requester_name || 'They')}</b> will join <b>${esc(p.project.title)}</b> as a member and can see all of its videos and notes.${ask.body ? ' Their note will be posted.' : ''}`, confirm: 'Approve' });
      if (!ok) return;
    }
    b.disabled = true;
    const { error } = await sb.rpc('decide_join_request', { p_request: ask.id, p_approve: yes });
    if (error) { b.disabled = false; return toast(friendlyError(error), 'error'); }
    toast(yes ? 'Approved. They’re in the project now.' : 'Request declined.');
    renderProjectPeople(projectId);
  }));
  wireGroups(projectId, p, groups, () => renderProjectPeople(projectId));
  $$('[data-member]').forEach((b) => b.addEventListener('click', async () => {
    const m = p.members.find((x) => x.user_id === b.dataset.member);
    const choice = await dialog({ title: m.name, body: `Make <b>${esc(m.name)}</b> the owner of ${esc(p.project.title)}? You’ll stay on as a member.`, confirm: 'Make owner', extra: 'Remove from project' });
    if (!choice) return;
    if (choice.extra) {
      const sure = await dialog({ title: `Remove ${m.name}?`, body: 'They lose access to this project’s videos and notes. Their notes stay.', confirm: 'Remove', danger: true });
      if (!sure) return;
      const { error } = await sb.from('project_members').delete().eq('project_id', projectId).eq('user_id', m.user_id);
      if (error) return toast(friendlyError(error), 'error');
      toast(`${m.name} was removed.`);
    } else {
      const { error } = await sb.rpc('transfer_ownership', { p_project: projectId, p_user: m.user_id });
      if (error) return toast(friendlyError(error), 'error');
      toast(`${m.name} is now the owner.`);
    }
    renderProjectPeople(projectId);
  }));
}

export async function renderProjectSettings(projectId) {
  const { view, setCrumbs } = ctx;
  const p = await loadProject(projectId);
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Settings']]);
  const { data: invites } = await sb.from('project_invites').select('code, created_at, expires_at, created_by').eq('project_id', projectId).eq('revoked', false).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
  const names = await namesFor((invites || []).map((i) => i.created_by));
  const canRevoke = (i) => p.isOwner || i.created_by === p.me;
  // A project goes to the Trash first (migration 033); the sample keeps its own Remove sample.
  const trashable = schema.projectTrash && !p.project.is_sample;
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'settings')}
    <div class="settings-stack">
      <section class="panel">
        <div class="panel-head"><div><h2>General</h2></div></div>
        <div class="image-row">
          ${projectMark(p.project, 'lg')}
          <div><b>Project image</b><p class="muted">Shown in the sidebar and on project cards. A square works best.</p>
            ${p.isOwner ? `<div class="image-actions"><button class="btn small" type="button" data-pick-image>${p.project.image_url ? 'Change image' : 'Upload image'}</button>${p.project.image_url ? '<button class="btn small ghost" type="button" data-remove-image>Remove</button>' : ''}</div><input type="file" accept="image/*" hidden data-image-file />` : '<p class="fine left">Only the owner can change it.</p>'}
          </div>
        </div>
        <form class="inline-form" data-rename-form>
          <label class="field"><span>Project name</span><input name="title" maxlength="120" value="${esc(p.project.title)}" ${p.isOwner ? '' : 'disabled'} required /></label>
          ${p.isOwner ? '<button class="btn" type="submit">Save</button>' : '<p class="fine left">Only the owner can rename the project.</p>'}
        </form>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Invite links</h2><p class="muted">Anyone with an active link can join. Links expire after 30 days.</p></div><button class="btn small" data-new-link>New link</button></div>
        ${invites?.length ? `<div class="list flush">${invites.map((i) => `<div class="row"><span class="row-main"><span class="row-title mono">…/join/${esc(i.code.slice(0, 6))}…</span><span class="row-meta">Created by ${esc(names[i.created_by] || 'someone')} · expires ${new Date(i.expires_at).toLocaleDateString()}</span></span><span class="row-side"><button class="btn ghost small" data-copy-link="${esc(i.code)}">Copy</button>${canRevoke(i) ? `<button class="btn ghost small danger" data-revoke="${esc(i.code)}">Turn off</button>` : ''}</span></div>`).join('')}</div>`
          : '<p class="panel-empty">No active links.</p>'}
      </section>
      ${p.isOwner && !p.project.is_sample && schema.shareCards ? `<section class="panel">
        <label class="row toggle-row"><span class="row-main"><span class="row-title">Members can share progress cards</span><span class="row-meta">Anyone on the project can turn its takes into a progress image for Instagram and the like. Turn this off for choreography that’s secret until a show or competition.</span></span>
          <span class="switch"><input type="checkbox" data-share-cards ${p.project.allow_share_cards !== false ? 'checked' : ''} /><i aria-hidden="true"></i></span></label>
      </section>` : ''}
      <section class="panel danger-zone">
        <div class="panel-head"><div><h2>${p.isOwner ? 'Delete project' : 'Leave project'}</h2><p class="muted">${p.isOwner ? (trashable ? 'Moves it to the Trash for everyone. You can restore it within 30 days.' : 'Deletes every video, take, and note for everyone. This can’t be undone.') : 'You’ll lose access to its videos and notes. Ask for a new invite to come back.'}</p></div>
          <button class="btn danger" data-danger>${p.isOwner ? 'Delete project' : 'Leave project'}</button></div>
        ${p.isOwner && p.members.length > 1 ? '<p class="fine left">Want to step back instead? Make someone else the owner from the People tab, then leave.</p>' : ''}
      </section>
    </div>
  </section>`;
  wireImagePicker({
    folder: `projects/${projectId}`,
    save: (url) => sb.from('projects').update({ image_url: url }).eq('id', projectId),
    done: async (url) => { toast(url ? 'Project image updated.' : 'Project image removed.'); await ctx.refreshNav(); ctx.route(); }
  });
  $('[data-rename-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = event.currentTarget.elements.namedItem('title').value.trim(); // form.title is the element's tooltip, not the field
    if (!title || title === p.project.title) return;
    const { error } = await sb.from('projects').update({ title }).eq('id', projectId);
    if (error) return toast(friendlyError(error), 'error');
    toast('Project renamed.');
    ctx.route();
  });
  $('[data-share-cards]')?.addEventListener('change', async (event) => {
    const on = event.target.checked;
    const { error } = await sb.from('projects').update({ allow_share_cards: on }).eq('id', projectId);
    if (error) { event.target.checked = !on; return toast(friendlyError(error), 'error'); }
    toast(on ? 'Members can share progress cards.' : 'Progress cards are off for this project.');
  });
  $('[data-new-link]').addEventListener('click', async () => {
    const { error } = await sb.from('project_invites').insert({ project_id: projectId });
    if (error) return toast(friendlyError(error), 'error');
    renderProjectSettings(projectId);
  });
  $$('[data-copy-link]').forEach((b) => b.addEventListener('click', async () => {
    const link = `${location.origin}/app/join/${b.dataset.copyLink}`;
    window.dataLayer?.push({ event: 'invite_link_shared', via: 'copy' });
    try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { toast(link); }
  }));
  $$('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await sb.from('project_invites').update({ revoked: true }).eq('code', b.dataset.revoke);
    if (error) return toast(friendlyError(error), 'error');
    toast('Link turned off. It no longer works.');
    renderProjectSettings(projectId);
  }));
  $('[data-danger]').addEventListener('click', async () => {
    if (p.isOwner && trashable) {
      const title = p.project.title;
      const sure = await dialog({ title: 'Delete this project?', body: `<b>${esc(title)}</b> and everything in it disappear for everyone in this project. It stays in your Trash for 30 days, so you can restore it exactly as it was.`, confirm: 'Delete project', danger: true });
      if (!sure) return;
      const { error } = await sb.rpc('trash_item', { p_kind: 'project', p_id: projectId });
      if (error) return toast(friendlyError(error), 'error');
      track('project_deleted', { trash: true });
      await ctx.refreshNav();
      ctx.navigate('/app/projects');
      toast(`“${title}” moved to Trash.`, 'info', { label: 'Undo', run: () => restoreFromTrash('project', projectId, async () => { await ctx.refreshNav(); ctx.navigate(`/app/p/${projectId}`); }) });
      return;
    }
    if (p.isOwner) {
      const sure = await dialog({ title: 'Delete this project?', body: `Every video, take, and note in <b>${esc(p.project.title)}</b> will be deleted for everyone. This can’t be undone.`, confirm: 'Delete project', danger: true });
      if (!sure) return;
      const { error } = await sb.from('projects').delete().eq('id', projectId);
      if (error) return toast(friendlyError(error), 'error');
      toast('Project deleted.');
    } else {
      const sure = await dialog({ title: 'Leave this project?', body: 'You’ll lose access to its videos and notes. Ask for a new invite link to come back.', confirm: 'Leave project', danger: true });
      if (!sure) return;
      const { error } = await sb.from('project_members').delete().eq('project_id', projectId).eq('user_id', p.me);
      if (error) return toast(friendlyError(error), 'error');
    }
    ctx.navigate('/app/projects');
  });
}

// Words that don't tell two videos apart ("take 2", "v3", "final", dates).
const titleWords = (title) => title.toLowerCase().replace(/\b(take|v|ver|version)\s*\d+\b|\b(final|new|again|retake)\b|\d{1,4}[./-]\d{1,2}([./-]\d{1,4})?/g, ' ')
  .split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

// Is this upload probably another take of a video that's already here?
function suggestStack(title, videos, lastViewedId) {
  const words = new Set(titleWords(title));
  let best = null;
  for (const v of videos) {
    const other = new Set(titleWords(v.title));
    const shared = [...words].filter((w) => other.has(w)).length;
    const score = shared / Math.max(1, Math.min(words.size, other.size));
    if (score >= 0.6 && (!best || score > best.score)) best = { video: v, score };
  }
  if (best) return best.video;
  // No title match: offer the video they were just looking at, if it's still here.
  return videos.find((v) => v.id === lastViewedId) || null;
}

// request: answer a request. Your first upload becomes your submission; later ones are its next takes.
export async function createVideo(projectId, { request = null } = {}) {
  if (request) {
    const { data: mine } = await sb.from('videos').select('id, title, takes(count)').eq('request_id', request.id).eq('created_by', ctx.state.session.user.id).limit(1).maybeSingle();
    if (mine) return resubmit(projectId, mine);
  }
  // The name is a typed value (not translated with the page), so it's written in the reader's language here.
  const autoName = `${isKo ? '연습' : 'Practice'} ·${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const values = await dialog({
    title: request ? `Submit: ${request.title}` : 'Upload video',
    body: request ? (request.due_at ? `Due ${new Date(request.due_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'Your video goes to everyone on the project.') : 'Re-shooting something you already uploaded? Open that video and use <b>Upload new take</b> — its open notes come along.',
    // The video first (what people reach for), then a name that's already filled in and easy to change.
    fields: [
      { name: 'file', label: 'Video', type: 'file', accept: 'video/mp4,video/quicktime,video/webm', required: true, hint: FILE_HINT },
      { name: 'title', label: 'Name', placeholder: 'Full run-through', required: true, value: request ? `${request.title} — ${ctx.state.profile.display_name}` : autoName }
    ],
    confirm: 'Upload'
  });
  if (!values) return;
  const problem = checkTakeFile(values.file);
  if (problem) return toast(problem, 'error');
  const { data: existing } = await sb.from('videos').select('id, title, takes(count)').eq('project_id', projectId);
  let lastViewed = null;
  try { lastViewed = localStorage.getItem(`looproom:lastVideo:${projectId}`); } catch {}
  // A name left as filled in says nothing about which video this is, so don't match on it.
  const match = request ? null : suggestStack(values.title === autoName ? '' : values.title, existing || [], lastViewed);
  if (match) {
    const next = (match.takes[0]?.count ?? 0) + 1;
    const choice = await dialog({
      title: `Is this a new take of “${match.title}”?`,
      body: `It would become <b>Take ${next}</b>, and notes that aren’t fixed yet will carry over so you can check what changed.`,
      confirm: `Yes, add as Take ${next}`,
      extra: 'No, it’s a new video'
    });
    if (!choice) return;
    if (!choice.extra) {
      try {
        const added = await withUploadBar(`${match.title} · Take ${next}`, (stage) => uploadTake({ projectId, videoId: match.id, file: values.file, onStage: stage }));
        toast(`Take ${added.number} is up. Open notes came along.`);
        return ctx.navigate(`/app/p/${projectId}/v/${match.id}?take=${added.number}`);
      } catch (err) {
        return toast(friendlyError(err), 'error');
      }
    }
  }
  const { data: video, error } = await sb.from('videos').insert({ project_id: projectId, title: values.title, ...(request ? { request_id: request.id } : {}) }).select('id').single();
  if (error) return toast(friendlyError(error), 'error');
  try {
    await withUploadBar(values.title, (stage) => uploadTake({ projectId, videoId: video.id, file: values.file, onStage: stage }));
    toast('Uploaded. Pause on a moment and pin your first note.');
    ctx.navigate(`/app/p/${projectId}/v/${video.id}`);
    inviteAfterFirstVideo(projectId);
  } catch (err) {
    // A stopped upload can be resumed from the video's page; anything else leaves nothing worth keeping.
    if (err.resumable) {
      toast(err.message, 'error');
      return ctx.navigate(`/app/p/${projectId}/v/${video.id}`);
    }
    await sb.from('videos').delete().eq('id', video.id);
    toast(friendlyError(err), 'error');
  }
}

// Already submitted to this request: the new file becomes the next take of that video.
async function resubmit(projectId, video) {
  const next = (video.takes[0]?.count ?? 0) + 1;
  const values = await dialog({
    title: `Upload Take ${next}`,
    body: `You already submitted <b>${esc(video.title)}</b>. This becomes Take ${next}, and notes that aren’t fixed yet come along.`,
    fields: [{ name: 'file', label: 'Video', type: 'file', accept: 'video/mp4,video/quicktime,video/webm', required: true, hint: FILE_HINT }],
    confirm: `Upload Take ${next}`
  });
  if (!values) return;
  const problem = checkTakeFile(values.file);
  if (problem) return toast(problem, 'error');
  try {
    const added = await withUploadBar(`${video.title} · Take ${next}`, (stage) => uploadTake({ projectId, videoId: video.id, file: values.file, onStage: stage }));
    toast(`Take ${added.number} is up.`);
    ctx.navigate(`/app/p/${projectId}/v/${video.id}?take=${added.number}`);
  } catch (err) {
    toast(friendlyError(err), 'error');
  }
}

// Reuse a live invite link if there is one, so everyone shares the same link.
export async function inviteLink(projectId) {
  let { data: invite } = await sb.from('project_invites').select('code, expires_at').eq('project_id', projectId).eq('revoked', false)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!invite) {
    const { data, error } = await sb.from('project_invites').insert({ project_id: projectId }).select('code, expires_at').single();
    if (error) throw error;
    invite = data;
  }
  return { link: `${location.origin}/app/join/${invite.code}`, expires_at: invite.expires_at };
}

// One tap from wherever the need comes up (an @mention, a lone video, a request): the link is copied, nothing else opens.
export async function copyInvite(projectId, from) {
  let invite;
  try { invite = await inviteLink(projectId); } catch (error) { toast(friendlyError(error), 'error'); return null; }
  track('invite_link_shared', { via: 'copy', from });
  try { await navigator.clipboard.writeText(invite.link); toast('Invite link copied. Send it to anyone you want feedback from.'); }
  catch { await showInvite(projectId, ctx.state.projects.find((p) => p.id === projectId)?.title || ''); }
  return invite.link;
}

// Right after the first video goes up in a project nobody else is in yet: the moment an invite makes sense,
// because teammates arrive to something they can watch. Once per project; not for people practicing alone.
async function inviteAfterFirstVideo(projectId) {
  const project = ctx.state.projects.find((p) => p.id === projectId);
  if (!project || project.is_sample || onboarding().team === 'solo' || seen(`invite_prompt:${projectId}`)) return;
  const members = await loadMembers(projectId).catch(() => []);
  if (members.length !== 1) return;
  markSeen(`invite_prompt:${projectId}`);
  showInvite(projectId, project.title, {
    heading: 'Your video is up. Invite people to leave feedback.',
    body: 'They’ll see your video as soon as they join and can leave feedback on any moment. Anyone with this link joins with just their name and email.',
    from: 'first_video',
    later: 'Later'
  });
}

export async function showInvite(projectId, title, { heading = 'Invite people', body = null, from = 'invite_dialog', later = 'Done' } = {}) {
  let invite;
  try { invite = await inviteLink(projectId); } catch (error) { return toast(friendlyError(error), 'error'); }
  const { link } = invite;
  const el = document.createElement('dialog');
  el.className = 'dialog';
  el.innerHTML = `<div class="dialog-card"><h2>${esc(heading)}</h2>
    <div class="known" data-known hidden>
      <label class="known-field" data-known-field>${ic('search')}<input type="search" class="known-search" data-known-search placeholder="Search people you’ve worked with" aria-label="Search people you’ve worked with" autocomplete="off" enterkeyhint="search" /><button type="button" class="known-clear" data-known-clear hidden aria-label="Clear search" title="Clear">${ic('x', 'solo')}</button></label>
      <div class="known-list" data-known-list></div>
      <p class="known-or">Anyone else can join with this link, using just their name and email.</p>
    </div>
    ${body ? `<p>${body}</p>` : `<p data-no-i18n>${isKo ? `이 링크가 있으면 누구나 이름과 이메일만으로 <b>${esc(title)}</b>에 참여할 수 있어요.` : `Anyone with this link can join <b>${esc(title)}</b> with just their name and email.`}</p>`}<p class="fine left">It works until ${new Date(invite.expires_at).toLocaleDateString()}.</p>
    <div class="copy-row"><input readonly value="${esc(link)}" aria-label="Invite link" data-link-input /><button class="btn primary" data-copy>Copy</button></div>
    <div class="invite-more">${navigator.share ? '<button class="btn" data-share>Share…</button>' : ''}<button class="btn" data-qr-open>${ic('qr')}Show QR code</button></div>
    <p class="fine left">In the studio? Show the QR code and everyone can scan it with their phone camera to join.</p>
    <div class="dialog-actions"><button class="btn ghost" data-close>${esc(later)}</button></div></div>`;
  document.body.append(el);
  el.showModal();
  el.querySelector('[data-link-input]').select();
  const added = wireKnownPeople(el, projectId, title);
  el.querySelector('[data-copy]').addEventListener('click', async () => {
    track('invite_link_shared', { via: 'copy', from });
    try { await navigator.clipboard.writeText(link); toast('Invite link copied. Send it to anyone you want feedback from.'); } catch { el.querySelector('input').select(); toast('Press Ctrl+C to copy the link.'); }
  });
  el.querySelector('[data-share]')?.addEventListener('click', () => {
    track('invite_link_shared', { via: 'share', from });
    navigator.share({ title: 'dancerly', text: `Join ${title} on dancerly`, url: link }).catch(() => {});
  });
  el.querySelector('[data-qr-open]').addEventListener('click', () => {
    track('invite_link_shared', { via: 'qr', from });
    showInviteQr(link, title, invite.expires_at);
  });
  el.querySelector('[data-close]').addEventListener('click', () => el.close());
  el.addEventListener('close', () => {
    el.remove();
    // Someone was added: the page behind (members, avatars) should show them.
    if (added.size) ctx.route();
  });
}

// People you've worked with on other projects, ready to add without a link (migration 051). Recent first;
// typing filters by name, Korean initials included. Hidden when there's nobody (or the database isn't ready).
function wireKnownPeople(el, projectId, title) {
  const added = new Set();
  const box = el.querySelector('[data-known]');
  const list = el.querySelector('[data-known-list]');
  const search = el.querySelector('[data-known-search]');
  let people = [];
  const row = (p) => `<div class="known-row">${avatar(p.display_name, p.user_id, 'sm')}<span class="known-main"><b>${esc(p.display_name)}</b><small>${esc(p.shared_project)}</small></span>${added.has(p.user_id)
    ? `<span class="known-done">${ic('check')}Added</span>`
    : `<button type="button" class="btn small" data-add="${p.user_id}">Add</button>`}</div>`;
  const paint = () => {
    const q = search.value;
    const shown = people.filter((p) => nameMatches(p.display_name, q)).slice(0, q.trim() ? 8 : 5);
    list.innerHTML = shown.length ? shown.map(row).join('') : `<p class="known-empty">No one by that name. Send them the link below.</p>`;
  };
  sb.rpc('people_i_know', { p_project: projectId }).then(({ data, error }) => {
    if (error || !data?.length) return;
    people = data.sort((a, b) => String(b.last_together).localeCompare(String(a.last_together)));
    // A few people: no search box needed, the list is the whole answer.
    el.querySelector('[data-known-field]').hidden = people.length <= 5;
    box.hidden = false;
    paint();
  });
  const clear = el.querySelector('[data-known-clear]');
  search.addEventListener('input', () => { clear.hidden = !search.value; paint(); });
  clear.addEventListener('click', () => { search.value = ''; clear.hidden = true; paint(); search.focus(); });
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    b.disabled = true;
    const person = people.find((p) => p.user_id === b.dataset.add);
    const { error } = await sb.rpc('add_project_member', { p_project: projectId, p_user: b.dataset.add });
    if (error) { b.disabled = false; return toast(friendlyError(error), 'error'); }
    added.add(b.dataset.add);
    track('member_added_directly', { from: 'invite_dialog' });
    toast(isKo ? `${person?.display_name || ''}님을 ${title}에 추가했어요.` : `Added ${person?.display_name || 'them'} to ${title}.`);
    paint();
  });
  return added;
}

// ---------- Invite QR: one code per project, the same one everyone in it sees ----------
// Made for the studio: a full-screen code to hold up or put on the TV, and a poster to print or post.
// Scans are tagged ?ref=qr_invite, so signups from it show up as such in the admin alerts.
const qrUrl = (link) => `${link}${link.includes('?') ? '&' : '?'}ref=qr_invite`;
async function makeQr(text) {
  const { default: qrcode } = await import('../vendor/qrcode-generator-1.4.4.js');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr;
}

export async function showInviteQr(link, title, expiresAt) {
  let qr;
  try { qr = await makeQr(qrUrl(link)); } catch { return toast('Couldn’t make the QR code. Copy the link instead.', 'error'); }
  const until = new Date(expiresAt).toLocaleDateString();
  const el = document.createElement('dialog');
  el.className = 'qr-full';
  el.innerHTML = `<div class="qr-full-card">
    <img class="qr-full-logo" src="/logo-wordmark.png" alt="dancerly" width="542" height="128" />
    <p class="qr-full-eyebrow">Scan to join</p>
    <h2 class="qr-full-title">${esc(title)}</h2>
    <div class="qr-full-code">${qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true })}</div>
    <p class="qr-full-help">Point your phone’s camera at the code. No app to install.</p>
    <p class="qr-full-until">Works until ${esc(until)}</p>
    <div class="qr-full-actions"><button class="btn" data-qr-poster>${ic('download')}Save as poster</button><button class="btn primary" data-qr-close>Done</button></div>
  </div>`;
  document.body.append(el);
  el.showModal();
  el.querySelector('[data-qr-close]').addEventListener('click', () => el.close());
  el.addEventListener('click', (e) => { if (e.target === el) el.close(); });
  el.querySelector('[data-qr-poster]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try { await savePoster(qr, title, until); } catch { toast('Couldn’t save the poster. Try a screenshot instead.', 'error'); }
    b.disabled = false;
  });
  el.addEventListener('close', () => el.remove());
}

// A 1080×1350 image (fits Instagram and prints fine): logo, the project, the code, and how to use it.
async function savePoster(qr, title, until) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f2f2ff'; g.fillRect(0, 0, W, 300);
  const logo = new Image();
  logo.src = '/logo-wordmark.png';
  await logo.decode().catch(() => {});
  if (logo.naturalWidth) g.drawImage(logo, (W - 300) / 2, 96, 300, 300 * (logo.naturalHeight / logo.naturalWidth));
  const font = (w, px) => `${w} ${px}px Inter, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = '#5b5ce2'; g.font = font(700, 34);
  g.fillText(isKo ? '스캔해서 참여하기' : 'SCAN TO JOIN', W / 2, 250);
  g.fillStyle = '#15171b'; g.font = font(800, 64);
  const name = title.length > 26 ? `${title.slice(0, 25)}…` : title;
  g.fillText(name, W / 2, 400);
  // The code itself, drawn module by module so it stays sharp.
  const n = qr.getModuleCount(), size = 640, cell = Math.floor(size / (n + 4)), side = cell * (n + 4);
  const x0 = Math.round((W - side) / 2), y0 = 470; // whole pixels, so the modules meet without seams
  g.fillStyle = '#ffffff'; g.fillRect(x0, y0, side, side);
  g.strokeStyle = '#e6e8ec'; g.lineWidth = 3; g.strokeRect(x0, y0, side, side);
  g.fillStyle = '#15171b';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) g.fillRect(x0 + (col + 2) * cell, y0 + (r + 2) * cell, cell, cell);
  g.fillStyle = '#3b4048'; g.font = font(500, 34);
  g.fillText(isKo ? '휴대폰 카메라로 스캔하면 바로 참여할 수 있어요.' : 'Point your phone’s camera at the code to join.', W / 2, y0 + side + 80);
  g.fillText(isKo ? '연습 영상을 보고, 그 순간에 피드백을 남겨요.' : 'Watch our practice videos and leave feedback on the count.', W / 2, y0 + side + 128);
  g.fillStyle = '#8b93a3'; g.font = font(500, 26);
  g.fillText(isKo ? `${until}까지 사용할 수 있어요 · dancerly.app` : `Works until ${until} · dancerly.app`, W / 2, H - 60);
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'dancerly'}-invite-qr.png`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Poster saved.');
}

