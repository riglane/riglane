/**
 * Riglane — OpenCode hook shim.
 *
 * Written by `riglane init --opencode` / refreshed by `riglane update`. Auto-discovered
 * by OpenCode from `.opencode/plugins/` (no opencode.json entry needed).
 *
 * This file is a THIN SHIM: all gate/ledger/guard logic lives in the globally
 * installed `riglane` package, invoked as subprocess commands — upgrading Riglane
 * upgrades the behavior without editing this file. Do not edit it by hand —
 * `riglane update` overwrites it; put your own hooks in a separate plugin file.
 *
 * OpenCode loads config (and plugins) once at startup — after `riglane update`
 * changes this file, restart OpenCode.
 *
 * Hook wiring:
 *   - tool.execute.before (edit/write/apply_patch) → `riglane file-guard
 *     --host opencode`: engine-owned-file guard; deny → throw (blocks the
 *     tool call — `permission.ask` has no observed trigger site on 1.18.4).
 *   - tool.execute.after (every tool)  → `riglane tool-call-logger
 *     --host opencode`: one JSONL ledger event per call (the logger itself
 *     drops read-only built-ins and engine control-plane calls).
 *   - tool.execute.after (tool === "task") → `riglane gate-check --host opencode`:
 *     the SubagentStop equivalent. The gate verdict's followup_message is
 *     injected into the (mutable) task output, so the orchestrator sees it;
 *     the engine's step_collect_result then drives the retry protocol
 *     (in-session via task_id, or fresh spawn — engine-decided).
 *
 * Every hook is FAIL-OPEN: a shim/spawn failure must never block a tool call.
 * The engine-inline gate (step_collect_result) remains the safety net when
 * gate-check could not run here.
 */

import { spawn } from 'node:child_process';

// Shim version — `riglane update` refreshes this file on drift.
// ⚠ Deliberately NOT exported: OpenCode's plugin loader invokes EVERY export
// as a plugin factory, so a non-function export silently kills the whole
// module's hook registration (found live — the guard did not fire until this
// stopped being an export). Only the factory may be exported.
const RIGLANE_SHIM_VERSION = 5;
void RIGLANE_SHIM_VERSION;

// Task wall-clock timing (v5): tool.execute.before stamps the spawn instant
// per callID; the gate payload then carries a real duration_ms, so the trace
// viewer renders REAL subagent gantt bars instead of the phantom/approx
// fallback (the after-hook alone only knows the END instant). Process-local:
// an OpenCode restart mid-task loses the stamp → duration 0 → the viewer's
// approx fallback covers it gracefully.
const taskStartByCall = new Map<string, number>();

/** Tools whose targets the file-guard checks (write surface; bash is out of scope). */
const WRITE_TOOLS = new Set(['edit', 'write', 'apply_patch']);

// One loud line on the FIRST hook failure per OpenCode process — a missing /
// broken `riglane` binary is otherwise 100% silent (fail-open by design), and the
// engine's downstream symptom (empty ledger → "tool was not called" warnings)
// points the user at the wrong culprit.
let riglaneFailureWarned = false;
function warnRiglaneFailureOnce(detail: string): void {
  if (riglaneFailureWarned) return;
  riglaneFailureWarned = true;
  console.error(
    `[riglane-hooks] riglane subprocess failed (${detail}) — Riglane gate/ledger/guard hooks are ` +
      `inactive for this session. Is the 'riglane' package installed and on PATH?`,
  );
}

/**
 * Spawn an `riglane` subcommand with a JSON payload on stdin. Returns null on
 * spawn failure/timeout. Async (`spawn`, not `spawnSync`): the plugin runs
 * inside OpenCode's own process — a sync child would freeze the entire UI
 * event loop for the child's lifetime (up to the gate's validation polling).
 */
function runRiglane(
  cwd: string,
  args: string[],
  payload: unknown,
  timeoutMs: number,
): Promise<{ status: number | null; stdout: string; stderr: string } | null> {
  return new Promise((resolve) => {
    try {
      // shell: true resolves the npm `riglane.cmd` shim on Windows.
      // cwd: the session's project directory — the plugin runs inside the
      // serve/TUI process, whose own cwd may be a DIFFERENT directory (daemon
      // started from HOME, session opened via ?directory=). gate-check /
      // tool-call-logger / file-guard all resolve `.riglane` against their cwd, so
      // inheriting the serve cwd silently disables all three.
      const child = spawn('riglane', args, { shell: true, cwd, windowsHide: true });
      let out = '';
      let err = '';
      let settled = false;
      const finish = (v: { status: number | null; stdout: string; stderr: string } | null): void => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        warnRiglaneFailureOnce(`timeout after ${timeoutMs}ms: riglane ${args[0]}`);
        finish(null);
      }, timeoutMs);
      child.stdout.setEncoding('utf-8');
      child.stderr.setEncoding('utf-8');
      child.stdout.on('data', (d: string) => {
        out += d;
      });
      child.stderr.on('data', (d: string) => {
        err += d;
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        warnRiglaneFailureOnce(`spawn error: ${e.message}`);
        finish(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        finish({ status: code, stdout: out, stderr: err });
      });
      // EPIPE if the child dies before consuming stdin — never throw from a hook.
      child.stdin.on('error', () => {});
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (e) {
      warnRiglaneFailureOnce(`spawn threw: ${e instanceof Error ? e.message : String(e)}`);
      resolve(null);
    }
  });
}

/** First JSON object parsed from a CLI's stdout (tolerates stray log lines). */
function parseJsonLine(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

/** Extract the child session id from a task result (`<task id="ses_…"`). */
function childSessionId(output: unknown): string | null {
  const m = /<task id="(ses_[A-Za-z0-9]+)"/.exec(String(output ?? ''));
  return m?.[1] ?? null;
}

export const RiglaneHooks = async (ctx?: { directory?: string; worktree?: string }) => {
  // The plugin factory input carries the per-instance project directory —
  // the ONLY reliable project root when serve/TUI was started elsewhere.
  const projectDir = ctx?.directory || ctx?.worktree || process.cwd();
  return {
    'tool.execute.before': async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ) => {
      // v5: stamp the task spawn instant (see taskStartByCall above).
      if (input.tool === 'task') taskStartByCall.set(input.callID, Date.now());
      if (!WRITE_TOOLS.has(input.tool)) return;
      // file-guard consumes the args verbatim as tool_input (it knows the
      // OpenCode arg shapes: camelCase filePath, apply_patch patchText).
      const r = await runRiglane(projectDir, ['file-guard', '--host', 'opencode'], {
        tool_name: input.tool,
        tool_input: output.args ?? {},
      }, 20_000);
      if (r === null) return; // fail-open: guard unavailable ≠ block the tool
      if (r.status === 2) {
        const verdict = parseJsonLine(r.stdout);
        const reason =
          (verdict?.reason as string | undefined) ||
          r.stderr.trim() ||
          'Blocked by Riglane file-guard (engine-owned file).';
        // throw = the only blocking channel on OpenCode (before-hook contract).
        throw new Error(reason);
      }
    },

    'tool.execute.after': async (
      input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
      output: { title?: string; output: unknown; metadata?: Record<string, unknown> },
    ) => {
      const args = input.args ?? {};

      // 1) Tool-call ledger — every call; the logger drops noise itself.
      //    Best-effort: a logger failure never affects the call. Awaited so a
      //    task's ledger line lands before the gate below reads the run state.
      await runRiglane(projectDir, ['tool-call-logger', '--host', 'opencode'], {
        tool_name: input.tool,
        tool_input: args,
        tool_response: String(output.output ?? '').slice(0, 4000),
        agent_id: input.sessionID,
        conversation_id: input.sessionID,
      }, 15_000);

      // 2) Structural gate — SubagentStop equivalent: fires when a subagent
      //    (task call) finishes. gate-check resolves the run (RIGLANE_RUN_ID env /
      //    scan) and the step (manifest cursor) itself; with no active run it
      //    is fail-open. Generous timeout: validation may poll for late file
      //    flushes (RIGLANE_GATE_FILE_WAIT_MS class).
      if (input.tool !== 'task') return;
      // 300s: the gate's missing-output wait-poll (RIGLANE_GATE_FILE_WAIT_MS,
      // default 30s) applies PER missing required output — a genuinely failed
      // multi-output step can poll for minutes, and killing the gate exactly
      // when it has a failure to report silently drops the retry protocol.
      // Async spawn → the long wait no longer blocks the OpenCode UI.
      const taskStartedAt = taskStartByCall.get(input.callID);
      taskStartByCall.delete(input.callID);
      const gate = await runRiglane(projectDir, ['gate-check', '--host', 'opencode'], {
        task: (args.prompt as string | undefined) ?? '',
        agent_type: (args.subagent_type as string | undefined) ?? '',
        subagent_id: childSessionId(output.output) ?? input.callID,
        status: 'completed',
        // v5: real wall-clock duration (before→after) — feeds the trace
        // viewer's subagent gantt (0 = unknown → approx fallback).
        duration_ms: taskStartedAt ? Date.now() - taskStartedAt : 0,
        last_assistant_message: String(output.output ?? '').slice(0, 20_000),
      }, 300_000);
      if (gate === null) return; // fail-open: engine-inline gate is the net
      const verdict = parseJsonLine(gate.stdout);
      const followup = verdict?.followup_message as string | undefined;
      if (followup) {
        // Mutable task output → the orchestrator sees the gate feedback
        // verbatim. Prepended so it cannot be truncated away.
        output.output = `[Riglane STRUCTURAL GATE]\n${followup}\n\n${String(output.output ?? '')}`;
      }
    },
  };
};
