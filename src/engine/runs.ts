
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isValidRunId } from './run-id.js';

export function runsRootDir(agentDir: string): string {
  return join(agentDir, 'local', 'workflow_runs');
}

export function runDir(agentDir: string, runId: string): string {
  if (!isValidRunId(runId)) {
    throw new Error(`Invalid run_id (unsafe as a path segment): ${JSON.stringify(runId)}`);
  }
  return join(runsRootDir(agentDir), runId);
}

export function runManifestPath(agentDir: string, runId: string): string {
  return join(runDir(agentDir, runId), 'manifest.json');
}

export function runTracePath(agentDir: string, runId: string): string {
  return join(runDir(agentDir, runId), 'trace.json');
}

export function runDataDir(agentDir: string, runId: string): string {
  return join(runDir(agentDir, runId), 'data');
}

export function runToolEventsPath(agentDir: string, runId: string): string {
  return join(runDir(agentDir, runId), 'tool-events.jsonl');
}

export function ensureRunDir(agentDir: string, runId: string): string {
  const dir = runDir(agentDir, runId);
  mkdirSync(runDataDir(agentDir, runId), { recursive: true });
  return dir;
}


export type RunEventKind = 'started' | 'finalized' | 'aborted';

export interface RunEvent {
  readonly run_id: string;
  readonly workflow: string;
  readonly event: RunEventKind;
  readonly status?: string;
  readonly at: string;
}

export function runIndexPath(agentDir: string): string {
  return join(runsRootDir(agentDir), 'index.jsonl');
}

export function appendRunEvent(agentDir: string, evt: RunEvent): void {
  try {
    mkdirSync(runsRootDir(agentDir), { recursive: true });
    appendFileSync(runIndexPath(agentDir), `${JSON.stringify(evt)}\n`, { encoding: 'utf-8' });
  } catch {
  }
}

export function findRunsByWorkflow(
  agentDir: string,
  workflowName: string,
  status?: string,
): string[] {
  const root = runsRootDir(agentDir);
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const m = JSON.parse(readFileSync(join(root, e.name, 'manifest.json'), 'utf-8')) as {
        workflow?: string;
        status?: string;
      };
      if (m.workflow !== workflowName) continue;
      if (status !== undefined && m.status !== status) continue;
      out.push(e.name);
    } catch {
    }
  }
  return out.sort();
}

export function findInProgressRuns(agentDir: string): string[] {
  const root = runsRootDir(agentDir);
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const m = JSON.parse(readFileSync(join(root, e.name, 'manifest.json'), 'utf-8')) as {
        status?: string;
      };
      if (m.status === 'in_progress') out.push(e.name);
    } catch {
    }
  }
  return out.sort();
}

export function readRunIndex(agentDir: string): RunEvent[] {
  const path = runIndexPath(agentDir);
  let raw: string;
  try {
    if (!statSync(path).isFile()) return [];
    raw = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const out: RunEvent[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RunEvent);
    } catch {
    }
  }
  return out;
}
