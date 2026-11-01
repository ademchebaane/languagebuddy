import { mkdir, copyFile, rm } from 'node:fs/promises';

const files = ['index.html', 'styles.css', 'app.js', 'vocab.js', 'icon.svg'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of files) await copyFile(file, `dist/${file}`);
console.log(`LanguageBuddy web assets prepared (${files.length} files).`);
