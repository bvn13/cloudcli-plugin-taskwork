// Builds both halves of the plugin:
//   src/server + src/shared -> build/server, build/shared   (plain tsc output)
//   src/client + src/shared -> build/client/index.js        (single-file bundle)
//
// The host runs this via `npm run build` with a 60 s timeout and only after
// `npm install --ignore-scripts`. If that install skipped devDependencies (a
// host running with NODE_ENV=production does exactly that), TypeScript is not
// available — the committed build/ output is then used as-is instead of failing
// the installation (SPEC-v3 §13.1).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundle } from './bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = ['build/client/index.js', 'build/server/index.js'];

const run = (script) => execFileSync(process.execPath, [path.join(root, 'scripts', script)], { stdio: 'inherit' });
const tscPath = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

run('check-version.mjs');

if (!fs.existsSync(tscPath)) {
  const missing = artifacts.filter((f) => !fs.existsSync(path.join(root, f)));
  if (missing.length > 0) {
    console.error(`TypeScript is not installed and the committed build is incomplete: ${missing.join(', ')}`);
    console.error('Run `npm install` (with devDependencies) and build again.');
    process.exit(1);
  }
  console.warn('[taskwork] TypeScript not installed — keeping the committed build/ output.');
  process.exit(0);
}

const tsc = (project) => execFileSync(process.execPath, [tscPath, '-p', path.join(root, project)], { stdio: 'inherit' });

tsc('tsconfig.server.json');
tsc('tsconfig.client.json');

const clientEntry = path.join(root, 'build/.tsc-client/client/index.js');
const clientOut = path.join(root, 'build/client/index.js');

fs.mkdirSync(path.dirname(clientOut), { recursive: true });
fs.writeFileSync(clientOut, bundle(clientEntry));
// build/.tsc-client is kept (and gitignored): the frontend tests import the
// individual client modules from it, while the shipped artifact is the bundle.

for (const file of artifacts) {
  const size = fs.statSync(path.join(root, file)).size;
  console.log(`built ${file} (${(size / 1024).toFixed(1)} kB)`);
}
