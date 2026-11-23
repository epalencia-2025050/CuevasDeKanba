import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const zipPath = path.resolve('dist/kanba-source-VCTn1r.zip');
const testExtractDir = path.resolve('dist/test-zip-extract');
const manifestPath = path.resolve('dist/kanba-source-VCTn1r/release-manifest.json');

if (!fs.existsSync(zipPath)) {
  console.error('ZIP file not found:', zipPath);
  process.exit(1);
}

const stats = fs.statSync(zipPath);
console.log(`ZIP path: ${zipPath}`);
console.log(`ZIP size: ${stats.size} bytes (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);

// Clean previous test extraction if exists
if (fs.existsSync(testExtractDir)) {
  fs.rmSync(testExtractDir, { recursive: true, force: true });
}
fs.mkdirSync(testExtractDir, { recursive: true });

// Extract using PowerShell Expand-Archive
console.log('Extracting ZIP for integrity verification...');
execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${testExtractDir}'"`);

// Read manifest
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Verify all files from manifest against extracted files
let mismatches = 0;
for (const entry of manifest) {
  const extractedFile = path.join(testExtractDir, entry.path);
  if (!fs.existsSync(extractedFile)) {
    console.error(`Missing file in ZIP: ${entry.path}`);
    mismatches++;
    continue;
  }
  const content = fs.readFileSync(extractedFile);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  if (hash !== entry.sha256) {
    console.error(`Hash mismatch in extracted file ${entry.path}`);
    mismatches++;
  }
}

if (mismatches > 0) {
  console.error(`ZIP validation failed with ${mismatches} mismatches.`);
  process.exit(1);
}

// Check total files in extracted dir
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

const extractedFiles = getAllFiles(testExtractDir);
console.log(`Total extracted files from ZIP: ${extractedFiles.length}`);

// Clean up test extraction dir
fs.rmSync(testExtractDir, { recursive: true, force: true });
console.log('Test extraction directory cleaned up.');
console.log('ZIP verification completed: 100% integrity match with release manifest.');
