
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { configDir } from '../config/config.js';

export const MAX_UI_PREFS_BYTES = 64 * 1024;

const ALLOWED = new Set([
  'section',
  'sidebarCollapsed',
  'panelCollapsed',
  'panelHeld',
  'panelWidth',
  'dismissedHints',
  'theme',
]);

export interface UiPrefs {
  readonly [key: string]: unknown;
}

export function uiPrefsPath(): string {
  return join(configDir(), 'studio-ui.json');
}

export function readUiPrefs(): UiPrefs {
  try {
    const p = uiPrefsPath();
    if (!existsSync(p)) return {};
    const raw: unknown = JSON.parse(readFileSync(p, 'utf-8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    return sanitize(raw as Record<string, unknown>);
  } catch {
    return {};
  }
}

export function writeUiPrefs(patch: Record<string, unknown>): UiPrefs | null {
  const merged = { ...readUiPrefs(), ...sanitize(patch) };
  try {
    const dir = configDir();
    mkdirSync(dir, { recursive: true });
    const target = uiPrefsPath();
    const content = `${JSON.stringify(merged, null, 2)}\n`;
    const tmp = `${target}.tmp.${process.pid}`;
    writeFileSync(tmp, content, 'utf-8');
    try {
      renameSync(tmp, target);
    } catch {
      let done = false;
      for (let i = 0; i < 3 && !done; i += 1) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
        try {
          renameSync(tmp, target);
          done = true;
        } catch {
        }
      }
      if (!done) writeFileSync(target, content, 'utf-8');
    }
    return merged;
  } catch {
    return null;
  }
}

function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED.has(k)) continue;
    if (k === 'dismissedHints') {
      if (!Array.isArray(v)) continue;
      const ids = v
        .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80)
        .slice(0, 200);
      out[k] = ids;
      continue;
    }
    if (k === 'panelWidth') {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[k] = Math.min(Math.max(Math.round(v), 220), 1200);
      continue;
    }
    if (k === 'section' || k === 'theme') {
      if (typeof v !== 'string' || v.length > 40) continue;
      out[k] = v;
      continue;
    }
    if (typeof v !== 'boolean') continue;
    out[k] = v;
  }
  return out;
}
