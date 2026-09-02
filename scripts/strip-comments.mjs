/**
 * strip-comments.mjs — remove comments from TS/JS sources IN A RELEASE STAGING
 * COPY (never run against the working tree; the private source keeps its
 * discussion-rich comments by design). Invoked as `node strip-comments.mjs` —
 * no shebang on purpose: the guard tests import this module, and a shebang
 * line breaks Vitest's transform of an inlined dependency.
 *
 * Guarantees by construction:
 *   - Comment ranges come from the TypeScript PARSER (ts.createSourceFile +
 *     getLeading/TrailingCommentRanges), not from text heuristics. A string or
 *     template literal — i.e. every agent-facing instruction the engine ships —
 *     is a string token and can never be classified as a comment. Regex
 *     literals are parsed correctly too (the classic tokenizer pitfall).
 *   - `src/cli/templates/**` is NEVER touched: template comments (workflow
 *     tutorial headers, config.toml.template guidance) are product content.
 *   - Directive comments survive via whitelist: triple-slash references,
 *     @ts-* pragmas, biome-ignore/eslint pragmas (the staged copy must still
 *     typecheck/build — the sync script verifies exactly that afterwards).
 *   - Whitespace repair is positional (line-local around the removed range),
 *     NEVER a whole-file regex — so string interiors cannot be reformatted.
 *
 * Usage: node strip-comments.mjs <dir> [...moreDirs]
 *   Processes .ts/.tsx/.mts/.cts/.js/.mjs/.cjs files recursively, in place.
 *   Prints a per-file summary and a total.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const EXCLUDE_SEGMENTS = [`${sep}cli${sep}templates${sep}`, `${sep}node_modules${sep}`, `${sep}.git${sep}`];

function isDirective(chunk) {
  return (
    chunk.startsWith('///') ||
    /@ts-(expect-error|ignore|nocheck|check)\b/.test(chunk) ||
    chunk.includes('biome-ignore') ||
    chunk.includes('eslint-')
  );
}

function scriptKindFor(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function collectCommentRanges(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const byPos = new Map();
  const add = (ranges) => {
    if (!ranges) return;
    for (const r of ranges) byPos.set(r.pos, r);
  };
  const walk = (node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()));
    add(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(sf)) walk(child);
  };
  walk(sf);
  add(ts.getLeadingCommentRanges(text, sf.endOfFileToken.getFullStart()));
  return [...byPos.values()].sort((a, b) => a.pos - b.pos);
}

function expandRange(text, pos, end) {
  let start = pos;
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
  const atLineStart = start === 0 || text[start - 1] === '\n';
  if (atLineStart) {
    let stop = end;
    if (text[stop] === '\r') stop++;
    if (text[stop] === '\n') stop++;
    if (stop > end || end >= text.length) return { start, stop };
    return { start, stop: end };
  }
  return { start, stop: end };
}

export function stripCommentsFromText(text, fileName) {
  const ranges = collectCommentRanges(text, fileName).filter(
    (r) => !isDirective(text.slice(r.pos, r.end)),
  );
  if (ranges.length === 0) return { text, removed: 0 };
  let out = '';
  let cursor = 0;
  for (const r of ranges) {
    if (r.pos < cursor) continue;
    const { start, stop } = expandRange(text, r.pos, r.end);
    out += text.slice(cursor, Math.max(cursor, start));
    cursor = stop;
  }
  out += text.slice(cursor);
  return { text: out, removed: ranges.length };
}

function stripFile(file) {
  const original = readFileSync(file, 'utf-8');
  const { text, removed } = stripCommentsFromText(original, file);
  if (removed === 0) return 0;
  writeFileSync(file, text, 'utf-8');
  return removed;
}

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (EXCLUDE_SEGMENTS.some((seg) => (p + sep).includes(seg))) continue;
    const st = statSync(p);
    if (st.isDirectory()) yield* walkFiles(p);
    else if (EXTS.has(p.slice(p.lastIndexOf('.')))) yield p;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('usage: strip-comments.mjs <dir> [...moreDirs]');
    process.exit(1);
  }
  let files = 0;
  let comments = 0;
  for (const dir of dirs) {
    for (const f of walkFiles(dir)) {
      const n = stripFile(f);
      if (n > 0) {
        files++;
        comments += n;
      }
    }
  }
  console.log(`strip-comments: removed ${comments} comment(s) across ${files} file(s)`);
}
