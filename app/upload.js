// Getting a phone video into Looproom: shrink it on the device when needed, then upload in resumable chunks.
//
// 1. Prepare: anything that isn't H.264, is over the size budget, or is bigger than 1080p is converted
//    on the device to 720p H.264 MP4 (WebCodecs via Mediabunny). This also fixes iPhone HEVC videos that
//    other browsers can't play. The music is kept as-is when possible.
// 2. Upload: TUS resumable upload to Supabase Storage in 6 MB chunks, retrying through dropped connections.
//    The prepared file and the upload position are remembered, so picking the same file again after a
//    reload continues where it stopped instead of starting over.
import { Upload } from './vendor/tus-js-client-4.3.1.js';
import { grabStill, saveThumb } from './thumbs.js';
import { sb, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TAKE_BUCKET, MAX_TAKE_BYTES, TAKE_TYPES } from './client.js';

const TARGET_BYTES = 45 * 1024 * 1024; // leaves headroom under the 50 MB storage limit
const MAX_SECONDS = 15 * 60;
const SHORT_SIDE = 720;
const AUDIO_BPS = 160_000;

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
  if (track.codec === 'avc' && file.size <= TARGET_BYTES && !big) return null; // already fine

  // Bitrate that fits the size budget, within sensible bounds for 720p dance video.
  const videoBps = Math.max(450_000, Math.min(3_500_000, Math.floor((TARGET_BYTES * 8 * 0.94) / Math.max(duration, 1) - AUDIO_BPS)));
  // Short side down to 720 px, both sides even (H.264 needs that).
  const scale = Math.min(1, SHORT_SIDE / Math.min(track.displayWidth, track.displayHeight));
  const even = (x) => Math.max(2, Math.round((x * scale) / 2) * 2);
  const size = { width: even(track.displayWidth), height: even(track.displayHeight) };
  if (!(await mbx.canEncodeVideo('avc', { ...size, bitrate: videoBps }))) {
    if (tooBig) throw new Error(`This video is ${mb(file.size)} and this device can’t shrink it. Trim it under 50 MB and try again.`);
    return null;
  }

  const output = new mbx.Output({ format: new mbx.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mbx.BufferTarget() });
  const conversion = await mbx.Conversion.init({
    input,
    output,
    tracks: 'primary',
    // A plain number bitrate: Mediabunny 1.61's Quality(number) fails its own encoder check.
    video: { codec: 'avc', ...size, fit: 'contain', bitrate: videoBps, forceTranscode: true, keyFrameInterval: 2 },
    // AAC from phones is copied untouched; other audio is re-encoded to AAC where the browser can.
    audio: { codec: 'aac' },
    showWarnings: false
  });
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
  return data;
}
