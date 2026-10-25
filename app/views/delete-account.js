// Settings › Delete account. One page, top to bottom: what goes and what stays, decide on the projects you manage,
// download your data, (optionally) tell us why, then confirm with your email and password.
import { sb, $, $$, esc, toast, friendlyError, loadMembers, TAKE_BUCKET, isPublicMedia } from '../client.js';
import { ctx } from '../ctx.js';
import { isKo } from '../i18n.js';

const isSamplePerson = (id) => id.startsWith('5a3b0000-');
const REASONS = [
  ['not_using', 'I don’t use it anymore'],
  ['team_left', 'My team stopped using it'],
  ['missing_feature', 'It’s missing something I need'],
  ['too_hard', 'It was hard to use'],
  ['switching', 'I’m switching to something else'],
  ['privacy', 'Privacy concerns'],
  ['other', 'Something else']
];

export async function renderDeleteAccount() {
  const { state, view, setCrumbs } = ctx;
  setCrumbs([['Settings', '/app/settings'], ['Account', '/app/settings/account'], ['Delete account']]);
  const me = state.session.user.id;
  const email = state.session.user.email || '';

  const [{ data: owned }, { count: takeCount }, { count: noteCount }, { count: replyCount }] = await Promise.all([
    sb.from('project_members').select('project_id, projects(id, title, is_sample)').eq('user_id', me).eq('role', 'owner'),
    sb.from('takes').select('id', { count: 'exact', head: true }).eq('uploaded_by', me),
    sb.from('notes').select('id', { count: 'exact', head: true }).eq('author_id', me),
    sb.from('note_replies').select('id', { count: 'exact', head: true }).eq('author_id', me)
  ]);
  // Sort the projects you manage: only you (deleted with you), someone else also manages (stays), or yours to decide.
  const projects = await Promise.all((owned || []).filter((r) => r.projects).map(async (r) => {
    const members = await loadMembers(r.project_id);
    const others = members.filter((m) => m.user_id !== me && !isSamplePerson(m.user_id)).sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)));
    const kind = r.projects.is_sample || !others.length ? 'alone' : others.some((m) => m.role === 'owner') ? 'shared' : 'decide';
    return { ...r.projects, others, kind };
  }));
  const decide = projects.filter((p) => p.kind === 'decide');
  const alone = projects.filter((p) => p.kind === 'alone');
  const decisions = Object.fromEntries(decide.map((p) => [p.id, { action: 'transfer', to: p.others[0].user_id }]));

  view.innerHTML = `<section class="page narrow delete-account">
    <header class="page-head"><div><h1>Delete your account</h1><p class="muted sub">This permanently deletes your Looproom account. It can’t be undone.</p></div></header>

    <section class="panel">
      <div class="panel-head"><div><h2>What happens</h2></div></div>
      <div class="da-columns">
        <div><h3 class="da-gone">Deleted for good</h3><ul>
          <li>Your profile, photo, and sign-in</li>
          <li data-no-i18n>${isKo ? `내가 올린 테이크 ${takeCount || 0}개와 그 영상 파일` : `Your ${takeCount || 0} uploaded ${takeCount === 1 ? 'take' : 'takes'} and their video files`}</li>
          <li data-no-i18n>${isKo ? `내가 남긴 피드백 ${noteCount || 0}개, 답글 ${replyCount || 0}개` : `Your ${noteCount || 0} ${noteCount === 1 ? 'note' : 'notes'} and ${replyCount || 0} ${replyCount === 1 ? 'reply' : 'replies'}`}</li>
          <li>Your 👍 reactions, AI summaries, share links, and calendar links</li>
          ${alone.length ? `<li data-no-i18n>${isKo ? `나만 있는 프로젝트: ${alone.map((p) => esc(p.title)).join(', ')}` : `Projects only you are in: ${alone.map((p) => esc(p.title)).join(', ')}`}</li>` : ''}
        </ul></div>
        <div><h3 class="da-stays">Stays with your teams</h3><ul>
          <li>Projects you hand over below, or that another owner already manages</li>
          <li>Calendar events, pages, video requests, and groups you set up — without your name</li>
          <li>Videos where teammates also uploaded takes — their takes stay</li>
        </ul></div>
      </div>
    </section>

    ${decide.length ? `<section class="panel">
      <div class="panel-head"><div><h2>Projects you manage</h2><p class="muted">Your teammates are still using these. Choose who takes over, or delete the project for everyone.</p></div></div>
      <div class="da-projects">${decide.map((p) => `<div class="da-project" data-project="${p.id}">
        <div class="da-project-head"><b>${esc(p.title)}</b><small data-no-i18n>${isKo ? `나 외 ${p.others.length}명` : `${p.others.length} other ${p.others.length === 1 ? 'member' : 'members'}`}</small></div>
        <label class="da-choice"><input type="radio" name="d-${p.id}" value="transfer" checked /><span>Hand over to</span>
          <select data-to aria-label="New owner">${p.others.map((m) => `<option value="${m.user_id}">${esc(m.name)}</option>`).join('')}</select></label>
        <label class="da-choice"><input type="radio" name="d-${p.id}" value="delete" /><span>Delete this project and everything in it, for everyone</span></label>
      </div>`).join('')}</div>
    </section>` : ''}

    <section class="panel">
      <div class="panel-head"><div><h2>Download your data</h2><p class="muted">A file with your profile, projects, notes, and replies, plus links to download your videos (valid for 7 days).</p></div><button class="btn" data-export>Download</button></div>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h2>Why are you leaving?</h2><p class="muted">Optional. Kept without your name or email, so we can make Looproom better.</p></div></div>
      <div class="da-reasons">${REASONS.map(([k, l]) => `<label class="da-reason"><input type="radio" name="reason" value="${k}" /><span>${l}</span></label>`).join('')}</div>
      <label class="field"><span>Anything else? (optional)</span><textarea data-details maxlength="1000" rows="3"></textarea></label>
    </section>

    <form class="panel da-confirm" data-confirm novalidate>
      <div class="panel-head"><div><h2>Confirm deletion</h2><p class="muted" data-no-i18n>${isKo ? `확인을 위해 이메일 <b>${esc(email)}</b>과 비밀번호를 입력해 주세요.` : `To confirm, type your email <b>${esc(email)}</b> and your password.`}</p></div></div>
      <label class="field"><span>Email</span><input name="confirm" type="email" autocomplete="off" required placeholder="${esc(email)}" /></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required /></label>
      <p class="fine left">No password yet? <a href="/app/reset" data-link>Set one first</a>.</p>
      <label class="consent"><input type="checkbox" name="understand" required /><span>I understand my account and the content listed above will be permanently deleted.</span></label>
      <p class="form-error" data-error role="alert" hidden></p>
      <div class="da-actions"><a class="btn ghost" href="/app/settings/account" data-link>Cancel</a><button class="btn danger" type="submit" disabled>Delete my account</button></div>
    </form>
  </section>`;

  // Project decisions
  $$('.da-project').forEach((row) => {
    const id = row.dataset.project;
    const sync = () => {
      const action = row.querySelector('input[type=radio]:checked').value;
      decisions[id] = action === 'delete' ? { action } : { action, to: row.querySelector('[data-to]').value };
      row.classList.toggle('deleting', action === 'delete');
    };
    row.addEventListener('change', sync);
  });

  $('[data-export]').addEventListener('click', (e) => exportData(e.currentTarget));

  // Confirm
  const form = $('[data-confirm]');
  const submit = form.querySelector('[type=submit]');
  const ready = () => {
    submit.disabled = !(form.confirm.value.trim().toLowerCase() === email.toLowerCase() && form.password.value && form.understand.checked);
  };
  form.addEventListener('input', ready);
  form.addEventListener('change', ready);
  const showError = (msg) => { const el = $('[data-error]'); el.textContent = msg; el.hidden = false; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    submit.textContent = isKo ? '삭제하는 중…' : 'Deleting…';
    const body = {
      confirm: form.confirm.value.trim(),
      password: form.password.value,
      decisions,
      reason: $('input[name=reason]:checked')?.value || null,
      details: $('[data-details]').value.trim() || null
    };
    const { data, error } = await sb.functions.invoke('delete-account', { body });
    if (error || !data?.ok) {
      let msg = friendlyError(error || { message: 'Something went wrong. Nothing was deleted.' });
      try { const detail = await error?.context?.json?.(); if (detail?.error) msg = detail.error; } catch {}
      submit.textContent = isKo ? '계정 삭제하기' : 'Delete my account';
      ready();
      return showError(msg);
    }
    window.dataLayer?.push({ event: 'account_deleted', reason: body.reason });
    state.farewellUntil = Date.now() + 15000;
    await sb.auth.signOut().catch(() => {});
    ctx.navigate('/app/login', { replace: true });
  });

  // Everything you made, as one JSON file, with 7-day links to your videos.
  async function exportData(button) {
    button.disabled = true;
    const label = button.textContent;
    button.textContent = isKo ? '준비하는 중…' : 'Preparing…';
    try {
      const [profile, memberships, takes, notes, replies, requests, events, pages, recaps] = await Promise.all([
        sb.from('profiles').select('display_name, avatar_url, created_at').eq('id', me).maybeSingle(),
        sb.from('project_members').select('role, joined_at, projects(title)').eq('user_id', me),
        sb.from('takes').select('number, created_at, file_name, storage_path, videos(title, projects(title))').eq('uploaded_by', me),
        sb.from('notes').select('body, t_start, t_end, status, created_at, resolved_at, private_to, videos(title), takes(number)').eq('author_id', me),
        sb.from('note_replies').select('body, created_at, notes(body)').eq('author_id', me),
        sb.from('requests').select('title, brief, due_at, created_at').eq('created_by', me),
        sb.from('project_events').select('title, kind, starts_at, ends_at, location, details').eq('created_by', me),
        sb.from('project_pages').select('title, body, created_at, updated_at').eq('created_by', me),
        sb.from('recaps').select('scope, period, period_start, period_end, content, created_at').eq('created_by', me)
      ]);
      const stored = (takes.data || []).filter((t) => !isPublicMedia(t.storage_path));
      const { data: links } = stored.length ? await sb.storage.from(TAKE_BUCKET).createSignedUrls(stored.map((t) => t.storage_path), 7 * 86400) : { data: [] };
      const linkOf = Object.fromEntries((links || []).map((l) => [l.path, l.signedUrl]));
      const file = {
        exported_at: new Date().toISOString(),
        account: { email, ...(profile.data || {}) },
        projects: (memberships.data || []).map((m) => ({ project: m.projects?.title, role: m.role, joined_at: m.joined_at })),
        videos: stored.map((t) => ({ video: t.videos?.title, project: t.videos?.projects?.title, take: t.number, uploaded_at: t.created_at, file_name: t.file_name, download_link_valid_7_days: linkOf[t.storage_path] || null })),
        notes: (notes.data || []).map((n) => ({ video: n.videos?.title, take: n.takes?.number, at_seconds: Number(n.t_start), until_seconds: n.t_end === null ? null : Number(n.t_end), text: n.body, status: n.status, private: Boolean(n.private_to), created_at: n.created_at, resolved_at: n.resolved_at })),
        replies: (replies.data || []).map((r) => ({ text: r.body, on_note: r.notes?.body, created_at: r.created_at })),
        video_requests: requests.data || [],
        calendar_events: events.data || [],
        pages: pages.data || [],
        ai_summaries: recaps.data || []
      };
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `looproom-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(isKo ? '내 데이터 파일을 내려받았어요.' : 'Your data file is downloading.');
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }
}
