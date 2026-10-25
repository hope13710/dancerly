// Project › Pages: plain-Markdown docs anyone on the project can write — plans, spacing, costume lists.
import { sb, $, $$, esc, timeAgo, toast, friendlyError, dialog } from '../client.js';
import { ctx } from '../ctx.js';
import { loadProject, projectHead } from './project.js';
import { empty, namesFor } from './shared.js';

// A small, safe Markdown subset: everything is escaped first, then a few patterns become tags.
export function markdown(src) {
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(src || '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { close(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)$/i))) { if (list !== 'ul') { close(); out.push('<ul class="tasks">'); list = 'ul'; } out.push(`<li class="${m[1].trim() ? 'done' : ''}"><span class="box">${m[1].trim() ? '✓' : ''}</span>${inline(m[2])}</li>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (/^\s*---+\s*$/.test(line)) { close(); out.push('<hr />'); }
    else if ((m = line.match(/^>\s?(.*)$/))) { close(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if (!line.trim()) { close(); }
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join('');
}

export async function renderProjectPages(projectId) {
  const { view, setCrumbs } = ctx;
  const [p, { data: pages, error }] = await Promise.all([
    loadProject(projectId),
    sb.from('project_pages').select('id, title, body, pinned, updated_at, updated_by').eq('project_id', projectId).order('pinned', { ascending: false }).order('updated_at', { ascending: false })
  ]);
  if (error) throw error;
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Pages']]);
  const names = await namesFor(pages.map((x) => x.updated_by));
  view.innerHTML = `<section class="page">
    ${projectHead(p, 'pages', '<button class="btn primary" data-new-page>+ New page</button>')}
    ${pages.length ? `<div class="list">${pages.map((pg) => `<a class="row" href="/app/p/${projectId}/pages/${pg.id}" data-link>
        <span class="page-icon">${pg.pinned ? '📌' : '📄'}</span>
        <span class="row-main"><span class="row-title">${esc(pg.title)}</span><span class="row-meta">${esc(pg.body.replace(/[#*>`\-[\]]/g, '').trim().slice(0, 110)) || 'Empty page'}</span></span>
        <span class="row-side"><small>${esc(names[pg.updated_by] || '')} · ${timeAgo(pg.updated_at)}</small><span class="chev">›</span></span></a>`).join('')}</div>`
      : empty('📄', 'No pages yet', 'Keep the plan in one place: rehearsal schedule, spacing, costumes, music cues. Everyone on the project can read and edit.', '<button class="btn primary" data-new-page>+ New page</button>')}
  </section>`;
  $$('[data-new-page]').forEach((b) => b.addEventListener('click', () => newPage(projectId)));
}

async function newPage(projectId) {
  const values = await dialog({ title: 'New page', fields: [{ name: 'title', label: 'Title', placeholder: 'Rehearsal plan', required: true }], confirm: 'Create' });
  if (!values?.title) return;
  const { data, error } = await sb.from('project_pages').insert({ project_id: projectId, title: values.title, body: '' }).select('id').single();
  if (error) return toast(friendlyError(error), 'error');
  ctx.navigate(`/app/p/${projectId}/pages/${data.id}?edit=1`);
}

export async function renderPage(projectId, pageId) {
  const { view, setCrumbs, navigate } = ctx;
  const [p, { data: page, error }] = await Promise.all([
    loadProject(projectId),
    sb.from('project_pages').select('id, title, body, pinned, created_by, updated_by, updated_at').eq('id', pageId).eq('project_id', projectId).maybeSingle()
  ]);
  if (error) throw error;
  if (!page) throw new Error('This page was deleted.');
  setCrumbs([['Projects', '/app/projects'], [p.project.title, `/app/p/${projectId}`], ['Pages', `/app/p/${projectId}/pages`], [page.title]]);
  const names = await namesFor([page.updated_by]);
  const editing = new URLSearchParams(location.search).get('edit') === '1';
  const canDelete = page.created_by === p.me || p.isOwner;
  view.innerHTML = `<section class="page narrow-wide doc-page">
    <header class="doc-head">
      <p class="muted doc-meta" data-meta>Edited by ${esc(names[page.updated_by] || 'someone')} · ${timeAgo(page.updated_at)}</p>
      <div class="head-actions">
        <button class="btn small ghost ${page.pinned ? 'on' : ''}" data-pin>📌 ${page.pinned ? 'Pinned' : 'Pin'}</button>
        ${editing ? '<span class="save-state" data-save>Saved</span><a class="btn small primary" href="?" data-link data-done>Done</a>' : `<a class="btn small" href="?edit=1" data-link>Edit</a>`}
        ${canDelete ? '<button class="btn small ghost danger" data-delete>Delete</button>' : ''}
      </div>
    </header>
    ${editing ? `<input class="doc-title-input" data-title maxlength="120" value="${esc(page.title)}" aria-label="Title" />
      <div class="doc-editor">
        <textarea data-body placeholder="Write in plain text. # Heading, - list, - [ ] checklist, **bold**, [link](https://…)" aria-label="Page">${esc(page.body)}</textarea>
        <article class="doc" data-preview aria-label="Preview">${markdown(page.body) || '<p class="muted">Preview shows here.</p>'}</article>
      </div>`
      : `<h1 class="doc-title">${esc(page.title)}</h1><article class="doc">${markdown(page.body) || `<p class="muted">This page is empty. <a class="link" href="?edit=1" data-link>Start writing →</a></p>`}</article>`}
  </section>`;

  $('[data-pin]').addEventListener('click', async () => {
    const { error: e } = await sb.from('project_pages').update({ pinned: !page.pinned }).eq('id', page.id);
    if (e) return toast(friendlyError(e), 'error');
    renderPage(projectId, pageId);
  });
  $('[data-delete]')?.addEventListener('click', async () => {
    const ok = await dialog({ title: `Delete “${page.title}”?`, body: 'This can’t be undone.', confirm: 'Delete', danger: true });
    if (!ok) return;
    const { error: e } = await sb.from('project_pages').delete().eq('id', page.id);
    if (e) return toast(friendlyError(e), 'error');
    navigate(`/app/p/${projectId}/pages`, { replace: true });
  });
  if (!editing) return null;

  // Autosave while typing; the preview follows along.
  const titleEl = $('[data-title]');
  const bodyEl = $('[data-body]');
  const state = $('[data-save]');
  let timer = null;
  let pending = false;
  const save = async () => {
    pending = false;
    const title = titleEl.value.trim() || 'Untitled';
    state.textContent = 'Saving…';
    const { error: e } = await sb.from('project_pages').update({ title, body: bodyEl.value }).eq('id', page.id);
    state.textContent = e ? 'Couldn’t save — retrying when you type' : 'Saved';
    state.classList.toggle('error', Boolean(e));
  };
  const queue = () => { pending = true; state.textContent = 'Editing…'; clearTimeout(timer); timer = setTimeout(save, 700); };
  bodyEl.addEventListener('input', () => { $('[data-preview]').innerHTML = markdown(bodyEl.value) || '<p class="muted">Preview shows here.</p>'; queue(); });
  titleEl.addEventListener('input', queue);
  bodyEl.focus();
  const beforeUnload = (e) => { if (pending) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return () => {
    window.removeEventListener('beforeunload', beforeUnload);
    if (pending) { clearTimeout(timer); save(); }
  };
}
