// An invite link (/app/join/<code>, rewritten here by vercel.json) shows the team in the link preview, so a link
// pasted into a group chat reads "Join Spring Showcase on dancerly · 5 people are already here" instead of the
// generic app card. People get the same app page as before; only the preview tags change.
// Only what invite_preview already tells anyone with the link: the project's name and how many people are in it.
const SUPABASE_URL = 'https://egkwjdwfzuslyrhuzkmq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tPZZPnIucN4L1EAwXam_uA_3m7tNshc';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setMeta = (html, attr, key, value) => html.replace(new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`), `$1${esc(value)}$2`);

async function invite(code) {
  if (!/^[a-f0-9]{6,64}$/.test(code || '')) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/invite_preview`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
      signal: AbortSignal.timeout(2500)
    });
    if (!res.ok) return null;
    const [row] = await res.json();
    return row?.valid ? row : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const code = String(req.query.code || '');
  // The app itself: the same index.html the static site serves.
  const page = await fetch(`${proto}://${host}/app/index.html`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
  if (!page?.ok) {
    // Couldn't read the page: send people to it unchanged (the static route), so the link still works.
    res.setHeader('Cache-Control', 'no-store');
    // ?p=1 skips this function in vercel.json, so this can't loop.
    res.statusCode = 302;
    res.setHeader('Location', `/app/join/${encodeURIComponent(code)}?p=1`);
    return res.end();
  }
  let html = await page.text();
  const row = await invite(code);
  if (row) {
    const n = Number(row.member_count) || 0;
    const title = `Join ${row.project_title} on dancerly`;
    const desc = `${n} ${n === 1 ? 'person is' : 'people are'} already here, giving each other feedback on practice videos. Tap to join from your phone, nothing to install.`;
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
    html = setMeta(html, 'property', 'og:title', title);
    html = setMeta(html, 'name', 'twitter:title', title);
    html = setMeta(html, 'property', 'og:description', desc);
    html = setMeta(html, 'name', 'twitter:description', desc);
    html = setMeta(html, 'name', 'description', desc);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Short: a renamed project or a new member shows up in the next preview soon.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  res.statusCode = 200;
  res.end(html);
}
