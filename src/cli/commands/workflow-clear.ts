
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { type EnginePaths, defaultPaths, toolWorkflowFinalize } from '../../engine/workflow-engine.js';
import { isProcessAlive } from '../../engine/file-lock.js';
import { findRunsByWorkflow, runManifestPath } from '../../engine/runs.js';
import { setCurrentRunId } from '../../engine/run-context.js';

export interface WorkflowClearOptions {
  readonly finalize?: (name: string, paths: EnginePaths) => { status: string; run_id: string };
  readonly runId?: string;
}

export interface ClearResult {
  readonly name: string;
  readonly cleared: boolean;
  readonly reason: 'no-run' | 'not-in-progress' | 'owner-alive' | 'cleared' | 'unknown-run';
  readonly status?: string;
  readonly run_id?: string;
  readonly owner_pid?: number;
  readonly detail?: string;
}

export function clearWorkflowRun(
  name: string,
  target: string,
  options: WorkflowClearOptions = {},
): ClearResult {
  const paths = defaultPaths(resolve(target));
  const allRuns = findRunsByWorkflow(paths.agentDir, name);
  if (allRuns.length === 0) {
    return { name, cleared: false, reason: 'no-run' };
  }
  const inProgress = findRunsByWorkflow(paths.agentDir, name, 'in_progress');
  let runId: string;
  if (options.runId !== undefined && options.runId !== '') {
    if (!allRuns.includes(options.runId)) {
      return {
        name,
        cleared: false,
        reason: 'unknown-run',
        run_id: options.runId,
        detail: `no run '${options.runId}' of workflow '${name}' in this project`,
      };
    }
    if (!inProgress.includes(options.runId)) {
      let status = '';
      try {
        const m = JSON.parse(
          readFileSync(runManifestPath(paths.agentDir, options.runId), 'utf-8'),
        ) as { status?: string };
        status = typeof m.status === 'string' ? m.status : '';
      } catch {
        status = '';
      }
      return {
        name,
        cleared: false,
        reason: 'not-in-progress',
        run_id: options.runId,
        status,
      };
    }
    runId = options.runId;
  } else {
    if (inProgress.length === 0) {
      let status = '';
      try {
        const m = JSON.parse(
          readFileSync(runManifestPath(paths.agentDir, allRuns[allRuns.length - 1] as string), 'utf-8'),
        ) as { status?: string };
        status = typeof m.status === 'string' ? m.status : '';
      } catch {
        status = '';
      }
      return { name, cleared: false, reason: 'not-in-progress', status };
    }
    runId = inProgress[inProgress.length - 1] as string;
  }
  const manifestPath = runManifestPath(paths.agentDir, runId);

  {
    let ownerPid: number | undefined;
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
      ownerPid = typeof m.owner_pid === 'number' ? m.owner_pid : undefined;
    } catch {
      ownerPid = undefined;
    }
    if (ownerPid !== undefined && ownerPid !== process.pid && isProcessAlive(ownerPid)) {
      return { name, cleared: false, reason: 'owner-alive', run_id: runId, owner_pid: ownerPid };
    }
  }

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    if ('owner_instance_id' in raw || 'owner_pid' in raw) {
      delete raw.owner_instance_id;
      delete raw.owner_pid;
      writeFileSync(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
    }
  } catch {
  }

  setCurrentRunId(runId);

  const finalize =
    options.finalize ??
    ((n, p) => {
      const r = toolWorkflowFinalize({ name: n as never }, p);
      return { status: String(r.status), run_id: String(r.run_id) };
    });
  const r = finalize(name, paths);
  return { name, cleared: true, reason: 'cleared', status: r.status, run_id: r.run_id };
}

export async function runWorkflowClear(
  args: string[],
  options: WorkflowClearOptions = {},
): Promise<number> {
  const json = args.includes('--json');
  let runId: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--run') runId = args[++i];
    else if (a.startsWith('--run=')) runId = a.slice('--run='.length);
    else if (!a.startsWith('--')) positional.push(a);
  }
  const name = positional[0];
  const target = positional[1] ?? '.';
  if (!name) {
    process.stderr.write(
      'Usage: riglane workflow-clear <workflow-name> [target] [--run <run-id>] [--json]\n',
    );
    return 2;
  }

  const result = clearWorkflowRun(name, target, {
    ...options,
    ...(runId !== undefined && runId !== '' ? { runId } : {}),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.reason === 'owner-alive' || result.reason === 'unknown-run' ? 1 : 0;
  }
  if (result.reason === 'no-run') {
    process.stdout.write(`No run found for '${name}' — nothing to clear.\n`);
  } else if (result.reason === 'unknown-run') {
    process.stderr.write(
      `Refused: ${result.detail}. Nothing was cleared — a run id that does not resolve is ` +
        `never swapped for another run. Copy the id from the run list or the trace.\n`,
    );
    return 1;
  } else if (result.reason === 'not-in-progress') {
    process.stdout.write(
      result.run_id
        ? `Run ${result.run_id} is '${result.status || 'unknown'}', not in_progress — nothing to clear.\n`
        : `Run '${name}' is '${result.status || 'unknown'}', not in_progress — nothing to clear.\n`,
    );
  } else if (result.reason === 'owner-alive') {
    process.stderr.write(
      `Refused: run ${result.run_id} of '${name}' is owned by a LIVE orchestrator session ` +
        `(engine pid ${result.owner_pid}). workflow-clear releases STUCK runs (crashed / ` +
        `abandoned sessions, dead owner) — a live run is a healthy run, and clearing it ` +
        `would falsify its record.\n\n` +
        `ORCHESTRATOR DIRECTIVE: if you are an agent, do NOT retry this command and do NOT ` +
        `try to work around it — a run waiting at a gate or on a human answer is healthy. ` +
        `Report the situation to the user and STOP; run lifecycle is the user's decision.\n\n` +
        `USER REMEDIATION: to abort this run, stop its session first (close/Ctrl-C the ` +
        `harness — the engine process dies with it), then run workflow-clear again.\n`,
    );
    return 1;
  } else {
    process.stdout.write(
      `Cleared '${name}': finalized run ${result.run_id} as ${result.status} (lock released).\n`,
    );
  }
  return 0;
}
