#!/usr/bin/env node
/**
 * NFR-003 line count gate.
 * Ensures every source file and frontend module is <= 300 lines.
 */
import fs from 'fs';
import path from 'path';

let failed = false;
const MAX_LINES = 300;

function checkDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'coverage', '.git'].includes(entry.name)) {
        checkDirectory(fullPath);
      }
    } else if (/\.(ts|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').length;
      if (lines > MAX_LINES) {
        console.error(`❌ [NFR-003 VIOLATION] ${fullPath} has ${lines} lines (max allowed: ${MAX_LINES})`);
        failed = true;
      }
    }
  }
}

console.log('Checking source files for line count compliance (<= 300 lines)...');
checkDirectory('src');
checkDirectory('public/js');

if (failed) {
  console.error('\nLine count gate failed. Split oversized files into smaller modular units.');
  process.exit(1);
} else {
  console.log('✅ All source and client JS modules are <= 300 lines (NFR-003 compliant).');
}
