// Projects: the list, and each project's tabs — Videos, Notes, People, Settings.
import { uploadTake, checkTakeFile } from '../upload.js';
import { thumbUrls, backfillThumbs } from '../thumbs.js';
import { cols, schema } from '../client.js';
import { sb, $, $$, esc, initials, timeAgo, toast, friendlyError, dialog, withUploadBar, loadMembers, avatar, projectMark, wireImagePicker } from '../client.js';
import { ctx } from '../ctx.js';
import { NOTE_SELECT, noteRow, tabs, empty, namesFor } from './shared.js';
import { loadGroups, groupsSection, wireGroups } from './groups.js';
import { memberWelcome, sampleOffer, samplePeek, track } from '../onboarding.js';

// Under every file picker: what makes a rehearsal video easy to give feedback on.
const FILE_HINT = 'Tip: film from the front, whole body in frame, with the music, start to finish · MP4, MOV, or WebM';

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
        <p class="muted">${p.videos[0]?.count ?? 0} videos · ${p.project_members[0]?.count ?? 1} members</p>
      </a>`;
  const real = projects.filter((p) => !p.is_sample);
  const sample = projects.find((p) => p.is_sample);
  view.innerHTML = `<section class="page">
    <header class="page-head"><div><h1>Projects</h1><p class="muted sub">One project per goal — a showcase, a competition, or weekly practice.</p></div><button class="btn primary" data-new-project>+ New project</button></header>
    ${projects.length ? `${real.length ? `<div class="cards">${real.map(card).join('')}</div>` : ''}
      ${sample ? `<h2 class="section-label">Try it out</h2><div class="cards">${card(sample)}</div>`
        : schema.firstRun ? '<p class="muted projects-sample">Want to try things without touching real work? <button type="button" class="link-btn" data-open-sample="projects">Open the sample project</button></p>' : ''}`
    : empty('✦', 'Create your first project', 'A project is one goal — a showcase, a competition, or weekly practice. Upload a rehearsal, invite your team, and start pinning notes.', `<button class="btn primary" data-new-project>+ New project</button>${schema.firstRun ? '<button class="btn" data-open-sample>Explore a sample first</button>' : ''}`)}
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

// Shared header + tabs for every project screen.
export async function loadProject(projectId) {
  const [{ data: project, error }, members] = await Promise.all([
    sb.from('projects').select(cols('id, title, image_url, is_sample, created_at, created_by')).eq('id', projectId).single(),
    loadMembers(projectId)
  ]);
  if (error) throw error;
  const me = ctx.state.session.user.id;
  const isOwner = members.some((m) => m.user_id === me && m.role === 'owner');
  return { project, members, isOwner, me };
}

export function projectHead({ project, members }, tab, actions = '') {
  const base = `/app/p/${project.id}`;
  return `<header class="page-head project-head">
      <div class="project-title">${projectMark(project, 'head')}<div><p class="eyebrow">${project.is_sample ? 'Sample project' : 'Project'}</p><h1>${esc(project.title)}</h1>
        <a class="members" href="${base}/people" data-link>${members.slice(0, 6).map((m) => `${avatar(m.name, m.user_id)}`).join('')}${members.length > 6 ? `<span class="avatar more">+${members.length - 6}</span>` : ''}<span class="link">${members.length} ${members.length === 1 ? 'member' : 'members'}</span></a>
      </div></div>
      <div class="head-actions">${project.is_sample ? `${actions.replace(/<button[^>]*data-invite[^>]*>[^<]*<\/button>/g, '')}<button class="btn ghost" data-delete-sample>Delete sample</button>` : actions}</div>
    </header>
    ${tabs([['overview', 'Overview', `${base}/overview`], ['videos', 'Videos', base], ['requests', 'Requests', `${base}/requests`], ['notes', 'Notes', `${base}/notes`], ['pages', 'Pages', `${base}/pages`], ['recaps', 'Recaps', `${base}/recaps`], ['calendar', 'Calendar', `${base}/calendar`], ['people', 'People', `${base}/people`], ['settings', 'Settings', `${base}/settings`]], tab)}`;
}

export async function renderProject(projectId) {
  const { view, setCrumbs } = ctx;
  const [p, { data: videos, error: vErr }] = await Promise.all([
    loadProject(projectId),
    sb.from('videos').select('id, title, created_at, takes(id, number, created_at, storage_path, thumb_path, project_id, video_id), notes(status)').eq('project_id', projectId).order('created_at', { ascending: false })
  ]);
  if (vErr) throw vErr;
  setCrumbs([['Projects', '/app/projects'], [p.project.title]]);
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'videos', '<button class="btn" data-invite>Invite</button><button class="btn primary" data-new-video>+ New video</button>')}
    ${videos.length ? `<div class="video-list">${videos.map((v) => {
      const takes = [...v.takes].sort((a, b) => b.number - a.number);
      const open = v.notes.filter((n) => n.status !== 'resolved').length;
      return `<a class="video-row" href="/app/p/${projectId}/v/${v.id}" data-link>
        <span class="video-thumb" ${takes[0] ? `data-thumb="${takes[0].id}"` : ''}><i aria-hidden="true">▶</i>${takes.length > 1 ? `<em>${takes.length} takes</em>` : ''}</span>
        <span class="video-copy"><b>${esc(v.title)}</b><small>${takes.length > 1 ? `${takes.length} takes · latest ${timeAgo(takes[0].created_at)}` : takes.length ? `Uploaded ${timeAgo(takes[0].created_at)}` : 'No video yet'}</small></span>
        <span class="pill ${open ? 'warn' : 'ok'}">${open ? `${open} open` : 'All clear'}</span><span class="chev">→</span>
      </a>`;
    }).join('')}</div>`
    : p.isOwner
      ? empty('▶', 'Add your first rehearsal video', 'Upload a run-through, a section, or someone’s part. Every new take of the same piece goes into the same video.', `<button class="btn primary" data-new-video>+ New video</button>${!p.project.is_sample && sampleOffer() ? '<button class="btn" data-open-sample="empty-videos">See how it works in a sample</button>' : ''}`)
      : empty('▶', 'No videos yet', 'When a video is uploaded here, you’ll get a notification. Have one of your own? Upload it and your team can leave feedback.', '<button class="btn primary" data-new-video>+ Upload my video</button>')}
  </section>`;
  $$('[data-new-video]').forEach((b) => b.addEventListener('click', () => createVideo(projectId)));
  $('[data-invite]')?.addEventListener('click', () => showInvite(projectId, p.project.title));
  // People who just joined get a short welcome once.
  const mine = p.members.find((m) => m.user_id === p.me);
  if (!p.isOwner && (ctx.state.justJoined === projectId || (mine?.joined_at && Date.now() - new Date(mine.joined_at) < 3 * 86400000))) {
    ctx.state.justJoined = null;
    memberWelcome(projectId, p.project, p.members);
  }
  paintThumbs(videos.map((v) => [...v.takes].sort((a, b) => b.number - a.number)[0]).filter(Boolean));
}

// Each row shows a still from its latest take; missing ones are made in the background.
async function paintThumbs(latest) {
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
      : notes.length ? empty('✓', 'All caught up', 'Nothing in this view.') : empty('◫', 'No notes yet', 'Open a video, pause on a moment, and pin what you see.', samplePeek('notes'))}
  </section>`;
}

export async function renderProjectPeople(projectId) {
  const { view, setCrumbs } = ctx;
  const [p, groups] = await Promise.all([loadProject(projectId), loadGroups(projectId)]);
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['People']]);
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'people', '<button class="btn primary" data-invite>Invite people</button>')}
    <div class="list">${p.members.map((m) => `<div class="row member-row">
      <a class="person" href="/app/people/${m.user_id}" data-link>${avatar(m.name, m.user_id, 'sm')}<span class="row-main"><span class="row-title">${esc(m.name)}${m.user_id === p.me ? ' <span class="tag">You</span>' : ''}</span><span class="row-meta">Joined ${timeAgo(m.joined_at)}</span></span></a>
      <span class="row-side"><span class="role ${m.role}">${m.role === 'owner' ? 'Owner' : 'Member'}</span>
        ${p.isOwner && m.user_id !== p.me ? `<button class="btn ghost small icon" data-member="${m.user_id}" aria-label="Manage ${esc(m.name)}">•••</button>` : ''}</span>
    </div>`).join('')}</div>
    <p class="fine left">Owners can rename or delete the project and remove people. Everyone can upload, leave notes, and invite.</p>
    ${groupsSection(p, groups)}
  </section>`;
  $('[data-invite]')?.addEventListener('click', () => showInvite(projectId, p.project.title));
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
      <section class="panel danger-zone">
        <div class="panel-head"><div><h2>${p.isOwner ? 'Delete project' : 'Leave project'}</h2><p class="muted">${p.isOwner ? 'Deletes every video, take, and note for everyone. This can’t be undone.' : 'You’ll lose access to its videos and notes. Ask for a new invite to come back.'}</p></div>
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
  const values = await dialog({
    title: request ? `Submit: ${request.title}` : 'New video',
    body: request ? (request.due_at ? `Due ${new Date(request.due_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'Your video goes to everyone on the project.') : 'Re-shooting something you already uploaded? Open that video and use <b>Upload a new take</b> — its open notes come along.',
    fields: [
      { name: 'title', label: 'What is it?', placeholder: 'Full run-through', required: true, value: request ? `${request.title} — ${ctx.state.profile.display_name}` : '' },
      { name: 'file', label: 'First take', type: 'file', accept: 'video/mp4,video/quicktime,video/webm', required: true, hint: FILE_HINT }
    ],
    confirm: 'Upload'
  });
  if (!values) return;
  const problem = checkTakeFile(values.file);
  if (problem) return toast(problem, 'error');
  const { data: existing } = await sb.from('videos').select('id, title, takes(count)').eq('project_id', projectId);
  let lastViewed = null;
  try { lastViewed = localStorage.getItem(`looproom:lastVideo:${projectId}`); } catch {}
  const match = request ? null : suggestStack(values.title, existing || [], lastViewed);
  if (match) {
    const next = (match.takes[0]?.count ?? 0) + 1;
    const choice = await dialog({
      title: `Is this a new take of “${match.title}”?`,
      body: `It would become <b>Take ${next}</b>, and notes that aren’t fixed yet will carry over so your team can check what changed.`,
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
  try { await navigator.clipboard.writeText(invite.link); toast('Invite link copied. Send it to your team.'); }
  catch { await showInvite(projectId, ctx.state.projects.find((p) => p.id === projectId)?.title || ''); }
  return invite.link;
}

export async function showInvite(projectId, title) {
  let invite;
  try { invite = await inviteLink(projectId); } catch (error) { return toast(friendlyError(error), 'error'); }
  const { link } = invite;
  const el = document.createElement('dialog');
  el.className = 'dialog';
  el.innerHTML = `<div class="dialog-card"><h2>Invite your team</h2><p>Anyone with this link can join <b>${esc(title)}</b> with just their name and email. It works until ${new Date(invite.expires_at).toLocaleDateString()}.</p>
    <div class="copy-row"><input readonly value="${esc(link)}" /><button class="btn primary" data-copy>Copy</button></div>
    <div class="dialog-actions"><button class="btn ghost" data-close>Done</button></div></div>`;
  document.body.append(el);
  el.showModal();
  el.querySelector('input').select();
  el.querySelector('[data-copy]').addEventListener('click', async () => {
    window.dataLayer?.push({ event: 'invite_link_shared', via: 'copy' });
    try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { el.querySelector('input').select(); toast('Press Ctrl+C to copy the link.'); }
  });
  el.querySelector('[data-close]').addEventListener('click', () => el.close());
  el.addEventListener('close', () => el.remove());
}

