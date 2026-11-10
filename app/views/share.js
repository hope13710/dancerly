// Sharing outside the team: a read-only guest link for one video, and a calendar subscription URL.
import { sb, $, $$, esc, fmt, toast, friendlyError, SUPABASE_URL, schema, fmtFine, dialog } from '../client.js';
import { ctx } from '../ctx.js';
import { placeLayer, paintSketches, sketchShowsAt } from '../sketch.js';
import { countAt } from '../counts.js';
import { ic } from '../icons.js';

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
  const { data: links } = await sb.from('video_shares').select('*').eq('video_id', videoId).eq('revoked', false).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
  const el = sheet(`<h2>Share outside the project</h2>
    <p>Anyone with the link can watch the latest take of <b>${esc(videoTitle)}</b> — no account needed. They can’t download it, and the link stops working when it expires.</p>
    <form class="share-form" data-new-share>
      <label class="check-row"><input type="checkbox" name="notes" checked /> <span><b>Include notes</b><small>Guests see the notes on this take, read-only.</small></span></label>
      ${schema.joinRequests ? `<label class="check-row"><input type="checkbox" name="requests" checked /> <span><b>Let people ask to join</b><small>They can write a note and send it with a request to join. Nothing is posted until the owner approves.</small></span></label>` : ''}
      <label class="field"><span>Expires</span><select name="days"><option value="7">In 7 days</option><option value="14" selected>In 14 days</option><option value="30">In 30 days</option></select></label>
      <button class="btn primary" type="submit">Create link</button>
    </form>
    <div data-links>${(links || []).map((l) => `<div class="share-link">
      ${copyRow(`${location.origin}/app/s/${l.token}`)}
      <p class="fine left">${l.include_notes ? 'With notes' : 'Video only'}${l.allow_requests === false ? '' : ' · takes requests'} · expires ${new Date(l.expires_at).toLocaleDateString()} · ${l.views} ${l.views === 1 ? 'view' : 'views'}
        ${l.created_by === me ? `· <button class="link-btn inline danger" type="button" data-off="${l.token}">Turn off</button>` : ''}</p>
    </div>`).join('')}</div>`);
  wireCopy(el);
  $('[data-new-share]', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    const expires = new Date(Date.now() + Number(f.namedItem('days').value) * 864e5).toISOString();
    const { data, error } = await sb.from('video_shares').insert({ video_id: videoId, include_notes: f.namedItem('notes').checked, expires_at: expires, ...(f.namedItem('requests') && !f.namedItem('requests').checked ? { allow_requests: false } : {}) }).select('token').single();
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
    view.innerHTML = `<section class="auth"><div class="auth-card center"><div class="inbox-icon">${ic('clock', 'solo')}</div><h1>Link unavailable</h1><p class="muted">${esc(message || 'This video isn’t available.')}${/new one/.test(message || '') ? '' : ' <span>Ask the person who shared it for a new link.</span>'}</p>
      <p class="guest-expired-pitch">Give your team feedback like this.</p><a class="btn wide" href="/?ref=share" data-guest-cta="expired">See how it works</a></div></section>`;
    return () => document.body.classList.remove('is-guest');
  }
  // Growth, in the order a guest experiences it: watch first, then (once the video ends, or further down)
  // a quiet suggestion to give their own team feedback like this. The top button only explains what this is.
  const signedIn = Boolean(ctx.state.session);
  const ctaHref = signedIn ? '/app' : '/app/login?mode=signup&ref=share';
  const topHref = signedIn ? '/app' : '/?ref=share';
  const topLabel = signedIn ? 'Open dancerly' : 'What’s dancerly?';
  view.innerHTML = `<section class="page guest">
    <div class="guest-bar"><a class="guest-brand" href="/?ref=share" aria-label="dancerly home"><img class="brand-logo" src="/logo-wordmark.png" alt="dancerly" width="542" height="128" /></a><span class="spacer"></span><a class="btn small ${signedIn ? 'primary' : 'ghost guest-what'}" href="${topHref}" data-guest-cta="top">${topLabel}</a></div>
    <header class="page-head"><div><p class="eyebrow">Shared with you · ${esc(data.project)}</p><h1>${esc(data.title)}</h1><p class="muted sub">Take ${data.take} · link expires ${new Date(data.expires_at).toLocaleDateString()}</p></div></header>
    <div class="guest-layout">
      <div class="guest-main">
      <div class="guest-player" data-gplayer><video class="guest-video" src="${esc(data.url)}" playsinline preload="metadata" controlslist="nodownload" disablepictureinpicture data-video></video><span class="guest-mirror-badge" aria-hidden="true">${ic('mirror')}Mirrored</span><button type="button" class="guest-big-play" data-gplay aria-label="Play or pause (Space)">${ic('play', 'solo')}</button><svg class="sketch-layer" data-sketch-layer aria-hidden="true"></svg><span class="count-badge" data-count-badge hidden></span>
        ${signedIn ? '' : `<div class="guest-end" data-guest-end hidden><p>Give your team feedback like this.</p><div><a class="btn primary" href="${ctaHref}" data-guest-cta="end">Start free</a><button type="button" class="btn ghost" data-replay>${ic('loop')}Watch again</button></div></div>`}</div>
      <div class="guest-controls">
        <div class="guest-timeline"><button type="button" class="guest-pp" data-gplay aria-label="Play or pause (Space)">${ic('play', 'solo')}</button><span class="guest-time" data-gcur>00:00</span><input type="range" min="0" max="1000" value="0" step="1" data-gseek aria-label="Playback position" /><span class="guest-time" data-gdur>--:--</span></div>
        <div class="guest-tools"><div class="seg small guest-speed" role="group" aria-label="Playback speed">${[0.5, 0.75, 1].map((r) => `<button type="button" data-grate="${r}" aria-pressed="${r === 1}">${r}×</button>`).join('')}</div><button type="button" class="toggle-btn" data-gab aria-pressed="false" title="Loop any part: tap at the start, then at the end">${ic('loop')}A–B</button><span class="loop-chip" data-gloop></span><span class="spacer"></span><button type="button" class="toggle-btn" data-gmirror aria-pressed="false" title="Mirror mode (M)">${ic('mirror')}Mirror</button><button type="button" class="toggle-btn full-btn" data-gfull aria-label="Full screen" title="Full screen">${ic('expand', 'solo')}</button></div>
      </div>
      ${data.allow_requests ? '<div data-guest-ask></div>' : ''}
      </div>
      ${data.notes.length ? `<aside class="panel guest-notes"><div class="panel-head"><div><h2>Notes</h2><p class="muted">Tap a time to jump there.</p></div></div>
        <ul>${data.notes.map((n) => `<li><button class="time-chip light" data-seek="${n.t_start}">${ic(n.t_end === null ? 'at' : 'range')}${n.t_end === null ? fmt(n.t_start) : `${fmt(n.t_start)}–${fmt(n.t_end)}`}</button><div><p>${esc(n.body)}</p><small>${esc(n.author)}${n.status === 'resolved' ? ' · resolved' : ''}${n.sketch ? ' · sketch' : ''}</small></div></li>`).join('')}</ul></aside>` : ''}
    </div>
    ${signedIn ? '' : `<aside class="guest-cta">
      <div><p class="eyebrow">Made with dancerly</p><h2>Give your team feedback like this.</h2><p>Every dancer deserves to see their progress. Pin notes to the exact count, sketch on the frame, and watch each fix land in the next take.</p></div>
      <div class="guest-cta-side"><div class="guest-cta-actions"><a class="btn primary" href="${ctaHref}" data-guest-cta="card">Start free</a><a class="btn ghost" href="/?ref=share" data-guest-cta="learn">See how it works</a></div><p class="guest-free">Free for your first team.</p></div>
    </aside>`}
    <p class="fine guest-foot">Shared with <a href="/?ref=share">dancerly</a> · dancerly.app</p>
  </section>`;
  const video = $('[data-video]');
  // The end card: once per visit, after the video plays to the end.
  const end = $('[data-guest-end]');
  let endShown = false;
  video.addEventListener('ended', () => { if (end && !endShown) { endShown = true; end.hidden = false; } });
  video.addEventListener('play', () => { if (end) end.hidden = true; });
  $('[data-replay]')?.addEventListener('click', () => { end.hidden = true; video.currentTime = 0; video.play(); });
  $$('[data-guest-cta]').forEach((a) => a.addEventListener('click', () => { try { window.dataLayer?.push({ event: 'guest_cta', cta: a.dataset.guestCta }); } catch {} }));
  const tools = wirePlayerTools(video);
  $$('[data-seek]').forEach((b) => b.addEventListener('click', () => {
    const n = data.notes.find((x) => String(x.t_start) === b.dataset.seek);
    // A note with a sketch stops on its frame so the drawing can be read; others loop their moment.
    if (n?.sketch) { tools.setLoop(null); video.pause(); video.currentTime = Number(b.dataset.seek); return; }
    const start = Number(b.dataset.seek);
    tools.setLoop(n?.t_end != null ? [start, Number(n.t_end)] : [Math.max(0, start - 1), start + 2]);
    video.currentTime = tools.loop[0];
    video.play();
  }));
  // Counts, when the team set them.
  const badge = $('[data-count-badge]');
  const paintCount = () => {
    const c = countAt(video.currentTime, data.bpm, data.count_start);
    badge.hidden = !c;
    const html = c ? `<small>Eight ${c.eight}</small><b>${c.count}</b>` : '';
    if (badge.dataset.key !== html) { badge.dataset.key = html; badge.innerHTML = html; }
  };
  if (data.bpm && data.count_start !== null && data.count_start !== undefined) { video.addEventListener('timeupdate', paintCount); video.addEventListener('seeked', paintCount); }
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
  if (data.allow_requests) await wireAsk(token, data, video);
  return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', place); tools.stop(); document.body.classList.remove('is-guest'); };
}

// ---------- Practice tools for anyone with the link: speed, A–B loop, mirror, full screen ----------
// Nothing here is saved, so it works the same signed in or not.
function wirePlayerTools(video) {
  const player = $('[data-gplayer]');
  const seek = $('[data-gseek]');
  const cur = $('[data-gcur]');
  const dur = $('[data-gdur]');
  const loopChip = $('[data-gloop]');
  const abBtn = $('[data-gab]');
  const api = { loop: null, abStart: null };
  const paintPlay = () => {
    const icon = ic(video.paused ? 'play' : 'pause', 'solo');
    $$('[data-gplay]').forEach((b) => { b.innerHTML = icon; });
    player.classList.toggle('playing', !video.paused);
  };
  const toggle = () => (video.paused ? video.play() : video.pause());
  $$('[data-gplay]').forEach((b) => b.addEventListener('click', toggle));
  video.addEventListener('click', toggle);
  video.addEventListener('play', paintPlay);
  video.addEventListener('pause', paintPlay);
  video.addEventListener('loadedmetadata', () => { dur.textContent = fmt(video.duration || 0); });
  const paintTime = () => {
    cur.textContent = fmt(video.currentTime);
    if (video.duration && document.activeElement !== seek) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
  };
  video.addEventListener('timeupdate', paintTime);
  seek.addEventListener('input', () => { if (video.duration) video.currentTime = (Number(seek.value) / 1000) * video.duration; });
  // Speed
  $$('[data-grate]').forEach((b) => b.addEventListener('click', () => {
    video.playbackRate = Number(b.dataset.grate);
    $$('[data-grate]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  // A–B loop: tap at the start, then at the end. A note's time sets one too.
  api.setLoop = (range) => {
    api.loop = range && range[1] > range[0] ? range : null;
    api.abStart = null;
    abBtn.setAttribute('aria-pressed', String(Boolean(api.loop)));
    abBtn.innerHTML = `${ic('loop')}A–B`;
    loopChip.innerHTML = api.loop ? `<span>${ic('loop')}Looping ${fmt(api.loop[0])}–${fmt(api.loop[1])}</span><button type="button" aria-label="Stop looping" data-gloop-off>${ic('x', 'solo')}</button>` : '';
    $('[data-gloop-off]', loopChip)?.addEventListener('click', () => api.setLoop(null));
  };
  abBtn.addEventListener('click', () => {
    if (api.loop) return api.setLoop(null);
    if (api.abStart === null) {
      api.abStart = video.currentTime;
      abBtn.setAttribute('aria-pressed', 'true');
      abBtn.innerHTML = `${ic('loop')}A–B ${fmt(api.abStart)}…`;
      return;
    }
    const a = Math.min(api.abStart, video.currentTime), b = Math.max(api.abStart, video.currentTime);
    if (b - a < 0.3) return api.setLoop(null);
    api.setLoop([a, b]);
    video.currentTime = a;
    video.play();
  });
  let frame = 0;
  const tick = () => {
    if (api.loop && (video.currentTime >= api.loop[1] || video.currentTime < api.loop[0] - 0.5)) video.currentTime = api.loop[0];
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  // Mirror, like the studio mirror (sketches flip with the picture)
  const mirrorBtn = $('[data-gmirror]');
  const setMirror = (on) => { player.classList.toggle('mirrored', on); mirrorBtn.setAttribute('aria-pressed', String(on)); };
  mirrorBtn.addEventListener('click', () => setMirror(!player.classList.contains('mirrored')));
  // Full screen: the player with its tools; iPhones fall back to their own video player.
  const fullBtn = $('[data-gfull]');
  const box = player.closest('.guest-main');
  fullBtn.addEventListener('click', async () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    const req = box.requestFullscreen || box.webkitRequestFullscreen;
    if (req) { try { await req.call(box); return; } catch { /* fall through */ } }
    video.webkitEnterFullscreen?.();
  });
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'm') setMirror(!player.classList.contains('mirrored'));
    else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
    else if (e.key === 'ArrowRight') video.currentTime += 5;
    else if (e.key === 'Escape' && api.loop) api.setLoop(null);
  };
  document.addEventListener('keydown', onKey);
  api.stop = () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', onKey); };
  paintPlay();
  return api;
}

// ---------- Ask to join, with a note ----------
// Write first, sign in when you send. The note waits on this device through sign-in (and email
// confirmation), then goes to the owner with the request; approving posts it at its moment.
const DRAFT_KEY = 'dancerly:guestDraft';
const readDraft = (token) => {
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && d.token === token && Date.now() - d.at < 7 * 864e5 ? d : null; } catch { return null; }
};
const saveDraft = (d) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, at: Date.now() })); } catch {} };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch {} };

async function wireAsk(token, data, video) {
  const host = $('[data-guest-ask]');
  if (!host) return;
  const signedIn = Boolean(ctx.state.session);
  const owner = data.owner || 'the owner';
  let access = { status: 'signed_out' };
  if (signedIn) {
    const { data: a } = await sb.rpc('share_access', { p_token: token });
    access = a || { status: 'none' };
  }
  const sentCard = (fresh) => `<div class="guest-ask-done" role="status"><b>${fresh ? `Sent to ${esc(owner)}.` : 'Request sent.'}</b><span>${fresh ? 'Your note will post as soon as you’re approved.' : `Waiting for ${esc(owner)} to approve. Your note will post then.`}</span></div>`;
  if (access.status === 'pending') { host.innerHTML = sentCard(false); clearDraft(); return; }
  if (access.status === 'closed' || access.status === 'unavailable') return;
  const member = access.status === 'member';
  const hint = member ? 'You’re in this project. Your note posts right away.'
    : signedIn ? `Your note goes to ${esc(owner)} with a request to join.`
    : 'Sign in to send. Your note is saved.';
  host.innerHTML = `<form class="guest-ask" data-ask-form>
    <div class="guest-ask-field"><span class="guest-ask-at" data-ask-at>${ic('at')}00:00.0</span><textarea data-ask-input rows="2" maxlength="2000" placeholder="Leave a note at this moment…" aria-label="Your note"></textarea></div>
    <div class="guest-ask-foot"><span class="guest-ask-hint">${hint}</span><button class="btn primary small" type="submit" data-ask-send>Send</button></div>
  </form>`;
  const form = $('[data-ask-form]', host);
  const input = $('[data-ask-input]', host);
  const atEl = $('[data-ask-at]', host);
  let at = null; // the moment the note is about: fixed once they start writing
  const paintAt = () => { atEl.innerHTML = `${ic('at')}${fmtFine(at ?? video.currentTime)}`; };
  video.addEventListener('timeupdate', () => { if (at === null) paintAt(); });
  input.addEventListener('focus', () => { if (at === null) { video.pause(); at = video.currentTime; paintAt(); } });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); form.requestSubmit(); }
  });
  const send = async (body, t) => {
    const btn = $('[data-ask-send]', host);
    btn.disabled = true;
    const { data: res, error } = await sb.rpc('request_join', { p_token: token, p_body: body, p_t: t });
    btn.disabled = false;
    if (error) return toast(friendlyError(error), 'error');
    clearDraft();
    if (res?.status === 'member') {
      toast('Note posted.');
      return ctx.navigate(`/app/p/${res.project_id}/v/${res.video_id}${res.note_id ? `?note=${res.note_id}` : ''}`);
    }
    host.innerHTML = sentCard(true);
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return input.focus();
    const t = Math.round((at ?? video.currentTime) * 100) / 100;
    if (!signedIn) {
      saveDraft({ token, body, t });
      return ctx.navigate(`/app/login?mode=signup&next=${encodeURIComponent(`/app/s/${token}`)}`);
    }
    send(body, t);
  });
  // Back from signing in with a note waiting: put it back, and send it (they already pressed Send).
  const draft = readDraft(token);
  if (draft) {
    input.value = draft.body;
    at = draft.t;
    video.addEventListener('loadedmetadata', () => { video.currentTime = draft.t; }, { once: true });
    paintAt();
    if (signedIn) send(draft.body, draft.t);
  } else paintAt();
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
    <p>Rehearsals, shows, and assignment due dates from all your projects, kept up to date in Google, Apple, or Outlook Calendar. Keep this link private — anyone with it can see your schedule.</p>
    ${copyRow(url)}
    <ul class="how-to">
      <li><b>Google Calendar</b> · Other calendars → + → From URL → paste</li>
      <li><b>Apple Calendar</b> · <a class="link" href="${esc(url.replace(/^https:/, 'webcal:'))}">Open in Calendar</a>, or File → New Calendar Subscription</li>
      <li><b>Outlook</b> · Add calendar → Subscribe from web → paste</li>
    </ul>
    <p class="fine left">Calendar apps refresh every few hours. <button class="link-btn inline danger" type="button" data-off>Turn this link off</button></p>`);
  wireCopy(el);
  $('[data-off]', el).addEventListener('click', async () => {
    const sure = await dialog({ title: 'Turn off this calendar link?', body: 'Calendars subscribed to it stop updating. A new link would need to be added to them again.', confirm: 'Turn off', danger: true });
    if (!sure) return;
    const { error } = await sb.from('calendar_feeds').delete().eq('token', feed.token);
    if (error) return toast(friendlyError(error), 'error');
    toast('Calendar link turned off. Make a new one any time.');
    el.close();
  });
}
