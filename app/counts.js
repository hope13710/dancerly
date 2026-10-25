// Dance counts from a tempo: where count 1 falls and the BPM give "eight 3 · count 5" at any moment.

// { eight, count } at time t, or null before count 1 / without a tempo.
export function countAt(t, bpm, start) {
  if (!bpm || start === null || start === undefined || t < start - 0.02) return null;
  const n = Math.floor((t - start) / (60 / bpm) + 0.02);
  return { eight: Math.floor(n / 8) + 1, count: (n % 8) + 1 };
}
export const countLabel = (c) => (c ? `${c.eight}·${c.count}` : '');

// Seconds where each eight begins, for the timeline marks.
export function eightStarts(duration, bpm, start, max = 400) {
  if (!bpm || start === null || start === undefined || !duration) return [];
  const step = (60 / bpm) * 8;
  const out = [];
  for (let s = Number(start); s <= duration && out.length < max; s += step) out.push(s);
  return out;
}

// Tap along with the beat; the median of the last few gaps gives a steady BPM.
export function tapTempo() {
  let taps = [];
  return {
    tap() {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now);
      taps = taps.slice(-9);
      if (taps.length < 3) return null;
      const gaps = taps.slice(1).map((x, i) => x - taps[i]).sort((a, b) => a - b);
      const mid = gaps[Math.floor(gaps.length / 2)];
      return Math.round((60000 / mid) * 10) / 10;
    },
    count: () => taps.length
  };
}
