// ⌘K / Ctrl+K: jump to any project, person, video, request, or note — or run a command.
import { sb, esc, initials, fmt, isSamplePerson, isEnter } from '../client.js';
import { ctx } from '../ctx.js';
import { noSample } from './shared.js';

let open = false;

export function openSearch() {
  if (open || !ctx.state.profile) return;
  open = true;
  const el = document.createElement('dialog');
  el.className = 'dialog palette';
  el.innerHTML = `<div class="palette-card" role="combobox" aria-expanded="true" aria-haspopup="listbox">
    <div class="palette-input"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
      <input data-q placeholder="Search notes, videos, people, assignments… or type a command" autocomplete="off" aria-label="Search" aria-controls="palette-list" /><kbd>esc</kbd></div>
    <div class="palette-list" id="palette-list" role="listbox" data-list></div>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span></div>
  </div>`;
  document.body.append(el);
  el.showModal();
  const input = el.querySelector('[data-q]');
  const list = el.querySelector('[data-list]');
  let results = [];
  let active = 0;
  let seq = 0;
  let timer = null;
  let ready = Promise.resolve();
  let searched = '';

  const close = () => { if (el.open) el.close(); };
  el.addEventListener('close', () => { el.remove(); open = false; });
  el.addEventListener('click', (e) => { if (e.target === el) close(); });

  const commands = () => (ctx.commands || []).map((c) => ({ group: 'Commands', icon: '›', label: c.label, hint: c.hint || '', run: c.run }));

  function paint() {
    if (!results.length) {
      list.innerHTML = `<p class="palette-empty">${input.value.trim().length < 2 ? 'Type at least 2 letters to search.' : 'Nothing found. Try another word.'}</p>`;
      return;
    }
    let group = '';
    list.innerHTML = results.map((r, i) => {
      const head = r.group !== group ? `<p class="palette-group">${esc((group = r.group))}</p>` : '';
      return `${head}<button class="palette-item ${i === active ? 'active' : ''}" role="option" aria-selected="${i === active}" data-i="${i}">
        <span class="palette-icon">${r.icon}</span><span class="palette-text"><b>${esc(r.label)}</b>${r.hint ? `<small>${esc(r.hint)}</small>` : ''}</span></button>`;
    }).join('');
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(r) {
    close();
    if (r.run) r.run(); else ctx.navigate(r.href);
  }

  async function search(q) {
    searched = q;
    const mine = ++seq;
    const term = q.trim();
    const lower = term.toLowerCase();
    const cmds = commands().filter((c) => !lower || c.label.toLowerCase().includes(lower));
    // Real projects first; the sample is still reachable by name, marked as such.
    const projects = [...ctx.state.projects].sort((a, b) => Number(Boolean(a.is_sample)) - Number(Boolean(b.is_sample)))
      .filter((p) => !lower || p.title.toLowerCase().includes(lower)).slice(0, 5)
      .map((p) => ({ group: 'Projects', icon: esc(initials(p.title)), label: p.title, hint: p.is_sample ? 'Sample' : '', href: `/app/p/${p.id}` }));
    if (term.length < 2) {
      results = [...cmds.slice(0, 8), ...projects];
      active = 0;
      return paint();
    }
    const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const [videos, requests, notes, people] = await Promise.all([
      noSample(sb.from('videos').select('id, title, project_id, projects(title)')).ilike('title', like).limit(6),
      noSample(sb.from('requests').select('id, title, project_id, projects(title)')).ilike('title', like).limit(5),
      noSample(sb.from('notes').select('id, body, t_start, project_id, video_id, takes(number), videos(title)')).ilike('body', like).order('created_at', { ascending: false }).limit(8),
      sb.from('profiles').select('id, display_name').ilike('display_name', like).limit(5)
    ]);
    if (mine !== seq) return; // a newer keystroke won
    results = [
      ...projects,
      ...(people.data || []).filter((p) => !isSamplePerson(p.id)).map((p) => ({ group: 'People', icon: esc(initials(p.display_name)), label: p.display_name, href: `/app/people/${p.id}` })),
      ...(videos.data || []).map((v) => ({ group: 'Videos', icon: '▶', label: v.title, hint: v.projects?.title, href: `/app/p/${v.project_id}/v/${v.id}` })),
      ...(requests.data || []).map((r) => ({ group: 'Assignments', icon: '⇪', label: r.title, hint: r.projects?.title, href: `/app/p/${r.project_id}/requests/${r.id}` })),
      ...(notes.data || []).map((n) => ({ group: 'Notes', icon: '◫', label: n.body.length > 90 ? `${n.body.slice(0, 90)}…` : n.body, hint: `${n.videos?.title || ''} · ${fmt(Number(n.t_start))}`, href: `/app/p/${n.project_id}/v/${n.video_id}?take=${n.takes?.number ?? ''}&note=${n.id}` })),
      ...cmds.slice(0, 4)
    ];
    active = 0;
    paint();
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { ready = search(input.value); }, 160); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (isEnter(e)) {
      // Typed and pressed Enter at once: search what's in the box first, so the pick matches it.
      e.preventDefault();
      if (input.value !== searched) { clearTimeout(timer); ready = search(input.value); }
      ready.then(() => { if (el.open && results[active]) choose(results[active]); });
    }
  });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) choose(results[Number(b.dataset.i)]); });
  search('');
  input.focus();
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
});
