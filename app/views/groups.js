// Groups inside a project — "Juniors", "Front line" — so requests can go to a group at once.
import { sb, $$, esc, initials, toast, friendlyError, dialog, avatar } from '../client.js';

export async function loadGroups(projectId) {
  const { data, error } = await sb.from('project_groups').select('id, name, created_by, project_group_members(user_id)').eq('project_id', projectId).order('name');
  if (error) throw error;
  return data;
}

export function groupsSection(p, groups) {
  const nameOf = (id) => p.members.find((m) => m.user_id === id)?.name || 'Former member';
  const canManage = (g) => g.created_by === p.me || p.isOwner;
  return `<section class="panel groups-panel">
    <div class="panel-head"><div><h2>Groups</h2><p class="muted">Send a request to a whole group at once.</p></div><button class="btn small" data-new-group>+ New group</button></div>
    ${groups.length ? `<div class="list flush">${groups.map((g) => `<div class="row">
      <span class="row-main"><span class="row-title">${esc(g.name)} <small class="muted">${g.project_group_members.length}</small></span>
        <span class="chips">${g.project_group_members.map((m) => `<span class="chip">${avatar(nameOf(m.user_id), m.user_id, 'xs')} ${esc(nameOf(m.user_id))}</span>`).join('') || '<span class="muted">Nobody yet</span>'}</span></span>
      ${canManage(g) ? `<span class="row-side"><button class="btn ghost small" data-edit-group="${g.id}">Edit</button></span>` : ''}
    </div>`).join('')}</div>` : '<p class="panel-empty">No groups yet. Make one for each part of the team — “Juniors”, “Front line”, “Soloists”.</p>'}
  </section>`;
}

export function wireGroups(projectId, p, groups, refresh) {
  $$('[data-new-group]').forEach((b) => b.addEventListener('click', () => editGroup(projectId, p, null, refresh)));
  $$('[data-edit-group]').forEach((b) => b.addEventListener('click', () => editGroup(projectId, p, groups.find((g) => g.id === b.dataset.editGroup), refresh)));
}

async function editGroup(projectId, p, group, refresh) {
  const current = new Set((group?.project_group_members || []).map((m) => m.user_id));
  const el = document.createElement('dialog');
  el.className = 'dialog';
  el.innerHTML = `<form method="dialog" class="dialog-card">
    <h2>${group ? 'Edit group' : 'New group'}</h2>
    <label class="field"><span>Name</span><input name="name" maxlength="60" required value="${esc(group?.name || '')}" placeholder="Juniors" /></label>
    <div class="field"><span>People</span></div>
    <div class="pick-people">${p.members.map((m) => `<label><input type="checkbox" name="person" value="${m.user_id}" ${current.has(m.user_id) ? 'checked' : ''} />${avatar(m.name, m.user_id, 'xs')}${esc(m.name)}</label>`).join('')}</div>
    <div class="dialog-actions">${group ? '<button value="delete" formnovalidate class="btn ghost danger push-left">Delete group</button>' : ''}<button value="cancel" formnovalidate class="btn ghost">Cancel</button><button value="ok" class="btn primary">${group ? 'Save' : 'Create group'}</button></div>
  </form>`;
  document.body.append(el);
  el.showModal();
  const form = el.querySelector('form');
  const result = await new Promise((resolve) => el.addEventListener('close', () => {
    resolve({ action: el.returnValue, name: form.elements.namedItem('name').value.trim(), people: $$('[name=person]:checked', form).map((x) => x.value) });
    el.remove();
  }));
  if (result.action === 'delete') {
    const sure = await dialog({ title: `Delete “${group.name}”?`, body: 'Requests already sent to it are not affected.', confirm: 'Delete', danger: true });
    if (!sure) return;
    const { error } = await sb.from('project_groups').delete().eq('id', group.id);
    if (error) return toast(friendlyError(error), 'error');
    return refresh();
  }
  if (result.action !== 'ok' || !result.name) return;
  let groupId = group?.id;
  if (group) {
    if (result.name !== group.name) {
      const { error } = await sb.from('project_groups').update({ name: result.name }).eq('id', group.id);
      if (error) return toast(friendlyError(error), 'error');
    }
  } else {
    const { data, error } = await sb.from('project_groups').insert({ project_id: projectId, name: result.name }).select('id').single();
    if (error) return toast(/duplicate|unique/i.test(error.message) ? 'There’s already a group with that name.' : friendlyError(error), 'error');
    groupId = data.id;
  }
  const next = new Set(result.people);
  const add = [...next].filter((u) => !current.has(u));
  const remove = [...current].filter((u) => !next.has(u));
  if (add.length) {
    const { error } = await sb.from('project_group_members').insert(add.map((user_id) => ({ group_id: groupId, user_id })));
    if (error) return toast(friendlyError(error), 'error');
  }
  if (remove.length) {
    const { error } = await sb.from('project_group_members').delete().eq('group_id', groupId).in('user_id', remove);
    if (error) return toast(friendlyError(error), 'error');
  }
  toast(group ? 'Group saved.' : 'Group created.');
  refresh();
}
