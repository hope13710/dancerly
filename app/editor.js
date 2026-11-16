// The page editor: what you write is what everyone reads (no Markdown preview), as in Notion or Slack canvases.
// Pages are still stored as the same small Markdown as before, so nothing about saved pages changes:
//   # Heading · ## Subheading · ### Small heading · - list · 1. numbered · - [ ] checklist · > quote · ---
//   **bold** · *italic* · `code` · [link](https://…)
// The page is one row of blocks (one per line). Reading, a checklist item ticks with a tap; editing, typing "- ",
// "1. ", "[] " or "# " at the start of a line turns it into that block, and Enter carries a list on.
import { esc } from './client.js';

// A block's type and what it looks like in Markdown.
const PREFIX = { p: '', h1: '# ', h2: '## ', h3: '### ', li: '- ', ol: '1. ', task: '- [ ] ', quote: '> ', hr: '---' };
const LISTS = new Set(['li', 'ol', 'task']);

// Inline Markdown → HTML (escaped first; only these few tags come back).
export function inline(t) {
  return esc(t)
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
  : `<div class="blk" data-t="${b.t}"${b.t === 'task' ? ` data-done="${b.done ? 'true' : 'false'}"` : ''}>${inline(b.text) || '<br>'}</div>`);

export const toBlocks = (md) => String(md || '').split('\n').map(parseLine);
export const blocksHtml = (md) => toBlocks(md).map(blockHtml).join('');

// Inline HTML (what the browser left after editing) → Markdown.
function inlineMd(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/ /g, ' '); continue; }
    if (n.nodeType !== 1) continue;
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
export function mount(root, { markdown = '', onChange = () => {}, onToggle = () => {} } = {}) {
  root.classList.add('doc', 'doc-blocks');
  root.innerHTML = blocksHtml(markdown) || blockHtml({ t: 'p', text: '' });
  let editing = false;

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
      for (const el of [...b.querySelectorAll('*')]) {
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
  const SHORTCUTS = [[/^[-*]\s\[( |x)?\]\s$/i, 'task'], [/^\[( |x)?\]\s$/i, 'task'], [/^[-*]\s$/, 'li'], [/^\d+[.)]\s$/, 'ol'], [/^#\s$/, 'h1'], [/^##\s$/, 'h2'], [/^###\s$/, 'h3'], [/^>\s$/, 'quote']];
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
    if (e.inputType === 'deleteContentBackward' && block && atStart(block) && block.previousElementSibling?.dataset.t === 'hr') {
      e.preventDefault();
      block.previousElementSibling.remove();
      changed();
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
    if (e.inputType === 'insertText' && e.data === ' ') shortcut(block);
    changed();
  });
  root.addEventListener('keydown', (e) => {
    if (!editing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleMark('bold'); }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); toggleMark('italic'); }
    if (e.key === 'Enter' && !e.shiftKey) {
      const block = caretBlock();
      if (block && block.dataset.t === 'p' && block.textContent.trim() === '---') { e.preventDefault(); shortcut(block); }
    }
  });

  // Paste: plain text only. Several lines become blocks after the one you're in.
  root.addEventListener('paste', (e) => {
    if (!editing) return;
    e.preventDefault();
    const text = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    if (!text) return;
    const lines = text.split('\n');
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

  return {
    edit(on) {
      editing = on;
      root.contentEditable = on ? 'true' : 'false';
      root.classList.toggle('editing', on);
      if (on) { root.focus({ preventScroll: true }); if (!root.contains(getSelection().anchorNode)) placeCaret(blocks().pop(), true); }
    },
    setMarkdown(md) { root.innerHTML = blocksHtml(md) || blockHtml({ t: 'p', text: '' }); },
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
}
