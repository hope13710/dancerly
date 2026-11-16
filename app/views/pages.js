// Project › Pages: the team's notices and lists — this week's rehearsal, what to bring, spacing, the show-day run
// sheet. Written and read in the same view (app/editor.js), ticked with a tap, saved as you go.
import { sb, $, $$, esc, timeAgo, toast, friendlyError, dialog, actionSheet, isEnter, Unavailable, schema, takeUrl, notChoreo, fmt } from '../client.js';
import { showEvent } from './calendar.js';
import { track } from '../onboarding.js';
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
export const markdown = (md) => toBlocks(md).filter((b) => b.t !== 'img' && b.t !== 'card').map((b) => (b.t === 'hr' ? '<hr />' : `<div class="blk" data-t="${b.t}"${b.t === 'task' ? ` data-done="${b.done}"` : ''}>${inline(b.text) || '<br>'}</div>`)).join('');

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
  if (!page) throw new Unavailable('This page isn’t available', 'Someone on the project may have deleted it.', [`/app/p/${projectId}/pages`, 'Back to Pages']);
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
      <i aria-hidden="true" class="tb-sep-media"></i>
      <button type="button" data-mention-btn title="Mention someone or link a video, section, event or page (@)" aria-label="Mention or link"><span class="tb-at">@</span></button>
      ${schema.pageMentions ? `<button type="button" data-photo-btn title="Add a photo" aria-label="Add a photo">${ic('image', 'solo')}</button>` : ''}
    </div>
    <input type="file" accept="image/*" multiple data-photo-input hidden />
    <article class="doc" data-doc aria-label="Page"></article>
    <p class="doc-hint muted" data-hint hidden>Type <code>@</code> to mention someone or link a video, <code>-</code> for a list, <code>[]</code> for a checklist, <code>#</code> for a heading. Changes save as you go.</p>
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
  const refs = pageRefs(p, page.id);
  const ed = mount($('[data-doc]'), {
    markdown: withoutTitle(saved.body, saved.title),
    onChange: () => queue(),
    onToggle: (index, done) => toggleTask(index, done),
    suggest: refs.suggest,
    unfurl: refs.unfurl,
    imageUrl: (path) => takeUrl(path),
    onRef: (ref, el) => refs.open(ref, el),
    onImage: (img) => lightbox(img),
    onInsert: (ref, how) => track('page_ref_inserted', { kind: ref.split('/')[0], how }),
    card: refs.card
  });
  // Shows a version of the page, and greys out chips whose video, section, event, page or person is gone.
  const show = (md) => { ed.setMarkdown(md); refs.check(ed.chips()); };
  refs.check(ed.chips());
  ed.onPhoto = (file) => addPhotos([file]);
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
    const before = saved.body;
    saved = { title, body };
    notifyMentions(page.id, before, body, p.me, p.members);
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
      show(withoutTitle(saved.body, saved.title));
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
        if (attempt) show(withoutTitle(saved.body, saved.title));
        return;
      }
      const { data: latest } = await sb.from('project_pages').select('title, body, updated_at').eq('id', page.id).maybeSingle();
      if (!latest) break;
      version = latest.updated_at;
      saved = { title: latest.title, body: latest.body || '' };
    }
    // Couldn't apply it: show the page as it is now.
    show(withoutTitle(saved.body, saved.title));
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
        show(withoutTitle(saved.body, saved.title));
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
    if (editing || coarse || e.button !== 0 || e.target.closest('a, .blk[data-t="img"], .blk[data-t="card"]')) return;
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
    if ('mentionBtn' in b.dataset) ed.mention();
    if ('photoBtn' in b.dataset) $('[data-photo-input]').click();
    paintTools();
  });
  // ---------- Photos: from the toolbar (camera or album on phones), pasted, or dropped ----------
  const photoInput = $('[data-photo-input]');
  photoInput.addEventListener('change', () => { addPhotos([...photoInput.files]); photoInput.value = ''; });
  async function addPhotos(files) {
    if (!schema.pageMentions) return;
    for (const file of files.filter((f) => f.type.startsWith('image/')).slice(0, 10)) {
      const slot = ed.addPhoto();
      try {
        const blob = await shrink(file);
        const path = `${projectId}/pages/${page.id}/${crypto.randomUUID()}.jpg`;
        const { error: e } = await sb.storage.from('takes').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (e) throw e;
        slot.done(path);
        track('page_photo_added');
      } catch (e) {
        slot.failed();
        toast(e?.decode ? 'This photo type can’t be added. Try a JPG or PNG.' : friendlyError(e), 'error');
      }
    }
  }
  const docEl = $('[data-doc]');
  docEl.addEventListener('dragover', (e) => { if (editing && schema.pageMentions && [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); docEl.classList.add('drop'); } });
  docEl.addEventListener('dragleave', () => docEl.classList.remove('drop'));
  docEl.addEventListener('drop', (e) => {
    docEl.classList.remove('drop');
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!editing || !files.length) return;
    e.preventDefault();
    const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (at) { const s = getSelection(); s.removeAllRanges(); s.addRange(at); }
    addPhotos(files);
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
      { value: 'copy', icon: 'link', label: 'Copy link', hint: 'Paste it in your team chat. Anyone in the project can open it.' },
      { value: 'pin', icon: 'pin', label: page.pinned ? 'Unpin from Overview' : 'Pin to Overview', hint: page.pinned ? null : 'Everyone sees it first on the project’s Overview' },
      ...(canDelete ? [{ value: 'delete', icon: 'trash', label: 'Delete page', danger: true }] : [])
    ] });
    if (choice === 'copy') {
      const url = `${location.origin}/app/p/${projectId}/pages/${page.id}`;
      track('page_link_copied');
      try { await navigator.clipboard.writeText(url); toast('Link copied. Anyone in the project can open it.'); }
      catch { await dialog({ title: 'Copy this link', fields: [{ name: 'url', label: 'Link', value: url, max: 400 }], confirm: 'Done' }); }
    }
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
    document.querySelector('.ref-menu')?.remove();
    window.removeEventListener('beforeunload', beforeUnload);
    document.body.classList.remove('doc-editing');
    document.removeEventListener('selectionchange', onSelection);
    vv?.removeEventListener('resize', onViewport);
    vv?.removeEventListener('scroll', onViewport);
    if (pending && !inConflict) save();
  };
}

// ---------- Chips: what @ can link to in this project, opening them, and spotting the ones that are gone ----------
const KIND_GROUP = { everyone: 'People', person: 'People', video: 'Videos', section: 'Practice sections', event: 'Events', page: 'Pages' };
const GONE = { person: 'They’re no longer in this project.', video: 'This video was deleted.', section: 'This section was removed from Practice.', event: 'This event was deleted.', page: 'This page was deleted.' };
const splitRef = (ref) => { const [kind, rest = ''] = ref.split(/\/(.*)/s); const [id, query = ''] = rest.split('?'); return { kind, id, query }; };
const sectionLabel = (r) => [r.section, r.counts].filter(Boolean).join(' · ') || `Section ${r.position + 1}`;

function pageRefs(p, pageId) {
  const projectId = p.project.id;
  const live = schema.trash ? (q) => q.is('deleted_at', null) : (q) => q;
  let all = null;
  // Loaded once, the first time @ is typed.
  const load = () => all ||= (async () => {
    const [{ data: videos }, { data: sections }, { data: events }, { data: pages }] = await Promise.all([
      live(notChoreo(sb.from('videos').select(`id, title, created_at, takes(number${schema.trash ? ', deleted_at' : ''})`).eq('project_id', projectId))).order('created_at', { ascending: false }).limit(200),
      sb.from('count_sheet_rows').select('id, position, section, counts').eq('project_id', projectId).order('position').limit(200),
      sb.from('project_events').select('id, title, starts_at').eq('project_id', projectId).order('starts_at', { ascending: false }).limit(200),
      sb.from('project_pages').select('id, title').eq('project_id', projectId).neq('id', pageId).order('updated_at', { ascending: false }).limit(200)
    ]);
    const soon = Date.now() - 864e5;
    const date = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return [
      ...(p.members.length >= 3 ? [{ group: 'People', label: 'everyone', sub: `Notify all ${p.members.length - 1} people`, ref: `everyone/${projectId}`, text: 'everyone' }] : []),
      ...p.members.map((m) => ({ group: 'People', label: m.name, sub: m.user_id === p.me ? 'You' : m.role === 'owner' ? 'Owner' : '', ref: `person/${m.user_id}`, text: m.name })),
      ...(videos || []).map((v) => {
        const last = Math.max(0, ...(v.takes || []).filter((t) => !t.deleted_at).map((t) => t.number));
        return { group: 'Videos', label: v.title || 'Untitled video', sub: last ? `Take ${last}` : '', ref: `video/${v.id}${last ? `?take=${last}` : ''}`, text: `${v.title || 'Video'}${last ? ` · Take ${last}` : ''}` };
      }),
      ...(sections || []).filter((r) => r.section || r.counts).map((r) => ({ group: 'Practice sections', label: sectionLabel(r), sub: 'Practice', ref: `section/${r.id}`, text: `Practice · ${sectionLabel(r)}` })),
      // Coming up first, then the past.
      ...(events || []).sort((a, b) => ((new Date(a.starts_at) < soon) - (new Date(b.starts_at) < soon)) || (new Date(b.starts_at) < soon ? 0 : new Date(a.starts_at) - new Date(b.starts_at)))
        .map((e) => ({ group: 'Events', label: e.title, sub: date(e.starts_at), ref: `event/${e.id}`, text: `${e.title} · ${date(e.starts_at)}` })),
      ...(pages || []).map((pg) => ({ group: 'Pages', label: pg.title || 'Untitled', sub: '', ref: `page/${pg.id}`, text: pg.title || 'Untitled' }))
    ];
  })();

  async function suggest(query) {
    const items = await load();
    const q = query.trim().toLowerCase();
    const per = q ? 6 : { People: 5, Videos: 3, 'Practice sections': 3, Events: 2, Pages: 2 };
    const count = {};
    // Words that start with what's typed come before matches inside a word.
    const score = (it) => { const l = it.label.toLowerCase(); return !q ? 0 : l.startsWith(q) ? 0 : l.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : l.includes(q) ? 2 : -1; };
    return items.map((it) => ({ it, s: score(it) })).filter((x) => x.s >= 0)
      .sort((a, b) => Object.keys(KIND_GROUP).indexOf(a.it.ref.split('/')[0]) - Object.keys(KIND_GROUP).indexOf(b.it.ref.split('/')[0]) || a.s - b.s)
      .filter(({ it }) => (count[it.group] = (count[it.group] || 0) + 1) <= (typeof per === 'number' ? per : per[it.group]))
      .map(({ it }) => it);
  }

  // A pasted dancerly link to something in this project → a chip (a moment of a take, a note, a section, a page).
  async function unfurl(raw) {
    const url = new URL(raw);
    if (url.origin !== location.origin) return null;
    const path = url.pathname.replace(/\/$/, '');
    const inThis = path.startsWith(`/app/p/${projectId}`);
    let m;
    if (inThis && (m = path.match(/\/v\/([0-9a-f-]{36})$/))) {
      let take = Number(url.searchParams.get('take')) || null;
      let t = url.searchParams.has('t') ? Number(url.searchParams.get('t')) : null;
      const noteId = url.searchParams.get('note');
      const [{ data: v }, note] = await Promise.all([
        sb.from('videos').select('title').eq('id', m[1]).maybeSingle(),
        noteId ? sb.from('notes').select('t_start, takes(number)').eq('id', noteId).maybeSingle().then((r) => r.data) : null
      ]);
      if (!v) return null;
      if (note) { take = note.takes?.number || take; t = Number(note.t_start); }
      const q = new URLSearchParams();
      if (take) q.set('take', take);
      if (t !== null && !Number.isNaN(t)) q.set('t', Math.floor(t));
      if (note) q.set('note', noteId);
      return { ref: `video/${m[1]}${q.toString() ? `?${q}` : ''}`, text: [v.title || 'Video', take && `Take ${take}`, t !== null && !Number.isNaN(t) && fmt(t)].filter(Boolean).join(' · ') };
    }
    if (inThis && path.endsWith('/practice') && url.searchParams.get('section')) {
      const { data: r } = await sb.from('count_sheet_rows').select('id, position, section, counts').eq('id', url.searchParams.get('section')).maybeSingle();
      return r ? { ref: `section/${r.id}`, text: `Practice · ${sectionLabel(r)}` } : null;
    }
    if (inThis && (m = path.match(/\/pages\/([0-9a-f-]{36})$/))) {
      const { data: pg } = await sb.from('project_pages').select('id, title').eq('id', m[1]).maybeSingle();
      return pg ? { ref: `page/${pg.id}`, text: pg.title || 'Untitled' } : null;
    }
    if ((m = path.match(/^\/app\/people\/([0-9a-f-]{36})$/))) {
      const who = p.members.find((x) => x.user_id === m[1]);
      return who ? { ref: `person/${who.user_id}`, text: who.name } : null;
    }
    return null;
  }

  async function open(ref, el) {
    const { kind, id, query } = splitRef(ref);
    if (el?.classList.contains('gone')) return toast(GONE[kind] || 'This isn’t available anymore.');
    const go = ctx.navigate;
    track('page_chip_open', { kind });
    if (kind === 'everyone') return go(`/app/p/${projectId}/people`);
    if (kind === 'person') return go(`/app/people/${id}`);
    if (kind === 'video') return go(`/app/p/${projectId}/v/${id}${query ? `?${query}` : ''}`);
    if (kind === 'section') return go(`/app/p/${projectId}/practice?section=${id}`);
    if (kind === 'page') return go(`/app/p/${projectId}/pages/${id}`);
    if (kind === 'event') {
      const { data: e } = await sb.from('project_events').select('id, project_id, title, kind, starts_at, ends_at, location, details, created_by').eq('id', id).maybeSingle();
      if (!e) { el?.classList.add('gone'); return toast(GONE.event); }
      return showEvent(e, () => {}, projectId);
    }
  }

  // Grey out chips whose target is gone (deleted, or someone who left), as Notion does with a deleted page.
  async function check(chips) {
    const by = {};
    for (const c of chips) { const { kind, id } = splitRef(c.dataset.ref); if (/^[0-9a-f-]{36}$/.test(id)) (by[kind] ||= new Set()).add(id); }
    const table = { video: 'videos', section: 'count_sheet_rows', event: 'project_events', page: 'project_pages' };
    const found = { person: new Set(p.members.map((m) => m.user_id)) };
    await Promise.all(Object.entries(table).filter(([k]) => by[k]).map(async ([k, t]) => {
      let q = sb.from(t).select('id').in('id', [...by[k]]).eq('project_id', projectId);
      if (k === 'video') q = live(q);
      const { data, error } = await q;
      found[k] = error ? by[k] : new Set((data || []).map((r) => r.id));
    }));
    for (const c of chips) {
      const { kind, id } = splitRef(c.dataset.ref);
      const gone = Boolean(found[kind]) && !found[kind].has(id);
      c.classList.toggle('gone', gone);
      if (gone) c.title = GONE[kind]; else c.removeAttribute('title');
    }
  }
  // A video card: the take it points at (or the latest), its thumbnail, and the video when played.
  async function card(ref) {
    const { kind, id, query } = splitRef(ref);
    if (kind !== 'video') return null;
    const q = new URLSearchParams(query);
    const { data: takes } = await sb.from('takes').select(`number, thumb_path, storage_path${schema.trash ? ', deleted_at' : ''}`).eq('video_id', id).order('number', { ascending: false });
    const list = (takes || []).filter((t) => !t.deleted_at);
    const tk = list.find((t) => t.number === Number(q.get('take'))) || list[0];
    if (!tk) return null;
    return { thumb: tk.thumb_path ? await takeUrl(tk.thumb_path).catch(() => null) : null, play: () => { track('page_card_played'); return takeUrl(tk.storage_path); }, t: Number(q.get('t')) || 0 };
  }
  return { suggest, unfurl, open, check, card };
}

// People newly @mentioned in this save hear about it, with the line they're on (migration 075).
const personIds = (md) => new Set([...(md || '').matchAll(/\]\(dancerly:person\/([0-9a-f-]{36})\)/g)].map((m) => m[1]));
const plainLine = (line) => line.replace(/^\s*(?:[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d{1,2}\.\s+|#{1,3}\s+|>\s+)/, '')
  .replace(/\[([^\]]+)\]\(dancerly:(?:person|everyone)\/[^)]+\)/g, '@$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '').trim();
const EVERYONE = /\]\(dancerly:everyone\//;
function notifyMentions(pageId, before, after, me, members) {
  if (!schema.pageMentions) return;
  const had = personIds(before);
  const lines = (after || '').split('\n');
  let mentions = [...personIds(after)].filter((u) => !had.has(u) && u !== me)
    .map((user) => ({ user, line: plainLine(lines.find((l) => l.includes(`dancerly:person/${user}`)) || '') }));
  // @everyone newly on the page: everyone else in the project, with that line (the server skips anyone told
  // about this page in the last hour).
  if (EVERYONE.test(after || '') && !EVERYONE.test(before || '')) {
    const line = plainLine(lines.find((l) => EVERYONE.test(l)) || '');
    mentions = [...mentions, ...members.filter((m) => m.user_id !== me && !mentions.some((x) => x.user === m.user_id)).map((m) => ({ user: m.user_id, line }))];
    track('mention_everyone', { where: 'page' });
  }
  if (mentions.length) sb.rpc('notify_page_mentions', { p_page: pageId, p_mentions: mentions }).then(({ error }) => { if (error) console.warn(error); });
}

// Resize a photo on the device (1600px on the long side, JPEG), so a 12MB camera photo uploads as ~300KB.
async function shrink(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { const e = new Error('decode'); e.decode = true; throw e; }
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read this photo.'))), 'image/jpeg', 0.85));
}

// A photo, full screen. Tap anywhere or press Escape to close.
function lightbox(img) {
  if (!img.src) return;
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Photo');
  box.innerHTML = `<img src="${esc(img.src)}" alt="${esc(img.alt || 'Photo')}" /><button type="button" class="lightbox-close" aria-label="Close">×</button>`;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(box);
  box.querySelector('button').focus();
}

// ---------- From a video: "Add to a page…" on a note ----------
// Adds the note as a checklist item with a chip back to that moment, at the end of a page the team picks
// (or a new one), as Slack's "Save to a canvas". Saved onto the page's latest version, so nobody's edit is lost.
export async function addToPage(projectId, { ref, text, body, anchor = null }) {
  const { data: pages, error } = await sb.from('project_pages').select('id, title').eq('project_id', projectId).order('updated_at', { ascending: false }).limit(8);
  if (error) return toast(friendlyError(error), 'error');
  const choice = await actionSheet({ title: 'Add to a page', anchor, actions: [
    ...(pages || []).map((pg) => ({ value: pg.id, icon: 'file', label: pg.title || 'Untitled' })),
    { value: '+new', icon: 'plus', label: 'New page', hint: 'Starts a “To work on” list' }
  ] });
  if (!choice) return;
  const clean = (body || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  // A plain list item, not a checklist one: whether it's fixed lives on the note (one place to mark it).
  const line = `- [${text.replace(/[[\]*`]/g, '')}](dancerly:${ref})${clean ? ` ${clean}` : ''}`;
  let pageId = choice;
  let title = '';
  if (choice === '+new') {
    const { data, error: e } = await sb.from('project_pages').insert({ project_id: projectId, title: 'To work on', body: line }).select('id, title').single();
    if (e) return toast(friendlyError(e), 'error');
    pageId = data.id;
    title = data.title;
  } else {
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      const { data: pg } = await sb.from('project_pages').select('title, body, updated_at').eq('id', pageId).maybeSingle();
      if (!pg) return toast('That page was deleted.', 'error');
      title = pg.title;
      const next = `${(pg.body || '').replace(/\s+$/, '')}${pg.body?.trim() ? '\n' : ''}${line}`;
      const { data, error: e } = await sb.from('project_pages').update({ body: next }).eq('id', pageId).eq('updated_at', pg.updated_at).select('id');
      if (e) return toast(friendlyError(e), 'error');
      done = Boolean(data?.length);
    }
    if (!done) return toast('That page is being edited right now. Try again in a moment.', 'error');
  }
  toast(`Added to “${title || 'Untitled'}”.`, 'info', { label: 'Open', run: () => ctx.navigate(`/app/p/${projectId}/pages/${pageId}`) });
}
