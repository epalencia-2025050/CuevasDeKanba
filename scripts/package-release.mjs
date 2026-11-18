// Source-only distribution. Do not use git archive: legacy tracked data contains secrets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'dist');
fs.mkdirSync(artifacts, { recursive: true });
const destination = fs.mkdtempSync(path.join(artifacts, 'kanba-source-'));
const manifest = [];
function copy(relative) {
  if (relative.replaceAll('\\', '/').startsWith('public/uploads')) return;
  const source = path.join(root, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('Symlinks are not permitted in a release.');
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(source)) copy(path.join(relative, child));
    return;
  }
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  if (sha256 !== crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')) throw new Error('Release copy mismatch.');
  manifest.push({ path: relative.replaceAll('\\', '/'), sha256 });
}
for (const entry of ['server', 'public', 'tests', 'package.json', 'package-lock.json', '.env.example', '.dev.vars.example', 'wrangler.toml',
  'scripts/initialize-database.mjs', 'scripts/rotate-admin.mjs', 'scripts/package-release.mjs',
  'docs/ARQUITECTURA-PORTABLE.md', 'docs/OPERACION-SEGURA.md']) copy(entry);
fs.writeFileSync(path.join(destination, 'release-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ destination, files: manifest.length, excludes: ['data', '.git', 'node_modules', 'public/uploads', 'admin-cookies.txt', 'real environment files'] }));
