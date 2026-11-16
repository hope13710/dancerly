// The Home greeting: a short hello for the time of day, and under it one line about the most useful thing
// right now (a show coming up, rehearsal today, new feedback…), linking straight to it.
// The hello is picked once per day (not on every refresh), and most days it's the plain one.
import { esc } from './client.js';
import { ic } from './icons.js';

const DAY = 864e5;
const LAST_VISIT = 'looproom:home-seen:';

// Same pick all day for the same person; a different one tomorrow.
function pick(list, seed) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

// Index 0 is the plain hello and shows up about half the time; the rest are the occasional lighter ones.
const HELLO = {
  late: ['Hi, {n}', 'Hi, {n}', 'Up late, {n}?', 'Late-night session, {n}?'],
  morning: ['Good morning, {n}', 'Good morning, {n}', 'Morning, {n}', 'Ready to warm up, {n}?'],
  afternoon: ['Good afternoon, {n}', 'Good afternoon, {n}', 'Hi, {n}', 'How’s practice going, {n}?'],
  evening: ['Good evening, {n}', 'Good evening, {n}', 'Evening, {n}', 'Ready to run it back, {n}?'],
  monday: 'New week, {n}. Let’s get into it',
  friday: 'Happy Friday, {n}',
  weekend: 'Weekend practice, {n}?',
  welcome: 'Welcome to dancerly, {n}'
};

function hello(name, userId, firstVisit) {
  const L = HELLO;
  const now = new Date();
  const h = now.getHours();
  const day = now.getDay(); // 0 Sunday … 6 Saturday
  const part = h < 5 ? 'late' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const seed = `${now.toDateString()}|${part}|${userId}`;
  let line = pick(L[part], seed);
  // Once in a while, the day itself is the hello: Monday morning, Friday, weekend daytime.
  const special = day === 1 && part === 'morning' ? L.monday : day === 5 && part !== 'late' ? L.friday : (day === 0 || day === 6) && (part === 'morning' || part === 'afternoon') ? L.weekend : null;
  if (special && pick([true, false], `${seed}|day`)) line = special;
  if (firstVisit) line = L.welcome;
  return line.replace('{n}', esc(name));
}


const time = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const sameDay = (a, b) => a.toDateString() === b.toDateString();

// The one line under the hello. The first thing that applies wins; when nothing does, there's no line.
function situation(s) {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + DAY);
  const events = s.events || [];

  // 1. A show within a week.
  const show = events.find((e) => e.kind === 'show' && new Date(e.starts_at) >= new Date(now.toDateString()) && new Date(e.starts_at) - now <= 7 * DAY);
  if (show) {
    const days = Math.round((new Date(new Date(show.starts_at).toDateString()) - new Date(now.toDateString())) / DAY);
    const t = esc(show.title);
    return {
      text: days <= 0 ? `${t} is today. You’ve got this`
        : days === 1 ? `${t} is tomorrow. One more run-through?`
        : `${days} days until ${t}`,
      href: `/app/p/${show.project_id}/overview`
    };
  }

  // 2. Rehearsal today (still to come) or tomorrow; the team recap, if dancerly already wrote it.
  const nextRehearsal = events.find((e) => e.kind === 'rehearsal' && new Date(e.starts_at) > now && (sameDay(new Date(e.starts_at), now) || sameDay(new Date(e.starts_at), tomorrow)));
  if (nextRehearsal) {
    const today = sameDay(new Date(nextRehearsal.starts_at), now);
    const at = time(nextRehearsal.starts_at);
    const recap = s.recapFor?.(nextRehearsal.id);
    const when = `Rehearsal ${today ? 'today' : 'tomorrow'} at ${at}`;
    return {
      text: recap ? `${when} · The team recap is ready` : when,
      href: recap ? `/app/recaps/${recap}` : `/app/p/${nextRehearsal.project_id}`
    };
  }

  // 3. Rehearsal earlier today and no video from it yet: the best moment to upload.
  const done = events.filter((e) => e.kind === 'rehearsal' && sameDay(new Date(e.starts_at), now)
    && now - new Date(e.ends_at || new Date(e.starts_at).getTime() + 2 * 3600e3) > 0).pop();
  if (done && !(s.takes || []).some((t) => t.project_id === done.project_id && t.created_at > done.starts_at)) {
    return {
      text: 'Nice work at rehearsal today. Upload the video while it’s fresh',
      href: `/app/p/${done.project_id}?upload=1`
    };
  }

  // 4. New feedback for you since your last visit.
  const fresh = (s.forMe || []).filter((n) => n.status !== 'resolved' && s.lastVisit && n.created_at > s.lastVisit);
  if (fresh.length) {
    const authors = [...new Set(fresh.map((n) => n.author_id))];
    const who = authors.length === 1 ? s.names?.[authors[0]]?.split(' ')[0] : null;
    const n = fresh.length;
    return {
      text: who
        ? (`${esc(who)} left you ${n === 1 ? 'a new note' : `${n} new notes`}`)
        : `You have ${n} new notes`,
      href: '/app/feedback'
    };
  }

  // 5. Progress this week: feedback on your videos that got fixed.
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const fixed = (s.forMe || []).filter((n) => n.status === 'resolved' && n.resolved_at && n.resolved_at > weekAgo).length;
  if (fixed) {
    return {
      text: `You fixed ${fixed === 1 ? '1 note' : `${fixed} notes`} this week. Keep it going.`,
      href: '/app/feedback?view=for-me&status=resolved'
    };
  }

  // 6. A leader still on their own, with a video up: feedback starts when someone else watches.
  if (s.soloLeader) {
    return { text: 'Invite your team to start getting feedback', action: 'invite' };
  }

  // 7. Back after a while: no guilt, just where to start.
  if (s.lastVisit && now - new Date(s.lastVisit) > 7 * DAY) {
    return { text: 'Welcome back. Here’s what you missed', href: '/app/inbox' };
  }
  return null;
}

// Reads (and then updates) when this person last opened Home on this device.
function visit(userId) {
  let last = null;
  try { last = localStorage.getItem(LAST_VISIT + userId); localStorage.setItem(LAST_VISIT + userId, new Date().toISOString()); } catch {}
  return last;
}

export function homeGreeting({ name, userId, firstVisit = false, ...s }) {
  const lastVisit = visit(userId);
  const title = hello(name, userId, firstVisit && !lastVisit);
  const line = situation({ ...s, lastVisit });
  const link = !line ? '' : line.href
    ? `<a class="home-line" href="${line.href}" data-link>${line.text}${ic('right', 'after')}</a>`
    : `<button type="button" class="home-line" data-start-action="${line.action}">${line.text}${ic('right', 'after')}</button>`;
  return `<header class="page-head home-head"><div><h1>${title}</h1>${link ? `<p class="sub">${link}</p>` : ''}</div></header>`;
}
