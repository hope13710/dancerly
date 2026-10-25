import { sb, $, $$, esc, initials, timeAgo, toast, friendlyError, dialog, actionSheet, uploadTake, withUploadBar, checkTakeFile, loadMembers, GOOGLE_ENABLED } from './client.js';
import { mountReview } from './review.js';

const view = $('[data-view]');
const state = { session: null, profile: null, cleanup: null, authError: null, recovering: false, projects: [] };

// ---------- Routing ----------
const routes = [
  { re: /^\/app\/login\/?$/, render: renderLogin, open: true },
  { re: /^\/app\/reset\/?$/, render: renderReset, open: true },
  { re: /^\/app\/join\/([a-f0-9]{6,64})\/?$/, render: renderJoin, open: true },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/v\/([0-9a-f-]{36})\/?$/, render: (projectId, videoId) => mountReview({ projectId, videoId, me: state.session.user, view, navigate, setCrumbs }) },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/?$/, render: renderProject },
  { re: /^\/app\/me\/?$/, render: renderMe },
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
  refreshNav();
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
  // On phones the breadcrumb is hidden; a back link to the nearest parent takes its place.
  const parent = [...items].reverse().find(([, href]) => href);
  const back = $('[data-back]');
  back.hidden = !parent;
  if (parent) { back.href = parent[1]; back.textContent = `← ${parent[0]}`; }
}
// Signed in: a sidebar on wide screens, a tab bar on phones. Both reach the same places and actions.
function renderChrome() {
  const signedIn = Boolean(state.session && state.profile);
  document.body.classList.toggle('signed-in', signedIn);
  // Detail screens (the review) get the whole phone screen; the back link leads out.
  document.body.classList.toggle('is-review', /\/v\//.test(location.pathname));
  $('[data-sidebar]').hidden = !signedIn;
  $('[data-tabbar]').hidden = !signedIn;
  if (signedIn) {
    $('[data-account-initials]').textContent = initials(state.profile.display_name);
    $('[data-account-name]').textContent = state.profile.display_name;
    $('[data-account-email]').textContent = state.session.user.email || '';
    paintNav();
  }
  setCrumbs([]);
}

function currentProjectId() {
  return location.pathname.match(/^\/app\/p\/([0-9a-f-]{36})/)?.[1] || null;
}

function paintNav() {
  const path = location.pathname.replace(/\/$/, '');
  const projectId = currentProjectId();
  const current = { home: path === '/app', projects: path === '/app' || Boolean(projectId), me: path === '/app/me' || path === '/app/reset' };
  $$('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', Boolean(current[a.dataset.nav])));
  $('[data-side-projects]').innerHTML = state.projects.length
    ? state.projects.map((p) => `<a href="/app/p/${p.id}" data-link ${p.id === projectId ? 'aria-current="page"' : ''}><span class="card-mark xs">${esc(initials(p.title))}</span><span>${esc(p.title)}</span></a>`).join('')
    : '<p class="side-empty">No projects yet</p>';
}

// The project list behind the sidebar and the New menu.
async function refreshNav() {
  if (!state.session) return;
  const { data } = await sb.from('projects').select('id, title').order('created_at', { ascending: false });
  if (!data) return;
  state.projects = data;
  if (state.profile) paintNav();
}

async function openNew() {
  const projectId = currentProjectId();
  const project = state.projects.find((p) => p.id === projectId);
  const actions = [
    { value: 'video', label: 'Upload a video', hint: project ? `To ${project.title}` : 'A rehearsal or run-through' },
    ...(project ? [{ value: 'invite', label: 'Invite people', hint: `To ${project.title}` }] : []),
    { value: 'project', label: 'New project', hint: 'A showcase, competition, or weekly practice' }
  ];
  const choice = await actionSheet({ title: 'Create', actions });
  if (choice === 'project') return createProject();
  if (choice === 'invite') return showInvite(project.id, project.title);
  if (choice !== 'video') return;
  if (project) return createVideo(project.id);
  if (!state.projects.length) {
    toast('Videos live in a project. Create one first.');
    return createProject();
  }
  if (state.projects.length === 1) return createVideo(state.projects[0].id);
  const values = await dialog({ title: 'Upload to which project?', fields: [{ name: 'project', label: 'Project', type: 'select', options: state.projects.map((p) => ({ value: p.id, label: p.title })) }], confirm: 'Next' });
  if (values?.project) createVideo(values.project);
}
$$('[data-new]').forEach((b) => b.addEventListener('click', openNew));

// Wide screens can tuck the sidebar away; remembered per browser.
try { document.body.classList.toggle('side-hidden', localStorage.getItem('looproom:side') === 'hidden'); } catch {}
$$('[data-side-toggle]').forEach((b) => b.addEventListener('click', () => {
  const hidden = document.body.classList.toggle('side-hidden');
  try { localStorage.setItem('looproom:side', hidden ? 'hidden' : 'shown'); } catch {}
}));
$('[data-account-toggle]').addEventListener('click', () => $('[data-account-menu]').toggleAttribute('hidden'));
document.addEventListener('click', (event) => { if (!event.target.closest('[data-account]')) $('[data-account-menu]').hidden = true; });
$('[data-signout]').addEventListener('click', signOut);
async function signOut() {
  await sb.auth.signOut();
  state.session = null;
  state.profile = null;
  state.projects = [];
  navigate('/app/login');
}
$('[data-password]').addEventListener('click', () => { $('[data-account-menu]').hidden = true; navigate('/app/reset'); });
$('[data-rename]').addEventListener('click', renameMe);
async function renameMe() {
  $('[data-account-menu]').hidden = true;
  const values = await dialog({ title: 'Your name', fields: [{ name: 'name', label: 'Shown to your team', value: state.profile.display_name, max: 60, required: true }] });
  if (!values?.name) return;
  const { error } = await sb.from('profiles').update({ display_name: values.name }).eq('id', state.session.user.id);
  if (error) return toast(friendlyError(error), 'error');
  state.profile.display_name = values.name;
  renderChrome();
  route();
}

// ---------- Sign in / sign up ----------
// Only ever send people back inside the app after signing in.
const safeNext = (next) => (next && /^\/app(\/|$|\?)/.test(next) && !next.startsWith('//') ? next : '/app');

function renderLogin() {
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get('next'));
  if (state.session && state.recovering) return navigate('/app/reset', { replace: true });
  if (state.session && state.profile) return navigate(next, { replace: true });
  if (state.session) return renderName();
  let mode = params.get('mode') === 'signup' ? 'signup' : 'login';
  // Shown once: an error that came back from an email link or Google (captured at startup).
  let notice = state.authError ? friendlyError({ message: state.authError }) : null;
  state.authError = null;
  renderChrome();
  const paint = (email = params.get('email') || '') => {
    const signup = mode === 'signup';
    view.innerHTML = `<section class="auth">
      <div class="auth-card">
        <a class="auth-brand" href="/"><span class="brand-mark"><i></i><i></i><i></i></span>looproom</a>
        <div class="seg" role="tablist"><button role="tab" type="button" data-mode="signup" aria-selected="${signup}">Sign up</button><button role="tab" type="button" data-mode="login" aria-selected="${!signup}">Log in</button></div>
        <h1>${signup ? 'Start your team’s space' : 'Welcome back'}</h1>
        <p class="muted">${signup ? 'Free for your first team. No credit card. We’ll confirm your email once.' : 'Log in with your email and password.'}</p>
        ${notice ? `<p class="form-error" role="alert">${esc(notice)}</p>` : ''}
        ${GOOGLE_ENABLED ? '<button type="button" class="btn google" data-google><span class="g">G</span> Continue with Google</button><div class="or"><span>or with email</span></div>' : ''}
        <form data-auth-form>
          ${signup ? '<label class="field"><span>Your name</span><input name="name" autocomplete="name" maxlength="60" required placeholder="Maya Chen" /></label>' : ''}
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="you@example.com" value="${esc(email)}" /></label>
          <label class="field"><span>Password${signup ? ' <small>8+ characters</small>' : ''}</span>
            <span class="password"><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="${signup ? 8 : 1}" required /><button type="button" class="reveal" data-reveal aria-label="Show password">Show</button></span>
          </label>
          ${signup ? '' : '<button type="button" class="link-btn" data-forgot>Forgot password?</button>'}
          <button class="btn primary wide" type="submit">${signup ? 'Create account' : 'Log in'}</button>
          <p class="form-error" data-form-error role="alert" hidden></p>
        </form>
        <p class="fine">By continuing you agree to the Terms and Privacy Policy.</p>
      </div>
    </section>`;
    const form = $('[data-auth-form]');
    $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; notice = null; paint(form.email.value.trim()); }));
    $('[data-reveal]').addEventListener('click', (event) => togglePassword(form.password, event.currentTarget));
    $('[data-forgot]')?.addEventListener('click', () => renderForgot(form.email.value.trim()));
    $('[data-google]')?.addEventListener('click', async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${next}` } });
      if (error) showError(friendlyError(error));
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = form.email.value.trim();
      const password = form.password.value;
      const name = form.elements.namedItem('name')?.value.trim(); // form.name is the form's own name attribute, not the field
      const button = form.querySelector('button[type="submit"]');
      const label = button.textContent;
      button.disabled = true;
      button.textContent = signup ? 'Creating…' : 'Logging in…';
      const done = (message) => { button.disabled = false; button.textContent = label; showError(message); };
      if (signup) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${next}`, data: { display_name: name } } });
        if (error) return done(friendlyError(error));
        // Supabase answers an already-registered email with an empty user instead of an error.
        if (data.user && !data.user.identities?.length) return done('That email already has an account. Log in instead — or use “Forgot password?” if you never set one.');
        if (!data.session) renderCheckInbox(email, next, 'signup');
        return; // With a session, onAuthStateChange takes over.
      }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (!error) return;
      if (/not confirmed/i.test(error.message)) {
        await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${location.origin}${next}` } });
        return renderCheckInbox(email, next, 'signup');
      }
      done(friendlyError(error));
    });
  };
  const showError = (message) => { const el = $('[data-form-error]'); el.textContent = message; el.hidden = false; };
  paint();
}

function togglePassword(input, button) {
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.textContent = show ? 'Hide' : 'Show';
  button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

function renderForgot(email = '') {
  renderChrome();
  view.innerHTML = `<section class="auth"><form class="auth-card" data-forgot-form>
    <h1>Reset your password</h1>
    <p class="muted">We’ll email you a code to set a new one. Also works if you joined before Looproom had passwords.</p>
    <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required value="${esc(email)}" placeholder="you@example.com" /></label>
    <button class="btn primary wide" type="submit">Email me a code</button>
    <p class="form-error" data-form-error role="alert" hidden></p>
    <button type="button" class="btn ghost wide" data-back-login>Back to log in</button>
  </form></section>`;
  const form = $('[data-forgot-form]');
  form.email.focus();
  $('[data-back-login]').addEventListener('click', () => renderLogin());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Sending…';
    const value = form.email.value.trim();
    const { error } = await sb.auth.resetPasswordForEmail(value, { redirectTo: `${location.origin}/app/reset` });
    if (error) {
      button.disabled = false;
      button.textContent = 'Email me a code';
      const el = $('[data-form-error]');
      el.textContent = friendlyError(error);
      el.hidden = false;
      return;
    }
    renderCheckInbox(value, '/app/reset', 'recovery');
  });
}

// One email per account lifetime (confirming sign-up), plus password resets.
function renderCheckInbox(email, next, purpose) {
  const recovery = purpose === 'recovery';
  view.innerHTML = `<section class="auth"><div class="auth-card center">
    <div class="inbox-icon">✉</div>
    <h1>${recovery ? 'Check your inbox' : 'Confirm your email'}</h1>
    <p class="muted">We sent an email to <b>${esc(email)}</b>. Type the code here — or open the link on this device.${recovery ? '' : ' You only do this once; after that, log in with your password.'}</p>
    <form class="code-form" data-code-form>
      <label class="sr-only" for="otp">Code from the email</label>
      <input id="otp" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8" placeholder="123456" required />
      <button class="btn primary" type="submit">${recovery ? 'Continue' : 'Confirm'}</button>
    </form>
    <p class="form-error" data-code-error role="alert" hidden></p>
    <p class="fine">Codes and links work once and expire after an hour. Opening the link in your mail app confirms it there, not here.</p>
    <button class="btn wide" data-resend disabled>Resend in <span data-count>60</span>s</button>
    <button class="btn ghost wide" data-other>Use a different email</button>
  </div></section>`;
  let left = 60;
  const timer = setInterval(() => {
    left -= 1;
    const b = $('[data-resend]');
    if (!b) return clearInterval(timer);
    if (left <= 0) { clearInterval(timer); b.disabled = false; b.textContent = 'Resend the email'; } else $('[data-count]').textContent = left;
  }, 1000);
  $('[data-resend]').addEventListener('click', async () => {
    const { error } = recovery
      ? await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/app/reset` })
      : await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${location.origin}${next}` } });
    toast(error ? friendlyError(error) : 'Sent again. Check spam if it’s not there.', error ? 'error' : 'info');
  });
  $('[data-other]').addEventListener('click', () => { clearInterval(timer); recovery ? renderForgot() : renderLogin(); });
  $('#otp').focus();
  $('[data-code-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Checking…';
    if (recovery) state.recovering = true;
    // Verifying here (not in the mail app's browser) is what signs you in on this device.
    const { error } = await sb.auth.verifyOtp({ email, token: event.currentTarget.code.value.trim(), type: recovery ? 'recovery' : 'signup' });
    if (error) {
      state.recovering = false;
      button.disabled = false;
      button.textContent = label;
      const el = $('[data-code-error]');
      el.textContent = friendlyError(error);
      el.hidden = false;
      return;
    }
    clearInterval(timer);
    if (recovery) navigate('/app/reset', { replace: true });
  });
  return () => clearInterval(timer);
}

function renderReset() {
  renderChrome();
  if (!state.session) {
    view.innerHTML = `<section class="auth"><div class="auth-card center">
      <h1>This reset link has expired</h1>
      <p class="muted">Each link and code works once. Ask for a new one.</p>
      <button class="btn primary wide" data-new>Send a new code</button>
    </div></section>`;
    $('[data-new]').addEventListener('click', () => renderForgot());
    return;
  }
  if (!state.recovering) setCrumbs([['Me', '/app/me'], ['Password']]);
  view.innerHTML = `<section class="auth"><form class="auth-card" data-reset-form>
    <h1>${state.recovering ? 'Set a new password' : 'Change password'}</h1>
    <p class="muted">For <b>${esc(state.session.user.email || '')}</b>. You’ll use it to log in from now on.</p>
    <label class="field"><span>New password <small>8+ characters</small></span>
      <span class="password"><input name="password" type="password" autocomplete="new-password" minlength="8" required /><button type="button" class="reveal" data-reveal aria-label="Show password">Show</button></span>
    </label>
    <button class="btn primary wide" type="submit">Save password</button>
    <p class="form-error" data-form-error role="alert" hidden></p>
  </form></section>`;
  const form = $('[data-reset-form]');
  form.password.focus();
  $('[data-reveal]').addEventListener('click', (event) => togglePassword(form.password, event.currentTarget));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Saving…';
    const { error } = await sb.auth.updateUser({ password: form.password.value });
    if (error) {
      button.disabled = false;
      button.textContent = 'Save password';
      const el = $('[data-form-error]');
      el.textContent = friendlyError(error);
      el.hidden = false;
      return;
    }
    state.recovering = false;
    toast('Password saved. Use it next time you log in.');
    navigate('/app', { replace: true });
  });
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

// Phones reach account settings from the Me tab; wide screens also have them in the sidebar.
function renderMe() {
  setCrumbs([['Me']]);
  const user = state.session.user;
  view.innerHTML = `<section class="page narrow">
    <div class="me-card">
      <span class="avatar xl">${esc(initials(state.profile.display_name))}</span>
      <div><h1>${esc(state.profile.display_name)}</h1><p class="muted">${esc(user.email || '')}</p></div>
    </div>
    <div class="list-group">
      <button data-me-rename><span>Your name</span><small>${esc(state.profile.display_name)}</small><i>›</i></button>
      <button data-me-password><span>Password</span><small>Change</small><i>›</i></button>
    </div>
    <div class="list-group">
      <button data-me-signout class="danger-text"><span>Log out</span></button>
    </div>
  </section>`;
  $('[data-me-rename]').addEventListener('click', renameMe);
  $('[data-me-password]').addEventListener('click', () => navigate('/app/reset'));
  $('[data-me-signout]').addEventListener('click', signOut);
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
        <span class="video-copy"><b>${esc(v.title)}</b><small>${takes.length > 1 ? `${takes.length} takes · latest ${timeAgo(takes[0].created_at)}` : takes.length ? `Uploaded ${timeAgo(takes[0].created_at)}` : 'No video yet'}</small></span>
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

async function createVideo(projectId) {
  const values = await dialog({
    title: 'New video',
    body: 'Re-shooting something you already uploaded? Open that video and use <b>Upload a new take</b> — its open notes come along.',
    fields: [
      { name: 'title', label: 'What is it?', placeholder: 'Full run-through', required: true },
      { name: 'file', label: 'First take', type: 'file', accept: 'video/mp4,video/quicktime,video/webm', required: true, hint: 'MP4, MOV, or WebM · up to 50 MB' }
    ],
    confirm: 'Upload'
  });
  if (!values) return;
  const problem = checkTakeFile(values.file);
  if (problem) return toast(problem, 'error');
  const { data: existing } = await sb.from('videos').select('id, title, takes(count)').eq('project_id', projectId);
  let lastViewed = null;
  try { lastViewed = localStorage.getItem(`looproom:lastVideo:${projectId}`); } catch {}
  const match = suggestStack(values.title, existing || [], lastViewed);
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
        return navigate(`/app/p/${projectId}/v/${match.id}?take=${added.number}`);
      } catch (err) {
        return toast(friendlyError(err), 'error');
      }
    }
  }
  const { data: video, error } = await sb.from('videos').insert({ project_id: projectId, title: values.title }).select('id').single();
  if (error) return toast(friendlyError(error), 'error');
  try {
    await withUploadBar(values.title, (stage) => uploadTake({ projectId, videoId: video.id, file: values.file, onStage: stage }));
    toast('Uploaded. Pause on a moment and pin your first note.');
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
  // A password-reset link signs you in just long enough to choose a new password.
  if (event === 'PASSWORD_RECOVERY') state.recovering = true;
  const changed = (session?.user.id || null) !== (state.session?.user.id || null);
  state.session = session;
  if (booted && changed && (event === 'SIGNED_IN' || event === 'SIGNED_OUT')) setTimeout(async () => { await loadProfile(); route(); }, 0);
});

(async () => {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  await loadProfile();
  // A failed magic link or Google sign-in lands here with the reason in the URL; keep it for the login page.
  const hashParams = new URLSearchParams(location.hash.slice(1));
  const search = new URLSearchParams(location.search);
  state.authError = hashParams.get('error_description') || search.get('error_description');
  if (hashParams.get('type') === 'recovery') state.recovering = true;
  // Tidy the URL after a magic-link or Google redirect.
  if (location.hash.includes('access_token') || state.authError || search.has('code')) history.replaceState({}, '', location.pathname);
  if (state.session && state.profile && location.pathname.startsWith('/app/login')) {
    history.replaceState({}, '', safeNext(new URLSearchParams(location.search).get('next')));
  }
  booted = true;
  route();
})();
