// Insights: is feedback turning into fixes? Counts, a weekly trend, and breakdowns by video and person.
import { sb, $, $$, esc, initials, timeAgo } from '../client.js';
import { ctx } from '../ctx.js';
import { pageHead, empty, namesFor } from './shared.js';

const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']];
const DAY = 86400000;

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const duration = (ms) => (ms === null ? '—' : ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))}m` : ms < DAY ? `${Math.round(ms / 3600000)}h` : `${(ms / DAY).toFixed(ms < 10 * DAY ? 1 : 0)}d`);

export async function renderInsights() {
  const { state, view, setCrumbs, navigate } = ctx;
  setCrumbs([['Insights']]);
  await state.projectsReady;
  const params = new URLSearchParams(location.search);
  const days = RANGES.some(([d]) => d === params.get('range')) ? Number(params.get('range')) : 30;
  const project = params.get('project') || '';
  const url = (changes) => {
    const next = new URLSearchParams({ range: String(days), ...(project ? { project } : {}), ...changes });
    if (!next.get('project')) next.delete('project');
    return `/app/insights?${next}`;
  };

  let notesQ = sb.from('notes').select('id, project_id, video_id, author_id, status, created_at, resolved_at, videos(title), takes(uploaded_by)').order('created_at', { ascending: false }).limit(5000);
  let takesQ = sb.from('takes').select('id, project_id, video_id, uploaded_by, created_at').limit(5000);
  if (project) { notesQ = notesQ.eq('project_id', project); takesQ = takesQ.eq('project_id', project); }
  const [{ data: notes, error }, { data: takes, error: tErr }] = await Promise.all([notesQ, takesQ]);
  if (error || tErr) throw error || tErr;

  const since = Date.now() - days * DAY;
  const inRange = (iso) => iso && new Date(iso).getTime() >= since;
  const left = notes.filter((n) => inRange(n.created_at));
  const fixed = notes.filter((n) => n.status === 'resolved' && inRange(n.resolved_at));
  const openNow = notes.filter((n) => n.status !== 'resolved');
  const fixTimes = fixed.map((n) => new Date(n.resolved_at) - new Date(n.created_at)).filter((ms) => ms >= 0);
  const takesInRange = takes.filter((t) => inRange(t.created_at));
  const fixRate = left.length ? Math.round((left.filter((n) => n.status === 'resolved').length / left.length) * 100) : null;

  // Buckets: days for a week, weeks otherwise.
  const bucketMs = days <= 7 ? DAY : 7 * DAY;
  const count = Math.ceil((days * DAY) / bucketMs);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const firstStart = start.getTime() + DAY - count * bucketMs;
  const buckets = Array.from({ length: count }, (_, i) => ({ from: firstStart + i * bucketMs, left: 0, fixed: 0 }));
  const bucketOf = (iso) => Math.floor((new Date(iso).getTime() - firstStart) / bucketMs);
  for (const n of notes) {
    const a = bucketOf(n.created_at); if (buckets[a]) buckets[a].left += 1;
    if (n.status === 'resolved' && n.resolved_at) { const b = bucketOf(n.resolved_at); if (buckets[b]) buckets[b].fixed += 1; }
  }
  const label = (b) => new Date(b.from).toLocaleDateString(undefined, bucketMs === DAY ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
  const peak = Math.max(1, ...buckets.flatMap((b) => [b.left, b.fixed]));
  const step = peak <= 4 ? 1 : Math.ceil(peak / 4);
  const top = step * Math.ceil(peak / step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  // Breakdowns over everything in scope (not just the range), so the tables answer "where are we now".
  const videos = {};
  for (const n of notes) {
    const v = (videos[n.video_id] ||= { id: n.video_id, project_id: n.project_id, title: n.videos?.title || 'Video', open: 0, practicing: 0, resolved: 0, last: n.created_at });
    v[n.status] += 1;
    if (n.created_at > v.last) v.last = n.created_at;
  }
  const videoRows = Object.values(videos).sort((a, b) => (b.open + b.practicing) - (a.open + a.practicing) || b.last.localeCompare(a.last)).slice(0, 12);
  const people = {};
  const person = (id) => (people[id] ||= { id, given: 0, received: 0, receivedFixed: 0, takes: 0 });
  for (const n of left) {
    person(n.author_id).given += 1;
    const owner = n.takes?.uploaded_by;
    if (owner && owner !== n.author_id) { person(owner).received += 1; if (n.status === 'resolved') person(owner).receivedFixed += 1; }
  }
  for (const t of takesInRange) person(t.uploaded_by).takes += 1;
  const names = await namesFor(Object.keys(people));
  const peopleRows = Object.values(people).sort((a, b) => b.given + b.takes - (a.given + a.takes));

  const hasData = notes.length || takes.length;
  view.innerHTML = `<section class="page">
    ${pageHead('Insights', { sub: 'Is feedback turning into fixes?' })}
    <div class="filters">
      <div class="seg small" role="group" aria-label="Date range">${RANGES.map(([d, l]) => `<a href="${url({ range: d })}" data-link aria-selected="${Number(d) === days}">Last ${l}</a>`).join('')}</div>
      ${state.projects.length > 1 ? `<label class="select-wrap"><span class="sr-only">Project</span><select data-project><option value="">All projects</option>${state.projects.map((p) => `<option value="${p.id}" ${p.id === project ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>` : ''}
    </div>
    ${!hasData ? empty('↗', 'Nothing to measure yet', 'Upload a rehearsal and leave a few notes. This page shows how fast your team turns notes into fixes.') : `
    <div class="stats">
      <div class="stat"><small>Notes left</small><b>${left.length}</b></div>
      <div class="stat"><small>Notes fixed</small><b>${fixed.length}</b></div>
      <div class="stat"><small>Fix rate</small><b>${fixRate === null ? '—' : `${fixRate}%`}</b><span>of notes left in this range</span></div>
      <div class="stat"><small>Median time to fix</small><b>${duration(median(fixTimes))}</b></div>
      <div class="stat"><small>Takes uploaded</small><b>${takesInRange.length}</b></div>
      <div class="stat"><small>Still open</small><b>${openNow.length}</b><span>right now</span></div>
    </div>

    <section class="panel">
      <div class="panel-head"><div><h2>Notes left and fixed</h2><p class="muted">${bucketMs === DAY ? 'Per day' : 'Per week'}</p></div>
        <div class="legend"><span><i class="key left"></i>Left</span><span><i class="key fixed"></i>Fixed</span></div></div>
      <div class="bars" style="--cols:${count}" data-chart>
        <div class="bars-grid">${ticks.map((t) => `<div style="bottom:${(t / top) * 100}%"><span>${t}</span></div>`).join('')}</div>
        <div class="bars-plot">${buckets.map((b, i) => `<div class="bars-col" tabindex="0" data-i="${i}" aria-label="${label(b)}: ${b.left} left, ${b.fixed} fixed">
          <div class="bars-pair"><i class="bar left" style="height:${(b.left / top) * 100}%"></i><i class="bar fixed" style="height:${(b.fixed / top) * 100}%"></i></div>
          <span class="bars-x">${label(b)}</span>
        </div>`).join('')}</div>
        <div class="chart-tip" data-tip hidden></div>
      </div>
      <details class="table-toggle"><summary>Show as table</summary>
        <table class="table compact"><thead><tr><th>${bucketMs === DAY ? 'Day' : 'Week of'}</th><th class="num">Left</th><th class="num">Fixed</th></tr></thead>
        <tbody>${buckets.map((b) => `<tr><td>${label(b)}</td><td class="num">${b.left}</td><td class="num">${b.fixed}</td></tr>`).join('')}</tbody></table>
      </details>
    </section>

    <div class="home-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>By video</h2><p class="muted">Where the open notes are</p></div></div>
        ${videoRows.length ? `<table class="table compact"><thead><tr><th>Video</th><th class="num">Open</th><th class="num">Practicing</th><th>Fixed</th></tr></thead><tbody>
          ${videoRows.map((v) => { const total = v.open + v.practicing + v.resolved; const pct = total ? Math.round((v.resolved / total) * 100) : 0; return `<tr data-href="/app/p/${v.project_id}/v/${v.id}"><td><a href="/app/p/${v.project_id}/v/${v.id}" data-link>${esc(v.title)}</a><small class="muted block">${timeAgo(v.last)}</small></td><td class="num">${v.open}</td><td class="num">${v.practicing}</td><td><span class="meter" title="${v.resolved} of ${total} fixed"><i style="width:${pct}%"></i></span><small>${pct}%</small></td></tr>`; }).join('')}
        </tbody></table>` : '<p class="panel-empty">No notes yet.</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>By person</h2><p class="muted">In the selected range</p></div></div>
        ${peopleRows.length ? `<table class="table compact"><thead><tr><th>Person</th><th class="num">Notes given</th><th class="num">Received</th><th class="num">Takes</th></tr></thead><tbody>
          ${peopleRows.map((p) => `<tr data-href="/app/people/${p.id}"><td><a class="person" href="/app/people/${p.id}" data-link><span class="avatar xs">${esc(initials(names[p.id]))}</span>${esc(names[p.id] || 'Former member')}</a></td><td class="num">${p.given}</td><td class="num">${p.received}${p.received ? `<small class="muted"> · ${Math.round((p.receivedFixed / p.received) * 100)}% fixed</small>` : ''}</td><td class="num">${p.takes}</td></tr>`).join('')}
        </tbody></table>` : '<p class="panel-empty">No activity in this range.</p>'}
      </section>
    </div>`}
  </section>`;

  $('[data-project]')?.addEventListener('change', (event) => navigate(url({ project: event.target.value })));
  view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) navigate(tr.dataset.href); }));
  const chart = $('[data-chart]');
  if (!chart) return;
  const tip = $('[data-tip]');
  const show = (col) => {
    const b = buckets[Number(col.dataset.i)];
    tip.replaceChildren();
    const head = document.createElement('small'); head.textContent = bucketMs === DAY ? label(b) : `Week of ${label(b)}`;
    tip.append(head);
    for (const [cls, name, value] of [['left', 'Left', b.left], ['fixed', 'Fixed', b.fixed]]) {
      const row = document.createElement('div'); row.className = 'tip-row';
      row.innerHTML = `<i class="key line ${cls}"></i><b></b><span></span>`;
      row.querySelector('b').textContent = value; row.querySelector('span').textContent = name;
      tip.append(row);
    }
    tip.hidden = false;
    const box = chart.getBoundingClientRect(); const c = col.getBoundingClientRect();
    const x = Math.min(Math.max(c.left - box.left + c.width / 2, 60), box.width - 60);
    tip.style.left = `${x}px`;
    $$('.bars-col', chart).forEach((el) => el.classList.toggle('hover', el === col));
  };
  const hide = () => { tip.hidden = true; $$('.bars-col', chart).forEach((el) => el.classList.remove('hover')); };
  $$('.bars-col', chart).forEach((col) => {
    col.addEventListener('pointerenter', () => show(col));
    col.addEventListener('focus', () => show(col));
    col.addEventListener('blur', hide);
  });
  chart.addEventListener('pointerleave', hide);
}
