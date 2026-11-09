// Settings: your account, what you get notified about, the projects you're in, and your plan.
import { sb, $, $$, esc, initials, toast, friendlyError, projectMark, avatar, wireImagePicker, rememberPhotos } from '../client.js';
import { cols, schema } from '../client.js';
import { ctx } from '../ctx.js';
import { LANGS, getLang, setLang } from '../i18n.js';
import { openHelp } from '../help.js';

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
  ['new_take', 'New takes', 'When someone uploads to one of your projects.'],
  ['note_resolved', 'Your notes get fixed', 'When someone marks a note you wrote as resolved.'],
  ['joined', 'Someone joins', 'People joining a project you own.'],
  ['recap_shared', 'Recaps shared with you', 'When someone shares an AI recap to a project.'],
  ['request', 'Assignments', 'When someone gives you an assignment, and its reminders.']
];
// Email follow-ups by group (send-emails function). Same defaults as the server.
const EMAIL_GROUPS = [
  ['mention', 'Someone @mentions you', 'instant', 'mention'],
  ['private_note', 'Private notes to you', 'instant', null],
  ['reply', 'Replies', 'instant', 'reply'],
  ['request', 'Assignments and due dates', 'instant', 'request'],
  ['note_on_your_video', 'Notes on your videos', 'digest', 'note_on_your_video'],
  ['new_take', 'New takes', 'digest', 'new_take'],
  ['note_resolved', 'Your notes get fixed', 'digest', 'note_resolved'],
  ['joined', 'Someone joins', 'digest', 'joined'],
  ['recap_shared', 'Recaps shared with you', 'digest', 'recap_shared']
];
const EMAIL_CHOICES = [['instant', 'Right away'], ['digest', 'Morning summary'], ['off', 'Off']];

// dancerly is free. The one limit is video storage per team owner (migration 044), enforced on upload.
const DEFAULT_STORAGE = 5 * 1024 ** 3;
// A typical compressed practice video, for "about N videos".
const VIDEO_SIZE = 35 * 1024 ** 2;
const aboutVideos = (bytes) => Math.max(0, Math.floor(bytes / VIDEO_SIZE / 10) * 10);
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
          <div><b>Photo</b><p class="muted">Helps people recognize your notes. A square works best.</p>
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
          <div class="seg small" role="group" aria-label="Language" data-no-i18n data-i18n-attrs>${LANGS.map(([k, l]) => `<button type="button" data-lang="${k}" aria-selected="${getLang() === k}">${l}</button>`).join('')}</div></div>
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
          <label class="row toggle-row"><span class="row-main"><span class="row-title">Weekly progress</span><span class="row-meta">Monday morning your time, after a week with fixes or new takes.</span></span>
            <span class="switch"><input type="checkbox" data-weekly ${email.weekly !== false ? 'checked' : ''} /><i aria-hidden="true"></i></span></label>
          <label class="row toggle-row"><span class="row-main"><span class="row-title">Getting started</span><span class="row-meta">At most three emails, early on: a tip for your first video, a reminder to invite your team, and a note when someone first joins.</span></span>
            <span class="switch"><input type="checkbox" data-onboarding ${email.onboarding !== false ? 'checked' : ''} /><i aria-hidden="true"></i></span></label>
        </div>
        <p class="fine left">Morning summaries arrive around 8 AM in your time zone.</p>
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
    const ko = getLang() === 'ko';
    // Your allowance (migration 044), with the per-project breakdown (migration 028). Older databases: 5 GB, unenforced.
    const [{ data: mine, error: mineErr }, { data: storage }] = await Promise.all([sb.rpc('my_storage'), sb.rpc('my_storage_usage')]);
    const perProject = (storage || []).filter((r) => Number(r.bytes));
    const used = mineErr ? perProject.reduce((t, r) => t + Number(r.bytes || 0), 0) : Number(mine?.[0]?.used || 0);
    const allowance = mineErr ? DEFAULT_STORAGE : Number(mine?.[0]?.allowance || DEFAULT_STORAGE);
    const full = used >= allowance;
    const ownedTitle = (id) => state.projects.find((x) => x.id === id)?.title || '';
    const meter = `<span class="meter wide"><i style="width:${Math.min(100, (used / allowance) * 100)}%" class="${full ? 'over' : used >= allowance * 0.9 ? 'warn' : ''}"></i></span>`;
    const note = full
      ? (ko ? '가득 찼어요. 지워진 건 없고, 새 업로드만 멈춘 상태예요.' : 'Full. Nothing was deleted; new uploads are paused.')
      : (ko ? `${size(allowance - used)} 남았어요 (영상 약 ${aboutVideos(allowance - used)}개)` : `${size(allowance - used)} left (about ${aboutVideos(allowance - used)} videos)`);
    // Full or nearly (90%+): a way out, right here. Biggest project first, since that's where clearing helps most.
    const tight = used >= allowance * 0.9;
    const byProject = [...perProject].sort((a, b) => Number(b.bytes) - Number(a.bytes));
    const projectOf = (id) => state.projects.find((x) => x.id === id);
    const freeUp = tight ? `<div class="free-up${full ? ' is-full' : ''}" data-no-i18n>
          <div class="free-up-head">
            <h3>${full ? (ko ? '다음 영상을 올릴 공간을 만들어 보세요' : 'Make room for your next video') : (ko ? '저장 공간이 거의 찼어요' : 'Almost full')}</h3>
            <p>${full
              ? (ko ? '이미 고친 피드백만 남은 예전 테이크부터 지우면 가장 쉬워요. 지운 테이크는 그 즉시 공간에서 빠지고, 마음이 바뀌면 30일 동안 휴지통에서 되살릴 수 있어요.' : 'Old takes whose notes are already fixed are the easiest to let go. A deleted take frees its space right away, and Trash keeps it for 30 days in case you change your mind.')
              : (ko ? `영상 약 ${aboutVideos(allowance - used)}개를 더 올릴 수 있어요. 이미 고친 예전 테이크를 정리해 두면 업로드가 멈추지 않아요.` : `About ${aboutVideos(allowance - used)} more videos fit. Clearing out takes you’ve already fixed keeps uploads going.`)}</p>
          </div>
          ${byProject.length ? `<ul class="free-up-list">${byProject.map((r, i) => {
            const p = projectOf(r.project_id);
            const share = Math.round((Number(r.bytes) / Math.max(used, 1)) * 100);
            return `<li>${projectMark(p, 'xs')}<span class="free-up-main"><span class="free-up-title">${esc(p?.title || ownedTitle(r.project_id))}</span><span class="free-up-meta">${size(Number(r.bytes))}${byProject.length > 1 ? ` · ${ko ? `전체의 ${share}%` : `${share}% of your storage`}` : ''}</span>${byProject.length > 1 ? `<span class="free-up-bar"><i style="width:${share}%"></i></span>` : ''}</span><a class="btn small${i === 0 ? ' primary' : ''}" href="/app/p/${r.project_id}" data-link>${ko ? '영상 정리하기' : 'Review videos'} <span aria-hidden="true">›</span></a></li>`;
          }).join('')}</ul>` : ''}
          <p class="free-up-more">${ko ? '공간이 더 필요하신가요?' : 'Need more room?'} <button type="button" class="link-btn" data-more-storage>${ko ? '저희에게 알려 주세요' : 'Tell us'}</button>${ko ? '. 늘려 드릴게요.' : ' and we’ll add more.'}</p>
        </div>` : '';
    const intro = ko
      ? `모든 기능을 쓸 수 있고 인원, 프로젝트, AI 요약에 제한이 없어요. 팀 오너마다 영상 저장 공간 ${size(allowance)}(연습 영상 약 ${aboutVideos(allowance)}개)가 주어져요.`
      : `Every feature, with no limit on people, projects, or AI recaps. Each team owner gets ${size(allowance)} for videos, about ${aboutVideos(allowance)} practice videos.`;
    return {
      html: `<section class="panel">
        <div class="panel-head"><div><p class="eyebrow">Your plan</p><h2>dancerly is free</h2><p class="muted" data-no-i18n>${intro}</p></div></div>
        <div class="usage">
          <div class="storage-row"><span>Video storage</span><b data-no-i18n>${size(used)} / ${size(allowance)}</b>${meter}
            <small data-no-i18n>${note}${!tight && perProject.length > 1 ? ` · ${perProject.map((r) => `${esc(ownedTitle(r.project_id))} ${size(Number(r.bytes))}`).join(' · ')}` : ''}</small></div>
        </div>
        ${freeUp}
        <p class="fine left">Uploads by everyone in your projects count toward your storage. If we ever add paid plans, we’ll tell you well in advance, and everything you’ve uploaded stays yours.</p>
      </section>`,
      // "Tell us": the in-app help form, ready to send (works without a mail app, and we see who's asking).
      wire: () => $('[data-more-storage]')?.addEventListener('click', () => openHelp({
        kind: 'other',
        body: ko ? '팀 영상 저장 공간이 더 필요해요.' : 'We need more video storage for our team.',
        intro: ko ? '어떤 팀인지, 얼마나 자주 영상을 올리는지 한두 줄 적어 주시면 더 빨리 늘려 드릴게요.' : 'A line about your team and how often you upload helps us add room faster.',
        done: ko ? '저장 공간을 늘린 뒤 이메일로 알려 드릴게요.' : 'We’ll add more storage and email you once it’s ready.'
      }))
    };
  }
}
