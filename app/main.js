import { sb, $, $$, esc, initials, timeAgo, toast, friendlyError, dialog, uploadTake, withUploadBar, checkTakeFile, loadMembers } from './client.js';
import { mountReview } from './review.js';

const view = $('[data-view]');
const state = { session: null, profile: null, cleanup: null };

// ---------- Routing ----------
const routes = [
  { re: /^\/app\/login\/?$/, render: renderLogin, open: true },
  { re: /^\/app\/join\/([a-f0-9]{6,64})\/?$/, render: renderJoin, open: true },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/v\/([0-9a-f-]{36})\/?$/, render: (projectId, videoId) => mountReview({ projectId, videoId, me: state.session.user, view, navigate, setCrumbs }) },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/?$/, render: renderProject },
  { re: /^\/app\/?$/, render: renderHome }
];

export function navigate(path, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  route();
}
window.addEventListener('popstate', route);
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  navigate(link.getAttribute('href'));
});

async function route() {
  if (state.cleanup) { state.cleanup(); state.cleanup = null; }
  const path = location.pathname;
  const match = routes.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  if (!match) return navigate('/app', { replace: true });
  if (!match.r.open && !state.session) {
    return navigate(`/app/login?next=${encodeURIComponent(path + location.search)}`, { replace: true });
  }
  if (!match.r.open && !state.profile) return renderName();
  renderChrome();
  view.innerHTML = '<div class="loading">Loading…</div>';
  try {
    state.cleanup = (await match.r.render(...match.m.slice(1))) || null;
  } catch (error) {
    view.innerHTML = `<div class="empty"><h2>Couldn’t load this page</h2><p>${esc(friendlyError(error))}</p><a class="btn" href="/app" data-link>Back to projects</a></div>`;
  }
}

// ---------- Header ----------
function setCrumbs(items) {
  $('[data-crumbs]').innerHTML = items.map(([label, href]) => href ? `<a href="${href}" data-link>${esc(label)}</a>` : `<b>${esc(label)}</b>`).join('<i>/</i>');
}
function renderChrome() {
  const signedIn = Boolean(state.session && state.profile);
  $('[data-account]').hidden = !signedIn;
  if (signedIn) {
    $('[data-account-initials]').textContent = initials(state.profile.display_name);
    $('[data-account-name]').textContent = state.profile.display_name;
    $('[data-account-email]').textContent = state.session.user.email || '';
  }
  setCrumbs([]);
}
$('[data-account-toggle]').addEventListener('click', () => $('[data-account-menu]').toggleAttribute('hidden'));
document.addEventListener('click', (event) => { if (!event.target.closest('[data-account]')) $('[data-account-menu]').hidden = true; });
$('[data-signout]').addEventListener('click', async () => {
  await sb.auth.signOut();
  state.session = null;
  state.profile = null;
  navigate('/app/login');
});
$('[data-rename]').addEventListener('click', async () => {
  const values = await dialog({ title: 'Your name', fields: [{ name: 'name', label: 'Shown to your team', value: state.profile.display_name, max: 60, required: true }] });
  if (!values?.name) return;
  const { error } = await sb.from('profiles').update({ display_name: values.name }).eq('id', state.session.user.id);
  if (error) return toast(friendlyError(error), 'error');
  state.profile.display_name = values.name;
  renderChrome();
  route();
});

// ---------- Sign in / sign up ----------
// Only ever send people back inside the app after signing in.
const safeNext = (next) => (next && /^\/app(\/|$|\?)/.test(next) && !next.startsWith('//') ? next : '/app');

function renderLogin() {
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get('next'));
  if (state.session && state.profile) return navigate(next, { replace: true });
  if (state.session) return renderName();
  let mode = params.get('mode') === 'signup' ? 'signup' : 'login';
  // Errors from a failed Google or magic-link redirect come back in the URL.
  const hash = new URLSearchParams(location.hash.slice(1));
  const redirectError = params.get('error_description') || hash.get('error_description');
  renderChrome();
  const paint = () => {
    view.innerHTML = `<section class="auth">
      <div class="auth-card">
        <a class="auth-brand" href="/"><span class="brand-mark"><i></i><i></i><i></i></span>looproom</a>
        <div class="seg" role="tablist"><button role="tab" type="button" data-mode="signup" aria-selected="${mode === 'signup'}">Sign up</button><button role="tab" type="button" data-mode="login" aria-selected="${mode === 'login'}">Log in</button></div>
        <h1>${mode === 'signup' ? 'Start your team’s space' : 'Welcome back'}</h1>
        <p class="muted">${mode === 'signup' ? 'Free for your first team. No credit card, no password.' : 'We’ll email you a link — no password to remember.'}</p>
        ${redirectError ? `<p class="form-error" role="alert">${esc(redirectError)}</p>` : ''}
        <button type="button" class="btn google" data-google><span class="g">G</span> Continue with Google</button>
        <div class="or"><span>or with email</span></div>
        <form data-auth-form>
          ${mode === 'signup' ? '<label class="field"><span>Your name</span><input name="name" autocomplete="name" maxlength="60" required placeholder="Maya Chen" /></label>' : ''}
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="you@example.com" value="${esc(params.get('email') || '')}" /></label>
          <button class="btn primary wide" type="submit">${mode === 'signup' ? 'Create account' : 'Email me a log-in link'}</button>
          <p class="form-error" data-form-error role="alert" hidden></p>
        </form>
        <p class="fine">By continuing you agree to the Terms and Privacy Policy.</p>
      </div>
    </section>`;
    $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; paint(); }));
    $('[data-google]').addEventListener('click', async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${next}` } });
      if (error) showError(friendlyError(error));
    });
    $('[data-auth-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const email = form.email.value.trim();
      const name = form.name?.value.trim();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}${next}`, shouldCreateUser: true, data: name ? { display_name: name } : undefined }
      });
      if (error) {
        button.disabled = false;
        button.textContent = mode === 'signup' ? 'Create account' : 'Email me a log-in link';
        return showError(friendlyError(error));
      }
      renderCheckInbox(email, name, next);
    });
  };
  const showError = (message) => { const el = $('[data-form-error]'); el.textContent = message; el.hidden = false; };
  paint();
}

function renderCheckInbox(email, name, next) {
  view.innerHTML = `<section class="auth"><div class="auth-card center">
    <div class="inbox-icon">✉</div>
    <h1>Check your inbox</h1>
    <p class="muted">We sent a link to <b>${esc(email)}</b>. Open it on this device to continue. It works for one hour.</p>
    <button class="btn wide" data-resend disabled>Resend in <span data-count>60</span>s</button>
    <button class="btn ghost wide" data-other>Use a different email</button>
  </div></section>`;
  let left = 60;
  const timer = setInterval(() => {
    left -= 1;
    const b = $('[data-resend]');
    if (!b) return clearInterval(timer);
    if (left <= 0) { clearInterval(timer); b.disabled = false; b.textContent = 'Resend the link'; } else $('[data-count]').textContent = left;
  }, 1000);
  $('[data-resend]').addEventListener('click', async () => {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}${next}`, data: name ? { display_name: name } : undefined } });
    toast(error ? friendlyError(error) : 'Sent again. Check spam if it’s not there.', error ? 'error' : 'info');
  });
  $('[data-other]').addEventListener('click', () => { clearInterval(timer); renderLogin(); });
  return () => clearInterval(timer);
}

// First visit after signing in: everyone needs a name teammates will recognise.
function renderName() {
  renderChrome();
  const suggested = state.session.user.user_metadata?.full_name || state.session.user.user_metadata?.name || '';
  view.innerHTML = `<section class="auth"><form class="auth-card" data-name-form>
    <h1>What should your team call you?</h1>
    <p class="muted">This name appears on your notes and in @mentions.</p>
    <label class="field"><span>Your name</span><input name="name" maxlength="60" required value="${esc(suggested)}" placeholder="Maya Chen" /></label>
    <button class="btn primary wide" type="submit">Continue</button>
  </form></section>`;
  $('[data-name-form] input').focus();
  $('[data-name-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = event.currentTarget.name.value.trim();
    if (!name) return;
    const { data, error } = await sb.from('profiles').insert({ id: state.session.user.id, display_name: name }).select().single();
    if (error) return toast(friendlyError(error), 'error');
    state.profile = data;
    route();
  });
}

// ---------- Projects ----------
async function renderHome() {
  setCrumbs([['Projects']]);
  const { data: projects, error } = await sb.from('projects')
    .select('id, title, created_at, project_members(count), videos(count)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  view.innerHTML = `<section class="page">
    <header class="page-head"><div><p class="eyebrow">Hi ${esc(state.profile.display_name.split(' ')[0])}</p><h1>Your projects</h1></div><button class="btn primary" data-new-project>+ New project</button></header>
    ${projects.length ? `<div class="cards">${projects.map((p) => `<a class="card project-card" href="/app/p/${p.id}" data-link>
        <span class="card-mark">${esc(initials(p.title))}</span>
        <h3>${esc(p.title)}</h3>
        <p class="muted">${p.videos[0]?.count ?? 0} videos · ${p.project_members[0]?.count ?? 1} members</p>
      </a>`).join('')}</div>`
    : `<div class="empty"><div class="empty-icon">✦</div><h2>Create your first project</h2><p>A project is one goal — a showcase, a competition, or weekly practice. Upload a rehearsal, invite your team, and start pinning notes.</p><button class="btn primary" data-new-project>+ New project</button></div>`}
  </section>`;
  $$('[data-new-project]').forEach((b) => b.addEventListener('click', createProject));
}

async function createProject() {
  const values = await dialog({ title: 'New project', fields: [{ name: 'title', label: 'Project name', placeholder: 'Showcase 2026', required: true }], confirm: 'Create project' });
  if (!values?.title) return;
  const { data, error } = await sb.from('projects').insert({ title: values.title }).select('id').single();
  if (error) return toast(friendlyError(error), 'error');
  navigate(`/app/p/${data.id}`);
}

async function renderProject(projectId) {
  const [{ data: project, error }, members, { data: videos, error: vErr }] = await Promise.all([
    sb.from('projects').select('id, title, created_at').eq('id', projectId).single(),
    loadMembers(projectId),
    sb.from('videos').select('id, title, created_at, takes(id, number, created_at), notes(status)').eq('project_id', projectId).order('created_at', { ascending: false })
  ]);
  if (error) throw error;
  if (vErr) throw vErr;
  const me = members.find((m) => m.user_id === state.session.user.id);
  const isOwner = me?.role === 'owner';
  setCrumbs([['Projects', '/app'], [project.title]]);
  view.innerHTML = `<section class="page">
    <header class="page-head">
      <div><p class="eyebrow">Project</p><h1>${esc(project.title)}</h1>
        <div class="members">${members.slice(0, 6).map((m) => `<span class="avatar" title="${esc(m.name)} · ${m.role === 'owner' ? 'Owner' : 'Member'}">${esc(initials(m.name))}</span>`).join('')}${members.length > 6 ? `<span class="avatar more">+${members.length - 6}</span>` : ''}<button class="link" data-show-members>${members.length} ${members.length === 1 ? 'member' : 'members'}</button></div>
      </div>
      <div class="head-actions"><button class="btn" data-invite>Invite</button><button class="btn primary" data-new-video>+ New video</button><button class="btn ghost icon" data-project-menu aria-label="Project settings">•••</button></div>
    </header>
    ${videos.length ? `<div class="video-list">${videos.map((v) => {
      const takes = [...v.takes].sort((a, b) => b.number - a.number);
      const open = v.notes.filter((n) => n.status !== 'resolved').length;
      return `<a class="video-row" href="/app/p/${projectId}/v/${v.id}" data-link>
        <span class="video-thumb">▶</span>
        <span class="video-copy"><b>${esc(v.title)}</b><small>${takes.length ? `Take ${takes[0].number} · ${timeAgo(takes[0].created_at)}` : 'No takes yet'}</small></span>
        <span class="pill ${open ? 'warn' : 'ok'}">${open ? `${open} open` : 'All clear'}</span><span class="chev">→</span>
      </a>`;
    }).join('')}</div>`
    : `<div class="empty"><div class="empty-icon">▶</div><h2>Add your first rehearsal video</h2><p>Upload a run-through, a section, or someone’s part. Every new take of the same piece goes into the same video.</p><button class="btn primary" data-new-video>+ New video</button></div>`}
  </section>`;
  $$('[data-new-video]').forEach((b) => b.addEventListener('click', () => createVideo(projectId)));
  $('[data-invite]').addEventListener('click', () => showInvite(projectId, project.title));
  $('[data-show-members]').addEventListener('click', () => showMembers(projectId, members, isOwner));
  $('[data-project-menu]').addEventListener('click', () => projectMenu(project, isOwner));
}

async function createVideo(projectId) {
  const values = await dialog({
    title: 'New video',
    body: 'One video holds every take of the same piece — Take 1, Take 2, and so on.',
    fields: [
      { name: 'title', label: 'What is it?', placeholder: 'Full run-through', required: true },
      { name: 'file', label: 'First take', type: 'file', accept: 'video/mp4,video/quicktime,video/webm', required: true, hint: 'MP4, MOV, or WebM · up to 50 MB' }
    ],
    confirm: 'Upload'
  });
  if (!values) return;
  const problem = checkTakeFile(values.file);
  if (problem) return toast(problem, 'error');
  const { data: video, error } = await sb.from('videos').insert({ project_id: projectId, title: values.title }).select('id').single();
  if (error) return toast(friendlyError(error), 'error');
  try {
    await withUploadBar(values.title, (stage) => uploadTake({ projectId, videoId: video.id, file: values.file, onStage: stage }));
    toast('Take 1 is up. Pin your first note.');
    navigate(`/app/p/${projectId}/v/${video.id}`);
  } catch (err) {
    await sb.from('videos').delete().eq('id', video.id);
    toast(friendlyError(err), 'error');
  }
}

async function showInvite(projectId, title) {
  // Reuse a live invite link if there is one, so everyone shares the same link.
  let { data: invite } = await sb.from('project_invites').select('code, expires_at').eq('project_id', projectId).eq('revoked', false)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!invite) {
    const { data, error } = await sb.from('project_invites').insert({ project_id: projectId }).select('code, expires_at').single();
    if (error) return toast(friendlyError(error), 'error');
    invite = data;
  }
  const link = `${location.origin}/app/join/${invite.code}`;
  const el = document.createElement('dialog');
  el.className = 'dialog';
  el.innerHTML = `<div class="dialog-card"><h2>Invite your team</h2><p>Anyone with this link can join <b>${esc(title)}</b> with just their name and email. It works until ${new Date(invite.expires_at).toLocaleDateString()}.</p>
    <div class="copy-row"><input readonly value="${esc(link)}" /><button class="btn primary" data-copy>Copy</button></div>
    <div class="dialog-actions"><button class="btn ghost" data-close>Done</button></div></div>`;
  document.body.append(el);
  el.showModal();
  el.querySelector('input').select();
  el.querySelector('[data-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { el.querySelector('input').select(); toast('Press Ctrl+C to copy the link.'); }
  });
  el.querySelector('[data-close]').addEventListener('click', () => el.close());
  el.addEventListener('close', () => el.remove());
}

function showMembers(projectId, members, isOwner) {
  const el = document.createElement('dialog');
  el.className = 'dialog';
  el.innerHTML = `<div class="dialog-card"><h2>Members</h2>
    <ul class="member-list">${members.map((m) => `<li><span class="avatar">${esc(initials(m.name))}</span><span><b>${esc(m.name)}</b><small>${m.role === 'owner' ? 'Owner' : 'Member'}</small></span>${isOwner && m.role !== 'owner' ? `<button class="link danger" data-remove="${m.user_id}">Remove</button>` : ''}</li>`).join('')}</ul>
    <div class="dialog-actions"><button class="btn ghost" data-close>Close</button></div></div>`;
  document.body.append(el);
  el.showModal();
  el.querySelector('[data-close]').addEventListener('click', () => el.close());
  el.addEventListener('close', () => el.remove());
  $$('[data-remove]', el).forEach((b) => b.addEventListener('click', async () => {
    const { error } = await sb.from('project_members').delete().eq('project_id', projectId).eq('user_id', b.dataset.remove);
    if (error) return toast(friendlyError(error), 'error');
    el.close();
    toast('Removed from the project.');
    route();
  }));
}

async function projectMenu(project, isOwner) {
  if (isOwner) {
    const values = await dialog({ title: 'Project settings', fields: [{ name: 'title', label: 'Project name', value: project.title, required: true }], confirm: 'Save', extra: 'Delete project' });
    if (!values) return;
    if (!values.extra) {
      if (values.title === project.title) return;
      const { error } = await sb.from('projects').update({ title: values.title }).eq('id', project.id);
      if (error) return toast(friendlyError(error), 'error');
      return route();
    }
    const sure = await dialog({ title: 'Delete this project?', body: `Every video, take, and note in <b>${esc(project.title)}</b> will be deleted for everyone. This can’t be undone.`, confirm: 'Delete project', danger: true });
    if (!sure) return;
    const { error } = await sb.from('projects').delete().eq('id', project.id);
    if (error) return toast(friendlyError(error), 'error');
    toast('Project deleted.');
    return navigate('/app');
  }
  const leave = await dialog({ title: 'Leave this project?', body: 'You’ll lose access to its videos and notes. Ask for a new invite link to come back.', confirm: 'Leave project', danger: true });
  if (!leave) return;
  const { error } = await sb.from('project_members').delete().eq('project_id', project.id).eq('user_id', state.session.user.id);
  if (error) return toast(friendlyError(error), 'error');
  navigate('/app');
}

// ---------- Joining with an invite link ----------
async function renderJoin(code) {
  renderChrome();
  const { data, error } = await sb.rpc('invite_preview', { p_code: code });
  if (error) throw error;
  const invite = data?.[0];
  if (!invite || !invite.valid) {
    view.innerHTML = `<section class="auth"><div class="auth-card center"><div class="inbox-icon">⌛</div><h1>This invite has expired</h1><p class="muted">Ask the project owner for a new link.</p><a class="btn wide" href="/app" data-link>Go to Looproom</a></div></section>`;
    return;
  }
  const signedIn = Boolean(state.session);
  view.innerHTML = `<section class="auth"><div class="auth-card center">
    <div class="card-mark big">${esc(initials(invite.project_title))}</div>
    <p class="eyebrow">You’re invited to</p><h1>${esc(invite.project_title)}</h1>
    <p class="muted">${invite.member_count} ${Number(invite.member_count) === 1 ? 'person is' : 'people are'} already here, giving each other feedback on rehearsals.</p>
    ${signedIn
      ? `<button class="btn primary wide" data-accept>Join project</button>`
      : `<a class="btn primary wide" href="/app/login?mode=signup&next=${encodeURIComponent(`/app/join/${code}`)}" data-link>Sign up to join</a><a class="btn ghost wide" href="/app/login?next=${encodeURIComponent(`/app/join/${code}`)}" data-link>I already have an account</a>`}
  </div></section>`;
  $('[data-accept]')?.addEventListener('click', async () => {
    if (!state.profile) return renderName();
    const { data: projectId, error: joinErr } = await sb.rpc('accept_invite', { p_code: code });
    if (joinErr) return toast(friendlyError(joinErr), 'error');
    toast(`Welcome to ${invite.project_title}.`);
    navigate(`/app/p/${projectId}`);
  });
}

// ---------- Session ----------
async function loadProfile() {
  if (!state.session) { state.profile = null; return; }
  const user = state.session.user;
  let { data } = await sb.from('profiles').select('id, display_name').eq('id', user.id).maybeSingle();
  // A name typed at sign-up travels in the magic link; save it the first time we see this person.
  const pending = user.user_metadata?.display_name;
  if (!data && pending) ({ data } = await sb.from('profiles').insert({ id: user.id, display_name: String(pending).slice(0, 60) }).select().single());
  state.profile = data || null;
}

let booted = false;
sb.auth.onAuthStateChange((event, session) => {
  // Supabase callbacks must stay synchronous; do the follow-up work on the next tick.
  const changed = (session?.user.id || null) !== (state.session?.user.id || null);
  state.session = session;
  if (booted && changed && (event === 'SIGNED_IN' || event === 'SIGNED_OUT')) setTimeout(async () => { await loadProfile(); route(); }, 0);
});

(async () => {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  await loadProfile();
  // Tidy the URL after a magic-link or Google redirect.
  if (location.hash.includes('access_token') || new URLSearchParams(location.search).has('code')) history.replaceState({}, '', location.pathname);
  if (state.session && state.profile && location.pathname.startsWith('/app/login')) {
    history.replaceState({}, '', safeNext(new URLSearchParams(location.search).get('next')));
  }
  booted = true;
  route();
})();
