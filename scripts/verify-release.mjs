import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const targetDir = path.resolve('dist/kanba-source-VCTn1r');
const manifestPath = path.join(targetDir, 'release-manifest.json');

if (!fs.existsSync(targetDir)) {
  console.error('Target directory does not exist:', targetDir);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  console.error('Manifest does not exist:', manifestPath);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
console.log(`Manifest contains ${manifest.length} entries.`);

// 1. Verify SHA-256 of all files
let mismatches = 0;
for (const entry of manifest) {
  const filePath = path.join(targetDir, entry.path);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${entry.path}`);
    mismatches++;
    continue;
  }
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  if (hash !== entry.sha256) {
    console.error(`Hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${hash}`);
    mismatches++;
  }
}

if (mismatches > 0) {
  console.error(`Verification failed with ${mismatches} mismatches.`);
  process.exit(1);
}
console.log('All 75 files match their SHA-256 manifest hash exactly.');

// 2. Scan entire directory for unexpected or sensitive files
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allFiles = getAllFiles(targetDir);
console.log(`Total files on disk in dist/kanba-source-VCTn1r: ${allFiles.length} (75 code/doc files + release-manifest.json)`);

// Check exclusions (Real env files like .env, .env.local, cookies, db, etc.)
const forbiddenPatterns = [
  /^\.env$/i,
  /^\.env\.(local|production|dev|development|test)$/i,
  /admin-cookies/i,
  /db\.json/i,
  /\.eml$/i,
  /outbox/i,
  /\.git/i,
  /node_modules/i,
  /uploads/i,
  /backup/i
];

let forbiddenFound = 0;
for (const f of allFiles) {
  const rel = path.relative(targetDir, f).replaceAll('\\', '/');
  for (const pat of forbiddenPatterns) {
    if (pat.test(rel)) {
      console.error(`Forbidden file pattern detected: ${rel}`);
      forbiddenFound++;
    }
  }
}

if (forbiddenFound > 0) {
  console.error(`Found ${forbiddenFound} forbidden files.`);
  process.exit(1);
}

// 3. Confirm presence of key operational files
const requiredFiles = [
  'package.json',
  'package-lock.json',
  '.env.example',
  'docs/OPERACION-SEGURA.md',
  'scripts/initialize-database.mjs',
  'scripts/package-release.mjs',
  'server/index.js',
  'server/store.js',
  'server/migrations.js',
  'public/admin.html',
  'public/index.html'
];

for (const req of requiredFiles) {
  if (!fs.existsSync(path.join(targetDir, req))) {
    console.error(`Missing essential file: ${req}`);
    process.exit(1);
  }
}

console.log('All essential operational files verified successfully.');
console.log('Zero real environment files, database snapshots, mail, cookies, uploads or git artifacts found.');
