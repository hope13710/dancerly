// The sitemap, built from the pages themselves: the home page is dated by the build, the legal pages by their own
// "dateModified" (the date they last changed in substance). build.js writes it to dist/; server.js serves it locally.
import { readFile } from 'node:fs/promises';

const SITE = 'https://dancerly.app';

async function modified(file) {
  const html = await readFile(new URL(file, import.meta.url), 'utf8');
  return html.match(/"dateModified":"(\d{4}-\d{2}-\d{2})"/)?.[1];
}

export async function buildSitemap(today = new Date().toISOString().slice(0, 10)) {
  const pages = [
    ['/', today],
    ['/terms', await modified('./terms.html')],
    ['/privacy', await modified('./privacy.html')]
  ];
  const urls = pages.map(([path, date]) => `  <url><loc>${SITE}${path}</loc>${date ? `<lastmod>${date}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
