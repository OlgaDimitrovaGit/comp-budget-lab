// After vite build: copy the one-file page to the project root and fail on anything
// that would load from the network. Links the reader clicks (<a href>) are allowed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, '..', 'dist', 'index.html'), 'utf8');
const bad = [...html.matchAll(/<(script|link|img|iframe|source)\b[^>]*\b(src|href)=["']?(https?:)?\/\/[^"' >]+/gi)].map(m => m[0]);
const imports = [...html.matchAll(/@import\s+url\(["']?https?:[^)]+\)|url\(["']?https?:[^)]+\)/gi)].map(m => m[0]);
if (bad.length || imports.length) {
  console.error('External loads in the page:\n' + [...bad, ...imports].join('\n'));
  process.exit(1);
}
writeFileSync(join(HERE, '..', '..', 'index.html'), html);
console.log(`ok -> index.html (${(html.length / 1024).toFixed(0)} KB)`);
