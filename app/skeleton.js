// Loading placeholders shaped like the page that's coming (list rows, cards, the review screen…), instead of one
// "Loading…" line for everything. The router shows one only when a page takes longer than a moment (see main.js),
// so fast pages never flash. Six building blocks cover every page; a new page just picks one in skeletonFor().
const bar = (w, cls = '') => `<span class="sk ${cls}" style="width:${w}"></span>`;
// Varied widths so the rows look like text, not a barcode.
const WIDTHS = ['72%', '58%', '80%', '64%', '76%', '52%'];

function pageHead() {
  return `<header class="page-head sk-head"><div>${bar('220px', 'sk-title')}${bar('150px')}</div></header>`;
}

function projectHead() {
  return `<header class="page-head sk-head"><div class="sk-project">
      <span class="sk sk-mark"></span>
      <div>${bar('200px', 'sk-title')}<div class="sk-avatars">${'<span class="sk sk-avatar small"></span>'.repeat(4)}</div></div>
    </div></header>
    <div class="sk-tabs">${['64px', '56px', '92px', '60px'].map((w) => bar(w)).join('')}</div>`;
}

function rows(n, lead = 'none') {
  const start = { thumb: '<span class="sk sk-thumb"></span>', avatar: '<span class="sk sk-avatar"></span>', chip: '<span class="sk sk-chip"></span>', icon: '<span class="sk sk-icon"></span>', none: '' }[lead];
  return `<div class="list sk-list">${Array.from({ length: n }, (_, i) => `<div class="row sk-row">${start}<span class="sk-lines">${bar(WIDTHS[i % WIDTHS.length])}${bar('34%', 'sk-meta')}</span></div>`).join('')}</div>`;
}

function cards(n) {
  return `<div class="cards">${Array.from({ length: n }, () => `<div class="card sk-card"><span class="sk sk-cover"></span>${bar('70%')}${bar('40%', 'sk-meta')}</div>`).join('')}</div>`;
}

function panels() {
  return `<div class="panel sk-panel">${bar('120px', 'sk-meta')}${bar('60%', 'sk-title')}${bar('86%')}${bar('70%')}</div>
    <div class="panel sk-panel">${bar('140px', 'sk-meta')}${rows(3, 'icon').replace('list sk-list', 'list flush sk-list')}</div>`;
}

function stats() {
  return `<div class="sk-stats">${'<div class="panel sk-panel sk-stat"><span class="sk sk-num"></span><span class="sk sk-meta" style="width:60%"></span></div>'.repeat(3)}</div>
    <div class="panel sk-panel"><span class="sk sk-chart"></span></div>`;
}

function article() {
  const section = (w) => `<div class="sk-section">${bar('120px', 'sk-meta')}${bar(w)}${bar('66%')}</div>`;
  return `<section class="page narrow-wide"><div class="panel sk-panel sk-article">${bar('110px', 'sk-meta')}${bar('82%', 'sk-headline')}${bar('48%', 'sk-meta')}${section('78%')}${section('84%')}${section('70%')}</div></section>`;
}

function calendar() {
  return `<div class="sk-calendar">${'<span class="sk"></span>'.repeat(35)}</div>`;
}

// The review screen: the dark player and the notes column, as they'll sit.
function review() {
  const note = (i) => `<div class="sk-note"><span class="sk sk-avatar small dark"></span><span class="sk-lines">${bar('40%', 'dark sk-meta')}${bar(WIDTHS[i], 'dark')}${bar('46%', 'dark')}</span></div>`;
  return `<section class="review"><header class="review-head sk-head"><div>${bar('260px', 'sk-title')}${bar('190px')}</div></header>
    <div class="sk-review"><div class="sk-video"><span class="sk-play"></span></div><div class="sk-notes">${[0, 1, 2, 3].map(note).join('')}</div></div></section>`;
}

const page = (inner, cls = '') => `<section class="page ${cls}">${inner}</section>`;

// Which placeholder each page gets. Pages that open at once (forms, settings, sign-in) get none.
export function skeletonFor(path) {
  const p = path.replace(/\/+$/, '') || '/app';
  if (/^\/app\/p\/[^/]+\/v\/[^/]+$/.test(p) || /^\/app\/s\/[^/]+$/.test(p)) return review();
  if (/^\/app\/recaps\/[^/]+$/.test(p) || /^\/app\/p\/[^/]+\/(pages|requests)\/[^/]+$/.test(p)) return article();
  const proj = p.match(/^\/app\/p\/[^/]+(?:\/([a-z]+))?$/);
  if (proj) {
    const tab = proj[1] || 'videos';
    const body = { videos: rows(5, 'thumb'), notes: rows(6, 'chip'), people: rows(5, 'avatar'), recaps: rows(4, 'icon'),
      requests: rows(4, 'icon'), pages: rows(4, 'icon'), counts: rows(6), overview: stats(), calendar: calendar() }[tab];
    return body ? page(projectHead() + body) : null;
  }
  if (p === '/app') return page(pageHead() + panels());
  if (p === '/app/projects') return page(pageHead() + cards(6));
  if (p === '/app/calendar') return page(pageHead() + calendar());
  if (p === '/app/insights') return page(pageHead() + stats());
  if (/^\/app\/(people\/[^/]+|me)$/.test(p)) return page(`<header class="page-head sk-head"><div class="sk-project"><span class="sk sk-avatar large"></span><div>${bar('180px', 'sk-title')}${bar('120px')}</div></div></header>${stats()}`, 'narrow-wide');
  if (/^\/app\/(inbox|feedback|queue|people|trash|me\/recaps)$/.test(p)) return page(pageHead() + rows(6, /inbox|people/.test(p) ? 'avatar' : 'icon'), 'narrow-wide');
  return null;
}

export function skeletonHtml(path) {
  const inner = skeletonFor(path);
  return inner ? `<div class="skeleton" aria-hidden="true">${inner}</div>` : '';
}
