// Trash: deleted videos and takes, kept for 30 days (migration 032). Restore puts them back exactly as they were,
// notes and all; Delete forever removes them and their files now. Everyone in a project sees its trash; only the
// project owner or whoever made the item can act on it.
import { sb, $$, esc, toast, friendlyError, dialog, schema, TAKE_BUCKET, isPublicMedia } from '../client.js';
import { ctx } from '../ctx.js';
import { track } from '../onboarding.js';
import { pageHead, empty, namesFor } from './shared.js';
import { restoreFromTrash } from './project.js';

const KEEP_DAYS = 30;
const daysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso).getTime() + KEEP_DAYS * 864e5 - Date.now()) / 864e5));

export async function renderTrash() {
  const { view, setCrumbs } = ctx;
  setCrumbs([['Trash']]);
  const head = pageHead('Trash', { sub: `Deleted videos and takes stay here for ${KEEP_DAYS} days, then they’re gone for good.` });
  if (!schema.trash) {
    view.innerHTML = `<section class="page narrow">${head}${empty('🗑', 'Trash isn’t set up yet', 'Deleted videos are removed right away for now.')}</section>`;
    return;
  }
  const { data: items, error } = await sb.rpc('trash_list');
  if (error) throw error;
  const names = await namesFor((items || []).map((i) => i.deleted_by).filter(Boolean));
  view.innerHTML = `<section class="page narrow">
    ${head}
    ${items?.length ? `<section class="panel"><div class="list flush">${items.map((it, i) => {
      const left = daysLeft(it.deleted_at);
      return `<div class="row trash-row">
        <span class="trash-icon" aria-hidden="true">${it.kind === 'video' ? '▶' : '◧'}</span>
        <span class="row-main"><span class="row-title">${it.kind === 'take' ? `Take ${it.take_number} · ` : ''}${esc(it.title)}</span>
          <span class="row-meta">${esc(it.project_title)}${it.kind === 'video' && it.takes > 1 ? ` · ${it.takes} takes` : ''} · deleted by ${esc(names[it.deleted_by] || 'someone')}</span>
          <span class="trash-left ${left <= 3 ? 'soon' : ''}">${left <= 1 ? 'Goes for good tomorrow' : `Goes for good in ${left} days`}</span></span>
        ${it.can_manage
          ? `<span class="row-side trash-actions"><button class="btn small" data-restore="${i}">Restore</button><button class="btn small ghost danger" data-purge="${i}">Delete forever</button></span>`
          : '<span class="row-side muted small">The owner or who made it can restore it</span>'}
      </div>`;
    }).join('')}</div></section>` : empty('🗑', 'Trash is empty', `When you delete a video or a take, it waits here for ${KEEP_DAYS} days in case you change your mind.`)}
  </section>`;
  $$('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
    const it = items[Number(b.dataset.restore)];
    b.disabled = true;
    const videoId = await restoreFromTrash(it.kind, it.id);
    if (!videoId) { b.disabled = false; return; }
    renderTrash();
  }));
  $$('[data-purge]').forEach((b) => b.addEventListener('click', async () => {
    const it = items[Number(b.dataset.purge)];
    const sure = await dialog({
      title: it.kind === 'video' ? `Delete “${it.title}” forever?` : `Delete Take ${it.take_number} forever?`,
      body: `${it.kind === 'video' ? 'The video, its takes, and their notes' : 'The take and its notes'} are deleted for everyone. This can’t be undone.`,
      confirm: 'Delete forever',
      danger: true
    });
    if (!sure) return;
    const { data: paths, error: purgeErr } = await sb.rpc('purge_item', { p_kind: it.kind, p_id: it.id });
    if (purgeErr) return toast(friendlyError(purgeErr), 'error');
    // Files you uploaded go now; the hourly cleanup removes the rest.
    const files = (paths || []).map((p) => (typeof p === 'string' ? p : Object.values(p)[0])).filter((p) => p && !isPublicMedia(p));
    if (files.length) sb.storage.from(TAKE_BUCKET).remove(files).then(() => {}, () => {});
    track('trash_purged', { kind: it.kind });
    toast('Deleted for good.');
    renderTrash();
  }));
}
