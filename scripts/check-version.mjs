// package.json.version and manifest.json.version must never drift apart:
// the host shows the manifest version, npm tooling shows the package one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

const pkg = read('package.json');
const manifest = read('manifest.json');

if (pkg.version !== manifest.version) {
  console.error(`version mismatch: package.json ${pkg.version} != manifest.json ${manifest.version}`);
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
  console.error(`version "${pkg.version}" is not semver`);
  process.exit(1);
}
