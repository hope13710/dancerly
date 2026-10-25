// Lining takes up. Recordings of the same piece start at different moments, so a note's time in the take it
// was left on has to be moved to land on the same moment in another take.
import { sb } from './client.js';
import { offsetByMusic } from './compare.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

// Seconds to add to a time in take `from` to reach the same moment in take `to`, or null when unknown.
// Count 1 in both takes is the most exact; otherwise the music alignment against Take 1.
export function shiftBetween(from, to) {
  if (!from || !to) return null;
  if (from.id === to.id) return 0;
  const a = num(from.count_start), b = num(to.count_start);
  if (a !== null && b !== null) return b - a;
  const align = (t) => (t.number === 1 ? 0 : num(t.align));
  const x = align(from), y = align(to);
  return x !== null && y !== null ? y - x : null;
}

// For a take after the first with no alignment yet: listen to both recordings once and save the result.
// Skipped on data-saver connections; the result is shared with the whole team.
export async function alignTake({ take, first, urlFirst, urlTake }) {
  if (!take || !first || take.number === 1 || num(take.align) !== null) return null;
  if (num(take.count_start) !== null && num(first.count_start) !== null) return null;
  const conn = navigator.connection;
  if (conn?.saveData || /2g/.test(conn?.effectiveType || '')) return null;
  try {
    const offset = await offsetByMusic(urlFirst, urlTake);
    if (offset === null || !Number.isFinite(offset)) return null;
    const { error } = await sb.rpc('set_take_align', { p_take: take.id, p_align: Number(offset.toFixed(2)) });
    return error ? null : Number(offset.toFixed(2));
  } catch {
    return null;
  }
}
