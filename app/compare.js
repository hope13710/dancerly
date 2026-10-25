// Compare mode: a second video plays next to the take under review, following its play, pause, seek, speed, and mirror.
// The two line up by count 1 when both have counts, by their music when asked, or by hand in 0.1 s steps.

// Finds how far apart two recordings of the same music are, from the rhythm of their sound (onset envelopes).
// Returns seconds to add to the first video's time to land on the same moment in the second, or null if unsure.
export async function offsetByMusic(urlA, urlB, onStage = () => {}) {
  const RATE = 50; // envelope frames per second
  const MAX_LAG = 30 * RATE;
  const envelope = async (url, label) => {
    onStage(label);
    const buf = await (await fetch(url)).arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let audio;
    try { audio = await ctx.decodeAudioData(buf); } finally { ctx.close?.(); }
    const data = audio.getChannelData(0);
    const hop = Math.floor(audio.sampleRate / RATE);
    const frames = Math.min(Math.floor(data.length / hop), 120 * RATE);
    const energy = new Float32Array(frames);
    for (let f = 0; f < frames; f += 1) {
      let sum = 0;
      for (let i = f * hop, end = i + hop; i < end; i += 4) sum += data[i] * data[i];
      energy[f] = Math.sqrt(sum / (hop / 4));
    }
    // Onsets: where the sound gets louder, z-normalized.
    const onset = new Float32Array(frames);
    for (let f = 1; f < frames; f += 1) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
    let mean = 0;
    for (const v of onset) mean += v;
    mean /= frames || 1;
    let sd = 0;
    for (const v of onset) sd += (v - mean) ** 2;
    sd = Math.sqrt(sd / (frames || 1)) || 1;
    for (let f = 0; f < frames; f += 1) onset[f] = (onset[f] - mean) / sd;
    return onset;
  };
  const a = await envelope(urlA, 'Listening to this take…');
  const b = await envelope(urlB, 'Listening to the other video…');
  onStage('Matching the music…');
  const scores = new Float32Array(MAX_LAG * 2 + 1);
  for (let lag = -MAX_LAG; lag <= MAX_LAG; lag += 1) {
    let s = 0;
    let n = 0;
    for (let i = Math.max(0, -lag), end = Math.min(a.length, b.length - lag); i < end; i += 1) { s += a[i] * b[i + lag]; n += 1; }
    scores[lag + MAX_LAG] = n > RATE * 5 ? s / n : 0;
  }
  let best = 0;
  for (let i = 1; i < scores.length; i += 1) if (scores[i] > scores[best]) best = i;
  let mean = 0;
  for (const v of scores) mean += v;
  mean /= scores.length;
  let sd = 0;
  for (const v of scores) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / scores.length) || 1;
  if ((scores[best] - mean) / sd < 5) return null; // no clear match
  return (best - MAX_LAG) / RATE;
}

// Keeps the second video on the first one's clock. Call every frame.
export function follow(primary, secondary, offset, speed) {
  if (!secondary || secondary.readyState < 1) return;
  const target = primary.currentTime + offset;
  const inRange = target >= 0 && (!secondary.duration || target <= secondary.duration);
  if (primary.paused || !inRange) {
    if (!secondary.paused) secondary.pause();
    if (inRange && Math.abs(secondary.currentTime - target) > 0.04) secondary.currentTime = target;
    return;
  }
  if (secondary.paused) { secondary.currentTime = target; secondary.play().catch(() => {}); }
  const drift = secondary.currentTime - target;
  if (Math.abs(drift) > 0.3) { secondary.currentTime = target; secondary.playbackRate = speed; return; }
  // Small drift: nudge the speed instead of jumping, so playback stays smooth.
  secondary.playbackRate = speed * (1 - Math.max(-0.1, Math.min(0.1, drift * 0.8)));
}
