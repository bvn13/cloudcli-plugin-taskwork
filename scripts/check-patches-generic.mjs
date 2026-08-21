// The three upstream patches must carry no trace of this plugin's domain:
// each one has to stand on its own as a generic host feature (SPEC-v3 §16.6).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'patches');

const FORBIDDEN = [/\btaskwork\b/i, /\btask[ -]work\b/i, /\btasks?\b/i, /\battachments?\b/i];

if (!fs.existsSync(dir)) {
  console.log('no patches/ directory — nothing to check');
  process.exit(0);
}

let failed = false;

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.patch')).sort()) {
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');

  lines.forEach((line, index) => {
    // Only inspect what the patch actually adds, plus its subject lines.
    const isAddition = line.startsWith('+') && !line.startsWith('+++');
    const isSubject = line.startsWith('Subject:');
    if (!isAddition && !isSubject) return;

    for (const pattern of FORBIDDEN) {
      if (pattern.test(line)) {
        console.error(`${file}:${index + 1}: domain wording ${pattern} in "${line.trim()}"`);
        failed = true;
      }
    }
  });

  if (!failed) console.log(`ok ${file}`);
}

process.exit(failed ? 1 : 0);
