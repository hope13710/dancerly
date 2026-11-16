// Project › Pages: the team's notices and lists — this week's rehearsal, what to bring, spacing, the show-day run
// sheet. Written and read in the same view (app/editor.js), ticked with a tap, saved as you go.
import { sb, $, $$, esc, timeAgo, toast, friendlyError, dialog, actionSheet, isEnter } from '../client.js';
import { ctx } from '../ctx.js';
import { loadProject, projectHead } from './project.js';
import { empty, namesFor } from './shared.js';
import { ic } from '../icons.js';
import { mount, toBlocks, inline, taskCount } from '../editor.js';

// A page whose text opens with its own title as a heading ("# This week" under "This week", common when pasting
// from Notes or Notion) shows the title once.
const withoutTitle = (body, title) => {
  const [first, ...rest] = (body || '').split('\n');
  const heading = first.match(/^#{1,2}\s+(.+?)\s*$/);
  return heading && heading[1].toLowerCase() === (title || '').trim().toLowerCase() ? rest.join('\n').replace(/^\s*\n/, '') : body;
};
// The first words of a page, as plain text, for lists.
export const pageSnippet = (body, title, n = 110) => toBlocks(withoutTitle(body, title)).filter((b) => b.t !== 'hr' && b.text.trim())
  .map((b) => b.text.replace(/[*`]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')).join(' · ').slice(0, n);
// Read-only HTML of a page's Markdown (the same blocks the editor shows), for places that only display it.
export const markdown = (md) => toBlocks(md).map((b) => (b.t === 'hr' ? '<hr />' : `<div class="blk" data-t="${b.t}"${b.t === 'task' ? ` data-done="${b.done}"` : ''}>${inline(b.text) || '<br>'}</div>`)).join('');

// Pages teams make again and again. Each starts filled in, ready to edit.
const day = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const TEMPLATES = [
  { key: 'notice', icon: 'calendar', label: 'Rehearsal notice', hint: 'When, where, what we’re working on, what to do before', title: () => `Rehearsal · ${day(new Date(Date.now() + 864e5))}`,
    body: '## When and where\n- Date: \n- Time: \n- Place: \n\n## What we’re working on\n- \n\n## Before you come\n- [ ] Watch the latest takes and the notes on them\n- [ ] Run your sections at half speed\n- [ ] Bring water and dance shoes' },
  { key: 'bring', icon: 'check', label: 'What to bring', hint: 'A checklist anyone can tick', title: () => 'What to bring',
    body: '- [ ] Dance shoes\n- [ ] Water\n- [ ] Practice clothes\n- [ ] Knee pads\n- [ ] Hair ties' },
  { key: 'formation', icon: 'people', label: 'Formation and spacing', hint: 'Positions per section and the moves between them', title: () => 'Formation and spacing',
    body: '## Positions\n- Intro: \n- Verse: \n- Chorus: \n\n## Transitions\n- \n\n## Notes\n- Mark the spots on the floor before the first run-through' },
  { key: 'show', icon: 'flag', label: 'Show day run sheet', hint: 'Call time, running order, backstage checklist', title: () => 'Show day',
    body: '## Call time and place\n- Call time: \n- Venue: \n- Meet at: \n\n## Running order\n1. \n2. \n3. \n\n## Backstage\n- [ ] Costumes ready\n- [ ] Music checked with the sound team\n- [ ] Spots marked on stage\n- [ ] Group photo after the show' },
  { key: 'costumes', icon: 'layers', label: 'Costumes and props', hint: 'What everyone wears and who brings what', title: () => 'Costumes and props',
    body: '## Costumes\n- [ ] Top: \n- [ ] Bottom: \n- [ ] Shoes: \n\n## Props\n- [ ] \n\n## Who brings what\n- ' },
  { key: 'blank', icon: 'file', label: 'Blank page', title: () => '', body: '' }
];

// ---------- The list ----------
export async function renderProjectPages(projectId) {
  const { view, setCrumbs } = ctx;
  const [p, { data: pages, error }] = await Promise.all([
    loadProject(projectId),
    sb.from('project_pages').select('id, title, body, pinned, updated_at, updated_by').eq('project_id', projectId).order('pinned', { ascending: false }).order('updated_at', { ascending: false })
  ]);
  if (error) throw error;
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Pages']]);
  const names = await namesFor(pages.map((x) => x.updated_by));
  const row = (pg) => {
    const tasks = taskCount(pg.body);
    return `<a class="row page-row" href="/app/p/${projectId}/pages/${pg.id}" data-link>
      <span class="page-icon">${ic(pg.pinned ? 'pin' : 'file', 'solo')}</span>
      <span class="row-main"><span class="row-title">${esc(pg.title || 'Untitled')}</span><span class="row-meta">${esc(pageSnippet(pg.body, pg.title)) || 'Empty page'}</span></span>
      <span class="row-side">${tasks.total ? `<span class="task-count${tasks.done === tasks.total ? ' all' : ''}" title="${tasks.done} of ${tasks.total} checked">${ic('check', 'solo')}${tasks.done}/${tasks.total}</span>` : ''}<small class="hide-sm">${esc(names[pg.updated_by] || '')} · ${timeAgo(pg.updated_at)}</small><span class="chev">${ic('right', 'solo')}</span></span></a>`;
  };
  const pinned = pages.filter((x) => x.pinned);
  const rest = pages.filter((x) => !x.pinned);
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'pages', '<button class="btn primary" data-new-page>+ New page</button>')}
    ${pages.length ? `${pinned.length ? `<h2 class="section-label">Pinned · on the project Overview</h2><div class="list">${pinned.map(row).join('')}</div>` : ''}
      ${rest.length ? `${pinned.length ? '<h2 class="section-label">All pages</h2>' : ''}<div class="list">${rest.map(row).join('')}</div>` : ''}`
      : `${empty('file', 'No pages yet', 'Keep the team’s notices and lists in one place: this week’s rehearsal, what to bring, spacing, the show-day run sheet. Everyone on the project can read, tick, and edit.', '<button class="btn primary" data-new-page>+ New page</button>')}
        <div class="template-grid" data-templates>${TEMPLATES.filter((t) => t.key !== 'blank').map((t) => `<button type="button" class="template-card" data-template="${t.key}">${ic(t.icon, 'solo')}<b>${esc(t.label)}</b><small>${esc(t.hint)}</small></button>`).join('')}</div>`}
  </section>`;
  $$('[data-new-page]').forEach((b) => b.addEventListener('click', (e) => newPage(projectId, e.currentTarget)));
  $$('[data-template]').forEach((b) => b.addEventListener('click', () => createPage(projectId, TEMPLATES.find((t) => t.key === b.dataset.template))));
}

// New page: pick a template (or a blank page), and it opens ready to edit, title first.
async function newPage(projectId, anchor) {
  const key = await actionSheet({ title: 'New page', anchor, actions: TEMPLATES.map((t) => ({ value: t.key, icon: t.icon, label: t.label, hint: t.hint })) });
  if (key) createPage(projectId, TEMPLATES.find((t) => t.key === key));
}
async function createPage(projectId, t) {
  const { data, error } = await sb.from('project_pages').insert({ project_id: projectId, title: t.title() || 'Untitled', body: t.body }).select('id').single();
  if (error) return toast(friendlyError(error), 'error');
  ctx.navigate(`/app/p/${projectId}/pages/${data.id}?edit=1&new=1`);
}

// Tick or untick checklist item `index` (counting checklist lines) in Markdown. `text` finds the same item if lines
// moved since (someone else edited); returns null if it's gone.
function setTask(md, index, done, text) {
  const lines = md.split('\n');
  const tasks = lines.map((l, i) => [l, i]).filter(([l]) => /^\s*[-*]\s+\[( |x)\]/i.test(l));
  const same = (l) => l.replace(/^\s*[-*]\s+\[( |x)\]\s?/i, '').trim() === text.trim();
  const hit = tasks[index] && same(tasks[index][0]) ? tasks[index] : tasks.find(([l]) => same(l));
  if (!hit) return null;
  lines[hit[1]] = hit[0].replace(/\[( |x)\]/i, done ? '[x]' : '[ ]');
  return lines.join('\n');
}

// ---------- One page ----------
export async function renderPage(projectId, pageId) {
  const { view, setCrumbs, navigate } = ctx;
  const [p, { data: page, error }] = await Promise.all([
    loadProject(projectId),
    sb.from('project_pages').select('id, title, body, pinned, created_by, updated_by, updated_at').eq('id', pageId).eq('project_id', projectId).maybeSingle()
  ]);
  if (error) throw error;
  if (!page) throw new Error('This page was deleted.');
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Pages', `/app/p/${projectId}/pages`], [page.title || 'Untitled']]);
  const names = await namesFor([page.updated_by]);
  const params = new URLSearchParams(location.search);
  const canDelete = page.created_by === p.me || p.isOwner;
  const coarse = matchMedia('(pointer: coarse)').matches;
  // What's saved, and its version: a save only lands on the version it was made from (see save()).
  let saved = { title: page.title, body: page.body || '' };
  let version = page.updated_at;
  let editing = false;

  const TOOLS = [['p', 'Text', 'T'], ['h1', 'Heading', 'H1'], ['h2', 'Subheading', 'H2'], ['li', 'Bulleted list', '•'], ['ol', 'Numbered list', '1.'], ['task', 'Checklist', '☐']];
  view.innerHTML = `<section class="page narrow-wide doc-page">
    <header class="doc-head">
      <p class="muted doc-meta" data-meta>Edited by ${esc(names[page.updated_by] || 'someone')} · ${timeAgo(page.updated_at)}</p>
      <div class="head-actions">
        <span class="save-state" data-save hidden></span>
        <button type="button" class="btn small" data-edit>${ic('pen')}Edit</button>
        <button type="button" class="btn small primary" data-done hidden>Done</button>
        <button type="button" class="btn small ghost icon" data-page-more aria-label="Page options" title="Page options">${ic('more', 'solo')}</button>
      </div>
    </header>
    <div class="banner warn doc-conflict" data-conflict hidden></div>
    <h1 class="doc-title" data-title-view>${esc(page.title || 'Untitled')}</h1>
    <input class="doc-title-input" data-title maxlength="120" value="${esc(page.title)}" placeholder="Untitled" aria-label="Title" hidden />
    <div class="doc-toolbar" data-toolbar role="toolbar" aria-label="Formatting" hidden>
      ${TOOLS.map(([t, label, glyph]) => `<button type="button" data-block="${t}" title="${label}" aria-label="${label}"><span>${glyph}</span></button>`).join('')}
      <i aria-hidden="true"></i>
      <button type="button" data-mark="bold" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button>
      <button type="button" data-mark="italic" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button>
      <button type="button" data-link-btn title="Link" aria-label="Link">${ic('link', 'solo')}</button>
    </div>
    <article class="doc" data-doc aria-label="Page"></article>
    <p class="doc-hint muted" data-hint hidden>Type <code>-</code> for a list, <code>[]</code> for a checklist, <code>#</code> for a heading. Changes save as you go.</p>
  </section>`;

  const titleView = $('[data-title-view]');
  const titleEl = $('[data-title]');
  const stateEl = $('[data-save]');
  const conflictEl = $('[data-conflict]');
  const toolbar = $('[data-toolbar]');
  const setState = (text, bad = false) => { stateEl.hidden = !text; stateEl.textContent = text; stateEl.classList.toggle('error', bad); };

  let timer = null;
  let pending = false;
  let inConflict = false;
  const ed = mount($('[data-doc]'), {
    markdown: withoutTitle(saved.body, saved.title),
    onChange: () => queue(),
    onToggle: (index, done) => toggleTask(index, done)
  });
  const isBlank = () => !saved.body.trim();
  const paintEmpty = () => { $('[data-doc]').classList.toggle('is-empty', !editing && isBlank()); };

  // ---------- Saving: autosave, and never over someone else's newer version ----------
  const queue = () => { if (inConflict) return; pending = true; setState('Editing…'); clearTimeout(timer); timer = setTimeout(save, 700); };
  async function save({ force = false } = {}) {
    clearTimeout(timer);
    pending = false;
    const title = titleEl.value.trim() || 'Untitled';
    const body = ed.markdown();
    if (title === saved.title && body === saved.body) { setState(editing ? 'Saved' : ''); return true; }
    setState('Saving…');
    let q = sb.from('project_pages').update({ title, body }).eq('id', page.id);
    if (!force) q = q.eq('updated_at', version);
    const { data, error: e } = await q.select('updated_at, updated_by');
    if (e) { setState('Couldn’t save. Retrying…', true); pending = true; timer = setTimeout(save, 3000); return false; }
    if (!data?.length) { await showConflict(); return false; }
    version = data[0].updated_at;
    saved = { title, body };
    setState('Saved');
    titleView.textContent = title;
    return true;
  }
  // Someone saved this page since you opened it: show it, and let the person choose (as Google Docs does offline).
  async function showConflict() {
    inConflict = true;
    const { data: latest } = await sb.from('project_pages').select('title, body, updated_at, updated_by').eq('id', page.id).maybeSingle();
    if (!latest) { setState(''); return toast('This page was deleted.', 'error'); }
    const who = (await namesFor([latest.updated_by]))[latest.updated_by] || 'Someone';
    setState('Not saved', true);
    conflictEl.hidden = false;
    conflictEl.innerHTML = `<span><b>${esc(who)}</b> changed this page while you were editing.</span>
      <span class="banner-actions"><button type="button" class="btn small" data-theirs>Show their version</button><button type="button" class="btn small ghost" data-mine>Keep mine</button></span>`;
    conflictEl.querySelector('[data-theirs]').addEventListener('click', () => {
      version = latest.updated_at;
      saved = { title: latest.title, body: latest.body || '' };
      titleEl.value = latest.title; titleView.textContent = latest.title;
      ed.setMarkdown(withoutTitle(saved.body, saved.title));
      resolved('Their version is showing. Your changes weren’t saved.');
    });
    conflictEl.querySelector('[data-mine]').addEventListener('click', async () => {
      inConflict = false;
      conflictEl.hidden = true;
      if (await save({ force: true })) toast('Your version is saved.');
    });
  }
  const resolved = (msg) => { inConflict = false; conflictEl.hidden = true; setState(editing ? 'Saved' : ''); toast(msg); };

  // A tick from reading: saved on its own, onto the latest version, so two people ticking different items don't
  // undo each other.
  async function toggleTask(index, done) {
    const text = $$('[data-doc] > .blk[data-t="task"]')[index]?.textContent || '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = setTask(saved.body, index, done, text);
      if (body === null) break;
      const { data, error: e } = await sb.from('project_pages').update({ body }).eq('id', page.id).eq('updated_at', version).select('updated_at');
      if (e) { toast(friendlyError(e), 'error'); break; }
      if (data?.length) {
        version = data[0].updated_at;
        saved.body = body;
        paintMeta('you');
        // It landed on someone's newer version: show that version (with this tick), so nothing stale is saved later.
        if (attempt) ed.setMarkdown(withoutTitle(saved.body, saved.title));
        return;
      }
      const { data: latest } = await sb.from('project_pages').select('title, body, updated_at').eq('id', page.id).maybeSingle();
      if (!latest) break;
      version = latest.updated_at;
      saved = { title: latest.title, body: latest.body || '' };
    }
    // Couldn't apply it: show the page as it is now.
    ed.setMarkdown(withoutTitle(saved.body, saved.title));
    toast('This list changed. Here’s the latest.');
  }
  const paintMeta = (who) => { $('[data-meta]').textContent = `Edited by ${who} · just now`; };

  // ---------- Reading and editing: the same page, made editable in place ----------
  const setEditing = async (on) => {
    if (on === editing) return;
    if (on) {
      // Start from the latest version, in case someone saved since this page opened.
      const { data: latest } = await sb.from('project_pages').select('title, body, updated_at').eq('id', page.id).maybeSingle();
      if (latest && latest.updated_at !== version) {
        version = latest.updated_at;
        saved = { title: latest.title, body: latest.body || '' };
        titleEl.value = latest.title; titleView.textContent = latest.title;
        ed.setMarkdown(withoutTitle(saved.body, saved.title));
      }
    } else if (pending) await save();
    editing = on;
    titleView.hidden = on;
    titleEl.hidden = !on;
    toolbar.hidden = !on;
    $('[data-hint]').hidden = !on;
    $('[data-edit]').hidden = on;
    $('[data-done]').hidden = !on;
    document.body.classList.toggle('doc-editing', on);
    ed.edit(on);
    if (!on) setState('');
    paintEmpty();
    history.replaceState(history.state, '', on ? '?edit=1' : location.pathname);
  };
  $('[data-edit]').addEventListener('click', () => setEditing(true));
  $('[data-done]').addEventListener('click', () => setEditing(false));
  // On a computer, clicking into the text starts editing right there (the caret lands where you clicked).
  // With touch, Edit does it: scrolling a page shouldn't open the keyboard.
  $('[data-doc]').addEventListener('mousedown', (e) => {
    if (editing || coarse || e.button !== 0 || e.target.closest('a')) return;
    const block = e.target.closest('.blk');
    if (block?.dataset.t === 'task' && e.clientX - block.getBoundingClientRect().left <= 30) return; // the box ticks
    setEditing(true);
  });
  titleView.addEventListener('click', () => { if (!coarse) setEditing(true).then(() => titleEl.focus()); });
  titleEl.addEventListener('input', queue);
  titleEl.addEventListener('keydown', (e) => { if (isEnter(e)) { e.preventDefault(); $('[data-doc]').focus(); } });
  // Escape (or Cmd/Ctrl+Enter) finishes, as in Notion and Linear.
  view.addEventListener('keydown', (e) => { if (editing && (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey)))) { e.preventDefault(); setEditing(false); } });

  // Toolbar: buttons keep the caret where it is (no focus change on press).
  toolbar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  toolbar.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.block) ed.setType(b.dataset.block);
    if (b.dataset.mark) ed.toggleMark(b.dataset.mark);
    if ('linkBtn' in b.dataset) {
      const sel = getSelection();
      const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      const got = await dialog({ title: 'Add a link', fields: [{ name: 'url', label: 'Link', placeholder: 'https://…', required: true, max: 500 }], confirm: 'Add' });
      if (!got?.url) return;
      const url = /^https?:\/\//i.test(got.url) ? got.url : `https://${got.url}`;
      $('[data-doc]').focus();
      if (range) { sel.removeAllRanges(); sel.addRange(range); }
      ed.link(url);
    }
    paintTools();
  });
  // The toolbar shows the type of the line you're on.
  const paintTools = () => { const t = ed.currentType(); toolbar.querySelectorAll('[data-block]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.block === t))); };
  const onSelection = () => { if (editing) paintTools(); };
  document.addEventListener('selectionchange', onSelection);
  // On phones the toolbar rides above the keyboard.
  const vv = window.visualViewport;
  const onViewport = () => toolbar.style.setProperty('--kb', `${Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))}px`);
  vv?.addEventListener('resize', onViewport);
  vv?.addEventListener('scroll', onViewport);

  // ⋯: pin to the Overview, delete.
  $('[data-page-more]').addEventListener('click', async (e) => {
    const choice = await actionSheet({ title: titleEl.value || page.title, anchor: e.currentTarget, actions: [
      { value: 'pin', icon: 'pin', label: page.pinned ? 'Unpin from Overview' : 'Pin to Overview', hint: page.pinned ? null : 'Everyone sees it first on the project’s Overview' },
      ...(canDelete ? [{ value: 'delete', icon: 'trash', label: 'Delete page', danger: true }] : [])
    ] });
    if (choice === 'pin') {
      const { data, error: e2 } = await sb.from('project_pages').update({ pinned: !page.pinned }).eq('id', page.id).select('updated_at');
      if (e2) return toast(friendlyError(e2), 'error');
      page.pinned = !page.pinned;
      if (data?.[0]) version = data[0].updated_at;
      toast(page.pinned ? 'Pinned. It’s first on the Overview.' : 'Unpinned.');
    }
    if (choice === 'delete') {
      const ok = await dialog({ title: `Delete “${titleEl.value || page.title}”?`, body: 'It’s gone for everyone on the project. This can’t be undone.', confirm: 'Delete', danger: true });
      if (!ok) return;
      pending = false;
      const { error: e3 } = await sb.from('project_pages').delete().eq('id', page.id);
      if (e3) return toast(friendlyError(e3), 'error');
      navigate(`/app/p/${projectId}/pages`, { replace: true });
    }
  });

  paintEmpty();
  if (params.get('edit') === '1') {
    await setEditing(true);
    // A new page: the title first, selected, so typing replaces it (as in Notion).
    if (params.get('new') === '1') { titleEl.focus(); titleEl.select(); history.replaceState(history.state, '', '?edit=1'); }
  }

  const beforeUnload = (e) => { if (pending) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return () => {
    window.removeEventListener('beforeunload', beforeUnload);
    document.body.classList.remove('doc-editing');
    document.removeEventListener('selectionchange', onSelection);
    vv?.removeEventListener('resize', onViewport);
    vv?.removeEventListener('scroll', onViewport);
    if (pending && !inConflict) save();
  };
}
