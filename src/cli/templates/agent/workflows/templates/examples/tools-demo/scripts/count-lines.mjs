#!/usr/bin/env node
/**
 * count-lines.mjs — example JS script tool for tools-demo.
 *
 * Demonstrates a co-located script tool written in JavaScript. The workflow
 * declares it as `command: "node .riglane/workflows/templates/examples/tools-demo/scripts/count-lines.mjs"`.
 * The workflow_tools loader spawns this with the tool's input_schema args as
 * --key=value flags (here: --file_path=<path>).
 *
 * Node is always available (riglane itself runs on it), so this needs no extra deps.
 * The .mjs extension pins ES-module mode regardless of the host project's
 * package.json "type", so the demo runs in any project.
 *
 * Input:  --file_path=<path>
 * Output: JSON on stdout — {"file": "...", "line_count": N, "char_count": N}
 */

import { readFileSync } from 'node:fs';

function main(argv) {
  let filePath = null;
  for (const arg of argv) {
    if (arg.startsWith('--file_path=')) filePath = arg.slice('--file_path='.length);
  }

  if (!filePath) {
    process.stdout.write(`${JSON.stringify({ error: 'Missing --file_path argument' })}\n`);
    return 1;
  }

  let text;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch (e) {
    const msg = e && e.code === 'ENOENT' ? `File not found: ${filePath}` : String(e?.message ?? e);
    process.stdout.write(`${JSON.stringify({ error: msg })}\n`);
    return 1;
  }

  // Count newline-delimited lines; ignore the trailing empty entry when the
  // file ends with a newline (so "a\nb\n" is 2 lines, not 3).
  const lines = text === '' ? [] : text.split(/\r?\n/);
  if (text.endsWith('\n') && lines[lines.length - 1] === '') lines.pop();

  process.stdout.write(
    `${JSON.stringify({ file: filePath, line_count: lines.length, char_count: text.length })}\n`,
  );
  return 0;
}

process.exit(main(process.argv.slice(2)));
