
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { ENV_AUTO_OPEN_TRACE_VIEWER, ENV_CATALOG_BASE_URL, ENV_GATE_FILE_WAIT_MS, ENV_INBOX_ASK_MAX_HOLD_MS, ENV_INBOX_WEBHOOK, PRODUCT_DIR } from './product.js';


export interface RiglaneConfig {
  engine: {
    gate_file_wait_ms: number;
    auto_open_trace_viewer: boolean;
    inbox_webhook_url: string;
    inbox_ask_max_hold_ms: number;
  };
  ui: {
    theme: 'dark' | 'light';
  };
  catalog: {
    base_url: string;
  };
  run: {
    skip_approvals: boolean;
  };
}


export const DEFAULTS: Readonly<RiglaneConfig> = {
  engine: {
    gate_file_wait_ms: 30000,
    auto_open_trace_viewer: true,
    inbox_webhook_url: '',
    inbox_ask_max_hold_ms: 1800000,
  },
  ui: {
    theme: 'dark',
  },
  catalog: {
    base_url: 'https://riglane.dev',
  },
  run: {
    skip_approvals: false,
  },
};


export interface SettingMeta {
  readonly key: string;
  readonly group: string;
  readonly label: string;
  readonly hint: string;
  readonly type: 'number' | 'boolean' | 'string';
  readonly envVar?: string;
  readonly default: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly string[];
}

export const SETTING_DEFS: readonly SettingMeta[] = [
  {
    key: 'ui.theme',
    group: 'UI',
    label: 'Theme',
    hint: 'Color theme for riglane ui. "dark" suits terminals with dark backgrounds; "light" suits terminals with light backgrounds.',
    type: 'string',
    default: DEFAULTS.ui.theme,
    options: ['dark', 'light'] as const,
  },
  {
    key: 'engine.gate_file_wait_ms',
    group: 'Engine',
    label: 'Gate file wait (ms)',
    hint: 'Max time (ms) to wait for output files after a workflow step completes. On some systems, files may not be immediately visible due to disk flush delays. Increase if steps fail with "missing output" despite the subagent writing them. Set to 0 to disable.',
    type: 'number',
    envVar: ENV_GATE_FILE_WAIT_MS,
    default: DEFAULTS.engine.gate_file_wait_ms,
    min: 0,
    max: 120000,
  },
  {
    key: 'engine.inbox_webhook_url',
    group: 'Engine',
    label: 'Inbox webhook URL',
    hint: 'When set, every human message an agent posts to the run inbox is also POSTed to this URL as JSON — a machine-readable channel for programs (bots, CI, notifiers), not browsers. Responses still come back through the Local API or the terminal. Empty = disabled.',
    type: 'string',
    envVar: ENV_INBOX_WEBHOOK,
    default: DEFAULTS.engine.inbox_webhook_url,
  },
  {
    key: 'engine.inbox_ask_max_hold_ms',
    group: 'Engine',
    label: 'Inbox ask max hold (ms)',
    hint: "How long a single inbox ask call stays open waiting for the human answer before returning 'pending' (the agent then resumes the hold with another call). The call returns the moment an answer arrives from any channel; this is only the per-call ceiling. Lower it if your host times out long MCP calls despite progress notifications.",
    type: 'number',
    envVar: ENV_INBOX_ASK_MAX_HOLD_MS,
    default: DEFAULTS.engine.inbox_ask_max_hold_ms,
    min: 10000,
    max: 7200000,
  },
  {
    key: 'engine.auto_open_trace_viewer',
    group: 'Engine',
    label: 'Auto-open trace viewer',
    hint: 'When a workflow run starts, automatically open the trace viewer in your default browser (served over localhost) and live-refresh it as the run progresses. On by default — the engine still skips launch automatically in headless/CI environments (no display). Set to false to disable.',
    type: 'boolean',
    envVar: ENV_AUTO_OPEN_TRACE_VIEWER,
    default: DEFAULTS.engine.auto_open_trace_viewer,
  },
  {
    key: 'run.skip_approvals',
    group: 'Run',
    label: 'Skip approvals (default)',
    hint: 'Default for the "skip approvals" toggle when launching a workflow via riglane run-workflow / riglane ui. When on, the agent is started with its one-shot bypass flag (Claude: --dangerously-skip-permissions; Cursor: --force; Codex: --dangerously-bypass-approvals-and-sandbox) so it does not prompt to approve every action. DANGEROUS: full auto-execution — and on Codex this also disables the sandbox. Per-invocation only (no global agent config is changed); each run can override this default. Off by default.',
    type: 'boolean',
    default: DEFAULTS.run.skip_approvals,
  },
  {
    key: 'catalog.base_url',
    group: 'Catalog',
    label: 'Catalog base URL',
    hint: 'Base URL the CLI resolves the public workflow catalog against (riglane add / search read <base>/catalog/v1/...). Point it at a mirror or a local server for testing. Trailing slashes are ignored.',
    type: 'string',
    envVar: ENV_CATALOG_BASE_URL,
    default: DEFAULTS.catalog.base_url,
  },
];


let homeMigrationDone = false;
function ensureHomeDirMigrated(newDir: string): void {
  if (homeMigrationDone) return;
  homeMigrationDone = true;
  try {
    if (existsSync(newDir)) return;
    for (const legacy of ['.acp', '.agent']) {
      const legacyDir = join(homedir(), legacy);
      if (!existsSync(legacyDir)) continue;
      renameSync(legacyDir, newDir);
      process.stderr.write(`[riglane] migrated home dir ~/${legacy} → ~/${PRODUCT_DIR}\n`);
      return;
    }
  } catch {
  }
}

export function configDir(): string {
  const dir = join(homedir(), PRODUCT_DIR);
  ensureHomeDirMigrated(dir);
  return dir;
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}


export function readConfigRaw(): Record<string, unknown> {
  try {
    const path = configPath();
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function resolve<T>(meta: SettingMeta): T {
  const raw = readConfigRaw();
  const parts = meta.key.split('.');
  let node: unknown = raw;
  for (const part of parts) {
    if (node !== null && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      node = undefined;
      break;
    }
  }
  if (node !== undefined && node !== null) {
    if (meta.type === 'number') return Number(node) as T;
    if (meta.type === 'boolean') return Boolean(node) as T;
    return node as T;
  }

  if (meta.envVar) {
    const envVal = process.env[meta.envVar];
    if (envVal !== undefined && envVal !== '') {
      if (meta.type === 'number') return Number(envVal) as T;
      if (meta.type === 'boolean') return (envVal === 'true' || envVal === '1') as T;
      return envVal as T;
    }
  }

  return meta.default as T;
}

export function gateFileWaitMs(): number {
  return resolve<number>(SETTING_DEFS.find((s) => s.key === 'engine.gate_file_wait_ms')!);
}

export function inboxWebhookUrl(): string {
  return resolve<string>(SETTING_DEFS.find((s) => s.key === 'engine.inbox_webhook_url')!);
}

export function inboxAskMaxHoldMs(): number {
  return resolve<number>(SETTING_DEFS.find((s) => s.key === 'engine.inbox_ask_max_hold_ms')!);
}

export function autoOpenTraceViewer(): boolean {
  return resolve<boolean>(SETTING_DEFS.find((s) => s.key === 'engine.auto_open_trace_viewer')!);
}

export function skipApprovalsDefault(): boolean {
  return resolve<boolean>(SETTING_DEFS.find((s) => s.key === 'run.skip_approvals')!);
}


export function writeSetting(key: string, value: unknown): void {
  const path = configPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const config = readConfigRaw();
  const parts = key.split('.');
  let node = config;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in node) || typeof node[part] !== 'object' || node[part] === null) {
      node[part] = {};
    }
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;

  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function resetSetting(key: string): void {
  const path = configPath();
  if (!existsSync(path)) return;

  const config = readConfigRaw();
  const parts = key.split('.');
  let node = config;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in node) || typeof node[part] !== 'object') return;
    node = node[part] as Record<string, unknown>;
  }
  delete node[parts[parts.length - 1]!];

  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function resetGroup(group?: string): void {
  const path = configPath();
  if (!existsSync(path)) return;

  if (!group) {
    writeFileSync(path, '{}\n', 'utf-8');
    return;
  }

  const config = readConfigRaw();
  const groupKey = group.toLowerCase();
  delete config[groupKey];
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function readAllSettings(): Array<SettingMeta & { value: unknown; isDefault: boolean }> {
  return SETTING_DEFS.map((meta) => {
    const value = resolve(meta);
    const isDefault = value === meta.default;
    return { ...meta, value, isDefault };
  });
}

export function catalogBaseUrl(): string {
  const raw = resolve<string>(SETTING_DEFS.find((s) => s.key === 'catalog.base_url')!);
  return raw.replace(/\/+$/, '');
}
