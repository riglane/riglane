#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const SRC = join(PROJECT_ROOT, 'src', 'cli', 'templates');
const DEST = join(PROJECT_ROOT, 'dist', 'cli', 'templates');

if (!existsSync(SRC)) {
  console.error(`copy-templates: source missing: ${SRC}`);
  process.exit(1);
}

mkdirSync(dirname(DEST), { recursive: true });
if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });

const EXCLUDED_REL = ['agent/docs'];
cpSync(SRC, DEST, {
  recursive: true,
  force: true,
  filter: (srcPath) => {
    const rel = srcPath.slice(SRC.length + 1).replace(/\\/g, '/');
    return !EXCLUDED_REL.some((p) => rel === p || rel.startsWith(`${p}/`));
  },
});

let count = 0;
function countFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) countFiles(full);
    else if (entry.isFile()) count += 1;
  }
}
countFiles(DEST);
const stats = statSync(DEST);
if (!stats.isDirectory() || count === 0) {
  console.error(`copy-templates: failed — ${DEST} is not a non-empty directory`);
  process.exit(1);
}
console.log(`copy-templates: copied ${count} files → ${DEST}`);

const INSTR_SRC = join(PROJECT_ROOT, 'src', 'instructions');
const INSTR_DEST = join(PROJECT_ROOT, 'dist', 'instructions');
if (!existsSync(INSTR_SRC)) {
  console.error(`copy-templates: source missing: ${INSTR_SRC}`);
  process.exit(1);
}
if (existsSync(INSTR_DEST)) rmSync(INSTR_DEST, { recursive: true, force: true });
cpSync(INSTR_SRC, INSTR_DEST, { recursive: true, force: true });
count = 0;
countFiles(INSTR_DEST);
if (count === 0) {
  console.error(`copy-templates: failed — ${INSTR_DEST} is empty`);
  process.exit(1);
}
console.log(`copy-templates: copied ${count} instruction files → ${INSTR_DEST}`);
