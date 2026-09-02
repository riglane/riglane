
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { templatesRoot } from '../cli/templates.js';

function walk(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(abs);
      } else if (ent.isFile()) {
        out.push(abs);
      }
    }
  }
  return out;
}

export function computeTemplatesHash(root: string = templatesRoot()): string {
  let files: string[];
  try {
    files = walk(root);
  } catch {
    return createHash('sha256').digest('hex');
  }
  const entries = files
    .map((abs) => {
      const rel = relative(root, abs).split(sep).join('/');
      try {
        const content = readFileSync(abs);
        const ch = createHash('sha256').update(content).digest('hex');
        return { rel, ch };
      } catch {
        return { rel, ch: '' };
      }
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const top = createHash('sha256');
  for (const e of entries) {
    top.update(e.rel);
    top.update('\n');
    top.update(e.ch);
    top.update('\n');
  }
  return top.digest('hex');
}

export function shortHash(h: string): string {
  return h.slice(0, 12);
}

export function templatesFingerprint(root: string = templatesRoot()): string {
  let files: string[];
  try {
    files = walk(root);
  } catch {
    return '0:0';
  }
  let size = 0;
  for (const f of files) {
    try {
      size += statSync(f).size;
    } catch {
    }
  }
  return `${files.length}:${size}`;
}
