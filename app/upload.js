// Getting a phone video into dancerly: shrink it on the device when needed, then upload in resumable chunks.
//
// 1. Prepare: anything that isn't H.264, is over the size budget, is bigger than 1080p, is heavier than
//    5 Mbps, or is 60 fps is converted on the device to H.264 (High profile) MP4 via WebCodecs and
//    Mediabunny: 720p at up to 2.5 Mbps, 30 fps, 540p for long runs. This also
//    fixes iPhone HEVC videos other browsers can't play. The music is copied as-is, or re-encoded at 96 kbps
//    for runs over 8 minutes so 15 minutes fit.
// 2. Upload: TUS resumable upload to Supabase Storage in 6 MB chunks, retrying through dropped connections.
//    The prepared file and the upload position are remembered, so picking the same file again after a
//    reload continues where it stopped instead of starting over.
import { Upload } from './vendor/tus-js-client-4.3.1.js';
import { grabStill, saveThumb } from './thumbs.js';
import { sb, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TAKE_BUCKET, MAX_TAKE_BYTES, TAKE_TYPES } from './client.js';

const TARGET_BYTES = 45 * 1024 * 1024; // leaves headroom under the 50 MB storage limit
const MAX_SECONDS = 15 * 60;
// Bits go where they show: 30 fps is plenty for feedback (half-speed and frame steps still look right), and
// a 720p dance video looks clean at about 2.5 Mbps. Filling the size budget past that only makes every
// teammate's download bigger. 60 fps is always brought down to 30: browser encoders size their bitrate as if
// the video were 30 fps, so a 60 fps output comes out about twice as big as asked and can miss the 50 MB limit.
const VIDEO_CAP = { 720: 2_500_000, 540: 1_500_000 };
const VIDEO_FLOOR = 300_000; // below this, long runs drop to 540p; never below ~200 kbps
const RECODE_ABOVE_BPS = 5_000_000; // H.264 originals heavier than this are shrunk too (phones record ~10–20 Mbps)
const LONG_SECONDS = 8 * 60; // long runs re-encode the music at 96 kbps so 15 minutes fit
const AUDIO_LONG_BPS = 96_000;
const AUDIO_DEFAULT_BPS = 160_000; // assumed when the original's audio bitrate can't be read

const typeOf = (file) => file.type || ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' })[file.name.split('.').pop().toLowerCase()] || '';

export function checkTakeFile(file) {
  if (!file) return 'Choose a video file.';
  if (!TAKE_TYPES[typeOf(file)]) return 'This file type isn’t supported. Try MP4, MOV, or WebM.';
  return null;
}

// ---------- 1. Prepare ----------
const canConvert = () => typeof window.VideoEncoder === 'function' && typeof window.VideoDecoder === 'function';

export async function prepareVideo(file, onStage) {
  const tooBig = file.size > MAX_TAKE_BYTES;
  if (!canConvert()) {
    if (tooBig) throw new Error(`This video is ${mb(file.size)} and this browser can’t shrink it. Try Chrome or Safari, or trim it under 50 MB.`);
    return null;
  }
  onStage('Checking video');
  const mbx = await import('./vendor/mediabunny-1.61.3.js');
  const input = new mbx.Input({ source: new mbx.BlobSource(file), formats: mbx.ALL_FORMATS });
  let track;
  let duration;
  try {
    track = await input.getPrimaryVideoTrack();
    duration = await input.computeDuration();
  } catch {
    if (tooBig) throw new Error('We couldn’t read this video. Try exporting it again from your camera app.');
    return null;
  }
  if (!track) throw new Error('This file has no video in it.');
  if (duration > MAX_SECONDS) throw new Error(`This video is ${Math.round(duration / 60)} minutes long. Keep takes under 15 minutes — trim it to the part you want feedback on.`);
  const big = Math.min(track.displayWidth, track.displayHeight) > 1080;
  // What the original really is: frame rate and bitrates, read from the first few seconds of packets.
  const stats = await track.computePacketStats(150).catch(() => null);
  const fps = stats?.averagePacketRate || 30;
  const sourceBps = stats?.averageBitrate || (file.size * 8) / Math.max(duration, 1);
  const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
  const audioStats = audioTrack ? await audioTrack.computePacketStats(200).catch(() => null) : null;
  const sourceAudioBps = audioTrack ? audioStats?.averageBitrate || AUDIO_DEFAULT_BPS : 0;
  const lean = track.codec === 'avc' && file.size <= TARGET_BYTES && !big && sourceBps <= RECODE_ABOVE_BPS && fps <= 31;
  if (lean) return null; // already light enough to stream to the whole team

  const targetFps = fps > 31 ? 30 : null;
  // Resolution and bitrate for a given audio cost: the cap for quality, the size budget for long runs.
  const plan = (audioBps) => {
    const budget = Math.floor((TARGET_BYTES * 8 * 0.94) / Math.max(duration, 1) - audioBps);
    const short = budget < VIDEO_FLOOR * 1.8 ? 540 : 720;
    const cap = VIDEO_CAP[short];
    const videoBps = Math.max(Math.min(budget, VIDEO_FLOOR), Math.min(cap, budget));
    const scale = Math.min(1, short / Math.min(track.displayWidth, track.displayHeight));
    const even = (x) => Math.max(2, Math.round((x * scale) / 2) * 2);
    return { videoBps, size: { width: even(track.displayWidth), height: even(track.displayHeight) }, fits: videoBps >= 200_000 };
  };
  const reencodeAudio = Boolean(audioTrack) && duration > LONG_SECONDS;
  let settings = plan(reencodeAudio ? AUDIO_LONG_BPS : sourceAudioBps);
  if (!settings.fits) throw new Error(`This video is ${Math.round(duration / 60)} minutes long, too long to fit at a watchable quality. Trim it to the part you want feedback on.`);
  if (!(await mbx.canEncodeVideo('avc', { ...settings.size, bitrate: settings.videoBps }))) {
    if (tooBig) throw new Error(`This video is ${mb(file.size)} and this device can’t shrink it. Trim it under 50 MB and try again.`);
    return null;
  }

  const start = async (audio) => {
    const output = new mbx.Output({ format: new mbx.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mbx.BufferTarget() });
    const conversion = await mbx.Conversion.init({
      input,
      output,
      tracks: 'primary',
      // A plain number bitrate: Mediabunny 1.61's Quality(number) fails its own encoder check.
      // H.264 High profile; the browser's encoder defaults are variable bitrate and quality-first.
      video: { codec: 'avc', ...settings.size, fit: 'contain', bitrate: settings.videoBps, forceTranscode: true, keyFrameInterval: 2, ...(targetFps ? { frameRate: targetFps } : {}) },
      audio,
      showWarnings: false
    });
    return { output, conversion };
  };
  // Long runs: re-encode the music smaller. If this browser can't, copy it and re-plan the video around it.
  let { output, conversion } = await start(reencodeAudio ? { codec: 'aac', bitrate: AUDIO_LONG_BPS, forceTranscode: true } : { codec: 'aac' });
  if (reencodeAudio && conversion.discardedTracks.some((d) => d.track.type === 'audio')) {
    settings = plan(sourceAudioBps);
    if (!settings.fits) throw new Error('This browser can’t keep the music while shrinking a video this long. Try Chrome, or trim it to the part you want feedback on.');
    ({ output, conversion } = await start({ codec: 'aac' }));
  }
  const lostSound = conversion.discardedTracks.some((d) => d.track.type === 'audio');
  const lostVideo = conversion.discardedTracks.some((d) => d.track.type === 'video');
  if (lostVideo) {
    if (!tooBig) return null; // can't decode it here (e.g. HEVC on some Android/Linux browsers): upload as is
    throw new Error('This browser can’t read this video format to shrink it. Try Safari or Chrome on your phone, or trim it under 50 MB.');
  }
  if (!conversion.isValid || lostSound) {
    // Never silently drop the music: fall back to the original if it fits.
    if (!tooBig && track.codec === 'avc') return null;
    throw new Error('This browser can’t keep the music while shrinking this video. Try Chrome, or trim it under 50 MB.');
  }
  conversion.onProgress = (p) => onStage(`Preparing ${Math.round(p * 100)}%`);
  await conversion.execute();
  const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
  if (blob.size > MAX_TAKE_BYTES) throw new Error('Even after shrinking, this video is over 50 MB. Trim it to the part you want feedback on.');
  return blob;
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`;

// ---------- Remembering prepared files between reloads ----------
const DB = 'looproom-uploads';
function idb(mode, fn) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('files');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const tx = open.result.transaction('files', mode);
        const req = fn(tx.objectStore('files'));
        tx.oncomplete = () => { resolve(req?.result ?? null); open.result.close(); };
        tx.onerror = () => { resolve(null); open.result.close(); };
      };
    } catch {
      resolve(null);
    }
  });
}
const cacheGet = (key) => idb('readonly', (s) => s.get(key));
const cachePut = (key, blob) => idb('readwrite', (s) => s.put(blob, key));
const cacheDelete = (key) => idb('readwrite', (s) => s.delete(key));
const recordKey = (key) => `looproom:upload:${key}`;
function readRecord(key) { try { return JSON.parse(localStorage.getItem(recordKey(key))); } catch { return null; } }
function writeRecord(key, value) { try { localStorage.setItem(recordKey(key), JSON.stringify(value)); } catch {} }
function clearRecord(key) { try { localStorage.removeItem(recordKey(key)); } catch {} }

// ---------- 2. Upload ----------
function tusUpload(blob, { path, type, key }, onStage) {
  return new Promise((resolve, reject) => {
    const upload = new Upload(blob, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000, 60000],
      chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6 MB chunks
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      fingerprint: async () => `looproom-${key}`,
      metadata: { bucketName: TAKE_BUCKET, objectName: path, contentType: type, cacheControl: '3600' },
      headers: { 'x-upsert': 'false' },
      // Long uploads can outlive a session token; always send a fresh one.
      onBeforeRequest: async (req) => {
        const { data } = await sb.auth.getSession();
        req.setHeader('authorization', `Bearer ${data.session?.access_token || ''}`);
        req.setHeader('apikey', SUPABASE_PUBLISHABLE_KEY);
      },
      onProgress: (sent, total) => onStage(`Uploading ${Math.min(99, Math.round((sent / total) * 100))}%`),
      onSuccess: () => resolve(),
      onError: (err) => {
        // The object is already there (finished earlier, record not yet cleared): carry on.
        if (err?.originalResponse?.getStatus?.() === 409) return resolve();
        const stopped = new Error(navigator.onLine === false
          ? 'You’re offline. Pick the same file again when you’re back online — the upload continues where it stopped.'
          : 'The upload stopped. Pick the same file again to continue where it left off.');
        stopped.resumable = true;
        reject(stopped);
      }
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) { onStage('Resuming'); upload.resumeFromPreviousUpload(previous[0]); }
      upload.start();
    });
  });
}

// Prepare (or reuse the prepared copy), upload (or resume), then record the take.
export async function uploadTake({ projectId, videoId, file, onStage = () => {} }) {
  const problem = checkTakeFile(file);
  if (problem) throw new Error(problem);
  const key = `${projectId}/${videoId}/${file.name}/${file.size}/${file.lastModified}`;
  let record = readRecord(key);
  let blob = record?.prepared ? await cacheGet(key) : null;
  if (!blob) {
    const prepared = await prepareVideo(file, onStage);
    blob = prepared || file;
    if (prepared) await cachePut(key, prepared);
    const type = prepared ? 'video/mp4' : typeOf(file);
    record = { path: record?.path || `${projectId}/${videoId}/${crypto.randomUUID()}.${TAKE_TYPES[type]}`, type, prepared: Boolean(prepared) };
    writeRecord(key, record);
  }
  // Keep the path stable across retries so a resumed upload lands in the same place.
  if (!record.path.endsWith(`.${TAKE_TYPES[record.type]}`)) record.path = `${projectId}/${videoId}/${crypto.randomUUID()}.${TAKE_TYPES[record.type]}`;
  await tusUpload(blob, { ...record, key }, onStage);
  onStage('Saving');
  const { data, error } = await sb.from('takes').insert({ video_id: videoId, storage_path: record.path, file_name: file.name.slice(0, 200) }).select('id, number, project_id, video_id').single();
  if (error) {
    await sb.storage.from(TAKE_BUCKET).remove([record.path]);
    clearRecord(key);
    cacheDelete(key);
    throw error;
  }
  clearRecord(key);
  cacheDelete(key);
  // The list thumbnail, made from the file already on this device (doesn't hold up the upload).
  const local = URL.createObjectURL(blob);
  grabStill(local).then((still) => saveThumb(data, still)).finally(() => URL.revokeObjectURL(local));
  window.dispatchEvent(new CustomEvent('take-uploaded', { detail: data }));
  return data;
}
