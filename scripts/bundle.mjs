// Concatenating ES-module bundler for the client entry.
//
// Why bundle at all: the host imports the client module from a Blob URL
// (PluginTabContent.tsx). A relative `import './store.js'` inside a blob:
// module has no resolvable base URL, so the browser throws. The client must
// therefore ship as exactly one file with no import statements left in it.
//
// Why hand-rolled: the plugin is installed with `npm install --ignore-scripts`
// and must build with no runtime and no bundler dependency (SPEC-v3 §3, §13.1).
//
// The input is tsc output over sources we control, so the accepted subset is
// deliberately narrow and every unsupported form is a hard error.

import fs from 'node:fs';
import path from 'node:path';

const IMPORT_RE = /^import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];?[ \t]*$/gm;
const EXPORT_KEYWORD_RE = /^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm;

const UNSUPPORTED = [
  [/^export\s+default\b/m, 'export default'],
  [/^export\s*\{/m, 'export { ... } list'],
  [/^export\s+\*/m, 'export *'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\bimport\.meta\b/, 'import.meta'],
];

/** Collect relative dependencies of one emitted module, in source order. */
function readModule(file) {
  const code = fs.readFileSync(file, 'utf8');
  const deps = [];

  for (const [pattern, label] of UNSUPPORTED) {
    if (pattern.test(code)) {
      throw new Error(`${file}: ${label} is not supported by the bundler`);
    }
  }

  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(code)) !== null) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) {
      throw new Error(`${file}: bare import "${specifier}" — the client must have no dependencies`);
    }
    deps.push(path.resolve(path.dirname(file), specifier));
  }

  return { code: code.replace(IMPORT_RE, '').trim(), deps };
}

/**
 * Bundle `entry` and everything it imports into a single ES module.
 * Only the entry keeps its `export` keywords; dependencies become plain
 * top-level declarations sharing one module scope.
 */
export function bundle(entry) {
  const entryPath = path.resolve(entry);
  const chunks = [];
  const state = new Map(); // file -> 'visiting' | 'done'

  const visit = (file, stack) => {
    const seen = state.get(file);
    if (seen === 'done') return;
    if (seen === 'visiting') {
      throw new Error(`import cycle: ${[...stack, file].map((f) => path.basename(f)).join(' -> ')}`);
    }
    if (!fs.existsSync(file)) {
      throw new Error(`missing module ${file} (imported by ${stack[stack.length - 1] ?? 'entry'})`);
    }

    state.set(file, 'visiting');
    const { code, deps } = readModule(file);
    for (const dep of deps) visit(dep, [...stack, file]);
    state.set(file, 'done');

    const isEntry = file === entryPath;
    const body = isEntry ? code : code.replace(EXPORT_KEYWORD_RE, '');
    chunks.push(`// ---- ${path.basename(file)} ----\n${body}`);
  };

  visit(entryPath, []);

  const banner = [
    '// Task Work plugin — generated bundle, do not edit.',
    '// Source: src/client/**, built by scripts/build.mjs.',
    '// SPDX-License-Identifier: AGPL-3.0-or-later',
  ].join('\n');

  return `${banner}\n\n${chunks.join('\n\n')}\n`;
}
