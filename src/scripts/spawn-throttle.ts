
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { PRODUCT_DIR } from '../config/paths.js';
import { resolveProjectRoot } from '../engine/project-root.js';
import { findStepConfig } from '../engine/workflow-tree.js';
import { loadYaml } from '../engine/schema-validate.js';

interface SpawnThrottleState {
  first_spawn_time?: number;
}

function logStderr(msg: string): void {
  process.stderr.write(`[spawn-throttle] ${msg}\n`);
}

function findWorkflowRuntimeDir(): string | null {
  const runsDir = join(resolveProjectRoot() ?? '.', PRODUCT_DIR, 'local', 'workflow_runs');
  if (!existsSync(runsDir)) return null;
  try {
    if (!statSync(runsDir).isDirectory()) return null;
  } catch {
    return null;
  }

  let bestDir: string | null = null;
  let bestTime = '';

  let entries: string[];
  try {
    entries = readdirSync(runsDir);
  } catch {
    return null;
  }

  for (const runId of entries) {
    if (runId === 'index.jsonl') continue;
    const manifestPath = join(runsDir, runId, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const fst = statSync(manifestPath);
      if (!fst.isFile()) continue;
    } catch {
      continue;
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const status = data.status;
    if (status !== 'in_progress' && status !== 'paused') continue;
    const updated = typeof data.updated_at === 'string' ? data.updated_at : '';
    if (updated > bestTime) {
      bestTime = updated;
      bestDir = join(runsDir, runId);
    }
  }
  return bestDir;
}

function findWorkflowYaml(workflowName: string): string | null {
  const root = resolveProjectRoot() ?? '.';
  const candidates = [
    join(root, PRODUCT_DIR, 'workflows', 'templates', 'my_workflows', workflowName, 'workflow.yaml'),
    join(root, PRODUCT_DIR, 'workflows', 'templates', 'predefined', workflowName, 'workflow.yaml'),
    join(root, PRODUCT_DIR, 'workflows', 'templates', 'examples', workflowName, 'workflow.yaml'),
    join(root, PRODUCT_DIR, 'workflows', 'templates', 'community', workflowName, 'workflow.yaml'),
    join(root, PRODUCT_DIR, 'workflows', workflowName, 'workflow.yaml'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        if (statSync(c).isFile()) return c;
      } catch {
      }
    }
  }
  return null;
}

function loadStepConfig(
  runtimeDir: string,
): { wfConfig: Record<string, unknown>; stepConfig: Record<string, unknown> } | null {
  const manifestPath = join(runtimeDir, 'manifest.json');
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  let stepName = manifest.current_step;
  const activeLanes = Array.isArray(manifest.active_lanes)
    ? (manifest.active_lanes as string[])
    : [];
  if (activeLanes.length > 0) {
    const stepsMap = (manifest.steps ?? {}) as Record<string, Record<string, unknown>>;
    const laneCursors: string[] = [];
    for (const fork of activeLanes) {
      const lanes = (stepsMap[fork]?.lane_state as
        | { lanes?: Record<string, { cursor?: string | null; status?: string }> }
        | undefined)?.lanes ?? {};
      for (const entry of Object.values(lanes)) {
        if (entry.status === 'completed') continue;
        if (typeof entry.cursor === 'string' && entry.cursor && !activeLanes.includes(entry.cursor)) {
          laneCursors.push(entry.cursor);
        }
      }
    }
    if (laneCursors.length > 0) stepName = laneCursors[0];
    if (laneCursors.length > 1) {
      const workflowNamePeek = (manifest.workflow as string | undefined) ?? '';
      const yamlPeek = findWorkflowYaml(workflowNamePeek);
      if (yamlPeek !== null) {
        try {
          const wfPeek = loadYaml(yamlPeek);
          if (wfPeek !== null && typeof wfPeek === 'object' && !Array.isArray(wfPeek)) {
            for (const cur of laneCursors) {
              const sc = findStepConfig(wfPeek as Record<string, unknown>, cur);
              if (sc !== null && sc.parallel === true) {
                stepName = cur;
                break;
              }
            }
          }
        } catch {
        }
      }
    }
  }
  if (typeof stepName !== 'string' || !stepName) return null;

  const workflowName = (manifest.workflow as string | undefined) ?? '';
  const yamlPath = findWorkflowYaml(workflowName);
  if (yamlPath === null) return null;

  let wf: unknown;
  try {
    wf = loadYaml(yamlPath);
  } catch {
    return null;
  }
  if (wf === null || typeof wf !== 'object' || Array.isArray(wf)) return null;
  const wfDict = wf as Record<string, unknown>;

  const stepConfig = findStepConfig(wfDict, stepName);
  if (stepConfig === null) return null;

  return { wfConfig: wfDict, stepConfig };
}

function resolveDelayMs(
  wfConfig: Record<string, unknown>,
  stepConfig: Record<string, unknown>,
): number {
  if (!stepConfig.parallel) return 0;

  const stepVal = stepConfig.parallel_spawn_delay_ms;
  if (typeof stepVal === 'number' && Number.isInteger(stepVal) && stepVal >= 0) {
    return stepVal;
  }

  const wfVal = wfConfig.parallel_spawn_delay_ms;
  if (typeof wfVal === 'number' && Number.isInteger(wfVal) && wfVal >= 0) {
    return wfVal;
  }

  return 0;
}

function safeStepFilename(stepName: string): string {
  return stepName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

function stateFilePath(runtimeDir: string, stepName: string): string {
  return join(runtimeDir, 'data', '.spawn-timestamps', `${safeStepFilename(stepName)}.json`);
}

function readState(path: string): SpawnThrottleState | null {
  if (!existsSync(path)) return {};
  try {
    if (!statSync(path).isFile()) return {};
  } catch {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SpawnThrottleState;
  } catch {
    return {};
  }
}

function writeState(path: string, data: SpawnThrottleState): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    try {
      renameSync(tmp, path);
    } catch (e) {
      if (!(e instanceof Error) || !('code' in e)) throw e;
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
      try {
        unlinkSync(tmp);
      } catch (e2) {
        if (!(e2 instanceof Error) || !('code' in e2)) throw e2;
      }
    }
    return true;
  } catch (e) {
    if (!(e instanceof Error) || !('code' in e)) throw e;
    return false;
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function drainStdin(): Promise<void> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (stdin.isTTY) {
      resolve();
      return;
    }
    const onData = (): void => {
    };
    const onEnd = (): void => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('error', onError);
      resolve();
    };
    const onError = (): void => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('error', onError);
      resolve();
    };
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onError);
    setTimeout(() => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('error', onError);
      resolve();
    }, 100);
  });
}

export async function runSpawnThrottle(
  drain: () => Promise<void> = drainStdin,
): Promise<number> {
  try {
    await drain();

    const runtimeDir = findWorkflowRuntimeDir();
    if (runtimeDir === null) return 0;

    const loaded = loadStepConfig(runtimeDir);
    if (loaded === null) return 0;
    const { wfConfig, stepConfig } = loaded;

    const delayMs = resolveDelayMs(wfConfig, stepConfig);
    if (delayMs <= 0) return 0;

    const manifestPath = join(runtimeDir, 'manifest.json');
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      return 0;
    }
    const stepName = manifest.current_step;
    if (typeof stepName !== 'string' || !stepName) return 0;

    const tsFile = stateFilePath(runtimeDir, stepName);
    let state = readState(tsFile);
    if (state === null) state = {};

    const firstSpawn = state.first_spawn_time;
    if (firstSpawn === undefined || firstSpawn === null) {
      writeState(tsFile, { first_spawn_time: Date.now() / 1000 });
      return 0;
    }

    const elapsedSeconds = Date.now() / 1000 - Number(firstSpawn);
    const delaySeconds = delayMs / 1000;
    if (elapsedSeconds < delaySeconds) {
      await sleepMs((delaySeconds - elapsedSeconds) * 1000);
    }
    return 0;
  } catch (e) {
    const name = e instanceof Error ? e.constructor.name : 'Error';
    const msg = e instanceof Error ? e.message : String(e);
    logStderr(`unexpected error: ${name}: ${msg}`);
    return 0;
  }
}
