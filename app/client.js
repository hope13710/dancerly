import { createClient } from './vendor/supabase-js-2.45.4.js';

// Public values: the publishable key only works together with row level security in the database.
export const SUPABASE_URL = 'https://egkwjdwfzuslyrhuzkmq.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tPZZPnIucN4L1EAwXam_uA_3m7tNshc';

export const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// Turn on after enabling the Google provider in Supabase (Authentication → Sign In / Providers).
export const GOOGLE_ENABLED = false;

// Columns added for first-run guidance (migration 018). Until the database has them, queries leave them out
// and the guidance stays off, so the rest of the app keeps working.
// Same for take alignment (migration 019).
export const schema = { firstRun: true, align: true };
const missing = (error) => Boolean(error && /42703|does not exist/i.test(`${error.code} ${error.message}`));
export async function detectSchema() {
  const [a, b] = await Promise.all([sb.from('projects').select('is_sample').limit(1), sb.from('takes').select('align').limit(1)]);
  schema.firstRun = !missing(a.error);
  schema.align = !missing(b.error);
}
export function cols(list) {
  const drop = [...(schema.firstRun ? [] : ['is_sample', 'onboarding']), ...(schema.align ? [] : ['align'])];
  return drop.reduce((s, c) => s.replace(new RegExp(`,\\s*${c}\\b`, 'g'), '').replace(new RegExp(`\\b${c},\\s*`, 'g'), ''), list);
}

export const TAKE_BUCKET = 'takes';
export const MAX_TAKE_BYTES = 50 * 1024 * 1024;
// Sample-project media ships with the site: paths starting with "public:" are served from here, not storage.
const PUBLIC_PREFIX = 'public:';
export async function takeUrl(path, seconds = 60 * 60 * 3) {
  if (String(path).startsWith(PUBLIC_PREFIX)) return location.origin + path.slice(PUBLIC_PREFIX.length);
  const { data, error } = await sb.storage.from(TAKE_BUCKET).createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}
export const isPublicMedia = (path) => String(path || '').startsWith(PUBLIC_PREFIX);
export const publicMediaUrl = (path) => location.origin + path.slice(PUBLIC_PREFIX.length);
export const TAKE_TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

// ---------- Small DOM helpers shared by every view ----------
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const initials = (name) => String(name || '?').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

// Profile photos, remembered as profiles load, so any avatar can show a face instead of initials.
export const photos = new Map();
export const rememberPhotos = (rows) => { for (const p of rows || []) if (p?.id) { if (p.avatar_url) photos.set(p.id, p.avatar_url); else photos.delete(p.id); } };
export function avatar(name, userId, cls = '') {
  const url = userId && photos.get(userId);
  return `<span class="avatar ${cls}" title="${esc(name || '')}">${url ? `<img src="${esc(url)}" alt="" loading="lazy" />` : esc(initials(name))}</span>`;
}
// A project's square mark: its image, or its initials.
export function projectMark(project, cls = '') {
  return `<span class="card-mark ${cls}">${project?.image_url ? `<img src="${esc(project.image_url)}" alt="" loading="lazy" />` : esc(initials(project?.title))}</span>`;
}

// Wires [data-pick-image] / [data-remove-image] / [data-image-file] on the current screen.
export function wireImagePicker({ folder, save, done, root = document }) {
  const input = root.querySelector('[data-image-file]');
  root.querySelector('[data-pick-image]')?.addEventListener('click', () => input.click());
  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const button = root.querySelector('[data-pick-image]');
    button.disabled = true;
    button.textContent = 'Uploading…';
    try {
      const url = await uploadImage(file, folder);
      const { error } = await save(url);
      if (error) throw error;
      await done(url);
    } catch (err) {
      toast(friendlyError(err), 'error');
      button.disabled = false;
      button.textContent = 'Try again';
    }
  });
  root.querySelector('[data-remove-image]')?.addEventListener('click', async () => {
    const { error } = await save(null);
    if (error) return toast(friendlyError(error), 'error');
    await done(null);
  });
}

// Square-crops and shrinks a picked photo on the device, then stores it in the public images bucket.
export async function uploadImage(file, folder) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error('Pick a JPG, PNG, or WebP image.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That image is too large. Pick one under 25 MB.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('This image format can’t be read here. Try a JPG or PNG.'); }
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(512, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
  const type = blob?.type === 'image/webp' ? 'webp' : 'jpg';
  const body = type === 'webp' ? blob : await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const path = `${folder}/${crypto.randomUUID()}.${type}`;
  const { error } = await sb.storage.from('images').upload(path, body, { contentType: `image/${type === 'jpg' ? 'jpeg' : 'webp'}`, cacheControl: '31536000' });
  if (error) throw error;
  return sb.storage.from('images').getPublicUrl(path).data.publicUrl;
}
export const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
export const fmtFine = (sec) => `${fmt(sec)}.${Math.floor((sec % 1) * 10)}`;
export const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

let toastTimer;
export function toast(message, kind = 'info') {
  const el = $('[data-toast]');
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// Supabase errors are often technical; keep the useful part and say what to do.
export function friendlyError(error) {
  const msg = error?.message || String(error || 'Something went wrong.');
  const wait = msg.match(/after (\d+) seconds/i);
  if (wait) return `Wait ${wait[1]} seconds before asking for another email.`;
  if (/email rate limit/i.test(msg)) return 'We’ve hit the email limit for now. Try again a little later — or use the code from an email you already have.';
  if (/invalid or has expired|otp_expired|token has expired|token not found/i.test(msg)) return 'That link or code was already used or has expired. Each one works once — ask for a new one below.';
  if (/invalid login credentials/i.test(msg)) return 'Email or password doesn’t match. Joined before passwords? Use “Forgot password?” to set one.';
  if (/user already registered/i.test(msg)) return 'That email already has an account. Log in instead.';
  if (/password should be|weak password/i.test(msg)) return 'Pick a longer password — at least 8 characters, ideally mixing letters and numbers.';
  if (/should be different from the old/i.test(msg)) return 'That’s your current password. Choose a new one.';
  if (/provider is not enabled/i.test(msg)) return 'Google sign-in isn’t turned on yet. Use your email for now.';
  if (/rate limit|too many/i.test(msg)) return 'Too many tries. Wait a minute and try again.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Can’t reach Looproom. Check your connection and try again.';
  if (/JWT|not authenticated|session/i.test(msg)) return 'Your session ended. Log in again.';
  if (/row-level security|permission denied/i.test(msg)) return 'You don’t have permission to do that.';
  if (/Payload too large|exceeded the maximum allowed size/i.test(msg)) return 'That video is over 50 MB. Trim it or export a smaller file.';
  return msg;
}

// A small promise-based dialog so views can ask for a title or confirm a delete.
export function dialog({ title, body = '', fields = [], confirm = 'Save', danger = false, extra = null }) {
  return new Promise((resolve) => {
    const el = document.createElement('dialog');
    el.className = 'dialog';
    el.innerHTML = `<form method="dialog" class="dialog-card">
      <h2>${esc(title)}</h2>${body ? `<p>${body}</p>` : ''}
      ${fields.map((f) => `<label class="field"><span>${esc(f.label)}</span>${f.type === 'select'
        ? `<select name="${f.name}" ${f.required ? 'required' : ''}>${f.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`
        : f.type === 'file'
        ? `<input name="${f.name}" type="file" accept="${f.accept || ''}" ${f.required ? 'required' : ''} />`
        : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" maxlength="${f.max || 120}" ${f.required ? 'required' : ''} />`}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`).join('')}
      <div class="dialog-actions">${extra ? `<button value="extra" formnovalidate class="btn ghost danger push-left">${esc(extra)}</button>` : ''}<button value="cancel" formnovalidate class="btn ghost">Cancel</button><button value="ok" class="btn ${danger ? 'danger' : 'primary'}">${esc(confirm)}</button></div>
    </form>`;
    document.body.append(el);
    el.addEventListener('close', () => {
      const ok = el.returnValue === 'ok';
      const values = Object.fromEntries(fields.map((f) => {
        const input = el.querySelector(`[name="${f.name}"]`);
        return [f.name, f.type === 'file' ? input.files?.[0] : input.value.trim()];
      }));
      el.remove();
      resolve(el.returnValue === 'extra' ? { extra: true } : ok ? values : null);
    });
    el.showModal();
    el.querySelector('input')?.focus();
  });
}

// A short list of choices: a bottom sheet on phones, a small centered card elsewhere.
export function actionSheet({ title, actions }) {
  return new Promise((resolve) => {
    const el = document.createElement('dialog');
    el.className = 'dialog sheet';
    el.innerHTML = `<form method="dialog" class="dialog-card">
      <h2>${esc(title)}</h2>
      <div class="sheet-actions">${actions.map((a) => `<button value="${esc(a.value)}" class="sheet-action"><b>${esc(a.label)}</b>${a.hint ? `<small>${esc(a.hint)}</small>` : ''}</button>`).join('')}</div>
      <button value="" class="btn ghost wide">Cancel</button>
    </form>`;
    document.body.append(el);
    el.addEventListener('click', (event) => { if (event.target === el) el.close(''); });
    el.addEventListener('close', () => { el.remove(); resolve(el.returnValue || null); });
    el.showModal();
  });
}

// One shared upload bar, so people can keep working while a take uploads.
// Closing the tab mid-upload asks first; picking the same file again later resumes it.
let uploading = 0;
window.addEventListener('beforeunload', (e) => { if (uploading) { e.preventDefault(); e.returnValue = ''; } });
export async function withUploadBar(label, task) {
  const bar = $('[data-upload-bar]');
  bar.querySelector('span').textContent = label;
  bar.classList.add('show');
  uploading += 1;
  try {
    return await task((stage) => { bar.querySelector('span').textContent = `${stage} · ${label}`; });
  } finally {
    uploading -= 1;
    bar.classList.remove('show');
  }
}

// Project members with their display names, owner first.
export async function loadMembers(projectId) {
  const { data: members, error } = await sb.from('project_members').select('user_id, role, joined_at').eq('project_id', projectId);
  if (error) throw error;
  const { data: profiles } = await sb.from('profiles').select('id, display_name, avatar_url').in('id', members.map((m) => m.user_id));
  rememberPhotos(profiles);
  const names = Object.fromEntries((profiles || []).map((p) => [p.id, p.display_name]));
  return members.map((m) => ({ ...m, name: names[m.user_id] || 'Member' })).sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0));
}
