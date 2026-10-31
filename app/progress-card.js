// Progress cards: Take 1 next to the latest take, with a few honest numbers, as a 1080×1920 image for
// Instagram Stories and the like. Drawn on the device from the takes themselves; nothing is uploaded or stored.
// Anyone on the project can make one, unless the owner turned it off (migration 034). In the sample it's a
// preview: marked SAMPLE, and the share buttons point to starting your own project instead.
import { sb, $, $$, esc, toast, friendlyError, dialog, actionSheet, cols, takeUrl, isPublicMedia, publicMediaUrl } from './client.js';
import { ctx } from './ctx.js';
import { isKo } from './i18n.js';
import { track } from './onboarding.js';
import { shiftBetween } from './align.js';
import { thumbUrls } from './thumbs.js';

const W = 1080, H = 1920;
const SAFE_TOP = 216, SAFE_BOTTOM = 256; // Instagram's own buttons cover these
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const TEMPLATES = isKo ? [['stage', '스테이지'], ['light', '라이트'], ['photo', '포토']] : [['stage', 'Stage'], ['light', 'Light'], ['photo', 'Photo']];
const STATS = ['fixed', 'takes', 'days', 'practice'];
const MAX_STATS = 3;
const PROMPTED = 'looproom:cardPrompt:';

const label = (key, n) => (isKo
  ? { fixed: '고친 피드백', takes: '테이크', days: '일', practice: '연습한 날' }[key]
  : { fixed: n === 1 ? 'note fixed' : 'notes fixed', takes: n === 1 ? 'take' : 'takes', days: n === 1 ? 'day' : 'days', practice: n === 1 ? 'rehearsal day' : 'rehearsal days' }[key]);
// "12 notes fixed" / "고친 피드백 12개", for one-line spots.
const phrase = (key, n) => (isKo
  ? { fixed: `고친 피드백 ${n}개`, takes: `테이크 ${n}개`, days: `${n}일`, practice: `연습한 날 ${n}일` }[key]
  : `${n} ${label(key, n)}`);
const NOW = isKo ? '지금' : 'NOW';
const day = (iso) => new Date(iso).toLocaleDateString(isKo ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' });

// ---------- Data ----------
// Everything a card needs about one video. null when there's nothing to compare yet.
export async function loadCard(projectId, videoId) {
  const [{ data: project }, { data: video }, { data: takes }, { data: notes }, { data: owner }] = await Promise.all([
    sb.from('projects').select(cols('id, title, is_sample, created_by, allow_share_cards')).eq('id', projectId).single(),
    sb.from('videos').select('id, title').eq('id', videoId).single(),
    sb.from('takes').select(cols('id, number, created_at, storage_path, thumb_path, count_start, align')).eq('video_id', videoId).order('number'),
    sb.from('notes').select('id, take_id, t_start, status, resolved_at, private_to, body, created_at').eq('video_id', videoId),
    sb.from('project_members').select('user_id').eq('project_id', projectId).eq('role', 'owner').eq('user_id', ctx.state.session.user.id)
  ]);
  if (!project || !video || !takes || takes.length < 2) return null;
  const team = (notes || []).filter((n) => !n.private_to); // private notes never count on a public image
  const fixedNotes = team.filter((n) => n.status === 'resolved').sort((a, b) => String(b.resolved_at).localeCompare(String(a.resolved_at)));
  const first = takes[0], latest = takes[takes.length - 1];
  const span = Math.max(1, Math.ceil((new Date(latest.created_at) - new Date(first.created_at)) / 864e5));
  const dates = new Set([...takes.map((t) => t.created_at), ...team.map((n) => n.created_at)].map((iso) => new Date(iso).toDateString()));
  return {
    project, video, takes, first, latest,
    isOwner: Boolean(owner?.length),
    allowed: project.allow_share_cards !== false,
    stats: { fixed: fixedNotes.length, takes: takes.length, days: span, practice: dates.size },
    open: team.filter((n) => n.status !== 'resolved').length,
    fixedLine: fixedNotes[0] ? clip(fixedNotes[0].body.split('\n')[0], 46) : '',
    // Default moment: where the latest fixed note was pinned, moved onto Take 1 (lined-up takes share a beat).
    moment: (() => {
      const n = fixedNotes.find((x) => x.t_start !== null);
      if (!n) return null;
      const on = takes.find((t) => t.id === n.take_id) || first;
      return Math.max(0, Number(n.t_start) + (shiftBetween(on, first) || 0));
    })()
  };
}
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
const canMake = (c) => c.allowed || c.isOwner;

const mediaUrl = (path) => (isPublicMedia(path) ? publicMediaUrl(path) : takeUrl(path));

// One frame of a take at time t (seconds; null = a third of the way in), as a canvas.
function grabFrame(url, t) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    let done = false;
    const finish = (out) => { if (done) return; done = true; clearTimeout(timer); v.removeAttribute('src'); v.load(); resolve(out); };
    const timer = setTimeout(() => finish(null), 20000);
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.addEventListener('error', () => finish(null));
    v.addEventListener('loadedmetadata', () => {
      const dur = v.duration || 1;
      v.currentTime = Math.min(Math.max(0, t ?? dur / 3), Math.max(0, dur - 0.1));
    });
    v.addEventListener('seeked', () => {
      const scale = Math.min(1, 1280 / v.videoWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); finish({ canvas: c, time: v.currentTime, duration: v.duration }); }
      catch { finish(null); }
    }, { once: true });
    v.src = url;
  });
}

// ---------- Drawing ----------
function cover(g, img, x, y, w, h) {
  if (!img) { g.fillStyle = '#2a303a'; g.fillRect(x, y, w, h); return; }
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s, ih = img.height * s;
  g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
function rounded(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) return g.roundRect(x, y, w, h, r);
  // Older Safari: corners by hand.
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function pill(g, text, x, y, { bg, fg, size = 32, pad = 18, h = 56 }) {
  g.font = `800 ${size}px ${FONT}`;
  const w = g.measureText(text).width + pad * 2;
  rounded(g, x, y, w, h, 16); g.fillStyle = bg; g.fill();
  g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, x + pad, y + h / 2 + 1);
  return w;
}
// Wraps to at most `lines` lines; the last one ends in … if it doesn't fit.
function wrap(g, text, x, y, maxW, lineH, lines) {
  const words = text.split(/(\s+)/);
  let line = '', row = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line + words[i];
    if (g.measureText(test).width > maxW && line.trim()) {
      if (row === lines - 1) { while (g.measureText(`${line}…`).width > maxW && line.length) line = line.slice(0, -1); g.fillText(`${line.trim()}…`, x, y + row * lineH); return row + 1; }
      g.fillText(line.trim(), x, y + row * lineH); row++; line = words[i].trimStart();
    } else line = test;
  }
  g.fillText(line.trim(), x, y + row * lineH);
  return row + 1;
}

const THEMES = {
  stage: { ink: '#ffffff', soft: 'rgba(255,255,255,0.68)', hi: '#a5a6ff', tagB: ['rgba(255,255,255,0.16)', '#fff'], tagA: ['#7d7ef0', '#fff'], arrow: ['#fff', '#14171d'], line: ['rgba(125,126,240,0.18)', '#dcdcff'],
    bg: (g) => { const r = g.createRadialGradient(540, 0, 0, 540, 0, 1500); r.addColorStop(0, '#2c2a5e'); r.addColorStop(0.62, '#14171d'); r.addColorStop(1, '#14171d'); g.fillStyle = r; g.fillRect(0, 0, W, H); } },
  light: { ink: '#17191c', soft: 'rgba(23,25,28,0.62)', hi: '#5b5ce2', tagB: ['rgba(255,255,255,0.9)', '#17191c'], tagA: ['#17191c', '#fff'], arrow: ['#17191c', '#fff'], line: ['#ffffff', '#17191c'],
    bg: (g) => { g.fillStyle = '#f6f3ee'; g.fillRect(0, 0, W, H); } }
};

export function drawCard(canvas, c, s) {
  const g = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  g.textBaseline = 'alphabetic';
  const stats = s.stats.map((k) => [c.stats[k], label(k, c.stats[k]), k]);
  const tagB = `TAKE ${c.first.number}`, tagA = `TAKE ${c.latest.number}`;
  if (s.template === 'photo') drawPhoto(g, c, s, stats, tagB, tagA);
  else drawPanel(g, THEMES[s.template], c, s, stats, tagB, tagA);
  if (c.project.is_sample) {
    g.font = `800 30px ${FONT}`;
    const w = g.measureText('SAMPLE').width + 36;
    pill(g, 'SAMPLE', W - 72 - w, SAFE_TOP + 4, { bg: '#f59e0b', fg: '#17191c', size: 30, pad: 18, h: 52 });
  }
}

function drawPanel(g, t, c, s, stats, tagB, tagA) {
  t.bg(g);
  const x = 72;
  let y = SAFE_TOP + 40;
  g.fillStyle = t.soft; g.font = `700 34px ${FONT}`; g.textBaseline = 'alphabetic';
  g.fillText(c.project.title.toUpperCase().slice(0, 40), x, y);
  g.fillStyle = t.ink; g.font = `800 92px ${FONT}`;
  const rows = wrap(g, s.title || c.video.title, x, y + 100, W - x * 2, 96, 2);
  y += 100 + (rows - 1) * 96 + 64;
  // The pair, 4:6: Take 1 is where you started, the latest take is the star. Bottoms line up.
  const gap = 22, inner = W - 100 - gap, bw = Math.round(inner * 0.4), aw = inner - bw;
  const ah = Math.round(aw * 1.2), bh = Math.round(bw * 1.2), top = y;
  [[s.before, tagB, t.tagB, day(c.first.created_at), 50, top + ah - bh, bw, bh, 30], [s.after, `${tagA} · ${NOW}`, t.tagA, day(c.latest.created_at), 50 + bw + gap, top, aw, ah, 34]].forEach(([img, tag, [bg, fg], when, px, py, pw, ph, size], i) => {
    g.save(); rounded(g, px, py, pw, ph, 34); g.clip(); cover(g, img, px, py, pw, ph);
    const fade = g.createLinearGradient(0, py + ph - 160, 0, py + ph); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = fade; g.fillRect(px, py + ph - 160, pw, 160); g.restore();
    if (i === 1) { rounded(g, px - 3, py - 3, pw + 6, ph + 6, 37); g.strokeStyle = t.hi; g.lineWidth = 6; g.stroke(); }
    pill(g, tag, px + 20, py + 20, { bg, fg, size, h: size + 24, pad: 16 });
    g.fillStyle = '#fff'; g.font = `600 ${size - 2}px ${FONT}`; g.textBaseline = 'alphabetic'; g.fillText(when, px + 22, py + ph - 24);
  });
  // The arrow sits on the seam, level with the middle of Take 1.
  const ax = 50 + bw + gap / 2, ay = top + ah - bh / 2;
  g.beginPath(); g.arc(ax, ay, 40, 0, Math.PI * 2); g.fillStyle = t.arrow[0]; g.fill();
  g.fillStyle = t.arrow[1]; g.font = `800 40px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('→', ax, ay + 2); g.textAlign = 'left';
  y = top + ah + 70;
  // Numbers
  if (stats.length) {
    const colW = (W - x * 2) / stats.length;
    stats.forEach(([n, l], i) => {
      g.textBaseline = 'alphabetic';
      g.fillStyle = i === 0 ? t.hi : t.ink; g.font = `800 ${stats.length > 2 ? 104 : 120}px ${FONT}`; g.fillText(String(n), x + i * colW, y + 96);
      g.fillStyle = t.soft; g.font = `600 33px ${FONT}`; g.fillText(l, x + i * colW + 2, y + 146);
    });
    y += 190;
  }
  // What got fixed
  if (s.line && c.fixedLine) {
    rounded(g, x, y, W - x * 2, 104, 32); g.fillStyle = t.line[0]; g.fill();
    g.fillStyle = t.line[1]; g.font = `600 37px ${FONT}`; g.textBaseline = 'middle';
    wrap(g, `✓ ${c.fixedLine}`, x + 34, y + 53, W - x * 2 - 68, 40, 1);
  }
  brand(g, t.ink, x);
}

function drawPhoto(g, c, s, stats, tagB, tagA) {
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  // 4:6, top to bottom: Take 1 smaller, the latest take bigger.
  const seam = Math.round(H * 0.4);
  cover(g, s.before, 0, 0, W, seam);
  cover(g, s.after, 0, seam, W, H - seam);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, W, seam); // the past, a touch dimmer
  pill(g, `${tagB} · ${day(c.first.created_at)}`, 50, SAFE_TOP + 30, { bg: 'rgba(0,0,0,0.6)', fg: '#fff', size: 32, h: 58 });
  pill(g, `${tagA} · ${NOW}`, 50, seam + 64, { bg: '#fff', fg: '#000', size: 36, h: 64 });
  // The headline number sits on the seam.
  if (stats[0]) {
    const text = `${phrase(stats[0][2], stats[0][0])} ✓`;
    g.font = `900 44px ${FONT}`;
    const w = g.measureText(text).width + 64;
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 40;
    rounded(g, (W - w) / 2, seam - 44, w, 88, 44); g.fillStyle = '#fff'; g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, seam + 2); g.textAlign = 'left';
  }
  const fade = g.createLinearGradient(0, H - 760, 0, H); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.85)');
  g.fillStyle = fade; g.fillRect(0, H - 760, W, 760);
  g.fillStyle = '#fff'; g.font = `800 72px ${FONT}`; g.textBaseline = 'alphabetic';
  wrap(g, s.title || c.video.title, 60, H - SAFE_BOTTOM - 150, W - 120, 76, 1);
  const rest = stats.slice(1).map(([n, , k]) => phrase(k, n));
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = `600 36px ${FONT}`;
  wrap(g, [c.project.title, ...rest].join(' · '), 60, H - SAFE_BOTTOM - 84, W - 120 - 220, 40, 1);
  g.fillStyle = '#fff'; g.font = `900 48px ${FONT}`; g.textAlign = 'right'; g.fillText('dancerly', W - 60, H - SAFE_BOTTOM - 84); g.textAlign = 'left';
}

function brand(g, ink, x) {
  g.globalAlpha = 0.78; g.fillStyle = ink; g.textBaseline = 'alphabetic';
  g.font = `900 48px ${FONT}`; g.fillText('dancerly', x, H - SAFE_BOTTOM - 40);
  g.font = `600 34px ${FONT}`; g.textAlign = 'right'; g.fillText('dancerly.app', W - x, H - SAFE_BOTTOM - 40); g.textAlign = 'left';
  g.globalAlpha = 1;
}

// ---------- Editor ----------
export async function openCardEditor({ projectId, videoId, from = 'unknown' }) {
  const c = await loadCard(projectId, videoId);
  if (!c) return toast('A progress card needs at least two takes of this video.');
  if (!canMake(c)) return toast('The project owner turned off progress cards for this project.');
  track('card_opened', { from, sample: Boolean(c.project.is_sample) });

  const s = {
    template: 'stage',
    title: c.video.title, // editable on the card only, e.g. to add the song; the video keeps its name
    stats: (c.stats.fixed ? ['fixed', 'takes', 'days'] : ['takes', 'days', 'practice']),
    line: Boolean(c.fixedLine),
    beforeAt: c.moment, afterAt: null, before: null, after: null
  };
  const shift = shiftBetween(c.first, c.latest);
  const [urlB, urlA] = await Promise.all([mediaUrl(c.first.storage_path), mediaUrl(c.latest.storage_path)]);

  const el = document.createElement('dialog');
  el.className = 'dialog card-editor';
  el.innerHTML = `<div class="ce">
    <header class="ce-head"><button type="button" class="link-btn" data-ce-close>Cancel</button><b>Progress card</b><span></span></header>
    <div class="ce-body">
      <div class="ce-preview"><canvas data-ce-canvas width="${W}" height="${H}" aria-label="Preview of your progress card"></canvas><p class="ce-loading" data-ce-loading>Getting the frames…</p></div>
      <div class="ce-panel">
        <label class="field ce-title"><span>Card title</span><input data-ce-title maxlength="60" value="${esc(c.video.title)}" placeholder="${esc(c.video.title)}" autocomplete="off" /><small>Only on the card. Add the song if you like, e.g. “Supernova · Chorus”.</small></label>
        <div class="seg ce-seg" role="group" aria-label="Style" data-no-i18n>${TEMPLATES.map(([k, l]) => `<button type="button" data-ce-template="${k}" aria-pressed="${k === s.template}">${l}</button>`).join('')}</div>
        <div class="ce-pick">
          <button type="button" data-ce-pick="before"><img alt="" data-ce-thumb="before" /><b>Take ${c.first.number}</b><small>Change moment ›</small></button>
          <button type="button" data-ce-pick="after"><img alt="" data-ce-thumb="after" /><b>Take ${c.latest.number}</b><small>Change moment ›</small></button>
        </div>
        <p class="ce-label">On the card <small data-ce-count></small></p>
        <div class="ce-chips">${STATS.map((k) => `<button type="button" class="ce-chip" data-ce-stat="${k}">${esc(label(k, 2))}</button>`).join('')}${c.fixedLine ? '<button type="button" class="ce-chip" data-ce-line>What got fixed</button>' : ''}</div>
        ${c.project.is_sample
          ? `<div class="ce-sample"><p><b>This is the sample.</b> Make one from your own team’s takes and share it to Instagram.</p><button type="button" class="btn primary wide" data-ce-own>Start my own project</button></div>`
          : `<p class="ce-tip">🎵 Add the song with Instagram or TikTok’s music sticker. The card itself is silent.</p>
            <p class="fine ce-fine">Anyone you share the image with can see it. It’s made on your device; nothing is posted for you.</p>
            <div class="ce-actions"><button type="button" class="btn primary" data-ce-share>${navigator.canShare ? 'Share…' : 'Download image'}</button>${navigator.canShare ? '<button type="button" class="btn" data-ce-save>Save</button>' : ''}</div>`}
      </div>
    </div>
  </div>`;
  document.body.append(el);
  el.showModal();
  el.addEventListener('close', () => el.remove());
  el.addEventListener('cancel', () => el.close());
  $('[data-ce-close]', el).addEventListener('click', () => el.close());

  const canvas = $('[data-ce-canvas]', el);
  const paint = () => {
    drawCard(canvas, c, s);
    $$('[data-ce-template]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ceTemplate === s.template)));
    $$('[data-ce-stat]', el).forEach((b) => { const on = s.stats.includes(b.dataset.ceStat); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const line = $('[data-ce-line]', el); if (line) { line.classList.toggle('on', s.line); line.setAttribute('aria-pressed', String(s.line)); }
    $('[data-ce-count]', el).textContent = isKo ? `숫자 ${s.stats.length}/${MAX_STATS}` : `${s.stats.length} of ${MAX_STATS} numbers`;
  };
  const setFrame = async (which, at) => {
    const f = await grabFrame(which === 'before' ? urlB : urlA, at);
    if (!f) return false;
    s[which] = f.canvas;
    s[`${which}At`] = f.time;
    $(`[data-ce-thumb="${which}"]`, el).src = f.canvas.toDataURL('image/jpeg', 0.6);
    return true;
  };
  $('[data-ce-title]', el).addEventListener('input', (e) => { s.title = e.target.value.trim(); paint(); });
  await document.fonts?.ready;
  paint();
  const ok = await setFrame('before', s.beforeAt);
  // The latest take at the same beat, when the takes are lined up.
  await setFrame('after', shift !== null && s.beforeAt !== null ? s.beforeAt + shift : s.beforeAt);
  $('[data-ce-loading]', el)?.remove();
  if (!ok) toast('Couldn’t read this take’s frames in this browser. The card shows without them.', 'error');
  paint();

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.ceTemplate) { s.template = t.dataset.ceTemplate; return paint(); }
    if (t.dataset.ceStat) {
      const k = t.dataset.ceStat;
      if (s.stats.includes(k)) s.stats = s.stats.filter((x) => x !== k);
      else if (s.stats.length >= MAX_STATS) return toast(isKo ? `숫자는 ${MAX_STATS}개까지 넣을 수 있어요. 하나를 먼저 빼 주세요.` : `Up to ${MAX_STATS} numbers. Turn one off first.`);
      else s.stats = STATS.filter((x) => x === k || s.stats.includes(x));
      return paint();
    }
    if (t.hasAttribute('data-ce-line')) { s.line = !s.line; return paint(); }
    if (t.dataset.cePick) {
      const which = t.dataset.cePick;
      const at = await pickMoment(which === 'before' ? urlB : urlA, s[`${which}At`], which === 'before' ? c.first.number : c.latest.number);
      if (at === null) return;
      await setFrame(which, at);
      // Moving Take 1 moves the latest take to the same beat, when they're lined up.
      if (which === 'before' && shift !== null) await setFrame('after', at + shift);
      return paint();
    }
    if (t.hasAttribute('data-ce-own')) { el.close(); return ctx.startAction('project'); }
    if (t.hasAttribute('data-ce-share') || t.hasAttribute('data-ce-save')) {
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) return toast('Couldn’t make the image. Try again.', 'error');
      const name = `dancerly-${(s.title || c.video.title).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '') || 'progress'}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (t.hasAttribute('data-ce-share') && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: s.title || c.video.title });
          track('card_shared', { via: 'share', template: s.template });
        } catch (err) { if (err?.name !== 'AbortError') toast(friendlyError(err), 'error'); }
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      track('card_shared', { via: 'download', template: s.template });
      toast(isKo ? '이미지를 저장했어요.' : 'Image saved.');
    }
  });
}

// Pick a moment in a take: its player, then "Use this moment". Resolves to seconds, or null.
function pickMoment(url, at, number) {
  return new Promise((resolve) => {
    const el = document.createElement('dialog');
    el.className = 'dialog ce-picker';
    el.innerHTML = `<div class="dialog-card"><h2>Take ${number}: pick the moment</h2>
      <video src="${esc(url)}" controls playsinline muted preload="auto" crossorigin="anonymous"></video>
      <p class="fine left">Pause on the frame you want on the card.</p>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-no>Cancel</button><button type="button" class="btn primary" data-yes>Use this moment</button></div></div>`;
    document.body.append(el);
    const v = $('video', el);
    v.addEventListener('loadedmetadata', () => { if (at !== null && at !== undefined) v.currentTime = Math.min(at, Math.max(0, v.duration - 0.1)); }, { once: true });
    let out = null;
    $('[data-yes]', el).addEventListener('click', () => { out = v.currentTime; el.close(); });
    $('[data-no]', el).addEventListener('click', () => el.close());
    el.addEventListener('close', () => { v.pause(); el.remove(); resolve(out); });
    el.showModal();
  });
}

// ---------- Ways in ----------
// The video's Share button: a progress card, or the read-only link for people outside the team.
export async function shareChoice({ projectId, videoId, videoTitle, sample, takes, latest, linkShare }) {
  const card = { value: 'card', label: 'Make a progress card', hint: takes >= 2 ? `Take 1 next to Take ${latest}, as an image for Instagram Stories` : 'Needs a second take of this video to show progress' };
  const choice = await actionSheet({ title: 'Share', actions: [card, { value: 'link', label: 'Send a link', hint: 'A read-only link for a coach or family, no account needed' }] });
  if (choice === 'card') {
    if (takes < 2) return toast(isKo ? '같은 영상에 테이크를 하나 더 올리면 전후 비교 카드를 만들 수 있어요.' : 'Upload another take of this video to make a before-and-after card.');
    return openCardEditor({ projectId, videoId, from: 'share' });
  }
  if (choice !== 'link') return;
  if (!sample) return linkShare(videoId, videoTitle);
  // Sample media ship with the site, so a guest link couldn't play it; explain what it does instead.
  const go = await dialog({ title: 'Links work in your own projects', body: 'Send a read-only link to a coach or family: they watch the latest take, with your team’s notes if you like, without an account. Links expire, and you can turn them off.', confirm: 'Start my own project', cancel: 'Not now' });
  if (go) ctx.startAction('project');
}

// Right after the last open note on a video is fixed: a one-time nudge to make a card. Once per video.
export async function celebrate({ projectId, videoId }) {
  try { if (localStorage.getItem(PROMPTED + videoId)) return; } catch { return; }
  const c = await loadCard(projectId, videoId);
  if (!c || c.open || !c.stats.fixed || !canMake(c)) return;
  try { localStorage.setItem(PROMPTED + videoId, '1'); } catch {}
  const urls = await thumbUrls([c.first.thumb_path, c.latest.thumb_path].filter(Boolean));
  const thumb = (t) => (t.thumb_path && urls[t.thumb_path] ? `<img src="${esc(urls[t.thumb_path])}" alt="" />` : '<span class="ce-blank"></span>');
  track('card_prompted', { sample: Boolean(c.project.is_sample) });
  const yes = await dialog({
    title: isKo ? `${c.video.title}, 모두 해결!` : `All clear on ${c.video.title}!`,
    body: `<span data-no-i18n>${isKo
      ? `Take 1부터 피드백 ${c.stats.fixed}개를 고쳤어요. ${c.stats.days}일 동안의 변화를 남겨 볼까요?`
      : `${c.stats.fixed} ${c.stats.fixed === 1 ? 'note' : 'notes'} fixed since Take 1. Want to keep ${c.stats.days} ${c.stats.days === 1 ? 'day' : 'days'} of progress?`}</span>
      <span class="ce-celebrate" aria-hidden="true">${thumb(c.first)}${thumb(c.latest)}<i>→</i></span>`,
    confirm: 'Make a progress card',
    cancel: 'Not now'
  });
  if (yes) openCardEditor({ projectId, videoId, from: 'celebrate' });
}
