
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let moduleReal: string;
try {
  moduleReal = realpathSync(fileURLToPath(import.meta.url));
} catch {
  moduleReal = fileURLToPath(import.meta.url);
}
const INSTRUCTIONS_ROOT = join(dirname(moduleReal), '..', 'instructions');

const cache = new Map<string, string>();
const metaCache = new Map<string, Readonly<Record<string, string>>>();

function splitFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  if (!raw.startsWith('---\n')) return { meta: {}, body: raw };
  const close = raw.indexOf('\n---\n', 4);
  if (close === -1) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of raw.slice(4, close).split('\n')) {
    const sep = line.indexOf(':');
    if (sep > 0) meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  return { meta, body: raw.slice(close + 5) };
}

function load(id: string): string {
  let text = cache.get(id);
  if (text === undefined) {
    const file = join(INSTRUCTIONS_ROOT, `${id}.md`);
    let raw: string;
    try {
      raw = readFileSync(file, 'utf-8');
    } catch (err) {
      throw new Error(
        `instruction '${id}' not found (${file}): ${(err as Error).message}`,
      );
    }
    const { meta, body } = splitFrontmatter(raw.replace(/\r\n/g, '\n'));
    text = body.endsWith('\n') ? body.slice(0, -1) : body;
    cache.set(id, text);
    metaCache.set(id, meta);
  }
  return text;
}

export function instruction(
  id: string,
  vars?: Readonly<Record<string, string>>,
): string {
  let text = load(id);
  const tokens = new Set<string>();
  for (const m of text.matchAll(/\{\{([a-zA-Z0-9_-]+)\}\}/g)) tokens.add(m[1] as string);
  if (vars) {
    for (const name of Object.keys(vars)) {
      if (!tokens.has(name)) {
        throw new Error(
          `instruction '${id}': placeholder {{${name}}} is not present in the text (renamed or removed?)`,
        );
      }
    }
  }
  for (const name of tokens) {
    const value = vars?.[name];
    if (value === undefined) {
      throw new Error(`instruction '${id}': unresolved placeholder {{${name}}}`);
    }
    text = text.split(`{{${name}}}`).join(value);
  }
  return text;
}

export function instructionsRoot(): string {
  return INSTRUCTIONS_ROOT;
}

export function instructionMeta(id: string): Readonly<Record<string, string>> {
  load(id);
  return metaCache.get(id) ?? {};
}
