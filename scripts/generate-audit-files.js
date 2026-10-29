import { execSync } from 'child_process';
import fs from 'fs';

function getGitShow(path) {
  return execSync(`git show HEAD:"${path}"`, { maxBuffer: 15 * 1024 * 1024 }).toString('utf8');
}

function getExt(filePath) {
  if (filePath.endsWith('.ts')) return 'typescript';
  if (filePath.endsWith('.js')) return 'javascript';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) return 'yaml';
  if (filePath.endsWith('.html')) return 'html';
  if (filePath.endsWith('Dockerfile')) return 'dockerfile';
  return '';
}

function formatFileSection(filePath) {
  const content = getGitShow(filePath);
  const lang = getExt(filePath);
  return `### FILE: ${filePath}\n\n\`\`\`${lang}\n${content.trimEnd()}\n\`\`\`\n\n`;
}

// 1. Priority 1 files
const p1Files = [
  'src/app.ts',
  'src/routes/eventRoutes.ts',
  'src/routes/aiRoutes.ts',
  'src/services/eventService.ts',
  'src/services/budgetService.ts',
  'src/services/vendorService.ts',
  'src/services/planService.ts',
  'src/services/aiService.ts',
  'src/services/authService.ts',
  'src/middleware/auth.ts',
  'src/db/database.ts',
];

// 2. Priority 2 files
const p2Files = [
  'src/schemas/index.ts',
  'src/ai/groqProvider.ts',
  'src/ai/provider.ts',
  'src/domain/aiNormalizer.ts',
  'src/domain/budget.ts',
  'src/domain/timeline.ts',
  'src/domain/vendors.ts',
  'src/shared/config.ts',
  'src/shared/errors.ts',
  'src/shared/logger.ts',
];

// 3. Priority 3 files
const p3JsFiles = [
  'public/js/app.js',
  'public/js/auth.js',
  'public/js/events.js',
  'public/js/budget.js',
  'public/js/timeline.js',
  'public/js/vendors.js',
  'public/js/ideas.js',
  'public/js/ai.js',
  'public/js/api.js',
  'public/js/dom.js',
];

const configFiles = [
  'tsconfig.json',
  'vitest.config.ts',
  '.github/workflows/ci.yml',
  'Dockerfile',
];

// Extract head & script tags from public/index.html
const indexHtml = getGitShow('public/index.html');
const headMatch = indexHtml.match(/<head>[\s\S]*?<\/head>/i);
const scriptMatches = indexHtml.match(/<script[\s\S]*?<\/script>/gi);
const headAndScripts =
  (headMatch ? headMatch[0] : '') + '\n\n' + (scriptMatches ? scriptMatches.join('\n') : '');

// Size of styles.css
const cssStats = fs.statSync('public/css/styles.css');
const cssSizeKb = (cssStats.size / 1024).toFixed(2);

// Test names from vitest
console.log('Running vitest to extract test names...');
const vitestOutput = execSync('npx vitest run --reporter=verbose', {
  env: { ...process.env, NO_COLOR: '1' },
}).toString('utf8');

const testNames = vitestOutput
  .split('\n')
  .filter((l) => l.includes('✓'))
  .map((l) => l.replace(/\s*\d+ms\s*$/, '').trim())
  .filter(Boolean)
  .join('\n');

let p1Content = '# Priority 1 (Needed for the Plan)\n\n';
for (const f of p1Files) {
  p1Content += formatFileSection(f);
}

let p2Content = '# Priority 2\n\n';
for (const f of p2Files) {
  p2Content += formatFileSection(f);
}

let p3Content = '# Priority 3 (Frontend Efficiency & Configuration)\n\n';
for (const f of p3JsFiles) {
  p3Content += formatFileSection(f);
}

p3Content += `### FILE: public/index.html (<head> and <script> tags only)\n\n\`\`\`html\n${headAndScripts}\n\`\`\`\n\n`;
p3Content += `### CSS Asset Size\n\n- File: \`public/css/styles.css\`\n- Size: **${cssSizeKb} KB** (${cssStats.size} bytes)\n\n`;

p3Content += '# Configuration Files\n\n';
for (const f of configFiles) {
  p3Content += formatFileSection(f);
}

p3Content += `# Test Names Only (from npx vitest run --reporter=verbose)\n\n\`\`\`\n${testNames}\n\`\`\`\n`;

fs.writeFileSync('audit-priority-1-and-3.md', p1Content + '\n---\n\n' + p3Content, 'utf8');
fs.writeFileSync('audit-priority-2.md', p2Content, 'utf8');
fs.writeFileSync(
  'audit-all-priorities.md',
  p1Content + '\n---\n\n' + p2Content + '\n---\n\n' + p3Content,
  'utf8',
);

console.log('✅ Generated audit-priority-1-and-3.md, audit-priority-2.md, and audit-all-priorities.md');

