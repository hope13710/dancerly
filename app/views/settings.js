// Settings: your account, what you get notified about, the projects you're in, and your plan.
import { sb, $, $$, esc, initials, toast, friendlyError, projectMark, avatar, wireImagePicker, rememberPhotos } from '../client.js';
import { cols, schema } from '../client.js';
import { ctx } from '../ctx.js';
import { LANGS, getLang, setLang } from '../i18n.js';

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
// Matches the pricing page. Not enforced yet; shown so teams know where they stand.
const FREE = { projects: 1, members: 10 };

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
    const { data } = await sb.from('profiles').select('notify').eq('id', state.session.user.id).single();
    const prefs = data?.notify || {};
    return {
      html: `<section class="panel">
        <div class="panel-head"><div><h2>Inbox notifications</h2><p class="muted">Choose what shows up in your Inbox. Changes apply from now on.</p></div></div>
        <div class="list flush">${KINDS.map(([k, title, hint]) => `<label class="row toggle-row"><span class="row-main"><span class="row-title">${title}</span><span class="row-meta">${hint}</span></span>
          <span class="switch"><input type="checkbox" data-kind="${k}" ${prefs[k] !== false ? 'checked' : ''} /><i aria-hidden="true"></i></span></label>`).join('')}</div>
        <p class="fine left">Email and push notifications are coming. For now everything lands in your Inbox.</p>
      </section>`,
      wire() {
        $$('[data-kind]').forEach((box) => box.addEventListener('change', async () => {
          const next = Object.fromEntries(KINDS.map(([k]) => [k, $(`[data-kind="${k}"]`).checked]));
          const { error } = await sb.from('profiles').update({ notify: next }).eq('id', state.session.user.id);
          if (error) { box.checked = !box.checked; return toast(friendlyError(error), 'error'); }
          toast('Saved.');
        }));
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
    const owned = data?.length || 0;
    const largest = Math.max(0, ...(data || []).map((m) => m.projects?.project_members?.[0]?.count ?? 1));
    const meter = (used, max) => `<span class="meter wide"><i style="width:${Math.min(100, (used / max) * 100)}%" class="${used > max ? 'over' : ''}"></i></span>`;
    return {
      html: `<section class="panel">
        <div class="panel-head"><div><p class="eyebrow">Current plan</p><h2>Free</h2><p class="muted">One team of up to 10 members, unlimited takes, and every note feature. Everything you make stays yours.</p></div></div>
        <div class="usage">
          <div><span>Projects you own</span><b>${owned} of ${FREE.projects}</b>${meter(owned, FREE.projects)}</div>
          <div><span>People in your largest project</span><b>${largest} of ${FREE.members}</b>${meter(largest, FREE.members)}</div>
        </div>
        ${owned > FREE.projects || largest > FREE.members ? '<p class="fine left">You’re past the Free limits. Nothing is blocked during early access — we’ll let you know well before that changes.</p>' : ''}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Team · $12/month</h2><p class="muted">3 teams and up to 40 members, unlimited projects, full-history Insights, and unlimited AI recaps.</p></div><span class="tag">Coming soon</span></div>
        ${schema.firstRun ? `<p class="plan-try">See them working in the sample project: <button type="button" class="btn small" data-open-sample="plan:recaps">✦ An AI recap</button><button type="button" class="btn small" data-open-sample="plan:insights">↗ Insights</button></p>` : ''}
      </section>`
    };
  }
}
