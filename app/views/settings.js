// Settings: your account, what you get notified about, the projects you're in, and your plan.
import { sb, $, $$, esc, initials, toast, friendlyError, projectMark, avatar, wireImagePicker, rememberPhotos } from '../client.js';
import { cols, schema } from '../client.js';
import { ctx } from '../ctx.js';
import { LANGS, getLang, setLang } from '../i18n.js';
import { recapUsage } from './recaps.js';

const SECTIONS = [
  ['account', 'Account'],
  ['notifications', 'Notifications'],
  ['projects', 'Projects'],
  ['plan', 'Plan']
];
const KINDS = [
  ['mention', 'Someone @mentions you', 'In a note on any video.'],
  ['note_on_your_video', 'Notes on your videos', 'On a video you added or a take you uploaded.'],
  ['reply', 'Replies', 'When someone replies to a note you wrote or a thread you’re in.'],
  ['new_take', 'New takes', 'Whenever a teammate uploads to one of your projects.'],
  ['note_resolved', 'Your notes get fixed', 'When someone marks a note you wrote as resolved.'],
  ['joined', 'Someone joins', 'People joining a project you own.'],
  ['recap_shared', 'Recaps shared with you', 'When a teammate shares an AI recap to a project.'],
  ['request', 'Video requests', 'When someone asks you for a video, and their reminders.']
];
// Email follow-ups by group (send-emails function). Same defaults as the server.
const EMAIL_GROUPS = [
  ['mention', 'Someone @mentions you', 'instant', 'mention'],
  ['private_note', 'Private notes to you', 'instant', null],
  ['reply', 'Replies', 'instant', 'reply'],
  ['request', 'Video requests and due dates', 'instant', 'request'],
  ['note_on_your_video', 'Notes on your videos', 'digest', 'note_on_your_video'],
  ['new_take', 'New takes', 'digest', 'new_take'],
  ['note_resolved', 'Your notes get fixed', 'digest', 'note_resolved'],
  ['joined', 'Someone joins', 'digest', 'joined'],
  ['recap_shared', 'Recaps shared with you', 'digest', 'recap_shared']
];
const EMAIL_CHOICES = [['instant', 'Right away'], ['digest', 'Morning summary'], ['off', 'Off']];

// Matches the pricing page. Not enforced yet; shown so teams know where they stand.
const FREE = { projects: 1, members: 10, videos: 5, takes: 3, storage: 2 * 1024 ** 3 };
// "34 MB", "1.2 GB": GB with one decimal from 1 GB up.
const size = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1).replace(/\.0$/, '')} GB` : `${Math.max(b > 0 ? 1 : 0, Math.round(b / 1024 ** 2))} MB`);

export async function renderSettings(section = 'account') {
  const { state, view, setCrumbs } = ctx;
  if (!SECTIONS.some(([k]) => k === section)) section = 'account';
  const label = SECTIONS.find(([k]) => k === section)[1];
  setCrumbs([['Settings', '/app/settings'], [label]]);
  const nav = `<nav class="settings-nav" aria-label="Settings">${SECTIONS.map(([k, l]) => `<a href="/app/settings/${k}" data-link ${k === section ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
  const body = await ({ account, notifications, projects, plan })[section]();
  view.innerHTML = `<section class="page"><header class="page-head"><div><h1>Settings</h1></div></header>
    <div class="settings-layout">${nav}<div class="settings-body">${body.html}</div></div></section>`;
  body.wire?.();

  function account() {
    return {
      html: `<section class="panel">
        <div class="panel-head"><div><h2>Profile</h2><p class="muted">Your name appears on your notes and in @mentions.</p></div></div>
        <div class="image-row">
          ${avatar(state.profile.display_name, state.session.user.id, 'xl')}
          <div><b>Photo</b><p class="muted">Helps teammates recognize your notes. A square works best.</p>
            <div class="image-actions"><button class="btn small" type="button" data-pick-image>${state.profile.avatar_url ? 'Change photo' : 'Upload photo'}</button>${state.profile.avatar_url ? '<button class="btn small ghost" type="button" data-remove-image>Remove</button>' : ''}</div><input type="file" accept="image/*" hidden data-image-file />
          </div>
        </div>
        <form class="inline-form" data-name-form>
          <label class="field grow"><span>Name</span><input name="display" maxlength="60" required value="${esc(state.profile.display_name)}" /></label>
          <button class="btn" type="submit">Save</button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Language</h2><p class="muted">Shown throughout dancerly on this device.</p></div>
          <div class="seg small" role="group" aria-label="Language" data-no-i18n>${LANGS.map(([k, l]) => `<button type="button" data-lang="${k}" aria-selected="${getLang() === k}">${l}</button>`).join('')}</div></div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Sign-in</h2></div></div>
        <div class="list flush">
          <div class="row"><span class="row-main"><span class="row-title">Email</span><span class="row-meta">${esc(state.session.user.email || '')}</span></span></div>
          <div class="row"><span class="row-main"><span class="row-title">Password</span><span class="row-meta">Used to log in on any device</span></span><span class="row-side"><a class="btn small" href="/app/reset" data-link>Change</a></span></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Log out</h2><p class="muted">Signs you out on this device.</p></div><button class="btn" data-signout-here>Log out</button></div>
      </section>
      <section class="panel danger-zone">
        <div class="panel-head"><div><h2>Delete account</h2><p class="muted">Permanently delete your account, your videos, and your feedback. You’ll decide what happens to the projects you manage, and can download your data first.</p></div><a class="btn danger-outline" href="/app/account/delete" data-link>Delete account…</a></div>
      </section>`,
      wire() {
        $('[data-name-form]').addEventListener('submit', async (event) => {
          event.preventDefault();
          const name = event.currentTarget.elements.namedItem('display').value.trim();
          if (!name || name === state.profile.display_name) return;
          const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', state.session.user.id);
          if (error) return toast(friendlyError(error), 'error');
          state.profile.display_name = name;
          toast('Name saved.');
          ctx.route();
        });
        $('[data-signout-here]').addEventListener('click', () => ctx.signOut());
        $$('[data-lang]').forEach((b) => b.addEventListener('click', () => {
          if (b.dataset.lang === getLang()) return;
          setLang(b.dataset.lang);
          location.reload();
        }));
        wireImagePicker({
          folder: `users/${state.session.user.id}`,
          save: (url) => sb.from('profiles').update({ avatar_url: url }).eq('id', state.session.user.id),
          done: async (url) => { state.profile.avatar_url = url; rememberPhotos([state.profile]); toast(url ? 'Photo updated.' : 'Photo removed.'); ctx.route(); }
        });
      }
    };
  }

  async function notifications() {
    const [{ data }, { data: mail }] = await Promise.all([
      sb.from('profiles').select('notify').eq('id', state.session.user.id).single(),
      sb.from('notification_settings').select('email').eq('user_id', state.session.user.id).maybeSingle()
    ]);
    const prefs = data?.notify || {};
    const email = mail?.email || {};
    return {
      html: `<section class="panel">
        <div class="panel-head"><div><h2>Inbox notifications</h2><p class="muted">Choose what shows up in your Inbox. Changes apply from now on.</p></div></div>
        <div class="list flush">${KINDS.map(([k, title, hint]) => `<label class="row toggle-row"><span class="row-main"><span class="row-title">${title}</span><span class="row-meta">${hint}</span></span>
          <span class="switch"><input type="checkbox" data-kind="${k}" ${prefs[k] !== false ? 'checked' : ''} /><i aria-hidden="true"></i></span></label>`).join('')}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Email</h2><p class="muted">We only email what you haven’t seen in the app. Nothing is sent between 10 PM and 7 AM your time.</p></div></div>
        <div class="list flush">${EMAIL_GROUPS.map(([g, title, def, inbox]) => {
          const blocked = inbox && prefs[inbox] === false;
          return `<label class="row toggle-row email-row"><span class="row-main"><span class="row-title">${title}</span>${blocked ? '<span class="row-meta">Turned off in your Inbox above</span>' : ''}</span>
            <select data-email="${g}" ${blocked ? 'disabled' : ''}>${EMAIL_CHOICES.map(([v, l]) => `<option value="${v}" ${(email[g] || def) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
        }).join('')}
          <label class="row toggle-row"><span class="row-main"><span class="row-title">Weekly progress</span><span class="row-meta">Monday morning, after a week with fixes or new takes.</span></span>
            <span class="switch"><input type="checkbox" data-weekly ${email.weekly !== false ? 'checked' : ''} /><i aria-hidden="true"></i></span></label>
          <label class="row toggle-row"><span class="row-main"><span class="row-title">Getting started</span><span class="row-meta">At most two emails, early on: a tip for your first video, and a note when your first teammate joins.</span></span>
            <span class="switch"><input type="checkbox" data-onboarding ${email.onboarding !== false ? 'checked' : ''} /><i aria-hidden="true"></i></span></label>
        </div>
        <p class="fine left">The morning summary arrives around 8 AM US Eastern Time.</p>
      </section>`,
      wire() {
        $$('[data-kind]').forEach((box) => box.addEventListener('change', async () => {
          const next = Object.fromEntries(KINDS.map(([k]) => [k, $(`[data-kind="${k}"]`).checked]));
          const { error } = await sb.from('profiles').update({ notify: next }).eq('id', state.session.user.id);
          if (error) { box.checked = !box.checked; return toast(friendlyError(error), 'error'); }
          toast('Saved.');
          ctx.route(); // email rows follow the Inbox switches
        }));
        const saveEmail = async () => {
          const next = Object.fromEntries($$('[data-email]').map((s) => [s.dataset.email, s.value]));
          next.weekly = $('[data-weekly]').checked;
          next.onboarding = $('[data-onboarding]').checked;
          const { error } = await sb.from('notification_settings').upsert({ user_id: state.session.user.id, email: next, updated_at: new Date().toISOString() });
          if (error) return toast(friendlyError(error), 'error');
          toast('Saved.');
        };
        $$('[data-email]').forEach((s) => s.addEventListener('change', saveEmail));
        $('[data-weekly]').addEventListener('change', saveEmail);
        $('[data-onboarding]').addEventListener('change', saveEmail);
      }
    };
  }

  async function projects() {
    const { data, error } = await sb.from('project_members').select('project_id, role, joined_at, projects(title, image_url, project_members(count))').eq('user_id', state.session.user.id).order('joined_at', { ascending: false });
    if (error) throw error;
    return {
      html: `<section class="panel">
        <div class="panel-head"><div><h2>Your projects</h2><p class="muted">Rename, manage people, invite links, or leave — in each project’s Settings tab.</p></div></div>
        ${data.length ? `<div class="list flush">${data.map((m) => `<a class="row" href="/app/p/${m.project_id}/settings" data-link>
          ${projectMark(m.projects, 'xs')}
          <span class="row-main"><span class="row-title">${esc(m.projects?.title || '')}</span><span class="row-meta">${m.projects?.project_members?.[0]?.count ?? 1} members</span></span>
          <span class="row-side"><span class="role ${m.role}">${m.role === 'owner' ? 'Owner' : 'Member'}</span><span class="chev">›</span></span></a>`).join('')}</div>`
          : '<p class="panel-empty">You’re not in any projects yet.</p>'}
      </section>`
    };
  }

  async function plan() {
    const { data: rows } = await sb.from('project_members').select(cols('project_id, projects(is_sample, project_members(count))')).eq('user_id', state.session.user.id).eq('role', 'owner');
    const data = (rows || []).filter((m) => !m.projects?.is_sample);
    const [recaps, { data: storage, error: storageErr }, { data: vids }] = await Promise.all([
      recapUsage(),
      // Bytes per project you own (migration 028); counts toward the owner's plan.
      sb.rpc('my_storage_usage'),
      data.length ? sb.from('videos').select('project_id, takes(count)').in('project_id', data.map((m) => m.project_id)) : { data: [] }
    ]);
    const owned = data?.length || 0;
    const largest = Math.max(0, ...(data || []).map((m) => m.projects?.project_members?.[0]?.count ?? 1));
    const perProject = {};
    for (const v of vids || []) perProject[v.project_id] = (perProject[v.project_id] || 0) + 1;
    const mostVideos = Math.max(0, ...Object.values(perProject));
    const mostTakes = Math.max(0, ...(vids || []).map((v) => v.takes?.[0]?.count ?? 0));
    const meter = (used, max) => `<span class="meter wide"><i style="width:${Math.min(100, (used / max) * 100)}%" class="${used > max ? 'over' : ''}"></i></span>`;
    const used = (storage || []).reduce((t, r) => t + Number(r.bytes || 0), 0);
    const ownedTitle = (id) => state.projects.find((x) => x.id === id)?.title || '';
    const storageRow = storageErr ? '' : `<div class="storage-row"><span>Storage</span><b data-no-i18n>${size(used)} / ${size(FREE.storage)}</b>${meter(used, FREE.storage)}
            <small data-no-i18n>${used >= FREE.storage
              ? (getLang() === 'ko' ? '한도에 닿았어요. 지워지는 건 없고, 업로드는 얼리 액세스 동안 계속돼요.' : 'You’ve reached the limit. Nothing is deleted, and uploads keep working during early access.')
              : (getLang() === 'ko' ? `${size(FREE.storage - used)} 남음` : `${size(FREE.storage - used)} left`)}${(storage || []).length > 1 ? ` · ${(storage || []).filter((r) => Number(r.bytes)).map((r) => `${esc(ownedTitle(r.project_id))} ${size(Number(r.bytes))}`).join(' · ')}` : ''}</small></div>`;
    const ko = getLang() === 'ko';
    const ofText = (used, max, unit = '') => (ko ? `${max}${unit} 중 ${used}${unit}` : `${used} of ${max}`);
    const over = used > FREE.storage || owned > FREE.projects || largest > FREE.members || mostVideos > FREE.videos || mostTakes > FREE.takes || recaps?.over;
    const paid = (name, monthly, yearly, perMonth, what) => `<div class="plan-card"><div><h3>${name}</h3><p class="muted">${what}</p></div>
      <p class="plan-price" data-no-i18n><b>$${monthly}</b>${ko ? '/월' : '/month'} <span class="muted">· ${ko ? `연 $${yearly} (월 $${perMonth}, 2개월 무료)` : `or $${yearly}/year ($${perMonth}/month, 2 months free)`}</span></p></div>`;
    return {
      html: `<section class="panel">
        <div class="panel-head"><div><p class="eyebrow">Current plan</p><h2>Free</h2><p class="muted">1 team of up to 10 members, 5 videos with up to 3 takes each, 2 GB of storage, every feedback tool, and 3 AI recaps a month per person.</p></div></div>
        <div class="usage">
          ${storageRow}
          <div><span>Projects you own</span><b data-no-i18n>${ofText(owned, FREE.projects, '개')}</b>${meter(owned, FREE.projects)}</div>
          <div><span>People in your largest project</span><b data-no-i18n>${ofText(largest, FREE.members, '명')}</b>${meter(largest, FREE.members)}</div>
          <div><span>Videos in your largest project</span><b data-no-i18n>${ofText(mostVideos, FREE.videos, '개')}</b>${meter(mostVideos, FREE.videos)}</div>
          <div><span>Most takes on one video</span><b data-no-i18n>${ofText(mostTakes, FREE.takes, '개')}</b>${meter(mostTakes, FREE.takes)}</div>
          ${recaps ? `<div><span>Your AI recaps this month</span><b data-no-i18n>${ofText(recaps.used, recaps.limit, '회')}</b>${meter(recaps.used, recaps.limit)}</div>` : ''}
        </div>
        <p class="fine left founding-note">✦ Early access thank-you: teams that upload their first video before paid plans launch get 3 months of Team free.</p>
        ${over ? '<p class="fine left">You’re past the Free limits. Nothing is blocked during early access — we’ll let you know well before that changes.</p>' : ''}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Paid plans</h2><p class="muted">Unlimited videos and takes, unlimited AI recaps, and full-history Insights. Each plan has its own storage limit. If you reach it, nothing is deleted; new uploads pause until you free up space or upgrade.</p></div><span class="tag">Coming soon</span></div>
        <div class="plan-cards">
          ${paid('Team', 12, 120, 10, 'For crews, clubs, and teams. Up to 3 teams and 40 members, 20 GB of storage.')}
          ${paid('Studio', 29, 290, '24.17', 'For studios running many classes. Unlimited teams and members, 100 GB of storage.')}
        </div>
        ${schema.firstRun ? `<p class="plan-try">See them working in the sample project: <button type="button" class="btn small" data-open-sample="plan:recaps">✦ An AI recap</button><button type="button" class="btn small" data-open-sample="plan:insights">↗ Insights</button></p>` : ''}
      </section>`
    };
  }
}
