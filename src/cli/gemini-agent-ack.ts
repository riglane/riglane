
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export function geminiAgentAckPath(homeDir: string = homedir()): string {
  return join(homeDir, '.gemini', 'acknowledgments', 'agents.json');
}

export function geminiAgentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export interface GeminiAckOptions {
  readonly dryRun?: boolean;
  readonly homeDir?: string;
}

export function ackGeminiAgents(projectRoot: string, opts: GeminiAckOptions = {}): string[] {
  const dryRun = Boolean(opts.dryRun);
  const agentsDir = join(projectRoot, '.gemini', 'agents');
  let entries: string[];
  try {
    entries = readdirSync(agentsDir).filter((n) => n.startsWith('riglane-') && n.endsWith('.md'));
  } catch {
    return [];
  }
  if (entries.length === 0) return [];

  const rootKey = resolve(projectRoot);

  const acked: string[] = [];
  const agentHashes: Record<string, string> = {};
  for (const name of entries) {
    let content: string;
    try {
      const p = join(agentsDir, name);
      if (!statSync(p).isFile()) continue;
      content = readFileSync(p, 'utf-8');
    } catch {
      continue;
    }
    const agentName = name.slice(0, -'.md'.length);
    agentHashes[agentName] = geminiAgentHash(content);
    acked.push(agentName);
  }
  if (acked.length === 0) return [];
  if (dryRun) return acked.sort();

  const storePath = geminiAgentAckPath(opts.homeDir);
  let store: Record<string, unknown> = {};
  try {
    if (existsSync(storePath)) {
      const parsed = JSON.parse(readFileSync(storePath, 'utf-8'));
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        store = parsed as Record<string, unknown>;
      }
    }
  } catch {
    process.stderr.write(
      `WARN  ${storePath} is not valid JSON — skipping agent auto-acknowledgment ` +
        `(un-acked agents are silently absent in headless runs; run riglane doctor).\n`,
    );
    return [];
  }

  const projectEntry =
    typeof store[rootKey] === 'object' && store[rootKey] !== null && !Array.isArray(store[rootKey])
      ? (store[rootKey] as Record<string, unknown>)
      : {};
  let changed = false;
  for (const [name, hash] of Object.entries(agentHashes)) {
    if (projectEntry[name] !== hash) {
      projectEntry[name] = hash;
      changed = true;
    }
  }
  if (!changed) return acked.sort();
  store[rootKey] = projectEntry;

  try {
    mkdirSync(dirname(storePath), { recursive: true });
    const tmp = `${storePath}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
    renameSync(tmp, storePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `WARN  failed to write ${storePath}: ${msg} — un-acked agents are silently ` +
        `absent in headless runs; run riglane doctor.\n`,
    );
    return [];
  }
  return acked.sort();
}

export function checkGeminiAgentAcks(projectRoot: string, homeDir: string = homedir()): string[] {
  const agentsDir = join(projectRoot, '.gemini', 'agents');
  let entries: string[];
  try {
    entries = readdirSync(agentsDir).filter((n) => n.startsWith('riglane-') && n.endsWith('.md'));
  } catch {
    return [];
  }
  if (entries.length === 0) return [];

  let store: Record<string, unknown> = {};
  try {
    const storePath = geminiAgentAckPath(homeDir);
    if (existsSync(storePath)) {
      const parsed = JSON.parse(readFileSync(storePath, 'utf-8'));
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        store = parsed as Record<string, unknown>;
      }
    }
  } catch {
  }
  const projectEntry = (store[resolve(projectRoot)] as Record<string, unknown> | undefined) ?? {};

  const drifted: string[] = [];
  for (const name of entries) {
    let content: string;
    try {
      content = readFileSync(join(agentsDir, name), 'utf-8');
    } catch {
      continue;
    }
    const agentName = name.slice(0, -'.md'.length);
    if (projectEntry[agentName] !== geminiAgentHash(content)) drifted.push(agentName);
  }
  return drifted.sort();
}
