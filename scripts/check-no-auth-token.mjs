// D-3: the plugin never touches the host's auth token or its localStorage keys.
// The only localStorage key it may use is its own `taskwork:` namespace.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

let failed = false;

for (const file of walk(src)) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    const where = `${path.relative(root, file)}:${index + 1}`;

    if (/auth-token|authToken|Authorization/i.test(line)) {
      console.error(`${where}: refers to the host auth token — forbidden (D-3)`);
      failed = true;
    }

    const key = line.match(/localStorage\.\w+\(\s*['"]([^'"]+)['"]/);
    if (key && !key[1].startsWith('taskwork:')) {
      console.error(`${where}: localStorage key "${key[1]}" is outside the taskwork: namespace`);
      failed = true;
    }
  });
}

if (!failed) console.log('ok: no auth-token access, no foreign localStorage keys');
process.exit(failed ? 1 : 0);
