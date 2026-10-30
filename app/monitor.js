// Error reports (Sentry), so we hear about a broken upload or a blank screen before a team gives up on it.
// Loaded in the background after the app starts, and only on dancerly.app (local and preview builds stay quiet).
// What leaves the browser: the error and its stack, the app address reduced to its shape (no ids, invite codes,
// or guest-link tokens), the browser, and the signed-in account id. No IP address, email, note text, video, or
// screen recording.
const DSN = 'https://326b7a18886504e90f9559d555f1d131@o4512343165435904.ingest.us.sentry.io/4512343178674176';

let sentry = null;
let userId = null;

// Same shape as the visit statistics in index.html.
const shape = (raw) => {
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin) return `${url.origin}${url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')}`;
    url.pathname = url.pathname
      .replace(/^\/app\/s\/[^/]+/, '/app/s/:token')
      .replace(/^\/app\/join\/[^/]+/, '/app/join/:code')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
    return `${url.origin}${url.pathname}`;
  } catch { return ''; }
};
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi;
const clean = (s) => (typeof s === 'string' ? s.replace(EMAIL, '[email]') : s);

export function startMonitoring() {
  if (location.hostname !== 'dancerly.app') return;
  import('./vendor/sentry-browser-10.76.2.js').then((S) => {
    S.init({
      dsn: DSN,
      environment: 'production',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // Noise that isn't ours to fix: extensions, flaky networks, a benign layout warning.
      denyUrls: [/extensions\//i, /^chrome:\/\//i, /^moz-extension:\/\//i, /^safari-(web-)?extension:\/\//i],
      ignoreErrors: ['ResizeObserver loop', 'Non-Error promise rejection captured', 'AbortError', 'Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource'],
      beforeBreadcrumb(crumb) {
        if (crumb.category === 'console') return null; // could hold anything
        if (crumb.data?.url) crumb.data.url = shape(crumb.data.url);
        if (crumb.data?.from) crumb.data.from = shape(crumb.data.from);
        if (crumb.data?.to) crumb.data.to = shape(crumb.data.to);
        crumb.message = clean(crumb.message);
        return crumb;
      },
      beforeSend(event) {
        if (event.request) event.request = { url: shape(event.request.url || location.href), headers: { 'User-Agent': navigator.userAgent } };
        if (event.transaction) event.transaction = shape(event.transaction);
        event.message = clean(event.message);
        for (const ex of event.exception?.values || []) ex.value = clean(ex.value);
        event.user = userId ? { id: userId } : undefined;
        return event;
      }
    });
    sentry = S;
  }).catch(() => {});
}

// Which account hit it (an id only), so we can count how many people one bug reaches.
export function setMonitoredUser(id) { userId = id || null; }

// Failures the app catches and explains to the person, but that we still need to see — like a phone that
// can't shrink a video, which never reaches the server. Grouped by area, step, and reason (numbers left out),
// so "can't read this format" on 40 phones is one issue with a device breakdown, not 40.
export function reportFailure(area, error, { level = 'error', ...details } = {}) {
  if (!sentry) return;
  const reason = String(error?.message || error).replace(/\d+/g, '#').slice(0, 120);
  sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
    level,
    tags: { area, step: details.step },
    contexts: { [area]: details },
    fingerprint: [area, String(details.step), reason]
  });
}
