// Practice a note against the original: where a moment in a take sits in the project's choreo video.
// Each take keeps one number per choreo video (migration 067): the seconds to add to a time in the take to reach the
// same moment in the choreo video. One take of a video is enough: the others follow from how the takes line up
// with each other (align.js). It comes from the music (a choreo video file) or from someone tapping "Here" on the
// original (YouTube, whose sound a web page can't read), once, for the whole team.
import { sb, schema } from './client.js';
import { shiftBetween } from './align.js';
import { offsetByMusic } from './compare.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

// Which choreo video an alignment was made against: changing it leaves the old numbers unused.
export const choreoKey = (project) => (project?.choreo_video_id ? `v:${project.choreo_video_id}` : project?.choreo_youtube ? `yt:${project.choreo_youtube}` : null);
export const hasChoreo = (project) => Boolean(schema.choreo && schema.choreoAlign && (project?.choreo_video_id || project?.choreo_youtube));

// Practice opens on the note's moment: the take it's on and the times as shown on that take.
export function practiceHref(projectId, { take, t, end = null, note = null }) {
  const q = new URLSearchParams({ take, t: Number(t).toFixed(2) });
  if (end !== null && end !== undefined) q.set('end', Number(end).toFixed(2));
  if (note) q.set('note', note);
  return `/app/p/${projectId}/practice?${q}`;
}

// The take, its video's other takes, and how it lines up with the choreo video (or null if nobody has yet).
export async function loadTakeShift(takeId, key) {
  const { data: take } = await sb.from('takes').select('id, video_id, project_id, number, align, count_start, storage_path').eq('id', takeId).maybeSingle();
  if (!take) return { take: null, shift: null };
  if (!schema.choreoAlign || !key) return { take, shift: null };
  const { data: siblings } = await sb.from('takes').select('id, number, align, count_start').eq('video_id', take.video_id);
  const takes = siblings || [take];
  const { data: rows } = await sb.from('take_choreo_align').select('take_id, shift, source, updated_at').eq('choreo', key).in('take_id', takes.map((x) => x.id));
  const own = (rows || []).find((r) => r.take_id === take.id);
  if (own) return { take, shift: num(own.shift), source: own.source };
  // Through another take of the same video: this take → that take → the choreo video. The newest saved one first.
  for (const r of [...(rows || [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    const other = takes.find((x) => x.id === r.take_id);
    const between = shiftBetween(take, other);
    if (between !== null) return { take, shift: between + num(r.shift), source: r.source };
  }
  return { take, shift: null };
}

export async function saveTakeShift(takeId, key, shift, source) {
  const { error } = await sb.rpc('set_choreo_align', { p_take: takeId, p_choreo: key, p_shift: Number(shift.toFixed(2)), p_source: source });
  return !error;
}

// A take against a choreo video file, by their music. The take may start anywhere in the song.
export async function shiftByMusic(takeUrl, choreoUrl, onStage) {
  try {
    const offset = await offsetByMusic(takeUrl, choreoUrl, onStage, { lagFrom: -60, lagTo: 330, seconds: 360 });
    return offset === null || !Number.isFinite(offset) ? null : offset;
  } catch {
    return null;
  }
}

// What to loop in the choreo video around a note's moment (or range).
//   short:  just the move, a second either side.
//   normal: room to get into it and out of it: 4 counts before (a "5, 6, 7, 8"), 2 after, never under 2 s each.
// Counts come from the choreo video when it has them; otherwise seconds.
export const LOOP_LENGTHS = ['short', 'normal', 'section'];
export function focusRange(start, end, beat, duration, length = 'normal') {
  const before = length === 'short' ? 1 : Math.max(2, beat ? 4 * beat : 0);
  const after = length === 'short' ? 1 : Math.max(2, beat ? 2 * beat : 0);
  const a = Math.max(0, start - before);
  let b = (end ?? start) + after;
  if (duration) b = Math.min(duration, b);
  return [a, b];
}
