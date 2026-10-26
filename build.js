// Static build for hosts like Vercel: copies the site into dist/ (server.js is only for local dev).
import { cp, mkdir, rm } from 'node:fs/promises';

const files = ['index.html', 'landing.css', 'landing.js', 'landing-ko.js', 'terms.html', 'privacy.html', 'legal.css', 'legal.js', 'logo-wordmark.png', 'favicon.png', 'apple-touch-icon.png', 'icon-512.png', 'workspace.html', 'workspace.js', 'workspace.css', 'logo.svg'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await Promise.all(files.map((file) => cp(file, `dist/${file}`)));
await cp('app', 'dist/app', { recursive: true });
await cp('public', 'dist', { recursive: true });
console.log(`Built ${files.length} files and the app/ folder into dist/`);
