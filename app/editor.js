// The page editor: what you write is what everyone reads (no Markdown preview), as in Notion or Slack canvases.
// Pages are still stored as the same small Markdown as before, so nothing about saved pages changes:
//   # Heading · ## Subheading · ### Small heading · - list · 1. numbered · - [ ] checklist · > quote · ---
//   **bold** · *italic* · `code` · [link](https://…)
//   [Chorus · Take 2 · 0:15](dancerly:video/<id>?take=2&t=15) — a chip pointing at something in the project
//   (person, video, section, event, page), and ![photo](storage:<path>) on its own line — a photo
// The page is one row of blocks (one per line). Reading, a checklist item ticks with a tap; editing, typing "- ",
// "1. ", "[] " or "# " at the start of a line turns it into that block, and Enter carries a list on.
import { esc } from './client.js';

// A block's type and what it looks like in Markdown.
const PREFIX = { p: '', h1: '# ', h2: '## ', h3: '### ', li: '- ', ol: '1. ', task: '- [ ] ', quote: '> ', hr: '---' };
const LISTS = new Set(['li', 'ol', 'task']);

// Inline Markdown → HTML (escaped first; only these few tags come back).
export function inline(t) {
  return esc(t)
    .replace(/\[([^\]]+)\]\(dancerly:([a-z]+)\/([^)\s]+)\)/g, '<a class="ref" data-kind="$2" data-ref="$2/$3" contenteditable="false">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}

// One line of Markdown → { t, done, text }.
export function parseLine(raw) {
  const line = raw.replace(/\s+$/, '');
  let m;
  if ((m = line.match(/^!\[([^\]]*)\]\(storage:([^)\s]+)\)$/))) return { t: 'img', alt: m[1], src: m[2], text: '' };
  if ((m = line.match(/^(#{1,3})\s+(.*)$/))) return { t: `h${m[1].length}`, text: m[2] };
  if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s?(.*)$/i))) return { t: 'task', done: m[1].trim() !== '', text: m[2] };
  // An empty item ("- " or "1. ", a blank to fill in) is still a list item.
  if ((m = line.match(/^\s*[-*](?:\s+(.*))?$/))) return { t: 'li', text: m[1] || '' };
  if ((m = line.match(/^\s*\d{1,2}[.)](?:\s+(.*))?$/))) return { t: 'ol', text: m[1] || '' };
  if (/^\s*---+\s*$/.test(line)) return { t: 'hr', text: '' };
  if ((m = line.match(/^>\s?(.*)$/))) return { t: 'quote', text: m[1] };
  return { t: 'p', text: line };
}

const blockHtml = (b) => (b.t === 'hr'
  ? '<div class="blk" data-t="hr" contenteditable="false"><hr /></div>'
  : b.t === 'img'
  ? `<div class="blk" data-t="img" data-src="${esc(b.src)}" contenteditable="false"><img alt="${esc(b.alt || 'Photo')}" /><button type="button" class="img-remove" data-img-remove aria-label="Remove photo" title="Remove photo">×</button></div>`
  : `<div class="blk" data-t="${b.t}"${b.t === 'task' ? ` data-done="${b.done ? 'true' : 'false'}"` : ''}>${inline(b.text) || '<br>'}</div>`);

export const toBlocks = (md) => String(md || '').split('\n').map(parseLine);
export const blocksHtml = (md) => toBlocks(md).map(blockHtml).join('');

// Inline HTML (what the browser left after editing) → Markdown.
function inlineMd(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/ /g, ' '); continue; }
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'A' && n.dataset.ref) { out += `[${n.textContent.replace(/[[\]*`]/g, '')}](dancerly:${n.dataset.ref})`; continue; }
    const tag = n.tagName;
    const inner = inlineMd(n);
    if (tag === 'BR') continue;
    if (!inner.trim() && tag !== 'A') { out += inner; continue; }
    if (tag === 'B' || tag === 'STRONG') out += `**${inner}**`;
    else if (tag === 'I' || tag === 'EM') out += `*${inner}*`;
    else if (tag === 'CODE') out += `\`${inner}\``;
    else if (tag === 'A') {
      const href = n.getAttribute('href') || '';
      out += /^https?:\/\//.test(href) ? (inner === href ? href : `[${inner}](${href})`) : inner;
    } else out += inner;
  }
  return out;
}

// Blocks → Markdown, numbering numbered lists as they run.
export function toMarkdown(root) {
  const lines = [];
  let n = 0;
  for (const el of root.querySelectorAll(':scope > .blk')) {
    const t = el.dataset.t || 'p';
    n = t === 'ol' ? n + 1 : 0;
    if (t === 'hr') { lines.push('---'); continue; }
    if (t === 'img') { if (el.dataset.src) lines.push(`![${(el.querySelector('img')?.alt || 'Photo').replace(/[[\]]/g, '')}](storage:${el.dataset.src})`); continue; }
    const text = inlineMd(el).replace(/\n/g, ' ');
    if (t === 'task') lines.push(`- [${el.dataset.done === 'true' ? 'x' : ' '}] ${text}`);
    else if (t === 'ol') lines.push(`${n}. ${text}`);
    else lines.push(`${PREFIX[t] ?? ''}${text}`);
  }
  // No trailing empty lines.
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

// Checklist progress, for the list of pages: { done, total }.
export function taskCount(md) {
  const tasks = toBlocks(md).filter((b) => b.t === 'task');
  return { done: tasks.filter((b) => b.done).length, total: tasks.length };
}

// ---------- The editor ----------
// mount(root, { markdown, onChange, onToggle }) renders the page into root and returns
// { edit(on, at?), setMarkdown(md), markdown(), setType(t), toggleMark(cmd), link(url) }.
// Reading: links open, a checklist box ticks (onToggle(index, done)). Editing: onChange() after every change.
// Optional: suggest(query) → [{ group, label, sub, ref, text }] for the @ menu; unfurl(url) → { ref, text } | null to
// turn a pasted dancerly link into a chip; imageUrl(path) → a URL to show a photo; onRef(ref, el) when a chip is
// opened while reading; onImage(img) when a photo is opened.
export function mount(root, { markdown = '', onChange = () => {}, onToggle = () => {}, suggest = null, unfurl = null, imageUrl = null, onRef = () => {}, onImage = () => {} } = {}) {
  root.classList.add('doc', 'doc-blocks');
  root.innerHTML = blocksHtml(markdown) || blockHtml({ t: 'p', text: '' });
  let editing = false;
  // Photos: their URLs are signed per view, fetched once each.
  const urls = new Map();
  const paintImages = () => {
    if (!imageUrl) return;
    for (const b of root.querySelectorAll(':scope > .blk[data-t="img"][data-src]')) {
      const img = b.querySelector('img');
      if (!img || img.getAttribute('src')) continue;
      const src = b.dataset.src;
      if (!urls.has(src)) urls.set(src, imageUrl(src).catch(() => null));
      urls.get(src).then((u) => { if (u) img.src = u; else b.classList.add('gone'); });
    }
  };
  paintImages();

  const blocks = () => [...root.querySelectorAll(':scope > .blk')];
  const blockOf = (node) => { let n = node?.nodeType === 3 ? node.parentNode : node; while (n && n !== root && !(n.classList?.contains('blk') && n.parentNode === root)) n = n.parentNode; return n && n !== root ? n : null; };
  const caretBlock = () => { const s = getSelection(); return s.rangeCount ? blockOf(s.getRangeAt(0).startContainer) : null; };
  const atStart = (block) => {
    const s = getSelection();
    if (!s.rangeCount || !s.isCollapsed) return false;
    const r = document.createRange();
    r.selectNodeContents(block);
    r.setEnd(s.getRangeAt(0).startContainer, s.getRangeAt(0).startOffset);
    return r.toString().length === 0;
  };
  const isEmpty = (block) => !block.textContent.replace(/ /g, ' ').trim();
  const placeCaret = (block, end = false) => {
    const r = document.createRange();
    r.selectNodeContents(block);
    r.collapse(!end);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  };
  const setType = (block, t) => {
    if (!block) return;
    block.dataset.t = t;
    if (t === 'task') block.dataset.done = block.dataset.done === 'true' ? 'true' : 'false'; else delete block.dataset.done;
    changed();
  };

  // Whatever the browser leaves behind (pasted spans, text straight in the root, styles) becomes plain blocks.
  const normalize = () => {
    for (const n of [...root.childNodes]) {
      if (n.nodeType === 3) {
        if (!n.nodeValue.trim()) { n.remove(); continue; }
        const d = document.createElement('div'); d.className = 'blk'; d.dataset.t = 'p'; n.replaceWith(d); d.append(n);
      } else if (n.nodeType === 1 && !(n.classList.contains('blk'))) {
        const d = document.createElement('div'); d.className = 'blk'; d.dataset.t = 'p';
        if (n.tagName === 'BR') { n.replaceWith(d); d.innerHTML = '<br>'; continue; }
        n.replaceWith(d); d.append(...n.childNodes);
      }
    }
    for (const b of blocks()) {
      if (!b.dataset.t) b.dataset.t = 'p';
      if (b.dataset.t === 'img' || b.dataset.t === 'hr') continue;
      for (const el of [...b.querySelectorAll('*')]) {
        if (el.closest('a.ref') && el.tagName !== 'A') continue;
        if (el.tagName === 'A' && el.dataset.ref) { el.removeAttribute('style'); el.contentEditable = 'false'; continue; }
        if (['B', 'I', 'CODE', 'A', 'BR', 'HR'].includes(el.tagName)) { el.removeAttribute('style'); el.removeAttribute('class'); continue; }
        if (el.tagName === 'STRONG') { const x = document.createElement('b'); x.append(...el.childNodes); el.replaceWith(x); continue; }
        if (el.tagName === 'EM') { const x = document.createElement('i'); x.append(...el.childNodes); el.replaceWith(x); continue; }
        el.replaceWith(...el.childNodes); // span, font, div inside a block…
      }
      if (b.dataset.t !== 'hr' && !b.textContent && !b.querySelector('br')) b.innerHTML = '<br>';
    }
    if (!blocks().length) root.innerHTML = blockHtml({ t: 'p', text: '' });
  };
  const changed = () => onChange();

  // Typing "- " / "* " / "1. " / "[] " / "# " / "> " at the start of a line turns it into that block.
  // "-" and "*" may arrive as look-alikes from phone keyboards (full-width －＊ from Korean and Japanese keyboards,
  // ‐ – − from autocorrect); "•" pasted or typed works too.
  const SHORTCUTS = [[/^[-*＊－‐–−]\s\[( |x)?\]\s$/i, 'task'], [/^\[( |x)?\]\s$/i, 'task'], [/^[-*＊•－‐–−]\s$/, 'li'], [/^\d+[.)]\s$/, 'ol'], [/^#\s$/, 'h1'], [/^##\s$/, 'h2'], [/^###\s$/, 'h3'], [/^>\s$/, 'quote']];
  const shortcut = (block) => {
    if (!block || block.dataset.t !== 'p') return;
    const text = block.textContent.replace(/ /g, ' ');
    for (const [re, t] of SHORTCUTS) {
      if (re.test(text)) {
        block.innerHTML = '<br>';
        setType(block, t);
        if (t === 'task' && /x/i.test(text)) block.dataset.done = 'true';
        placeCaret(block);
        return;
      }
    }
    if (/^---$/.test(text.trim())) { block.outerHTML = blockHtml({ t: 'hr' }) + blockHtml({ t: 'p', text: '' }); placeCaret(blocks().find((b, i, all) => all[i - 1]?.dataset.t === 'hr' && !b.textContent.trim()) || blocks().pop()); changed(); }
  };

  root.addEventListener('beforeinput', (e) => {
    if (!editing) return;
    const block = caretBlock();
    if (e.inputType === 'insertLineBreak') { e.preventDefault(); return; } // one line per block
    if (e.inputType === 'insertParagraph' && block) {
      // Enter on an empty list item ends the list (as in every editor); in a heading, the next line is text.
      if (LISTS.has(block.dataset.t) || block.dataset.t === 'quote') {
        if (isEmpty(block)) { e.preventDefault(); setType(block, 'p'); return; }
      }
      // Enter at the very start of a line puts an empty line above it and leaves this one as it is.
      afterEnterFrom = { t: block.dataset.t, done: block.dataset.done, atStart: atStart(block) && !isEmpty(block) };
      return;
    }
    // Backspace at the start of a list item or heading makes it plain text first, before joining lines.
    if (e.inputType === 'deleteContentBackward' && block && block.dataset.t !== 'p' && atStart(block)) {
      e.preventDefault();
      setType(block, 'p');
      return;
    }
    const prev = block?.previousElementSibling;
    if (e.inputType === 'deleteContentBackward' && block && atStart(block) && prev?.dataset.t === 'hr') {
      e.preventDefault();
      prev.remove();
      changed();
    }
    if (e.inputType === 'deleteContentBackward' && block && atStart(block) && prev?.dataset.t === 'img') {
      e.preventDefault();
      if (prev.classList.contains('picked')) { prev.remove(); changed(); } else prev.classList.add('picked');
    }
  });
  let afterEnterFrom = null;
  root.addEventListener('input', (e) => {
    if (!editing) return;
    normalize();
    const block = caretBlock();
    if (afterEnterFrom && block) {
      const from = afterEnterFrom;
      afterEnterFrom = null;
      if (from.atStart) {
        // The empty line went above: it's text (or an empty item of the same list); this line keeps its type.
        const above = block.previousElementSibling;
        if (above) { if (LISTS.has(from.t)) { above.dataset.t = from.t; if (from.t === 'task') above.dataset.done = 'false'; } else { above.dataset.t = 'p'; delete above.dataset.done; } }
        block.dataset.t = from.t;
        if (from.t === 'task') block.dataset.done = from.done || 'false';
      } else if (LISTS.has(from.t)) {
        // The new line after Enter: a list carries on (an unticked item), anything else becomes text.
        block.dataset.t = from.t;
        if (from.t === 'task') block.dataset.done = 'false';
      } else { block.dataset.t = 'p'; delete block.dataset.done; }
    }
    // A marker and a space at the start of a line. Phones don't always send the space as plain typing (autocorrect,
    // a Korean keyboard finishing a character), so any input that leaves the line like that counts.
    if (block && block.dataset.t === 'p' && /^\S{1,5}[\s\u00a0]$/.test(block.textContent)) shortcut(block);
    root.querySelectorAll('.blk.picked').forEach((b) => b.classList.remove('picked'));
    if (suggest) followMention(e);
    changed();
  });
  root.addEventListener('keydown', (e) => {
    if (!editing) return;
    if (menu && menuKeys(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleMark('bold'); }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); toggleMark('italic'); }
    if (e.key === 'Enter' && !e.shiftKey) {
      const block = caretBlock();
      if (block && block.dataset.t === 'p' && block.textContent.trim() === '---') { e.preventDefault(); shortcut(block); }
    }
  });

  // Paste: plain text only. Several lines become blocks after the one you're in.
  root.addEventListener('paste', async (e) => {
    if (!editing) return;
    e.preventDefault();
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file && api.onPhoto) { api.onPhoto(file); return; }
    const text = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    if (!text) return;
    const lines = text.split('\n');
    // A link to something in dancerly (a moment of a video, a section, a page…) becomes a chip, as Slack unfurls.
    if (lines.length === 1 && unfurl && /^https?:\/\/\S+$/.test(text.trim())) {
      const at = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
      const chip = await unfurl(text.trim()).catch(() => null);
      if (chip && at) { const s = getSelection(); s.removeAllRanges(); s.addRange(at); insertChip(chip); return; }
      document.execCommand('insertText', false, text);
      return;
    }
    if (lines.length === 1) { document.execCommand('insertText', false, text); return; }
    const block = caretBlock();
    document.execCommand('insertText', false, parseLine(lines[0]).text);
    let after = block || blocks().pop();
    for (const line of lines.slice(1)) {
      const tmp = document.createElement('div');
      tmp.innerHTML = blockHtml(parseLine(line));
      const el = tmp.firstChild;
      after.after(el);
      after = el;
    }
    placeCaret(after, true);
    changed();
  });

  // A checklist box: the left edge of a checklist line (drawn with CSS), in reading and in editing.
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('a.ref');
    if (chip) { e.preventDefault(); if (!editing) onRef(chip.dataset.ref, chip); return; }
    if (editing && e.target.closest('[data-img-remove]')) { e.preventDefault(); e.target.closest('.blk').remove(); normalize(); changed(); return; }
    const photo = e.target.closest('.blk[data-t="img"] img');
    if (photo) { if (!editing) onImage(photo); else photo.closest('.blk').classList.toggle('picked'); return; }
    const block = blockOf(e.target);
    if (!block || block.dataset.t !== 'task') return;
    const box = block.getBoundingClientRect();
    if (e.clientX - box.left > 30) return;
    e.preventDefault();
    const done = block.dataset.done !== 'true';
    block.dataset.done = String(done);
    if (editing) changed();
    else onToggle(blocks().filter((b) => b.dataset.t === 'task').indexOf(block), done);
  });

  function toggleMark(cmd) { document.execCommand(cmd); normalize(); changed(); }

  // ---------- Chips ----------
  // Put a chip where the caret is (replacing `range` if given, e.g. the typed "@que"), with a space after it.
  function insertChip({ ref, text }, range = null) {
    const s = getSelection();
    const r = range || (s.rangeCount ? s.getRangeAt(0) : null);
    if (!r) return;
    r.deleteContents();
    const tmp = document.createElement('div');
    tmp.innerHTML = inline(`[${text.replace(/[[\]*`]/g, '')}](dancerly:${ref})`);
    const a = tmp.firstChild;
    const space = document.createTextNode('\u00a0');
    r.insertNode(space);
    r.insertNode(a);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    s.removeAllRanges();
    s.addRange(after);
    normalize();
    changed();
  }

  // ---------- The @ menu (Notion's @, Slack's mentions): people, videos, sections, events and pages ----------
  let menu = null; // { el, node, start, items, index }
  const closeMenu = () => { menu?.el.remove(); menu = null; };
  // Where "@" was typed and what's been typed after it, if the caret is still in that word.
  function followMention(e) {
    const s = getSelection();
    if (!s.rangeCount || !s.isCollapsed) return closeMenu();
    const { startContainer: node, startOffset: off } = s.getRangeAt(0);
    if (node.nodeType !== 3) return closeMenu();
    const before = node.nodeValue.slice(0, off);
    const at = before.lastIndexOf('@');
    if (at < 0 || (at > 0 && !/[\s\u00a0(]/.test(before[at - 1]))) return closeMenu();
    const query = before.slice(at + 1);
    if (query.length > 30 || /[\n]/.test(query) || (query.endsWith(' ') && query.trim().split(/\s+/).length > 3)) return closeMenu();
    openMenu(node, at, query);
  }
  async function openMenu(node, start, query) {
    const items = (await suggest(query)) || [];
    if (!editing) return;
    if (!menu) {
      const el = document.createElement('div');
      el.className = 'ref-menu';
      el.setAttribute('role', 'listbox');
      el.addEventListener('mousedown', (e) => e.preventDefault()); // keep the caret in the page
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) choose(Number(b.dataset.i)); });
      document.body.append(el);
      menu = { el };
    }
    Object.assign(menu, { node, start, query, items, index: 0 });
    paintMenu();
  }
  function paintMenu() {
    const { el, items, query } = menu;
    let group = '';
    el.innerHTML = items.length ? items.map((it, i) => {
      const head = it.group !== group ? `<p class="ref-menu-group">${esc((group = it.group))}</p>` : '';
      return `${head}<button type="button" role="option" data-i="${i}" class="ref-menu-item${i === menu.index ? ' on' : ''}" aria-selected="${i === menu.index}"><span class="ref-menu-icon" data-kind="${esc(it.ref.split('/')[0])}"></span><span class="ref-menu-main"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
    }).join('') : `<p class="ref-menu-empty">${query ? `Nothing called “${esc(query)}” in this project` : 'Nothing to link yet'}</p>`;
    // Under the caret on computers; on phones it sits above the keyboard (CSS).
    const r = document.createRange();
    r.setStart(menu.node, Math.min(menu.start, menu.node.length));
    const box = r.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(box.left, innerWidth - el.offsetWidth - 8))}px`;
    const below = box.bottom + 6 + el.offsetHeight < innerHeight - 8;
    el.style.top = `${below ? box.bottom + 6 : Math.max(8, box.top - 6 - el.offsetHeight)}px`;
    el.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  function menuKeys(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (menu.items.length) menu.index = (menu.index + (e.key === 'ArrowDown' ? 1 : -1) + menu.items.length) % menu.items.length;
      paintMenu();
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && menu.items.length) { e.preventDefault(); choose(menu.index); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return true; }
    return false;
  }
  function choose(i) {
    const it = menu?.items[i];
    if (!it) return;
    const r = document.createRange();
    const end = Math.min(menu.start + 1 + menu.query.length, menu.node.length);
    r.setStart(menu.node, menu.start);
    r.setEnd(menu.node, end);
    closeMenu();
    insertChip(it, r);
  }
  root.addEventListener('blur', () => setTimeout(() => { if (!root.contains(document.activeElement)) closeMenu(); }, 150));

  // ---------- Photos ----------
  // A photo block after the line you're on (or at the end); returns it, so an upload can fill in its path.
  function insertPhoto(src = null) {
    const tmp = document.createElement('div');
    tmp.innerHTML = blockHtml({ t: 'img', src: src || '', alt: 'Photo' });
    const el = tmp.firstChild;
    if (!src) { el.removeAttribute('data-src'); el.dataset.uploading = 'true'; }
    const at = caretBlock() || blocks().pop();
    at.after(el);
    // A line to keep writing on below it.
    if (!el.nextElementSibling) { const t = document.createElement('div'); t.innerHTML = blockHtml({ t: 'p', text: '' }); el.after(t.firstChild); }
    placeCaret(el.nextElementSibling);
    return el;
  }

  const api = {
    edit(on) {
      editing = on;
      if (!on) closeMenu();
      root.contentEditable = on ? 'true' : 'false';
      root.classList.toggle('editing', on);
      if (on) { root.focus({ preventScroll: true }); if (!root.contains(getSelection().anchorNode)) placeCaret(blocks().pop(), true); }
    },
    setMarkdown(md) { root.innerHTML = blocksHtml(md) || blockHtml({ t: 'p', text: '' }); paintImages(); },
    // The chips on the page, to mark the ones that point at something gone.
    chips: () => [...root.querySelectorAll('a.ref')],
    // @ from the toolbar (phones): type it, and the menu opens.
    mention() { if (!root.contains(getSelection().anchorNode)) placeCaret(blocks().pop(), true); const b = caretBlock(); const needSpace = b && b.textContent && !/[\s\u00a0]$/.test(b.textContent); document.execCommand('insertText', false, `${needSpace ? ' ' : ''}@`); },
    // Photos: a placeholder while it uploads, then done(path) or failed().
    addPhoto() {
      const el = insertPhoto();
      return {
        done(path) { el.dataset.src = path; delete el.dataset.uploading; paintImages(); changed(); },
        failed() { el.remove(); normalize(); changed(); }
      };
    },
    onPhoto: null,
    markdown: () => toMarkdown(root),
    // Toolbar: the block the caret is in becomes this type (again: back to text).
    setType(t) {
      const block = caretBlock() || blocks().pop();
      setType(block, block.dataset.t === t ? 'p' : t);
      placeCaret(block, true);
    },
    currentType: () => caretBlock()?.dataset.t || null,
    toggleMark,
    link(url) {
      const s = getSelection();
      if (!s.rangeCount) return;
      if (s.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url)}</a>`);
      else document.execCommand('createLink', false, url);
      normalize();
      changed();
    }
  };
  return api;
}
