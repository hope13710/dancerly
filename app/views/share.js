// Sharing outside the team: a read-only guest link for one video, and a calendar subscription URL.
import { sb, $, $$, esc, fmt, toast, friendlyError, SUPABASE_URL } from '../client.js';
import { ctx } from '../ctx.js';
import { placeLayer, paintSketches, sketchShowsAt } from '../sketch.js';

function copyRow(value) {
  return `<div class="copy-row"><input readonly value="${esc(value)}" /><button class="btn primary" type="button" data-copy="${esc(value)}">Copy</button></div>`;
}
function wireCopy(root) {
  $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied.'); } catch { b.previousElementSibling.select(); toast('Press Ctrl+C to copy.'); }
  }));
}
function sheet(html) {
  const el = document.createElement('dialog');
  el.className = 'dialog';
  el.innerHTML = `<div class="dialog-card">${html}<div class="dialog-actions"><button class="btn ghost" data-close>Done</button></div></div>`;
  document.body.append(el);
  el.showModal();
  el.querySelector('[data-close]').addEventListener('click', () => el.close());
  el.addEventListener('close', () => el.remove());
  return el;
}

// ---------- Guest link for one video ----------
export async function shareVideo(videoId, videoTitle) {
  const me = ctx.state.session.user.id;
  const { data: links } = await sb.from('video_shares').select('token, include_notes, expires_at, created_by, views').eq('video_id', videoId).eq('revoked', false).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
  const el = sheet(`<h2>Share outside the team</h2>
    <p>Anyone with the link can watch the latest take of <b>${esc(videoTitle)}</b> — no account needed. They can’t comment or download, and the link stops working when it expires.</p>
    <form class="share-form" data-new-share>
      <label class="check-row"><input type="checkbox" name="notes" checked /> <span><b>Include notes</b><small>Guests see the notes on this take, read-only.</small></span></label>
      <label class="field"><span>Expires</span><select name="days"><option value="7">In 7 days</option><option value="14" selected>In 14 days</option><option value="30">In 30 days</option></select></label>
      <button class="btn primary" type="submit">Create link</button>
    </form>
    <div data-links>${(links || []).map((l) => `<div class="share-link">
      ${copyRow(`${location.origin}/app/s/${l.token}`)}
      <p class="fine left">${l.include_notes ? 'With notes' : 'Video only'} · expires ${new Date(l.expires_at).toLocaleDateString()} · ${l.views} ${l.views === 1 ? 'view' : 'views'}
        ${l.created_by === me ? `· <button class="link-btn inline danger" type="button" data-off="${l.token}">Turn off</button>` : ''}</p>
    </div>`).join('')}</div>`);
  wireCopy(el);
  $('[data-new-share]', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    const expires = new Date(Date.now() + Number(f.namedItem('days').value) * 864e5).toISOString();
    const { data, error } = await sb.from('video_shares').insert({ video_id: videoId, include_notes: f.namedItem('notes').checked, expires_at: expires }).select('token').single();
    if (error) return toast(friendlyError(error), 'error');
    const url = `${location.origin}/app/s/${data.token}`;
    try { await navigator.clipboard.writeText(url); toast('Link created and copied.'); } catch { toast('Link created.'); }
    el.close();
    shareVideo(videoId, videoTitle);
  });
  $$('[data-off]', el).forEach((b) => b.addEventListener('click', async () => {
    const { error } = await sb.from('video_shares').update({ revoked: true }).eq('token', b.dataset.off);
    if (error) return toast(friendlyError(error), 'error');
    toast('Link turned off.');
    el.close();
    shareVideo(videoId, videoTitle);
  }));
}

// What a guest sees at /app/s/:token.
export async function renderShared(token) {
  const { view } = ctx;
  document.body.classList.add('is-guest');
  const { data, error } = await sb.functions.invoke('shared-video', { body: { token } });
  let message = null;
  if (error) { try { message = (await error.context.json()).error; } catch { message = 'This link isn’t available.'; } }
  if (message || !data?.url) {
    view.innerHTML = `<section class="auth"><div class="auth-card center"><div class="inbox-icon">⌛</div><h1>Link unavailable</h1><p class="muted">${esc(message || 'This video isn’t available.')}</p><a class="btn wide" href="/" >About Looproom</a></div></section>`;
    return () => document.body.classList.remove('is-guest');
  }
  view.innerHTML = `<section class="page guest">
    <header class="page-head"><div><p class="eyebrow">Shared with you · ${esc(data.project)}</p><h1>${esc(data.title)}</h1><p class="muted sub">Take ${data.take} · link expires ${new Date(data.expires_at).toLocaleDateString()}</p></div></header>
    <div class="guest-layout">
      <div class="guest-player"><video class="guest-video" src="${esc(data.url)}" controls playsinline controlslist="nodownload" data-video></video><svg class="sketch-layer" data-sketch-layer aria-hidden="true"></svg></div>
      ${data.notes.length ? `<aside class="panel guest-notes"><div class="panel-head"><div><h2>Notes</h2><p class="muted">Tap a time to jump there.</p></div></div>
        <ul>${data.notes.map((n) => `<li><button class="time-chip light" data-seek="${n.t_start}">${n.t_end === null ? '▸' : '⟷'} ${n.t_end === null ? fmt(n.t_start) : `${fmt(n.t_start)}–${fmt(n.t_end)}`}</button><div><p>${esc(n.body)}</p><small>${esc(n.author)}${n.status === 'resolved' ? ' · resolved' : ''}${n.sketch ? ' · ✎ sketch' : ''}</small></div></li>`).join('')}</ul></aside>` : ''}
    </div>
    <p class="fine guest-foot">Shared from <a href="/">Looproom</a> — timestamped feedback for dance teams.</p>
  </section>`;
  const video = $('[data-video]');
  $$('[data-seek]').forEach((b) => b.addEventListener('click', () => {
    const n = data.notes.find((x) => String(x.t_start) === b.dataset.seek && x.sketch);
    // A note with a sketch stops on its frame so the drawing can be read.
    if (n) { video.pause(); video.currentTime = Number(b.dataset.seek); } else { video.currentTime = Math.max(0, Number(b.dataset.seek) - 1); video.play(); }
  }));
  // Sketches show over the video at their moment, like in the team's review.
  const layer = $('[data-sketch-layer]');
  const sketched = data.notes.filter((n) => n.sketch);
  let shownKey = '';
  const paint = (force) => {
    const shown = sketched.filter((n) => sketchShowsAt(n, video.currentTime));
    const key = shown.map((n) => n.id).join();
    if (key === shownKey && !force) return;
    shownKey = key;
    paintSketches(layer, shown.map((n) => n.sketch));
  };
  const place = () => { placeLayer(layer, video); paint(true); };
  let frame = 0;
  const loop = () => { paint(false); frame = requestAnimationFrame(loop); };
  if (sketched.length) {
    video.addEventListener('loadedmetadata', place);
    window.addEventListener('resize', place);
    frame = requestAnimationFrame(loop);
  }
  return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', place); document.body.classList.remove('is-guest'); };
}

// ---------- Calendar subscription ----------
export async function subscribeCalendar() {
  let { data: feed } = await sb.from('calendar_feeds').select('token').limit(1).maybeSingle();
  if (!feed) {
    const { data, error } = await sb.from('calendar_feeds').insert({}).select('token').single();
    if (error) return toast(friendlyError(error), 'error');
    feed = data;
  }
  const url = `${SUPABASE_URL}/functions/v1/calendar-feed?token=${feed.token}`;
  const el = sheet(`<h2>Subscribe in your calendar</h2>
    <p>Rehearsals, shows, and request due dates from all your projects, kept up to date in Google, Apple, or Outlook Calendar. Keep this link private — anyone with it can see your schedule.</p>
    ${copyRow(url)}
    <ul class="how-to">
      <li><b>Google Calendar</b> · Other calendars → + → From URL → paste</li>
      <li><b>Apple Calendar</b> · <a class="link" href="${esc(url.replace(/^https:/, 'webcal:'))}">Open in Calendar</a>, or File → New Calendar Subscription</li>
      <li><b>Outlook</b> · Add calendar → Subscribe from web → paste</li>
    </ul>
    <p class="fine left">Calendar apps refresh every few hours. <button class="link-btn inline danger" type="button" data-off>Turn this link off</button></p>`);
  wireCopy(el);
  $('[data-off]', el).addEventListener('click', async () => {
    const { error } = await sb.from('calendar_feeds').delete().eq('token', feed.token);
    if (error) return toast(friendlyError(error), 'error');
    toast('Calendar link turned off. Make a new one any time.');
    el.close();
  });
}
