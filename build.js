// Static build for hosts like Vercel: copies the site into dist/ (server.js is only for local dev).
import { cp, mkdir, rm } from 'node:fs/promises';

const files = ['index.html', 'workspace.html', 'app.js', 'workspace.js', 'styles.css', 'workspace.css', 'logo.svg'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await Promise.all(files.map((file) => cp(file, `dist/${file}`)));
await cp('app', 'dist/app', { recursive: true });
await cp('public', 'dist', { recursive: true });
console.log(`Built ${files.length} files and the app/ folder into dist/`);
