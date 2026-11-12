// Static build for hosts like Vercel: copies the site into dist/ (server.js is only for local dev).
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { buildSitemap } from './sitemap.js';

const files = ['index.html', 'landing.css', 'landing.js', 'landing-ko.js', 'terms.html', 'privacy.html', 'legal.css', 'legal.js', 'logo-wordmark.png', 'favicon.png', 'apple-touch-icon.png', 'icon-512.png', 'og-image.png', 'logo.svg'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await Promise.all(files.map((file) => cp(file, `dist/${file}`)));
await cp('app', 'dist/app', { recursive: true });
await cp('public', 'dist', { recursive: true });
await writeFile('dist/sitemap.xml', await buildSitemap());
// The deployed version: the app compares it with the one it started with (app/update.js).
await writeFile('dist/version.json', JSON.stringify({ v: process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now()) }));
console.log(`Built ${files.length} files and the app/ folder into dist/`);
