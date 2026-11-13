// The Home greeting: a short hello for the time of day, and under it one line about the most useful thing
// right now (a show coming up, rehearsal today, new feedback…), linking straight to it.
// English and Korean are written separately, not translated: each should read like a person wrote it.
// The hello is picked once per day (not on every refresh), and most days it's the plain one.
import { esc } from './client.js';
import { isKo } from './i18n.js';
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
  en: {
    late: ['Hi, {n}', 'Hi, {n}', 'Up late, {n}?', 'Late-night session, {n}?'],
    morning: ['Good morning, {n}', 'Good morning, {n}', 'Morning, {n}', 'Ready to warm up, {n}?'],
    afternoon: ['Good afternoon, {n}', 'Good afternoon, {n}', 'Hi, {n}', 'How’s practice going, {n}?'],
    evening: ['Good evening, {n}', 'Good evening, {n}', 'Evening, {n}', 'Ready to run it back, {n}?'],
    monday: 'New week, {n}. Let’s get into it',
    friday: 'Happy Friday, {n}',
    weekend: 'Weekend practice, {n}?',
    welcome: 'Welcome to dancerly, {n}'
  },
  ko: {
    late: ['안녕하세요, {n}님', '안녕하세요, {n}님', '늦게까지 연습 중이네요, {n}님', '아직 깨어 있었네요, {n}님'],
    morning: ['좋은 아침이에요, {n}님', '좋은 아침이에요, {n}님', '{n}님, 오늘도 몸 풀어 볼까요?', '오늘도 힘차게 시작해요, {n}님'],
    afternoon: ['안녕하세요, {n}님', '안녕하세요, {n}님', '{n}님, 연습은 잘 되고 있나요?', '오늘 하루 어때요, {n}님?'],
    evening: ['좋은 저녁이에요, {n}님', '좋은 저녁이에요, {n}님', '오늘도 수고했어요, {n}님', '{n}님, 오늘 연습은 어땠어요?'],
    monday: '새로운 한 주예요, {n}님',
    friday: '벌써 금요일이에요, {n}님',
    weekend: '주말에도 연습하네요, {n}님',
    welcome: 'dancerly에 오신 걸 환영해요, {n}님'
  }
};

function hello(name, userId, firstVisit) {
  const L = HELLO[isKo ? 'ko' : 'en'];
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

// Korean endings that depend on the last sound of a name (공연이에요 / 쇼케이스예요).
const hasBatchim = (word) => { const c = String(word).trim().slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 > 0; };
const yeyo = (word) => (hasBatchim(word) ? '이에요' : '예요');

const time = (iso) => new Date(iso).toLocaleTimeString(isKo ? 'ko-KR' : 'en-US', { hour: 'numeric', minute: '2-digit' });
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
      text: days <= 0 ? (isKo ? `오늘은 ${t} 날이에요. 응원할게요` : `${t} is today. You’ve got this`)
        : days === 1 ? (isKo ? `내일 ${t}${yeyo(show.title)}. 마지막으로 한 번 맞춰 봐요` : `${t} is tomorrow. One more run-through?`)
        : (isKo ? `${t}까지 ${days}일 남았어요` : `${days} days until ${t}`),
      href: `/app/p/${show.project_id}/overview`
    };
  }

  // 2. Rehearsal today (still to come) or tomorrow; the team recap, if dancerly already wrote it.
  const nextRehearsal = events.find((e) => e.kind === 'rehearsal' && new Date(e.starts_at) > now && (sameDay(new Date(e.starts_at), now) || sameDay(new Date(e.starts_at), tomorrow)));
  if (nextRehearsal) {
    const today = sameDay(new Date(nextRehearsal.starts_at), now);
    const at = time(nextRehearsal.starts_at);
    const recap = s.recapFor?.(nextRehearsal.id);
    const when = isKo ? `${today ? '오늘' : '내일'} ${at} 연습이 있어요` : `Rehearsal ${today ? 'today' : 'tomorrow'} at ${at}`;
    return {
      text: recap ? `${when}${isKo ? ' · 팀 요약이 준비됐어요' : ' · The team recap is ready'}` : when,
      href: recap ? `/app/recaps/${recap}` : `/app/p/${nextRehearsal.project_id}`
    };
  }

  // 3. Rehearsal earlier today and no video from it yet: the best moment to upload.
  const done = events.filter((e) => e.kind === 'rehearsal' && sameDay(new Date(e.starts_at), now)
    && now - new Date(e.ends_at || new Date(e.starts_at).getTime() + 2 * 3600e3) > 0).pop();
  if (done && !(s.takes || []).some((t) => t.project_id === done.project_id && t.created_at > done.starts_at)) {
    return {
      text: isKo ? '오늘 연습 수고했어요. 기억이 생생할 때 영상을 올려 보세요' : 'Nice work at rehearsal today. Upload the video while it’s fresh',
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
        ? (isKo ? `${esc(who)}님이 새 피드백 ${n}개를 남겼어요` : `${esc(who)} left you ${n === 1 ? 'a new note' : `${n} new notes`}`)
        : (isKo ? `새 피드백이 ${n}개 있어요` : `You have ${n} new notes`),
      href: '/app/feedback'
    };
  }

  // 5. Progress this week: feedback on your videos that got fixed.
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const fixed = (s.forMe || []).filter((n) => n.status === 'resolved' && n.resolved_at && n.resolved_at > weekAgo).length;
  if (fixed) {
    return {
      text: isKo ? `이번 주에 피드백 ${fixed}개를 해결했어요. 좋은 흐름이에요.` : `You fixed ${fixed === 1 ? '1 note' : `${fixed} notes`} this week. Keep it going.`,
      href: '/app/insights'
    };
  }

  // 6. A leader still on their own, with a video up: feedback starts when someone else watches.
  if (s.soloLeader) {
    return { text: isKo ? '팀원을 초대하면 바로 피드백을 받을 수 있어요' : 'Invite your team to start getting feedback', action: 'invite' };
  }

  // 7. Back after a while: no guilt, just where to start.
  if (s.lastVisit && now - new Date(s.lastVisit) > 7 * DAY) {
    return { text: isKo ? '다시 오셨네요. 그동안 쌓인 소식부터 볼까요?' : 'Welcome back. Here’s what you missed', href: '/app/inbox' };
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
  return `<header class="page-head home-head"><div data-no-i18n><h1>${title}</h1>${link ? `<p class="sub">${link}</p>` : ''}</div></header>`;
}
