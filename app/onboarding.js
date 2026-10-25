// First-run guidance: the leader's three-step start, the sample project, a welcome for people who were invited,
// and one-time tips. Progress lives on the profile (profiles.onboarding) so it follows people across devices.
import { sb, $, $$, esc, toast, friendlyError, dialog } from './client.js';
import { ctx } from './ctx.js';
import { getLang, isKo, t } from './i18n.js';
import { inviteLink, createVideo } from './views/project.js';
import { myOpenRequests } from './views/requests.js';
import { notesForMe } from './views/shared.js';

export const track = (event, props = {}) => { try { (window.dataLayer ||= []).push({ event, ...props }); } catch {} };

export const onboarding = () => ctx.state.profile?.onboarding || {};
export async function saveOnboarding(patch) {
  const next = { ...onboarding(), ...patch };
  ctx.state.profile.onboarding = next;
  await sb.from('profiles').update({ onboarding: next }).eq('id', ctx.state.session.user.id);
}
// One-time things (tips, explanations) remembered by name.
export const seen = (key) => Boolean(onboarding().seen?.[key]);
export const markSeen = (key) => saveOnboarding({ seen: { ...(onboarding().seen || {}), [key]: true } });

// New leaders with nothing yet start here instead of an empty Home.
export const needsWelcome = () => !onboarding().welcome && !ctx.state.projects.length;

// ---------- The sample project ----------
export async function openSample({ from = 'unknown' } = {}) {
  const { data: projectId, error } = await sb.rpc('create_sample_project', { p_lang: getLang(), p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
  if (error) return toast(friendlyError(error), 'error');
  track('sample_opened', { from });
  await ctx.refreshNav();
  // Straight to the review: that's where the product makes sense.
  const { data: video } = await sb.from('videos').select('id').eq('project_id', projectId).order('created_at').limit(1).maybeSingle();
  ctx.navigate(video ? `/app/p/${projectId}/v/${video.id}?take=1` : `/app/p/${projectId}`);
}

async function deleteSample(projectId) {
  const sure = await dialog({ title: 'Delete the sample project?', body: 'Its videos, notes, and teammates go away. You can open a fresh one any time from Home.', confirm: 'Delete sample', danger: true });
  if (!sure) return;
  const { error } = await sb.from('projects').delete().eq('id', projectId).eq('is_sample', true);
  if (error) return toast(friendlyError(error), 'error');
  toast('Sample deleted.');
  await ctx.refreshNav();
  ctx.navigate(ctx.state.projects.length ? '/app/projects' : '/app');
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-open-sample], [data-delete-sample], [data-sample-own]');
  if (!el) return;
  if (el.matches('[data-open-sample]')) return openSample({ from: el.dataset.openSample || 'link' });
  const projectId = location.pathname.match(/^\/app\/p\/([0-9a-f-]{36})/)?.[1];
  if (el.matches('[data-delete-sample]') && projectId) return deleteSample(projectId);
  if (el.matches('[data-sample-own]')) {
    const own = ctx.state.projects.find((p) => !p.is_sample);
    return own ? ctx.navigate(`/app/p/${own.id}`) : ctx.navigate('/app/welcome');
  }
});

// ---------- Leader: three steps to a working project ----------
// [key, label, suggested project name in English, in Korean]. {year} becomes this year.
const TEAMS = [
  ['crew', 'Dance crew', 'Showcase {year}', '{year} 정기공연'],
  ['school', 'School or club team', 'Spring Concert {year}', '{year} 축제 무대'],
  ['studio', 'Studio or academy', 'Recital {year}', '{year} 발표회'],
  ['comp', 'Competition team', 'Competition Set {year}', '{year} 대회 준비'],
  ['solo', 'Just me', 'My practice', '내 연습']
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
          navigator.share({ title: 'Looproom', text: t('Join our team on Looproom'), url: link }).catch(() => {});
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
  if (project.is_sample || seen(`welcome:${projectId}`)) return;
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
  if (seen(key)) return () => {};
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
  if (seen('private')) return true;
  const ok = await dialog({
    title: 'Private feedback',
    body: `Only you and <b>${esc(name)}</b> will see this note and its replies. It doesn’t show up for the rest of the team, in AI recaps for others, or on shared links.`,
    confirm: 'Got it'
  });
  if (ok) markSeen('private');
  return Boolean(ok);
}
