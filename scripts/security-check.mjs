import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', '.npm', 'coverage']);
const forbiddenPathParts = ['Saved Sessions', 'previous working versions', 'latest release', 'full mode', 'slow mode', 'Test fast mode'];
const secretPatterns = [
  { name: 'OpenAI-style key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'GitHub token', pattern: /\bgh[opusr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Bearer token literal', pattern: /Authorization\s*[:=]\s*["'`]Bearer\s+[A-Za-z0-9._-]{20,}/gi },
];

const allowedTextExtensions = new Set([
  '.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.txt', '.yml', '.yaml', '.example', '.gitignore',
]);

const failures = [];

walk(root);

if (fs.existsSync(path.join(root, '.env'))) {
  failures.push('A real .env file exists in the repository working tree.');
}

if (failures.length) {
  console.error('Security check failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Security check passed: no forbidden legacy folders or obvious committed credentials were found.');

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);

    if (forbiddenPathParts.some((part) => relative.split(path.sep).includes(part))) {
      failures.push(`Forbidden legacy or research-data path found: ${relative}`);
      continue;
    }

    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }

    if (!entry.isFile()) continue;
    const extension = entry.name === '.gitignore' ? '.gitignore' : path.extname(entry.name).toLowerCase();
    if (!allowedTextExtensions.has(extension) && entry.name !== '.env.example') continue;

    const content = fs.readFileSync(absolute, 'utf8');
    for (const { name, pattern } of secretPatterns) {
      pattern.lastIndex = 0;
      const matches = [...content.matchAll(pattern)];
      for (const match of matches) {
        if (relative === 'scripts/security-check.mjs') continue;
        failures.push(`${name} detected in ${relative} near character ${match.index}.`);
      }
    }
  }
}
