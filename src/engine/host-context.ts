
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRODUCT_DIR } from '../config/paths.js';
import type { Host } from '../types/enums.js';

export interface ClientInfo {
  readonly name?: string;
  readonly version?: string;
}

let clientName: string | null = null;
let clientVersion: string | null = null;

export function resolveHostFromClientName(name: string | null | undefined): Host | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('codex')) return 'codex';
  if (n.includes('claude')) return 'claude-code';
  if (n.includes('cursor')) return 'cursor';
  if (n.includes('opencode')) return 'opencode';
  if (n.includes('copilot')) return 'copilot';
  if (n.includes('gemini')) return 'gemini';
  return null;
}

export interface ClientHandshake {
  readonly protocolVersion?: string;
  readonly capabilities?: Record<string, unknown>;
}

export function recordEngineClient(
  clientInfo: ClientInfo | null | undefined,
  baseDir = '.',
  logger?: (msg: string) => void,
  handshake?: ClientHandshake,
): void {
  const name = typeof clientInfo?.name === 'string' ? clientInfo.name : null;
  clientName = name;
  clientVersion = typeof clientInfo?.version === 'string' ? clientInfo.version : null;
  const resolved = resolveHostFromClientName(name);
  const capKeys = handshake?.capabilities ? Object.keys(handshake.capabilities) : [];
  logger?.(
    `MCP client: name=${JSON.stringify(name)} ` +
      `version=${JSON.stringify(clientInfo?.version ?? null)} → host=${resolved ?? 'unknown'}` +
      (handshake
        ? ` | protocol=${JSON.stringify(handshake.protocolVersion ?? null)} capabilities=[${capKeys.join(', ')}]`
        : ''),
  );
  if (name === null) return;
  try {
    const dir = join(baseDir, PRODUCT_DIR, 'local');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'engine-client.json'),
      `${JSON.stringify(
        {
          name,
          version: clientInfo?.version ?? null,
          host: resolved,
          ...(handshake?.protocolVersion !== undefined
            ? { protocol_version: handshake.protocolVersion }
            : {}),
          ...(handshake?.capabilities !== undefined
            ? { capabilities: handshake.capabilities }
            : {}),
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
  } catch {
  }
}

export interface RecordedClient {
  readonly name: string;
  readonly version: string | null;
  readonly host: Host | null;
  readonly protocol_version?: string;
  readonly capabilities?: Record<string, unknown>;
}

export function readEngineClientSidecar(baseDir = '.'): RecordedClient | null {
  try {
    const raw = readFileSync(join(baseDir, PRODUCT_DIR, 'local', 'engine-client.json'), 'utf-8');
    const parsed = JSON.parse(raw) as RecordedClient;
    return typeof parsed?.name === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function recordedElicitation(rec: RecordedClient | null): boolean | null {
  if (rec === null || rec.capabilities === undefined) return null;
  return Object.hasOwn(rec.capabilities, 'elicitation');
}

export function getEngineClientName(): string | null {
  return clientName;
}

export function getEngineClientVersion(): string | null {
  return clientVersion;
}

export function getEngineHost(): Host | null {
  return resolveHostFromClientName(clientName);
}

export function _resetEngineClient(): void {
  clientName = null;
  clientVersion = null;
}

export function detectOrchestratorModel(host: Host | null, projectRoot: string): string | null {
  try {
    if (host === 'opencode') {
      const cfg = JSON.parse(
        readFileSync(join(projectRoot, '.opencode', 'opencode.json'), 'utf-8'),
      ) as { model?: unknown };
      return typeof cfg.model === 'string' && cfg.model.length > 0 ? cfg.model : null;
    }
    if (host === 'claude-code') {
      const cfg = JSON.parse(
        readFileSync(join(projectRoot, '.claude', 'settings.json'), 'utf-8'),
      ) as { model?: unknown };
      return typeof cfg.model === 'string' && cfg.model.length > 0 ? cfg.model : null;
    }
    if (host === 'codex') {
      const raw = readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf-8');
      const m = /^\s*model\s*=\s*"([^"]+)"/m.exec(raw);
      return m?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
