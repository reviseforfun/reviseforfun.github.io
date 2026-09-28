import { mkdir, copyFile, rm } from 'node:fs/promises';
await rm('dist/public', { recursive: true, force: true });
await mkdir('dist/public', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'sw.js', 'manifest.webmanifest', 'logo.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'loader.mp4']) await copyFile(file, `dist/public/${file}`);
console.log('Frontend built in dist/public (only public assets are copied).');
