// Where someone first came from, so a signup days later can still be credited to the link that brought them.
// A tagged link (?ref=ig_dm, or utm_source) wins; otherwise the site they came from (instagram.com, google…).
// First visit counts and is kept for 30 days in this browser. Only the tag, the site, and the date are kept.
const KEY = 'looproom:source';
const DAYS = 30;

export function rememberSource() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && Date.now() - Date.parse(saved.at) < DAYS * 864e5) return;
    const params = new URLSearchParams(location.search);
    const tag = (params.get('ref') || params.get('utm_source') || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
    let site = '';
    try { const r = new URL(document.referrer); if (r.host && r.host !== location.host) site = r.host.replace(/^(www|l|m|lm)\.|^out\./, '').slice(0, 60); } catch {}
    if (!tag && !site) return; // a direct visit tells us nothing; keep waiting for one that does
    const medium = (params.get('utm_medium') || '').slice(0, 40);
    const campaign = (params.get('utm_campaign') || '').slice(0, 60);
    localStorage.setItem(KEY, JSON.stringify({ ref: tag || null, site: site || null, medium: medium || null, campaign: campaign || null, page: location.pathname.slice(0, 80), at: new Date().toISOString() }));
  } catch {}
}

// What goes on the account at signup (user metadata).
export function signupSource() {
  rememberSource();
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  if (!s) return {};
  return {
    signup_source: s.ref || s.site || undefined,
    signup_site: s.site || undefined,
    signup_medium: s.medium || undefined,
    signup_campaign: s.campaign || undefined,
    first_seen_at: s.at
  };
}
