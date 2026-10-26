// First-run guidance: the leader's three-step start, the sample project, a welcome for people who were invited,
// and one-time tips. Progress lives on the profile (profiles.onboarding) so it follows people across devices.
import { sb, $, $$, esc, toast, friendlyError, dialog, schema } from './client.js';
import { ctx } from './ctx.js';
import { getLang, isKo, t } from './i18n.js';
import { inviteLink, createVideo } from './views/project.js';
import { myOpenRequests } from './views/requests.js';
import { notesForMe } from './views/shared.js';

// Product events go to the product_events table (migration 023): an event name and a few small labels, never content.
// If the table isn't there yet, or a write fails, we stop trying for this visit.
let eventsOff = false;
export const track = (event, props = {}) => {
  try { (window.dataLayer ||= []).push({ event, ...props }); } catch {}
  if (eventsOff || !ctx.state?.session) return;
  sb.from('product_events').insert({ event, props }).then(({ error }) => { if (error) eventsOff = true; }, () => { eventsOff = true; });
};

export const onboarding = () => ctx.state.profile?.onboarding || {};
export async function saveOnboarding(patch) {
  if (!schema.firstRun) return;
  const next = { ...onboarding(), ...patch };
  ctx.state.profile.onboarding = next;
  await sb.from('profiles').update({ onboarding: next }).eq('id', ctx.state.session.user.id);
}
// One-time things (tips, explanations) remembered by name.
export const seen = (key) => Boolean(onboarding().seen?.[key]);
export const markSeen = (key) => saveOnboarding({ seen: { ...(onboarding().seen || {}), [key]: true } });

// New leaders with nothing yet start here instead of an empty Home.
export const needsWelcome = () => schema.firstRun && !onboarding().welcome && !ctx.state.projects.length;

// ---------- The sample project ----------
// Who gets the sample offered, by where they are:
//   A. nothing real yet → offered on Home and on empty screens
//   B. inside the sample → the bar on top says so; nudges toward your own project
//   C. a real project, but no real video yet → still offered (Home card, empty screens)
//   D. a real video is in ("graduated") → never pushed again; it waits under "Try it out" and on Projects
//   People who were invited (no project of their own) aren't offered it: they already have a real team.
export function sampleOffer() {
  if (!schema.firstRun || seen('sample_graduated')) return false;
  const me = ctx.state.session?.user.id;
  const real = ctx.state.projects.filter((p) => !p.is_sample);
  return !real.length || real.some((p) => p.created_by === me);
}

// An empty screen shows what it will look like, rather than being filled with made-up data.
export function samplePeek(where, text = 'Preview this in the sample project') {
  if (!sampleOffer()) return '';
  // Inside the sample itself there's nothing to preview.
  if (ctx.state.projects.some((p) => p.is_sample && location.pathname.includes(p.id))) return '';
  return `<p class="sample-peek"><button type="button" class="link-btn" data-open-sample="${where}"><span aria-hidden="true">✦</span> ${esc(text)}</button></p>`;
}

// Where each "preview it" link lands inside the sample.
const SAMPLE_SPOTS = { feedback: '/notes', inbox: '/notes', notes: '/notes', calendar: '/calendar', people: '/people', requests: '/requests', recaps: '/recaps', overview: '/overview' };

export async function openSample({ from = 'unknown' } = {}) {
  if (!schema.firstRun) return toast('The sample project isn’t available yet. Try again soon.');
  const { data: projectId, error } = await sb.rpc('create_sample_project', { p_lang: getLang(), p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
  if (error) return toast(friendlyError(error), 'error');
  track('sample_opened', { from });
  await ctx.refreshNav();
  // "plan:recaps" = the recaps spot, opened from the Plan page.
  const spot = from.split(':').pop();
  if (spot === 'insights') return ctx.navigate(`/app/insights?project=${projectId}`);
  if (spot === 'recaps') {
    const { data: recap } = await sb.from('recaps').select('id').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (recap) return ctx.navigate(`/app/recaps/${recap.id}`);
  }
  if (SAMPLE_SPOTS[spot]) return ctx.navigate(`/app/p/${projectId}${SAMPLE_SPOTS[spot]}`);
  // Otherwise straight to the review: that's where the product makes sense.
  const { data: video } = await sb.from('videos').select('id').eq('project_id', projectId).order('created_at').limit(1).maybeSingle();
  ctx.navigate(video ? `/app/p/${projectId}/v/${video.id}?take=1` : `/app/p/${projectId}`);
}

async function removeSample(projectId) {
  const { error } = await sb.from('projects').delete().eq('id', projectId).eq('is_sample', true);
  if (error) { toast(friendlyError(error), 'error'); return false; }
  toast('Sample deleted.');
  track('sample_deleted');
  await ctx.refreshNav();
  return true;
}

async function deleteSample(projectId) {
  const sure = await dialog({ title: 'Delete the sample project?', body: 'Its videos, notes, and teammates go away. You can open a fresh one any time from Projects.', confirm: 'Delete sample', danger: true });
  if (sure && await removeSample(projectId)) ctx.navigate(ctx.state.projects.length ? '/app/projects' : '/app');
}

// In the sample, features that grow with the paid Team plan say what Free includes and what Team adds — honestly: nothing is limited yet.
const TEAM_NOTES = {
  recaps: 'Free includes AI recaps to try; the Team plan makes them unlimited. During early access, there’s no limit for anyone.',
  insights: 'Free includes Insights; the Team plan adds your full history. During early access, everyone sees the full history.'
};
export const teamNote = (key) => `<p class="team-note"><span class="tag team-tag" data-no-i18n>Team</span> <span>${esc(TEAM_NOTES[key])}</span> <a class="link" href="/app/settings/plan" data-link>Plans</a></p>`;

// Right after someone tries the core thing in the sample, the bar on top turns into the next step — once per moment.
const MOMENTS = {
  note: ['That’s the whole loop.', 'Pause, pin it, fix it in the next take. Your team can do this on your own videos.'],
  recap: ['This is what your team gets before each rehearsal.', 'It’s written from your own notes once there are a few.'],
  insights: ['This is Insights for the sample team.', 'Where people keep getting stuck, what got fixed, what’s waiting — yours fills in as your team leaves notes.']
};
export function sampleMoment(key) {
  const bar = $('[data-sample-bar]');
  if (!bar || bar.hidden || seen(`sample_moment:${key}`) || !MOMENTS[key]) return;
  markSeen(`sample_moment:${key}`);
  track('sample_moment', { key });
  const p = bar.querySelector('p');
  if (p) p.innerHTML = `<b>${esc(MOMENTS[key][0])}</b> <span>${esc(MOMENTS[key][1])}</span>`;
  bar.classList.add('nudge');
}

// When the sample was last opened (at most one write a day), so an unused one can be offered for cleanup.
window.addEventListener('sample-visit', () => {
  if (Date.now() - (onboarding().sample_seen_at || 0) > 864e5) saveOnboarding({ sample_seen_at: Date.now() });
});

// After graduating, a sample nobody has opened in three weeks is clutter: ask once whether to clear it.
const STALE_DAYS = 21;
export function sampleCleanupCard() {
  const sample = ctx.state.projects.find((p) => p.is_sample);
  if (!sample || !seen('sample_graduated') || seen('sample_cleanup')) return null;
  const last = Math.max(onboarding().sample_seen_at || 0, Date.parse(sample.created_at || 0) || 0);
  if (!last || Date.now() - last < STALE_DAYS * 864e5) return null;
  return {
    html: `<section class="panel home-sample sample-cleanup">
      <span class="sample-dot" aria-hidden="true">✦</span>
      <div class="grow"><h2>Clear away the sample?</h2><p class="muted">You haven’t opened it in a few weeks — your team’s real work has taken over. You can always open a fresh one from Projects.</p></div>
      <button class="btn" data-cleanup="delete">Delete sample</button>
      <button class="btn ghost small" data-cleanup="keep">Keep it</button>
    </section>`,
    wire: (root) => root.querySelectorAll('[data-cleanup]').forEach((b) => b.addEventListener('click', async () => {
      const choice = b.dataset.cleanup;
      markSeen('sample_cleanup');
      track('sample_cleanup', { to: choice });
      root.querySelector('.sample-cleanup')?.remove();
      if (choice === 'delete') await removeSample(sample.id);
    }))
  };
}

// The first video of your own is the moment the sample has done its job: say so, and offer to clear it away.
// Keeping it is the default; it moves aside to "Try it out" in the sidebar either way.
window.addEventListener('take-uploaded', (event) => {
  const sample = ctx.state.projects.find((p) => p.is_sample);
  const real = !ctx.state.projects.some((p) => p.is_sample && p.id === event.detail?.project_id);
  // Activation: the first video into a real project, whether or not they ever opened the sample.
  if (real && !seen('first_real_video')) { markSeen('first_real_video'); track('first_real_video', { tried_sample: Boolean(sample) }); }
  if (!sample || !real || seen('sample_graduated')) return;
  markSeen('sample_graduated');
  track('sample_graduated');
  setTimeout(async () => {
    const clear = await dialog({ title: 'Your first real video is in 🎉', body: 'That’s the real thing now — your team’s notes, recaps, and Insights will build on it. Delete the sample, or keep it under “Try it out” in the sidebar for later.', confirm: 'Delete sample', cancel: 'Keep it' });
    if (clear) removeSample(sample.id);
  }, 800);
});

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-open-sample], [data-delete-sample], [data-sample-own]');
  if (!el) return;
  if (el.matches('[data-open-sample]')) return openSample({ from: el.dataset.openSample || 'link' });
  const projectId = location.pathname.match(/^\/app\/p\/([0-9a-f-]{36})/)?.[1];
  if (el.matches('[data-delete-sample]') && projectId) return deleteSample(projectId);
  if (el.matches('[data-sample-own]')) {
    const own = ctx.state.projects.filter((p) => !p.is_sample);
    track('sample_exit', { to: el.dataset.sampleOwn || (own.length ? 'projects' : 'welcome') });
    if (el.dataset.sampleOwn === 'upload' && own.length) return ctx.startAction('video');
    return ctx.navigate(own.length === 1 ? `/app/p/${own[0].id}` : own.length ? '/app/projects' : '/app/welcome');
  }
});

// ---------- Leader: three steps to a working project ----------
// [key, label, suggested project name in English, in Korean]. {year} becomes this year.
const TEAMS = [
  ['crew', 'Dance crew', 'Showcase {year}', '{year} 정기공연'],
  ['school', 'School or club team', 'Spring Concert {year}', '{year} 축제 무대'],
  ['studio', 'Studio or academy', 'Recital {year}', '{year} 발표회'],
  ['comp', 'Competition team', 'Competition Set {year}', '{year} 대회 준비'],
  ['solo', 'Just me, practicing', 'My practice', '내 연습']
];

export async function renderWelcome() {
  const { state, view, setCrumbs, navigate } = ctx;
  setCrumbs([['Get started']]);
  await state.projectsReady;
  const ob = onboarding();
  // Pick up where they left off: a project made in step 1 carries into steps 2 and 3.
  let step = ob.welcome_project && state.projects.some((p) => p.id === ob.welcome_project) ? (ob.welcome_step || 2) : 1;
  let projectId = step > 1 ? ob.welcome_project : null;
  let team = ob.team || null;
  let typed = null; // a name they typed beats our suggestion
  const year = new Date().getFullYear();
  const finish = async (where) => {
    await saveOnboarding({ welcome: 'done' });
    track('onboarding_step_done', { step: 'finished', via: where });
  };

  const frame = (body) => `<section class="auth welcome"><div class="auth-card welcome-card">
      <div class="steps" aria-label="Step ${step} of 3">${[1, 2, 3].map((n) => `<i class="${n < step ? 'done' : n === step ? 'now' : ''}"></i>`).join('')}<small>Step ${step} of 3</small></div>
      ${body}
    </div></section>`;

  const paint = () => {
    if (step === 1) {
      const pick = TEAMS.find((x) => x[0] === team) || TEAMS[0];
      const suggest = (isKo ? pick[3] : pick[2]).replace('{year}', year);
      view.innerHTML = frame(`<h1>What are you rehearsing for?</h1>
        <p class="muted">One project per goal. Your team’s videos, feedback, and schedule live inside it.</p>
        <div class="chips" role="group" aria-label="Your team">${TEAMS.map(([k, label]) => `<button type="button" class="chip" data-team="${k}" aria-pressed="${k === team}">${label}</button>`).join('')}</div>
        <form data-step-form>
          <label class="field"><span>Project name</span><input name="title" maxlength="120" required value="${esc(typed ?? suggest)}" /></label>
          <button class="btn primary wide" type="submit">Create project</button>
        </form>
        <div class="welcome-alt"><button type="button" class="link-btn" data-open-sample="welcome">Explore a sample project first</button><button type="button" class="link-btn" data-skip>Skip for now</button></div>`);
      $$('[data-team]').forEach((b) => b.addEventListener('click', () => { team = b.dataset.team; paint(); }));
      $('[data-step-form] input').addEventListener('input', (e) => { typed = e.target.value; });
      $('[data-step-form]').addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('[type=submit]');
        button.disabled = true;
        const title = event.currentTarget.title.value.trim();
        const { data, error } = await sb.from('projects').insert({ title }).select('id').single();
        if (error) { button.disabled = false; return toast(friendlyError(error), 'error'); }
        projectId = data.id;
        step = team === 'solo' ? 3 : 2;
        await saveOnboarding({ team, welcome_project: projectId, welcome_step: step });
        track('onboarding_step_done', { step: 'project', team });
        await ctx.refreshNav();
        paint();
      });
    } else if (step === 2) {
      view.innerHTML = frame(`<h1>Invite your team</h1>
        <p class="muted">Anyone with the link joins with just their name and email. They’ll get a short welcome that shows them what to do.</p>
        <div class="copy-row"><input readonly data-invite-link value="" placeholder="Making your link…" aria-label="Invite link" /><button class="btn primary" data-copy disabled>Copy</button></div>
        <button class="btn wide welcome-share" data-share hidden>Share…</button>
        <button class="btn primary wide" data-next>Next</button>
        <div class="welcome-alt"><button type="button" class="link-btn" data-later>I’ll invite them later</button></div>`);
      inviteLink(projectId).then(({ link }) => {
        const input = $('[data-invite-link]');
        if (!input) return;
        input.value = link;
        $('[data-copy]').disabled = false;
        $('[data-share]').hidden = !navigator.share;
        $('[data-copy]').addEventListener('click', async () => {
          track('invite_link_shared', { via: 'copy', from: 'welcome' });
          try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { input.select(); toast('Press Ctrl+C to copy the link.'); }
        });
        $('[data-share]').addEventListener('click', () => {
          track('invite_link_shared', { via: 'share', from: 'welcome' });
          navigator.share({ title: 'dancerly', text: t('Join our team on dancerly'), url: link }).catch(() => {});
        });
      }).catch((error) => toast(friendlyError(error), 'error'));
      const next = async () => { step = 3; await saveOnboarding({ welcome_step: 3 }); track('onboarding_step_done', { step: 'invite' }); paint(); };
      $('[data-next]').addEventListener('click', next);
      $('[data-later]').addEventListener('click', next);
    } else {
      view.innerHTML = frame(`<h1>Add your first rehearsal</h1>
        <p class="muted">A full run-through works best. Your team pauses on a moment and leaves feedback right there.</p>
        <ul class="film-tips"><li><b>From the front</b><span>Where the audience sits</span></li><li><b>Whole body in frame</b><span>Feet and hands included</span></li><li><b>With the music</b><span>So counts and sync work</span></li><li><b>Start to finish</b><span>Not just the hard part</span></li></ul>
        <button class="btn primary wide" data-upload>Upload a video</button>
        <button class="btn wide" data-open-sample="welcome-video">No video yet? See a sample</button>
        <div class="welcome-alt"><button type="button" class="link-btn" data-skip>Skip — take me to my project</button></div>`);
      $('[data-upload]').addEventListener('click', async () => { await finish('upload'); createVideo(projectId); });
    }
    $('[data-skip]')?.addEventListener('click', async () => {
      await finish('skip');
      navigate(projectId ? `/app/p/${projectId}` : '/app', { replace: true });
    });
    $$('[data-open-sample]').forEach((b) => b.addEventListener('click', () => finish('sample'), { capture: true }));
  };
  paint();
}

// ---------- Invited: a short welcome the first time they open a project ----------
export async function memberWelcome(projectId, project, members) {
  const me = ctx.state.session.user.id;
  if (!schema.firstRun || project.is_sample || seen(`welcome:${projectId}`)) return;
  markSeen(`welcome:${projectId}`);
  const owner = members.find((m) => m.role === 'owner');
  const [forMe, requests, { data: latest }] = await Promise.all([
    notesForMe(me, { limit: 50 }).then((n) => n.filter((x) => x.project_id === projectId && x.status !== 'resolved')).catch(() => []),
    myOpenRequests().then((r) => r.filter((x) => x.project_id === projectId)).catch(() => []),
    sb.from('videos').select('id, title, takes(number)').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  ]);
  const latestHref = latest ? `/app/p/${projectId}/v/${latest.id}?take=${Math.max(1, ...latest.takes.map((t) => t.number))}` : null;
  // The one thing most worth doing right now.
  const primary = requests[0] ? { label: 'Submit my video', href: `/app/p/${projectId}/requests/${requests[0].id}`, why: requests[0].title }
    : forMe[0] ? { label: 'See my feedback', href: `/app/p/${projectId}/v/${forMe[0].video_id}?take=${forMe[0].takes?.number ?? ''}&note=${forMe[0].id}` }
    : latestHref ? { label: 'Watch the latest video', href: latestHref }
    : null;
  const el = document.createElement('dialog');
  el.className = 'dialog welcome-dialog';
  el.innerHTML = `<div class="dialog-card">
    <p class="eyebrow">Welcome</p>
    <h2>You’re in ${esc(project.title)}</h2>
    <p>${owner && owner.user_id !== me ? `${esc(owner.name)} and the team review rehearsals here.` : 'Your team reviews rehearsals here.'} Three things you’ll do most:</p>
    <ol class="welcome-list">
      <li><span class="wl-icon" aria-hidden="true">◎</span><span><b>Check feedback on your moves</b><small>${forMe.length ? `${forMe.length} waiting for you — tap one to jump to that moment.` : 'Tap any note to jump to that moment in the video.'}</small></span></li>
      <li><span class="wl-icon" aria-hidden="true">↻</span><span><b>Practice with loop and mirror</b><small>Loop the part you’re working on, slow it down, flip it to match the mirror.</small></span></li>
      <li><span class="wl-icon" aria-hidden="true">↑</span><span><b>Upload your video</b><small>${requests[0] ? `Requested: ${esc(requests[0].title)}.` : 'Film from the front, whole body in frame, with the music.'}</small></span></li>
    </ol>
    ${latest ? '' : `<p class="fine left">${owner && owner.user_id !== me ? `No videos here yet. When ${esc(owner.name)} uploads one, you’ll get a notification.` : 'No videos here yet. You’ll get a notification when one is uploaded.'}</p>`}
    <div class="dialog-actions"><button class="btn ghost" data-close>${primary ? 'Later' : 'Got it'}</button>${primary ? `<a class="btn primary" href="${primary.href}" data-link data-go>${primary.label}</a>` : ''}</div>
  </div>`;
  document.body.append(el);
  el.showModal();
  el.querySelector('[data-close]').addEventListener('click', () => el.close());
  el.querySelector('[data-go]')?.addEventListener('click', () => { track('onboarding_step_done', { step: 'member_welcome', action: primary.label }); el.close(); });
  el.addEventListener('close', () => el.remove());
}

// ---------- Review: three quick tips, once ----------
// In the sample, everyone sees the leader's tips (they're the one setting things up).
export function reviewTips({ isOwner }) {
  const key = isOwner ? 'tips:review:lead' : 'tips:review:member';
  if (!schema.firstRun || seen(key)) return () => {};
  const tips = isOwner
    ? [
      ['[data-track]', 'Pause on a moment', 'Tap or drag the timeline to find a moment, pause, and type what you see.'],
      ['[data-composer]', 'Leave feedback right there', 'Mention someone with @, draw on the frame, or send it privately to one person.'],
      ['[data-ab]', 'Loop the hard part', 'Tap A–B at the start and the end. Slow it down with the speed button.']
    ]
    : [
      ['[data-list]', 'Your feedback, at its moment', 'Tap a note to jump there. Mark it Practicing, then Resolved when it’s clean.'],
      ['[data-ab]', 'Loop the part you’re drilling', 'Tap A–B at the start and the end. Slow it down with the speed button.'],
      ['[data-mirror]', 'Flip it to match the mirror', 'Mirror mode shows the video the way you see yourself in the studio.']
    ];
  let i = 0;
  let open = true;
  const tip = document.createElement('div');
  tip.className = 'coach';
  tip.setAttribute('role', 'dialog');
  tip.setAttribute('aria-live', 'polite');
  document.body.append(tip);
  const place = () => {
    if (!open) return;
    const target = $(tips[i][0]);
    if (!target) return;
    const box = target.getBoundingClientRect();
    const w = Math.min(300, innerWidth - 32);
    tip.style.width = `${w}px`;
    const h = tip.offsetHeight;
    const below = innerHeight - box.bottom > h + 20 || box.top < h + 20;
    tip.style.left = `${Math.max(16, Math.min(innerWidth - w - 16, box.left + box.width / 2 - w / 2))}px`;
    tip.style.top = `${below ? Math.min(innerHeight - h - 12, box.bottom + 10) : Math.max(12, box.top - h - 10)}px`;
    tip.dataset.side = below ? 'below' : 'above';
  };
  const paint = () => {
    const [, title, text] = tips[i];
    tip.innerHTML = `<small>${i + 1} / ${tips.length}</small><b>${esc(title)}</b><p>${esc(text)}</p>
      <div><button class="btn ghost small" data-coach-skip>Skip tips</button><button class="btn primary small" data-coach-next>${i === tips.length - 1 ? 'Got it' : 'Next'}</button></div>`;
    tip.querySelector('[data-coach-next]').addEventListener('click', next);
    tip.querySelector('[data-coach-skip]').addEventListener('click', () => close(true));
    const target = $(tips[i][0]);
    if (!target) return next();
    $$('.coach-target').forEach((t) => t.classList.remove('coach-target'));
    target.classList.add('coach-target');
    // Phones: bring the thing being explained on screen first.
    const box = target.getBoundingClientRect();
    if (box.top < 0 || box.bottom > innerHeight) target.scrollIntoView({ block: 'center' });
    place();
  };
  const close = (skipped = false) => {
    if (!open) return;
    open = false;
    tip.remove();
    $$('.coach-target').forEach((t) => t.classList.remove('coach-target'));
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place);
    if (skipped) track('tips_dismissed', { set: key, at: i + 1 });
    markSeen(key);
  };
  function next() {
    i += 1;
    if (i >= tips.length) return close();
    paint();
  }
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  // Let the player lay out first.
  setTimeout(() => { if (open) paint(); }, 400);
  return () => close();
}

// The first time someone sends a private note: who sees it, in one line.
export async function explainPrivate(name) {
  if (!schema.firstRun || seen('private')) return true;
  const ok = await dialog({
    title: 'Private feedback',
    body: `Only you and <b>${esc(name)}</b> will see this note and its replies. It doesn’t show up for the rest of the team, in AI recaps for others, or on shared links.`,
    confirm: 'Got it'
  });
  if (ok) markSeen('private');
  return Boolean(ok);
}
