import { cols, detectSchema } from './client.js';
import { sb, $, $$, esc, initials, timeAgo, toast, friendlyError, dialog, actionSheet, withUploadBar, loadMembers, GOOGLE_ENABLED, avatar, projectMark, rememberPhotos } from './client.js';
import { uploadTake, checkTakeFile } from './upload.js';
import { mountReview } from './review.js';
import { ctx } from './ctx.js';
import { startTranslating, isKo } from './i18n.js';
import { renderWelcome, markSeen } from './onboarding.js';
import { openHelp } from './help.js';
import { rememberSource, signupSource } from './source.js';
import { startMonitoring, setMonitoredUser } from './monitor.js';
import { renderDeleteAccount } from './views/delete-account.js';
import { renderTrash } from './views/trash.js';
import { renderHome } from './views/home.js';
import { renderInbox } from './views/inbox.js';
import { renderFeedback } from './views/feedback.js';
import { renderPeople, renderPerson } from './views/people.js';
import { renderInsights } from './views/insights.js';
import { renderSettings } from './views/settings.js';
import { renderProjectRecaps, renderRecap, renderMyRecaps } from './views/recaps.js';
import { renderProjectRequests, renderRequest, newRequest } from './views/requests.js';
import { renderQueue, unseenVideos } from './views/queue.js';
import { hasTeammates, noSample } from './views/shared.js';
import { renderCalendar, editEvent } from './views/calendar.js';
import { openSearch } from './views/search.js';
import { renderShared } from './views/share.js';
import { renderProjectPages, renderPage } from './views/pages.js';
import { renderProjectOverview, renderCountSheet } from './views/overview.js';
import { newRecap } from './views/recaps.js';
import { renderProjects, createProject, renderProject, renderProjectNotes, renderProjectPeople, renderProjectSettings, createVideo, showInvite } from './views/project.js';

const view = $('[data-view]');
const state = { session: null, profile: null, cleanup: null, authError: null, recovering: false, projects: [] };

// ---------- Routing ----------
const routes = [
  { re: /^\/app\/login\/?$/, render: renderLogin, open: true },
  // Used by the landing page's Log out link.
  { re: /^\/app\/logout\/?$/, render: async () => { await sb.auth.signOut(); location.replace('/'); }, open: true },
  { re: /^\/app\/reset\/?$/, render: renderReset, open: true },
  { re: /^\/app\/join\/([a-f0-9]{6,64})\/?$/, render: renderJoin, open: true },
  { re: /^\/app\/s\/([0-9a-f]{36})\/?$/, render: renderShared, open: true },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/v\/([0-9a-f-]{36})\/?$/, render: (projectId, videoId) => mountReview({ projectId, videoId, me: state.session.user, view, navigate, setCrumbs }) },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/?$/, render: renderProject },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/notes\/?$/, render: renderProjectNotes },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/people\/?$/, render: renderProjectPeople },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/recaps\/?$/, render: renderProjectRecaps },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/overview\/?$/, render: renderProjectOverview },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/counts\/?$/, render: renderCountSheet },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/pages\/?$/, render: renderProjectPages },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/pages\/([0-9a-f-]{36})\/?$/, render: renderPage },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/requests\/?$/, render: renderProjectRequests },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/requests\/([0-9a-f-]{36})\/?$/, render: renderRequest },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/calendar\/?$/, render: (id) => renderCalendar(id) },
  { re: /^\/app\/welcome\/?$/, render: renderWelcome },
  { re: /^\/app\/trash\/?$/, render: renderTrash },
  { re: /^\/app\/account\/delete\/?$/, render: renderDeleteAccount },
  { re: /^\/app\/queue\/?$/, render: renderQueue },
  { re: /^\/app\/calendar\/?$/, render: () => renderCalendar(null) },
  { re: /^\/app\/recaps\/([0-9a-f-]{36})\/?$/, render: renderRecap },
  { re: /^\/app\/me\/recaps\/?$/, render: renderMyRecaps },
  { re: /^\/app\/p\/([0-9a-f-]{36})\/settings\/?$/, render: renderProjectSettings },
  { re: /^\/app\/projects\/?$/, render: renderProjects },
  { re: /^\/app\/inbox\/?$/, render: renderInbox },
  { re: /^\/app\/feedback\/?$/, render: renderFeedback },
  { re: /^\/app\/people\/?$/, render: renderPeople },
  { re: /^\/app\/people\/([0-9a-f-]{36})\/?$/, render: renderPerson },
  { re: /^\/app\/insights\/?$/, render: renderInsights },
  { re: /^\/app\/settings(?:\/([a-z]+))?\/?$/, render: (section) => renderSettings(section) },
  { re: /^\/app\/me\/?$/, render: renderMe },
  { re: /^\/app\/?$/, render: renderHome }
];

export function navigate(path, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  route();
}
window.addEventListener('popstate', route);
// A person's name or photo inside a row that's itself a link (see personLink): open their profile, not the row.
const openPerson = (event) => {
  const el = event.target.closest('[data-person]');
  if (!el) return false;
  event.preventDefault();
  event.stopPropagation();
  navigate(`/app/people/${el.dataset.person}`);
  return true;
};
document.addEventListener('click', openPerson, true);
document.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target.matches?.('[data-person]')) openPerson(event); }, true);
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  navigate(link.getAttribute('href'));
});
// Next-step buttons on empty pages (Upload a video, Invite your team).
document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-start-action]');
  if (el) startAction(el.dataset.startAction);
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
  // Views that list projects wait on this; the sidebar repaints when it lands.
  state.projectsReady = refreshNav();
  if (state.profile) refreshUnread();
  view.innerHTML = '<div class="loading">Loading…</div>';
  try {
    state.cleanup = (await match.r.render(...match.m.slice(1))) || null;
    // Phones: keep the current tab in view when a tab row scrolls sideways.
    document.querySelector('.tabs a[aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  } catch (error) {
    view.innerHTML = `<div class="empty"><h2>Couldn’t load this page</h2><p>${esc(friendlyError(error))}</p><a class="btn" href="/app" data-link>Back to Home</a></div>`;
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
  $('[data-bell]').hidden = !signedIn;
  if (signedIn) {
    $('[data-account-initials]').innerHTML = state.profile.avatar_url ? `<img src="${esc(state.profile.avatar_url)}" alt="" />` : esc(initials(state.profile.display_name));
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
  const under = (prefix) => path === prefix || path.startsWith(`${prefix}/`);
  const current = {
    home: path === '/app',
    inbox: under('/app/inbox'),
    feedback: under('/app/feedback'),
    people: under('/app/people'),
    insights: under('/app/insights'),
    queue: under('/app/queue'),
    calendar: under('/app/calendar'),
    settings: under('/app/settings') || path === '/app/reset',
    trash: under('/app/trash'),
    'all-projects': path === '/app/projects',
    projects: path === '/app/projects' || Boolean(projectId),
    // Places only reachable from Me on a phone keep the Me tab lit.
    me: ['/app/me', '/app/inbox', '/app/queue', '/app/calendar', '/app/people', '/app/insights', '/app/settings', '/app/reset', '/app/trash'].some(under)
  };
  $$('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', Boolean(current[a.dataset.nav])));
  // Real projects up top; the sample sits apart, under its own label, so it never reads as real work.
  const link = (p) => `<a href="/app/p/${p.id}" data-link ${p.id === projectId ? 'aria-current="page"' : ''}>${projectMark(p, 'xs')}<span>${esc(p.title)}</span>${p.is_sample ? '<em class="side-tag">Sample</em>' : ''}</a>`;
  const real = state.projects.filter((p) => !p.is_sample);
  const sample = state.projects.find((p) => p.is_sample);
  $('[data-side-projects]').innerHTML = real.length ? real.map(link).join('') : '<p class="side-empty">No projects yet</p>';
  const side = $('[data-side-sample]');
  side.hidden = !sample;
  side.innerHTML = sample ? `<p class="side-label small">Try it out</p><nav class="side-projects">${link(sample)}</nav>` : '';
  paintSampleBar(sample && sample.id === projectId ? sample : null);
}

// Inside the sample, every screen says so — and offers the way out.
function paintSampleBar(sample) {
  const bar = $('[data-sample-bar]');
  document.body.classList.toggle('in-sample', Boolean(sample));
  bar.hidden = !sample;
  if (!sample) { bar.innerHTML = ''; return; }
  window.dispatchEvent(new CustomEvent('sample-visit'));
  const hasOwn = state.projects.some((p) => !p.is_sample);
  // The next real step: make a project, then put a video in it, then just get back to it.
  const graduated = Boolean(state.profile?.onboarding?.seen?.sample_graduated);
  const [cta, next] = !hasOwn ? ['Start my own project', 'project'] : graduated ? ['Go to my projects', 'projects'] : ['Upload a video of my own', 'upload'];
  bar.innerHTML = `<span class="sample-dot" aria-hidden="true">✦</span>
    <p><b>You’re in the sample project.</b> <span>Only you can see it. Try anything — nothing here reaches anyone, and it stays out of Home, Feedback, and your calendar.</span></p>
    <span class="sample-actions"><button class="btn small primary" data-sample-own="${next}">${cta}</button><a class="btn small ghost" href="/app" data-link>Exit sample</a></span>`;
}

// Unread count for the Inbox badge (sidebar) and the bell (phones). Kept live by a realtime channel.
let inboxChannel = null;
async function refreshUnread() {
  if (!state.session) return;
  const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  $$('[data-unread]').forEach((b) => { b.hidden = !count; b.textContent = count > 99 ? '99+' : String(count || ''); });
  if (!inboxChannel) {
    const uid = state.session.user.id;
    inboxChannel = sb.channel(`inbox:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, () => refreshUnread())
      .subscribe();
  }
}

// Shortcuts from Home's getting-started list.
async function startAction(kind) {
  if (kind === 'project') return createProject();
  if (kind === 'video') return newVideo();
  if (kind === 'invite') {
    const real = state.projects.filter((p) => !p.is_sample);
    if (!real.length) { toast('Invites are per project. Create one first.'); return createProject(); }
    const project = real.find((p) => p.id === currentProjectId()) || real[0];
    return showInvite(project.id, project.title);
  }
}

// The project list behind the sidebar and the New menu.
async function refreshNav() {
  if (!state.session) return;
  const { data } = await sb.from('projects').select(cols('id, title, image_url, is_sample, created_by, created_at')).order('created_at', { ascending: false });
  if (!data) return;
  state.projects = data;
  if (state.profile) { paintNav(); paintNavDots(); }
}

// A dot on a sidebar place someone saw while it was empty, once something has landed there.
// Opening the place clears it for good. Checked at most once a minute.
const NAV_DOTS = {
  queue: async () => (await unseenVideos()).length > 0,
  feedback: async () => Boolean((await noSample(sb.from('notes').select('id')).neq('author_id', state.session.user.id).limit(1)).data?.length),
  people: () => hasTeammates(),
  insights: async () => Boolean((await noSample(sb.from('notes').select('id')).limit(1)).data?.length)
};
const dotsOn = new Set();
let dotsCheckedAt = 0;
async function paintNavDots() {
  const seen = state.profile?.onboarding?.seen || {};
  const here = (k) => location.pathname.startsWith(`/app/${k}`);
  const pending = Object.keys(NAV_DOTS).filter((k) => seen[`nav_watch_${k}`] && !seen[`nav_new_${k}`]);
  const clear = (k) => { dotsOn.delete(k); markSeen(`nav_new_${k}`); };
  for (const k of pending) if (dotsOn.has(k) && here(k)) clear(k);
  if (pending.length && Date.now() - dotsCheckedAt > 60e3) {
    dotsCheckedAt = Date.now();
    const found = await Promise.all(pending.map((k) => NAV_DOTS[k]().catch(() => false)));
    pending.forEach((k, i) => { if (found[i]) here(k) ? clear(k) : dotsOn.add(k); });
  }
  $$('.side-nav [data-nav]').forEach((a) => {
    const on = dotsOn.has(a.dataset.nav);
    a.classList.toggle('has-new', on);
    if (on && !a.querySelector('.nav-dot')) a.insertAdjacentHTML('beforeend', '<span class="nav-dot"><span class="sr-only">New</span></span>');
    if (!on) a.querySelector('.nav-dot')?.remove();
  });
}

async function openNew() {
  const projectId = currentProjectId();
  const project = state.projects.find((p) => p.id === projectId);
  // Outside a project, the pickers offer real projects only.
  const real = state.projects.filter((p) => !p.is_sample);
  const actions = [
    { value: 'video', label: 'Upload a video', hint: project ? `To ${project.title}` : 'A rehearsal or run-through' },
    { value: 'request', label: 'Request a video', hint: project ? `From people in ${project.title}, by a date` : 'Ask people for a video by a date' },
    { value: 'event', label: 'Add to calendar', hint: 'A rehearsal or a show' },
    ...(project && !project.is_sample ? [{ value: 'invite', label: 'Invite people', hint: `To ${project.title}` }] : []),
    { value: 'project', label: 'New project', hint: 'A showcase, competition, or weekly practice' }
  ];
  const choice = await actionSheet({ title: 'Create', actions });
  if (choice === 'project') return createProject();
  if (choice === 'invite') return showInvite(project.id, project.title);
  if (choice === 'event') return editEvent({ projectId: project?.id || null });
  if (choice === 'request') {
    const target = project || (real.length === 1 ? real[0] : null);
    if (target) return newRequest(target.id);
    if (!real.length) { toast('Requests belong to a project. Create one first.'); return createProject(); }
    const values = await dialog({ title: 'Request in which project?', fields: [{ name: 'project', label: 'Project', type: 'select', options: real.map((p) => ({ value: p.id, label: p.title })) }], confirm: 'Next' });
    if (values?.project) newRequest(values.project);
    return;
  }
  if (choice === 'video') newVideo(project);
}

async function newVideo(project = null) {
  if (project) return createVideo(project.id);
  const real = state.projects.filter((p) => !p.is_sample);
  if (!real.length) {
    toast('Videos live in a project. Create one first.');
    return createProject();
  }
  if (real.length === 1) return createVideo(real[0].id);
  const values = await dialog({ title: 'Upload to which project?', fields: [{ name: 'project', label: 'Project', type: 'select', options: real.map((p) => ({ value: p.id, label: p.title })) }], confirm: 'Next' });
  if (values?.project) createVideo(values.project);
}
$$('[data-new]').forEach((b) => b.addEventListener('click', openNew));
$$('[data-search]').forEach((b) => b.addEventListener('click', openSearch));
if (/Mac|iPhone|iPad/.test(navigator.platform)) $$('[data-kbd]').forEach((k) => { k.textContent = '⌘K'; });

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
  if (inboxChannel) { sb.removeChannel(inboxChannel); inboxChannel = null; }
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
// The version of the Terms and Privacy Policy people agree to at sign-up (their effective date).
const TERMS_VERSION = '2026-10-25';
// Google's own "G" mark (their branding rules ask for it on sign-in buttons).
const GOOGLE_G = '<svg class="g" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
// Signing up (with email or Google) is the agreement: this line sits under every way in.
const legalLine = () => isKo
  ? '계속하면 만 14세 이상이며 <a href="/terms" target="_blank" rel="noopener">이용약관</a>과 <a href="/privacy" target="_blank" rel="noopener">개인정보 처리방침</a>에 동의하는 것으로 봐요.'
  : 'By continuing, you confirm you’re 14 or older and agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.';
// Only ever send people back inside the app after signing in.
const safeNext = (next) => (next && /^\/app(\/|$|\?)/.test(next) && !next.startsWith('//') ? next : '/app');

function renderLogin() {
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get('next'));
  const joining = next.startsWith('/app/join/'); // arrived from an invite link
  if (state.session && state.recovering) return navigate('/app/reset', { replace: true });
  if (state.session && state.profile) return navigate(next, { replace: true });
  if (state.session) return renderName();
  let mode = params.get('mode') === 'signup' ? 'signup' : 'login';
  // Shown once: an error that came back from an email link or Google (captured at startup).
  let notice = state.authError ? friendlyError({ message: state.authError }) : null;
  state.authError = null;
  // Right after an account is deleted (the sign-out can draw this screen more than once, so it's time-based).
  const farewell = (state.farewellUntil || 0) > Date.now();
  renderChrome();
  const paint = (email = params.get('email') || '') => {
    const signup = mode === 'signup';
    view.innerHTML = `<section class="auth">
      <div class="auth-card">
        <a class="auth-brand" href="/" aria-label="dancerly home"><img class="brand-logo" src="/logo-wordmark.png" alt="dancerly" width="542" height="128" /></a>
        <div class="seg" role="tablist"><button role="tab" type="button" data-mode="signup" aria-selected="${signup}">Sign up</button><button role="tab" type="button" data-mode="login" aria-selected="${!signup}">Log in</button></div>
        <h1>${joining ? (signup ? 'Join your team on dancerly' : 'Log in to join your team') : signup ? 'Start your team’s space' : 'Welcome back'}</h1>
        <p class="muted">${joining ? (signup ? 'Create your account and you’re in. We’ll confirm your email once.' : 'You’ll go straight into the project.') : signup ? 'Free for your first team. No credit card. We’ll confirm your email once.' : 'Log in with your email and password.'}</p>
        ${farewell ? '<p class="form-note" role="status">Your account has been deleted. Thanks for rehearsing with us.</p>' : ''}
        ${notice ? `<p class="form-error" role="alert">${esc(notice)}</p>` : ''}
        ${GOOGLE_ENABLED ? `<button type="button" class="btn google" data-google>${GOOGLE_G} Continue with Google</button><div class="or"><span>or with email</span></div>` : ''}
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
        <p class="fine auth-legal" data-no-i18n>${legalLine()}</p>
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
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${next}`, data: { display_name: name, ...signupSource(), terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString(), age_confirmed: '14+' } } });
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
    <p class="muted">We’ll email you a code to set a new one. Also works if you joined before dancerly had passwords.</p>
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
  const meta = state.session.user.user_metadata || {};
  const suggested = meta.full_name || meta.name || '';
  const unsigned = !meta.terms_version; // signed up with Google, not the email form
  view.innerHTML = `<section class="auth"><form class="auth-card" data-name-form>
    <h1>What should your team call you?</h1>
    <p class="muted">This name appears on your notes and in @mentions.</p>
    <label class="field"><span>Your name</span><input name="name" maxlength="60" required value="${esc(suggested)}" placeholder="Maya Chen" /></label>
    <button class="btn primary wide" type="submit">Continue</button>
    ${unsigned ? `<p class="fine auth-legal" data-no-i18n>${legalLine()}</p>` : ''}
  </form></section>`;
  $('[data-name-form] input').focus();
  $('[data-name-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = event.currentTarget.name.value.trim();
    if (!name) return;
    const { data, error } = await sb.from('profiles').insert({ id: state.session.user.id, display_name: name }).select().single();
    if (error) return toast(friendlyError(error), 'error');
    state.profile = data;
    if (unsigned) sb.auth.updateUser({ data: { ...signupSource(), terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString(), age_confirmed: '14+' } });
    route();
  });
}

// Phones: the Me tab is the hub for everything the sidebar holds beyond the tabs.
function renderMe() {
  setCrumbs([['Me']]);
  const user = state.session.user;
  const row = (href, label, extra = '') => `<a href="${href}" data-link><span>${label}</span>${extra}<i>›</i></a>`;
  view.innerHTML = `<section class="page narrow">
    <div class="me-card">
      ${avatar(state.profile.display_name, state.session.user.id, 'xl')}
      <div><h1>${esc(state.profile.display_name)}</h1><p class="muted">${esc(user.email || '')}</p></div>
    </div>
    <div class="list-group">
      ${row('/app/inbox', 'Inbox', '<span class="badge" data-unread hidden></span>')}
      ${row('/app/queue', 'Review queue')}
      ${row('/app/calendar', 'Calendar')}
      ${row('/app/me/recaps', '✦ My recaps')}
      ${row(`/app/people/${user.id}`, 'My activity')}
    </div>
    <div class="list-group">
      ${row('/app/people', 'People')}
      ${row('/app/insights', 'Insights')}
    </div>
    <div class="list-group">
      ${row('/app/settings/account', 'Account')}
      ${row('/app/settings/notifications', 'Notifications')}
      ${row('/app/settings/plan', 'Plan', '<small>Free</small>')}
      ${row('/app/trash', 'Trash')}
    </div>
    <div class="list-group">
      <a href="#help" data-help><span>Help &amp; support</span><i>›</i></a>
    </div>
    <div class="list-group">
      <button data-me-signout class="danger-text"><span>Log out</span></button>
    </div>
    <p class="me-delete"><a href="/app/account/delete" data-link>Delete account</a></p>
  </section>`;
  $('[data-me-signout]').addEventListener('click', signOut);
  refreshUnread();
}

// ---------- Joining with an invite link ----------
async function renderJoin(code) {
  renderChrome();
  const { data, error } = await sb.rpc('invite_preview', { p_code: code });
  if (error) throw error;
  const invite = data?.[0];
  if (!invite || !invite.valid) {
    view.innerHTML = `<section class="auth"><div class="auth-card center"><div class="inbox-icon">⌛</div><h1>This invite has expired</h1><p class="muted">Ask the project owner for a new link.</p><a class="btn wide" href="/app" data-link>Go to dancerly</a></div></section>`;
    return;
  }
  const signedIn = Boolean(state.session);
  // Coming back from signing up or in for this invite: join straight away instead of asking again.
  const auto = new URLSearchParams(location.search).get('auto') === '1';
  const back = `/app/join/${code}?auto=1`;
  const join = async () => {
    if (!state.profile) return renderName();
    const { data: projectId, error: joinErr } = await sb.rpc('accept_invite', { p_code: code });
    if (joinErr) return toast(friendlyError(joinErr), 'error');
    // The project page greets them with what to do first.
    state.justJoined = projectId;
    navigate(`/app/p/${projectId}`, { replace: true });
  };
  if (signedIn && auto) {
    view.innerHTML = `<section class="auth"><div class="auth-card center"><div class="card-mark big">${esc(initials(invite.project_title))}</div><h1>Joining ${esc(invite.project_title)}…</h1></div></section>`;
    return join();
  }
  view.innerHTML = `<section class="auth"><div class="auth-card center">
    <div class="card-mark big">${esc(initials(invite.project_title))}</div>
    <p class="eyebrow">You’re invited to</p><h1>${esc(invite.project_title)}</h1>
    <p class="muted">${invite.member_count} ${Number(invite.member_count) === 1 ? 'person is' : 'people are'} already here, giving each other feedback on rehearsals.</p>
    ${signedIn
      ? '<button class="btn primary wide" data-accept>Join project</button>'
      : `${GOOGLE_ENABLED ? `<button type="button" class="btn google wide" data-join-google>${GOOGLE_G} Continue with Google</button>` : ''}
        <a class="btn ${GOOGLE_ENABLED ? '' : 'primary '}wide" href="/app/login?mode=signup&next=${encodeURIComponent(back)}" data-link>Sign up with email</a>
        <a class="btn ghost wide" href="/app/login?next=${encodeURIComponent(back)}" data-link>I already have an account</a>
        <p class="fine auth-legal" data-no-i18n>${legalLine()}</p>`}
  </div></section>`;
  $('[data-accept]')?.addEventListener('click', join);
  $('[data-join-google]')?.addEventListener('click', async () => {
    const { error: gErr } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${back}` } });
    if (gErr) toast(friendlyError(gErr), 'error');
  });
}

// ---------- Session ----------
async function loadProfile() {
  if (!state.session) { state.profile = null; return; }
  const user = state.session.user;
  let { data } = await sb.from('profiles').select(cols('id, display_name, avatar_url, onboarding')).eq('id', user.id).maybeSingle();
  // A name typed at sign-up travels in the magic link; save it the first time we see this person.
  const pending = user.user_metadata?.display_name;
  if (!data && pending) ({ data } = await sb.from('profiles').insert({ id: user.id, display_name: String(pending).slice(0, 60) }).select().single());
  state.profile = data || null;
  if (data) rememberPhotos([data]);
  if (data) saveTimezone(user.id);
}

// Email follow-ups keep quiet hours in each person's own time zone. Saved once per browser and account.
function saveTimezone(userId) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const key = `looproom:tz:${userId}`;
  try { if (!tz || localStorage.getItem(key) === tz) return; } catch { return; }
  sb.from('notification_settings').upsert({ user_id: userId, timezone: tz }, { onConflict: 'user_id' })
    .then(({ error }) => { if (!error) try { localStorage.setItem(key, tz); } catch {} });
}

// What the ⌘K palette can do besides searching.
ctx.commands = [
  { label: 'Upload a video', hint: 'New video or take', run: () => newVideo(state.projects.find((p) => p.id === currentProjectId()) || null) },
  { label: 'Request a video', hint: 'Ask people for a video by a date', run: () => (currentProjectId() ? newRequest(currentProjectId()) : openNew()) },
  { label: 'New recap', hint: 'Summary by AI', run: () => newRecap({ projectId: currentProjectId() }) },
  { label: 'Add to calendar', hint: 'Rehearsal or show', run: () => editEvent({ projectId: currentProjectId() }) },
  { label: 'New project', run: () => createProject() },
  { label: 'Go to Inbox', run: () => navigate('/app/inbox') },
  { label: 'Go to Review queue', run: () => navigate('/app/queue') },
  { label: 'Go to Feedback', run: () => navigate('/app/feedback') },
  { label: 'Go to Calendar', run: () => navigate('/app/calendar') },
  { label: 'Go to Insights', run: () => navigate('/app/insights') },
  { label: 'Go to Settings', run: () => navigate('/app/settings') },
  { label: 'Send feedback', hint: 'A bug, an idea, or a question', run: () => openHelp({ kind: 'idea' }) },
  { label: 'Get help', hint: 'Email us or read the FAQ', run: () => openHelp({ kind: 'question' }) }
];

Object.assign(ctx, { state, view, navigate, setCrumbs, refreshNav, refreshUnread, startAction, route, signOut, sampleBar: paintSampleBar });

rememberSource(); // credit a later signup to the link that brought them here
startMonitoring();

let booted = false;
sb.auth.onAuthStateChange((event, session) => {
  // Supabase callbacks must stay synchronous; do the follow-up work on the next tick.
  // A password-reset link signs you in just long enough to choose a new password.
  if (event === 'PASSWORD_RECOVERY') state.recovering = true;
  const changed = (session?.user.id || null) !== (state.session?.user.id || null);
  state.session = session;
  setMonitoredUser(session?.user.id);
  if (booted && changed && (event === 'SIGNED_IN' || event === 'SIGNED_OUT')) setTimeout(async () => { await loadProfile(); route(); }, 0);
});

startTranslating();
(async () => {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  setMonitoredUser(data.session?.user.id);
  await detectSchema();
  await loadProfile();
  // A failed magic link or Google sign-in lands here with the reason in the URL; keep it for the login page.
  const hashParams = new URLSearchParams(location.hash.slice(1));
  const search = new URLSearchParams(location.search);
  state.authError = hashParams.get('error_description') || search.get('error_description');
  if (hashParams.get('type') === 'recovery') state.recovering = true;
  // Tidy the URL after a magic-link or Google redirect.
  if (location.hash.includes('access_token') || state.authError || search.has('code')) history.replaceState({}, '', location.pathname + (search.get('auto') === '1' ? '?auto=1' : ''));
  if (state.session && state.profile && location.pathname.startsWith('/app/login')) {
    history.replaceState({}, '', safeNext(new URLSearchParams(location.search).get('next')));
  }
  booted = true;
  route();
})();
