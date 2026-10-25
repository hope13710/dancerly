// Settings: your account, what you get notified about, the projects you're in, and your plan.
import { sb, $, $$, esc, initials, toast, friendlyError } from '../client.js';
import { ctx } from '../ctx.js';

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
        <form class="inline-form" data-name-form>
          <span class="avatar lg">${esc(initials(state.profile.display_name))}</span>
          <label class="field grow"><span>Name</span><input name="display" maxlength="60" required value="${esc(state.profile.display_name)}" /></label>
          <button class="btn" type="submit">Save</button>
        </form>
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
    const { data, error } = await sb.from('project_members').select('project_id, role, joined_at, projects(title, project_members(count))').eq('user_id', state.session.user.id).order('joined_at', { ascending: false });
    if (error) throw error;
    return {
      html: `<section class="panel">
        <div class="panel-head"><div><h2>Your projects</h2><p class="muted">Rename, manage people, invite links, or leave — in each project’s Settings tab.</p></div></div>
        ${data.length ? `<div class="list flush">${data.map((m) => `<a class="row" href="/app/p/${m.project_id}/settings" data-link>
          <span class="card-mark xs">${esc(initials(m.projects?.title))}</span>
          <span class="row-main"><span class="row-title">${esc(m.projects?.title || '')}</span><span class="row-meta">${m.projects?.project_members?.[0]?.count ?? 1} members</span></span>
          <span class="row-side"><span class="role ${m.role}">${m.role === 'owner' ? 'Owner' : 'Member'}</span><span class="chev">›</span></span></a>`).join('')}</div>`
          : '<p class="panel-empty">You’re not in any projects yet.</p>'}
      </section>`
    };
  }

  async function plan() {
    const { data } = await sb.from('project_members').select('project_id, projects(project_members(count))').eq('user_id', state.session.user.id).eq('role', 'owner');
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
      </section>`
    };
  }
}
