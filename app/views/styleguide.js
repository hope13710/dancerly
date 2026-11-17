// /app/_ui — the design system on one page, for whoever builds the next screen: every token (read live from
// app/tokens.css) and every component in each of its states. Not linked anywhere; not for customers.
import { esc, toast, dialog, actionSheet } from '../client.js';
import { ctx } from '../ctx.js';
import { ic } from '../icons.js';
import { catChip, CATEGORIES } from '../categories.js';

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const all = () => {
  // Every custom property declared on :root by tokens.css, in order.
  const names = [];
  for (const sheet of document.styleSheets) {
    if (!String(sheet.href || '').endsWith('/app/tokens.css')) continue;
    for (const rule of sheet.cssRules) if (rule.selectorText === ':root') for (const p of rule.style) if (p.startsWith('--')) names.push(p);
  }
  return names;
};
const section = (title, why, body) => `<section class="panel sg-section"><h2>${esc(title)}</h2>${why ? `<p class="muted sg-why">${esc(why)}</p>` : ''}${body}</section>`;
const swatch = (name) => `<div class="sg-swatch"><span class="sg-chip" style="background: var(${name})"></span><code>${esc(name)}</code><small>${esc(token(name))}</small></div>`;

export async function renderStyleguide() {
  const { view, setCrumbs } = ctx;
  setCrumbs([['Design system']]);
  const names = all();
  const group = (prefix) => names.filter((n) => n.startsWith(prefix));
  const semantic = names.filter((n) => n.startsWith('--color-') && !/-(neutral|slate|violet|green|amber|orange|red|blue)-\d+$/.test(n) && !n.startsWith('--color-cat-') && n !== '--color-black');
  const primitives = names.filter((n) => /^--color-(neutral|slate|violet|green|amber|orange|red|blue)-\d+$/.test(n));

  view.innerHTML = `<section class="page sg">
    <header class="page-head"><div><h1>Design system</h1><p class="muted">Tokens live in <code>app/tokens.css</code>. Screens use the semantic ones; build.js stops new raw values in <code>app/app.css</code>.</p></div></header>

    ${section('Five kinds of small things', 'Each has one look, so none passes for another.', `<div class="sg-row sg-kinds">
      <div><p class="sg-label">Action</p><button class="btn primary small">Save</button></div>
      <div><p class="sg-label">Choice</p><button type="button" class="chip" aria-pressed="true">On</button> <button type="button" class="chip" aria-pressed="false">Off</button></div>
      <div><p class="sg-label">Status</p><span class="pill ok">Fixed</span> <span class="pill warn">Open</span></div>
      <div><p class="sg-label">Reference</p><span class="goal-chip">${ic('flag')}Spring Showcase</span></div>
      <div><p class="sg-label">Category</p>${catChip('timing')}</div>
    </div>`)}

    ${section('Buttons', 'Primary: one per screen. Secondary is the plain button. Ghost for quiet actions, danger to delete.', `
      <div class="sg-row"><button class="btn primary">Primary</button><button class="btn">Secondary</button><button class="btn ghost">Ghost</button><button class="btn danger">Delete</button><button class="btn" disabled>Disabled</button></div>
      <div class="sg-row"><button class="btn primary small">Small primary</button><button class="btn small">Small</button><button class="btn ghost small">Small ghost</button><button class="icon-btn" aria-label="More">${ic('more', 'solo')}</button><button type="button" class="text-btn">Text link</button></div>`)}

    ${section('Chips (choice)', 'Things you turn on and off: filters, pickers, answers. Fully round; on is the violet tint.', `
      <div class="sg-row">${['Dance crew', 'School or club', 'On my own'].map((t, i) => `<button type="button" class="chip" aria-pressed="${i === 0}">${t}</button>`).join('')}<button type="button" class="chip-btn on">Missed notes</button><button type="button" class="chip-btn">Too long</button></div>`)}

    ${section('Badges (status) and counts', 'Read-only: small rounded rectangles, never pressable. Counts are round.', `
      <div class="sg-row"><span class="pill">Draft</span><span class="pill info">Show</span><span class="pill ok">Fixed</span><span class="pill warn">Due tomorrow</span><span class="pill danger">Overdue</span><span class="tag">You</span><span class="badge">4</span></div>`)}

    ${section('Categories (focus areas)', 'Their own hues, apart from the brand violet and the status colors.', `<div class="sg-row">${CATEGORIES.map(([k]) => catChip(k)).join('')}</div>`)}

    ${section('Fields', 'One height, border and focus ring. 16px text, so phones don’t zoom in.', `
      <div class="sg-fields"><label class="field"><span>Project name</span><input value="Spring Showcase" /></label><label class="field"><span>Notes</span><textarea rows="2" placeholder="What should change at this moment?"></textarea></label></div>`)}

    ${section('Banners, toasts, menus, dialogs', '', `
      <div class="banner ok">Saved. Everyone on the project sees it.</div>
      <div class="banner warn">Jin changed this page while you were editing.</div>
      <div class="sg-row"><button class="btn" data-sg-toast>Show a toast</button><button class="btn" data-sg-error>Show an error toast</button><button class="btn" data-sg-menu>Open a menu</button><button class="btn" data-sg-dialog>Open a dialog</button></div>`)}

    ${section('Type', '11 caption · 12 meta · 13 small · 14 body · 16 lead and phone reading · 20 / 24 / 32 titles.', `
      <div class="sg-type">${group('--font-size-').map((n) => `<p style="font-size: var(${n})"><code>${esc(n)}</code> Feedback that lands on the count</p>`).join('')}</div>`)}

    ${section('Radius, elevation, control sizes', '', `
      <div class="sg-row sg-shapes">${group('--radius-').map((n) => `<div class="sg-shape" style="border-radius: var(${n})"><code>${esc(n)}</code></div>`).join('')}</div>
      <div class="sg-row sg-shapes">${group('--shadow-').map((n) => `<div class="sg-shape" style="box-shadow: var(${n})"><code>${esc(n)}</code></div>`).join('')}</div>
      <div class="sg-row">${group('--control-').map((n) => `<div class="sg-control" style="height: var(${n})"><code>${esc(n)} · ${esc(token(n))}</code></div>`).join('')}</div>`)}

    ${section('Colors: roles', 'What screens use. Change a role here, not in a screen.', `<div class="sg-swatches">${semantic.map(swatch).join('')}</div>`)}
    ${section('Colors: palette', 'Raw shades the roles point at.', `<div class="sg-swatches">${primitives.map(swatch).join('')}</div>`)}
  </section>`;

  view.querySelector('[data-sg-toast]').addEventListener('click', () => toast('Note added at 00:12. Jordan will see it in their feedback.'));
  view.querySelector('[data-sg-error]').addEventListener('click', () => toast('Couldn’t save. Check your connection and try again.', 'error'));
  view.querySelector('[data-sg-menu]').addEventListener('click', (e) => actionSheet({ title: 'Chorus run', anchor: e.currentTarget, actions: [{ value: 'a', icon: 'pen', label: 'Rename' }, { value: 'b', icon: 'link', label: 'Copy link' }, { value: 'c', icon: 'trash', label: 'Delete', danger: true }] }));
  view.querySelector('[data-sg-dialog]').addEventListener('click', () => dialog({ title: 'Delete this note?', body: 'It disappears for everyone on the project.', confirm: 'Delete', danger: true }));
}
