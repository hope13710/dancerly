// Help & support: one place to tell us anything (a bug, an idea, a question) without leaving the app,
// plus email and the FAQ. Messages go through the send-feedback function into app_feedback (migration 024)
// and the Notion inbox, with the page and browser attached. If that isn't set up yet, the same message opens
// in the mail app instead, so nothing typed is lost.
import { sb, toast } from './client.js';
import { ctx } from './ctx.js';
import { getLang } from './i18n.js';
import { track } from './onboarding.js';

const EMAIL = 'help@dancerly.app';
const KINDS = [['bug', 'Something’s broken'], ['idea', 'Idea'], ['question', 'Question'], ['other', 'Other']];

export function openHelp({ kind = 'bug' } = {}) {
  const el = document.createElement('dialog');
  el.className = 'dialog help-dialog';
  el.innerHTML = `<form method="dialog" class="dialog-card">
    <div class="help-head"><h2>Help &amp; support</h2><button type="button" class="icon-btn" data-help-close aria-label="Close">✕</button></div>
    <div data-help-form>
      <p class="muted">Tell us anything. We read every message.</p>
      <div class="chips help-kinds" role="radiogroup" aria-label="What is it about?">${KINDS.map(([k, label]) => `<button type="button" class="chip" role="radio" data-kind="${k}" aria-checked="${k === kind}" aria-pressed="${k === kind}">${label}</button>`).join('')}</div>
      <label class="field"><span class="sr-only">Message</span><textarea name="body" rows="5" maxlength="4000" required placeholder="What happened, or what would make dancerly better for your team?"></textarea></label>
      <p class="fine left">We’ll attach the page you’re on and your browser, to help us fix things faster.</p>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-help-close>Cancel</button><button type="submit" class="btn primary" data-help-send>Send</button></div>
    </div>
    <div class="help-done" data-help-done hidden>
      <div class="help-done-icon" aria-hidden="true">✓</div>
      <h3>Thanks, we got it.</h3>
      <p class="muted">We read every message. If you asked something, we’ll reply to your email.</p>
      <div class="dialog-actions"><button type="button" class="btn primary" data-help-close>Done</button></div>
    </div>
    <div class="help-links">
      <a href="mailto:${EMAIL}?subject=${encodeURIComponent('dancerly help')}" data-help-email><span aria-hidden="true">✉</span> Email us<small>${EMAIL}</small></a>
      <a href="/#faq" target="_blank" rel="noopener"><span aria-hidden="true">?</span> FAQ<small>Common questions</small></a>
    </div>
  </form>`;
  document.body.append(el);
  el.showModal();
  track('help_opened', { from: location.pathname.split('/')[2] || 'home' });
  let picked = kind;
  const form = el.querySelector('form');
  const text = el.querySelector('textarea');
  text.focus();
  el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    picked = b.dataset.kind;
    el.querySelectorAll('[data-kind]').forEach((x) => { x.setAttribute('aria-checked', String(x === b)); x.setAttribute('aria-pressed', String(x === b)); });
  }));
  el.querySelectorAll('[data-help-close]').forEach((b) => b.addEventListener('click', () => el.close()));
  el.addEventListener('close', () => el.remove());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = text.value.trim();
    if (!body) return text.focus();
    const send = el.querySelector('[data-help-send]');
    send.disabled = true;
    const row = { kind: picked, body, page: location.pathname + location.search, user_agent: navigator.userAgent.slice(0, 500), lang: getLang() };
    // The send-feedback function saves it and copies it to the Notion inbox; if it isn't there, save directly.
    let { error } = await sb.functions.invoke('send-feedback', { body: row });
    if (error) ({ error } = await sb.from('app_feedback').insert(row));
    if (error) {
      // Not set up yet (or offline): hand the same message to the mail app.
      const mail = `mailto:${EMAIL}?subject=${encodeURIComponent(`dancerly ${picked}`)}&body=${encodeURIComponent(`${body}\n\n—\nPage: ${row.page}\nBrowser: ${row.user_agent}`)}`;
      send.disabled = false;
      toast('Couldn’t send from here. Opening your email instead.');
      location.href = mail;
      return;
    }
    track('feedback_sent', { kind: picked });
    el.querySelector('[data-help-form]').hidden = true;
    el.querySelector('[data-help-done]').hidden = false;
    el.querySelector('[data-help-done] .btn').focus();
  });
}

// Anything marked [data-help] opens it (sidebar, account menu, Me page).
document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-help]');
  if (!el || !ctx.state?.session) return;
  event.preventDefault();
  document.querySelector('[data-account-menu]')?.setAttribute('hidden', '');
  openHelp();
});
