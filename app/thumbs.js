// Video thumbnails: one still per take, saved next to the video in the private bucket.
// Made on the uploader's device right after an upload; older takes get one the first time someone opens the list.
import { sb, TAKE_BUCKET } from './client.js';

// Grabs a frame about 1 second in (or 10% for short clips) and returns a JPEG blob, or null if the browser can't decode it.
export function grabStill(src, { width = 480 } = {}) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let done = false;
    const finish = (blob) => { if (done) return; done = true; clearTimeout(timer); video.removeAttribute('src'); video.load(); resolve(blob); };
    const timer = setTimeout(() => finish(null), 15000);
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('error', () => finish(null));
    let drawn = false;
    const draw = () => {
      if (drawn) return;
      drawn = true;
      const scale = Math.min(1, width / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      try {
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.78);
      } catch { finish(null); }
    };
    video.addEventListener('loadedmetadata', () => {
      if (!video.videoWidth) return finish(null);
      video.currentTime = Math.min(1, (video.duration || 1) * 0.1);
      // If seeking stalls, settle for the first frame.
      setTimeout(() => { if (!done && video.readyState >= 2) draw(); }, 4000);
    });
    video.addEventListener('seeked', draw, { once: true });
    video.src = src;
  });
}

// Saves a still for a take and returns its path (or null).
export async function saveThumb(take, blob) {
  if (!blob) return null;
  const path = `${take.project_id}/${take.video_id}/thumb-${take.id}-${Date.now()}.jpg`;
  const { error } = await sb.storage.from(TAKE_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) return null;
  const { error: setErr } = await sb.rpc('set_take_thumb', { p_take: take.id, p_path: path });
  return setErr ? null : path;
}

// Signed URLs for a batch of thumbnail paths: { path: url }.
export async function thumbUrls(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await sb.storage.from(TAKE_BUCKET).createSignedUrls(unique, 60 * 60 * 6);
  return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

// Fills in missing stills one or two at a time; calls back with an object URL as each one is ready.
export async function backfillThumbs(takes, onReady) {
  const queue = [...takes];
  const worker = async () => {
    while (queue.length) {
      const take = queue.shift();
      const { data } = await sb.storage.from(TAKE_BUCKET).createSignedUrl(take.storage_path, 600);
      if (!data?.signedUrl) continue;
      const blob = await grabStill(data.signedUrl);
      if (!blob) continue;
      onReady(take, URL.createObjectURL(blob));
      saveThumb(take, blob);
    }
  };
  await Promise.all([worker(), worker()]);
}
