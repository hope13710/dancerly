import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.mp4':'video/mp4', '.jpg':'image/jpeg', '.png':'image/png', '.webp':'image/webp' };
const resolveRequestPath = (requestPath) => {
  if (requestPath === '/') return 'index.html';
  // The old static demo now opens the real app.
  if (requestPath === '/demo' || requestPath === '/demo/') return 'app/index.html';
  // The real app is a single page: every /app route without a file extension loads app/index.html.
  if (/^\/app(\/[^.]*)?$/.test(requestPath)) return 'app/index.html';
  if (requestPath === '/terms' || requestPath === '/privacy') return `${requestPath.slice(1)}.html`;
  if (requestPath === '/manus-routes.json') return 'public/manus-routes.json';
  // The build copies public/ to the site root; locally, serve it from there.
  if (requestPath.startsWith('/samples/') || /^\/(robots\.txt|sitemap\.xml|site\.webmanifest|\.well-known\/security\.txt)$/.test(requestPath)) return `public${requestPath}`;
  return requestPath.replace(/^\/+/, '');
};
const server = http.createServer(async (request, response) => {
  const requestPath = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
  const relativePath = resolveRequestPath(requestPath);
  const safePath = normalize(relativePath).replace(/^\.\.(?:[\\/]|$)/, '');
  const filePath = join(root, safePath);
  try {
    const body = await readFile(filePath);
    const type = mime[extname(filePath)] || 'application/octet-stream';
    // Videos need byte ranges so the browser can seek.
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      response.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-cache' });
      response.end(body.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch {
    if (!extname(requestPath)) {
      try { const body = await readFile(join(root, 'index.html')); response.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-cache' }); response.end(body); return; } catch {}
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found');
  }
});
server.listen(port, '0.0.0.0', () => console.log(`dancerly listening on http://0.0.0.0:${port}`));
