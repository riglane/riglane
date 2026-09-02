
import { type SpawnSyncOptions, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { PRODUCT_DIR } from '../../config/paths.js';
import {
  ENV_ACTIVE_WORKFLOW,
  ENV_INBOX_WEBHOOK_OVERRIDE,
  ENV_MODEL_OVERRIDE,
  ENV_TRACE_VIEWER_OVERRIDE,
  ENV_RUN_ID,
  PRODUCT_NAME,
} from '../../config/product.js';
import { clearActiveWorkflow, writeActiveWorkflow } from '../../engine/active-workflow.js';
import { generateRunId, isValidRunId } from '../../engine/run-id.js';
import { loadYaml } from '../../engine/schema-validate.js';
import { defaultTemplatesDir, scanWorkflows } from '../../engine/workflow-tools-loader.js';
import { initWorkflowSync, WorkflowNotFoundError } from '../../scripts/init-workflow.js';
import { isModelMode, MODEL_MODES } from '../../types/workflow.js';

const PER_STEP_AGENT_TARGETS: ReadonlySet<string> = new Set([
  'claude',
  'claude-headless',
  'copilot',
  'copilot-headless',
  'opencode',
  'opencode-headless',
  'gemini',
  'gemini-headless',
]);

function regeneratePerStepSubagents(workflow: string, dir: string, modelOverride?: string): number {
  try {
    const res = initWorkflowSync(workflow, {
      cwd: dir,
      stdout: () => {},
      stderr: () => {},
      ...(modelOverride ? { modelOverride } : {}),
    });
    const changed = res.created.length + res.updated.length + res.deleted.length;
    if (changed > 0) {
      process.stderr.write(
        `[riglane] regenerated subagent files for '${workflow}': ` +
          `${res.created.length} created, ${res.updated.length} updated, ` +
          `${res.deleted.length} deleted\n`,
      );
    }
    return 0;
  } catch (e) {
    if (e instanceof WorkflowNotFoundError) return 0;
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `[riglane] run-workflow: failed to regenerate subagent files for '${workflow}': ${msg}\n` +
        `Fix workflow.yaml or run \`riglane init-workflow ${workflow}\` manually, then retry.\n`,
    );
    return 2;
  }
}

export const RUN_WORKFLOW_TARGETS: Record<string, readonly string[]> = {
  claude: ['claude'],
  'claude-headless': ['claude', '-p'],
  'cursor-agent': ['cursor-agent', '--approve-mcps'],
  'cursor-agent-headless': ['cursor-agent', '-p', '--force', '--approve-mcps'],
  codex: ['codex'],
  'codex-exec': ['codex', 'exec'],
  opencode: ['opencode', '--prompt'],
  'opencode-headless': ['opencode', 'run', '--command', `${PRODUCT_NAME}-run-workflow`],
  copilot: ['copilot', '-i'],
  'copilot-headless': ['copilot', '--no-remote-export', '-p'],
  gemini: ['gemini', '-i'],
  'gemini-headless': ['gemini', '-p'],
};

export const SKIP_APPROVALS_ARGS: Record<string, readonly string[]> = {
  claude: ['--dangerously-skip-permissions'],
  'claude-headless': ['--dangerously-skip-permissions'],
  'cursor-agent': ['--force'],
  'cursor-agent-headless': ['--force'],
  codex: ['--dangerously-bypass-approvals-and-sandbox'],
  'codex-exec': ['--dangerously-bypass-approvals-and-sandbox'],
  'opencode-headless': ['--auto'],
  copilot: ['--allow-all'],
  'copilot-headless': ['--allow-all'],
  gemini: ['--approval-mode', 'yolo'],
  'gemini-headless': ['--approval-mode', 'yolo'],
};

export const TARGET_SKILL_PREFIX: Record<string, '/' | '$' | '' | '/riglane:'> = {
  claude: '/',
  'claude-headless': '/',
  'cursor-agent': '/',
  'cursor-agent-headless': '/',
  codex: '$',
  opencode: '/',
  'opencode-headless': '',
  copilot: '/',
  'copilot-headless': '/',
  gemini: '/riglane:',
  'gemini-headless': '/riglane:',
};

export function skillPrefixForTarget(target: string): '/' | '$' | '' | '/riglane:' {
  return TARGET_SKILL_PREFIX[target] ?? '/';
}

export type SpawnFn = (
  file: string,
  args: string[],
  options: SpawnSyncOptions,
) => { status: number | null };

export interface RunWorkflowOptions {
  readonly spawn?: SpawnFn;
  readonly cwd?: string;
}

export interface ParsedRunWorkflowArgs {
  readonly target: string;
  readonly workflow: string;
  readonly dir: string;
  readonly passthrough: string[];
  readonly skipApprovals: boolean;
  readonly modelOverride?: string;
  readonly inboxWebhook?: string;
  readonly noTraceViewer: boolean;
  readonly resumeRunId?: string;
  readonly noSupervise: boolean;
  readonly forceMsysEnv: boolean;
}

export function parseRunWorkflowArgs(
  args: string[],
  baseCwd: string,
): ParsedRunWorkflowArgs | { error: string } {
  let target: string | undefined;
  let workflow: string | undefined;
  let dir: string | undefined;
  let skipApprovals = false;
  let noTraceViewer = false;
  let noSupervise = false;
  let forceMsysEnv = false;
  let modelOverride: string | undefined;
  let inboxWebhook: string | undefined;
  let resumeRunId: string | undefined;
  const passthrough: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const eat = (): string | undefined => args[++i];
    if (a === '--target') target = eat();
    else if (a.startsWith('--target=')) target = a.slice('--target='.length);
    else if (a === '--workflow') workflow = eat();
    else if (a.startsWith('--workflow=')) workflow = a.slice('--workflow='.length);
    else if (a === '--dir') dir = eat();
    else if (a.startsWith('--dir=')) dir = a.slice('--dir='.length);
    else if (a === '--model') modelOverride = eat();
    else if (a.startsWith('--model=')) modelOverride = a.slice('--model='.length);
    else if (a === '--inbox-webhook') inboxWebhook = eat();
    else if (a.startsWith('--inbox-webhook=')) inboxWebhook = a.slice('--inbox-webhook='.length);
    else if (a === '--resume') {
      passthrough.push(a);
      const next = args[i + 1];
      if (next !== undefined && isValidRunId(next)) {
        resumeRunId = next;
        passthrough.push(next);
        i += 1;
      }
    } else if (a.startsWith('--resume=')) {
      const v = a.slice('--resume='.length);
      if (isValidRunId(v)) {
        resumeRunId = v;
        passthrough.push('--resume', v);
      } else {
        passthrough.push(a);
      }
    }
    else if (a === '--skip-approvals') skipApprovals = true;
    else if (a === '--no-trace-viewer') noTraceViewer = true;
    else if (a === '--no-supervise') noSupervise = true;
    else if (a === '--force-msys-env') forceMsysEnv = true;
    else passthrough.push(a);
  }

  if (!target) return { error: 'Missing required --target' };
  if (!(target in RUN_WORKFLOW_TARGETS)) {
    return {
      error: `Unknown --target '${target}'. Valid: ${Object.keys(RUN_WORKFLOW_TARGETS).join(', ')}`,
    };
  }
  if (!workflow) return { error: 'Missing required --workflow' };
  if (target === 'copilot-headless' && !skipApprovals) {
    return {
      error:
        `--target copilot-headless requires --skip-approvals: non-interactive copilot ` +
        `cannot answer approval prompts, so the run only works with --allow-all. ` +
        `Pass --skip-approvals to consent, or use --target copilot (interactive).`,
    };
  }
  if (target === 'codex-exec' && !skipApprovals) {
    return {
      error:
        `--target codex-exec requires --skip-approvals: headless codex can only run ` +
        `the engine MCP tools with the sandbox off ` +
        `(--dangerously-bypass-approvals-and-sandbox). Use --target codex for an ` +
        `interactive run with the sandbox on.`,
    };
  }
  if (target === 'gemini-headless' && !skipApprovals) {
    return {
      error:
        `--target gemini-headless requires --skip-approvals: in non-interactive gemini ` +
        `every ask_user approval resolves to DENY, so the run only works under ` +
        `--approval-mode yolo. Pass --skip-approvals to consent, or use --target gemini ` +
        `(interactive).`,
    };
  }
  if (inboxWebhook !== undefined && inboxWebhook !== '' && !/^https?:\/\//.test(inboxWebhook)) {
    return {
      error: `Invalid --inbox-webhook '${inboxWebhook}'. It must be a full http(s) URL.`,
    };
  }
  if (modelOverride !== undefined && modelOverride !== '' && !isModelMode(modelOverride)) {
    return {
      error: `Invalid --model '${modelOverride}'. Valid values: ${MODEL_MODES.join(', ')}.`,
    };
  }

  return {
    target,
    workflow,
    dir: dir ?? baseCwd,
    passthrough,
    skipApprovals,
    noTraceViewer,
    noSupervise,
    forceMsysEnv,
    ...(modelOverride ? { modelOverride } : {}),
    ...(inboxWebhook ? { inboxWebhook } : {}),
    ...(resumeRunId ? { resumeRunId } : {}),
  };
}

export function workflowExists(dir: string, name: string): boolean {
  const templatesDir = defaultTemplatesDir(dir);
  for (const path of scanWorkflows(templatesDir)) {
    let wf: unknown;
    try {
      wf = loadYaml<unknown>(path);
    } catch {
      continue;
    }
    if (typeof wf === 'object' && wf !== null && !Array.isArray(wf)) {
      if ((wf as Record<string, unknown>).name === name) return true;
    }
  }
  return false;
}

export function buildRunWorkflowPrompt(
  workflow: string,
  passthrough: string[],
  prefix: '/' | '$' | '' | '/riglane:' = '/',
): string {
  const head =
    prefix === ''
      ? workflow
      : prefix === '/riglane:'
        ? `/${PRODUCT_NAME}:run-workflow ${workflow}`
        : `${prefix}${PRODUCT_NAME}-run-workflow ${workflow}`;
  return [head, ...passthrough].join(' ').trim();
}

export function buildCodexExecPrompt(workflow: string, passthrough: string[]): string {
  const args =
    passthrough.length > 0 ? ` Workflow arguments: ${passthrough.join(' ')}.` : '';
  return (
    `Read .agents/skills/riglane-run-workflow/SKILL.md and follow it to run the Riglane ` +
    `workflow '${workflow}' to completion.${args} Use the workflow_engine MCP tools ` +
    `(workflow_resolve, workflow_init, step_begin, step_collect_result, step_complete, ` +
    `workflow_finalize) for the entire run, follow every engine instruction exactly, ` +
    `and do not work around errors.`
  );
}


export const SUPERVISED_TARGETS: ReadonlySet<string> = new Set([
  'claude-headless',
  'codex-exec',
  'cursor-agent-headless',
  'opencode-headless',
  'copilot-headless',
  'gemini-headless',
]);

export interface RunSupervisionState {
  readonly exists: boolean;
  readonly terminal: boolean;
  readonly openQuestions: number;
  readonly ownerAlive: boolean;
  readonly status?: string;
  readonly workflow?: string;
  readonly currentStep?: string;
  readonly updatedAt?: string;
}

export function readRunSupervisionState(runDir: string): RunSupervisionState {
  let manifest: {
    status?: string;
    owner_pid?: number;
    workflow?: string;
    current_step?: string;
    updated_at?: string;
  };
  try {
    manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf-8'));
  } catch {
    return { exists: false, terminal: false, openQuestions: 0, ownerAlive: false };
  }
  const terminal = manifest.status === 'completed' || manifest.status === 'failed';
  let openQuestions = 0;
  try {
    for (const f of readdirSync(join(runDir, 'inbox'))) {
      if (!f.startsWith('msg-') || !f.endsWith('.json')) continue;
      try {
        const m = JSON.parse(readFileSync(join(runDir, 'inbox', f), 'utf-8'));
        if (m.response === null && !m.superseded_by) openQuestions += 1;
      } catch {
      }
    }
  } catch {
  }
  let ownerAlive = false;
  const pid = manifest.owner_pid;
  if (typeof pid === 'number' && pid > 0) {
    try {
      process.kill(pid, 0);
      ownerAlive = true;
    } catch (e) {
      ownerAlive = (e as NodeJS.ErrnoException).code === 'EPERM';
    }
  }
  return {
    exists: true,
    terminal,
    openQuestions,
    ownerAlive,
    ...(typeof manifest.status === 'string' ? { status: manifest.status } : {}),
    ...(typeof manifest.workflow === 'string' ? { workflow: manifest.workflow } : {}),
    ...(typeof manifest.current_step === 'string' ? { currentStep: manifest.current_step } : {}),
    ...(typeof manifest.updated_at === 'string' ? { updatedAt: manifest.updated_at } : {}),
  };
}

export type SuperviseVerdict = 'done' | 'wait' | 'relaunch';

export function superviseVerdict(state: RunSupervisionState): SuperviseVerdict {
  if (!state.exists || state.terminal) return 'done';
  if (state.ownerAlive) return 'wait';
  if (state.openQuestions > 0) return 'wait';
  return 'relaunch';
}

export function runDirBornSince(runsRoot: string, prefix: string, sinceMs: number): boolean {
  let entries: string[];
  try {
    entries = readdirSync(runsRoot);
  } catch {
    return false;
  }
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    try {
      const st = statSync(join(runsRoot, name));
      if (!st.isDirectory()) continue;
      const born = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
      if (born >= sinceMs) return true;
    } catch {
    }
  }
  return false;
}

export function newestRunDirBornSince(
  runsRoot: string,
  prefix: string,
  sinceMs: number,
): string | null {
  let best: string | null = null;
  let bestBorn = 0;
  let entries: string[];
  try {
    entries = readdirSync(runsRoot);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    try {
      const st = statSync(join(runsRoot, name));
      if (!st.isDirectory()) continue;
      const born = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
      if (born >= sinceMs && born >= bestBorn) {
        best = name;
        bestBorn = born;
      }
    } catch {
    }
  }
  return best;
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const WIN_EXT_ORDER = ['.com', '.exe', '.bat', '.cmd'] as const;

export type CmdShimTarget =
  | { readonly kind: 'node'; readonly entry: string }
  | { readonly kind: 'exe'; readonly path: string };

export function resolveWindowsCmdShim(
  command: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): CmdShimTarget | null {
  if (!command || /[\\/.]/.test(command)) return null;
  const pathVar = env.PATH ?? env.Path ?? '';
  for (const dir of pathVar.split(';')) {
    if (!dir) continue;
    for (const ext of WIN_EXT_ORDER) {
      const candidate = join(dir, command + ext);
      let found = false;
      try {
        found = statSync(candidate).isFile();
      } catch {
        found = false;
      }
      if (!found) continue;
      if (ext !== '.cmd') return null;
      return parseCmdShim(candidate);
    }
  }
  return null;
}

function parseCmdShim(cmdPath: string): CmdShimTarget | null {
  let body: string;
  try {
    body = readFileSync(cmdPath, 'utf-8');
  } catch {
    return null;
  }
  const dp0 = dirname(cmdPath);
  const jsMatch = /"%dp0%\\([^"]+?\.(?:mjs|cjs|js))"/i.exec(body);
  if (jsMatch?.[1]) {
    const entry = join(dp0, jsMatch[1]);
    try {
      if (statSync(entry).isFile()) return { kind: 'node', entry };
    } catch {
    }
    return null;
  }
  const exeMatch = /"%dp0%\\([^"]+?\.exe)"/i.exec(body);
  if (exeMatch?.[1]) {
    const exe = join(dp0, exeMatch[1]);
    try {
      if (statSync(exe).isFile()) return { kind: 'exe', path: exe };
    } catch {
    }
  }
  return null;
}

export function resolveSpawn(
  argv: string[],
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): { file: string; args: string[] } {
  if (platform === 'win32') {
    const shim = resolveWindowsCmdShim(argv[0] ?? '', env);
    if (shim?.kind === 'node') {
      return { file: process.execPath, args: [shim.entry, ...argv.slice(1)] };
    }
    if (shim?.kind === 'exe') {
      return { file: shim.path, args: argv.slice(1) };
    }
    return { file: env.ComSpec ?? 'cmd.exe', args: ['/c', ...argv] };
  }
  return { file: argv[0] ?? '', args: argv.slice(1) };
}

export function isGitBashDir(dir: string): boolean {
  if (!dir) return false;
  const bashExe = join(dir, 'bash.exe');
  if (!/git.*bash/i.test(bashExe)) return false;
  try {
    return statSync(bashExe).isFile();
  } catch {
    return false;
  }
}

export function runRunWorkflowCli(args: string[], options: RunWorkflowOptions = {}): number {
  const baseCwd = options.cwd ?? process.cwd();
  const spawn = options.spawn ?? (spawnSync as unknown as SpawnFn);

  const parsed = parseRunWorkflowArgs(args, baseCwd);
  if ('error' in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return 2;
  }

  if (!workflowExists(parsed.dir, parsed.workflow)) {
    process.stderr.write(
      `Workflow '${parsed.workflow}' not found in ${defaultTemplatesDir(parsed.dir)}\n`,
    );
    return 2;
  }

  if (PER_STEP_AGENT_TARGETS.has(parsed.target)) {
    const initCode = regeneratePerStepSubagents(parsed.workflow, parsed.dir, parsed.modelOverride);
    if (initCode !== 0) return initCode;
  }

  const promptArgs = [
    ...parsed.passthrough,
    ...(parsed.modelOverride ? ['--model', parsed.modelOverride] : []),
    ...(parsed.noTraceViewer ? ['--no-trace-viewer'] : []),
  ];
  const prompt =
    parsed.target === 'codex-exec'
      ? buildCodexExecPrompt(parsed.workflow, promptArgs)
      : buildRunWorkflowPrompt(parsed.workflow, promptArgs, skillPrefixForTarget(parsed.target));
  let prefix = RUN_WORKFLOW_TARGETS[parsed.target] ?? [];
  const skipArgs = parsed.skipApprovals
    ? (SKIP_APPROVALS_ARGS[parsed.target] ?? []).filter((a) => !prefix.includes(a))
    : [];
  let promptFlag: string[] = [];
  const lastPrefixArg = prefix[prefix.length - 1] ?? '';
  if (skipArgs.length > 0 && (lastPrefixArg === '-p' || lastPrefixArg === '-i')) {
    promptFlag = [lastPrefixArg];
    prefix = prefix.slice(0, -1);
  }
  const { file, args: spawnArgs } = resolveSpawn([...prefix, ...skipArgs, ...promptFlag, prompt]);

  writeActiveWorkflow(parsed.workflow, parsed.dir);
  const preMintedRunId = parsed.resumeRunId ?? generateRunId(parsed.workflow);
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    [ENV_ACTIVE_WORKFLOW]: parsed.workflow,
    [ENV_RUN_ID]: preMintedRunId,
    ...(parsed.modelOverride ? { [ENV_MODEL_OVERRIDE]: parsed.modelOverride } : {}),
    ...(parsed.inboxWebhook ? { [ENV_INBOX_WEBHOOK_OVERRIDE]: parsed.inboxWebhook } : {}),
    ...(parsed.noTraceViewer ? { [ENV_TRACE_VIEWER_OVERRIDE]: 'off' } : {}),
    ...(parsed.target === 'copilot-headless'
      ? { GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: 'true' }
      : {}),
  };
  if (process.platform === 'win32' && parsed.target.startsWith('cursor-agent')) {
    delete childEnv.SHELL;
    for (const key of Object.keys(childEnv)) {
      if (!/^path$/i.test(key)) continue;
      const val = childEnv[key];
      if (!val) continue;
      childEnv[key] = val.split(';').filter((d) => !isGitBashDir(d)).join(';');
    }
    if ((process.env.MSYSTEM || /bash/i.test(process.env.SHELL ?? '')) && !parsed.forceMsysEnv) {
      process.stderr.write(
        '[riglane] REFUSED: cursor-agent hooks break when riglane runs under a Git Bash/MSYS ' +
          'environment on Windows (PowerShell hook text gets executed under bash → Cursor ' +
          'fail-closed blocks every hooked call; the run dies at its first MCP call with a ' +
          'cryptic in-agent error). This applies transitively: a `riglane serve` started from ' +
          'Git Bash passes the poisoned environment to every API-launched run.\n' +
          'Launch from PowerShell or cmd instead. (--force-msys-env overrides, for debugging ' +
          'the detection channel itself.)\n',
      );
      return 1;
    }
  }
  const launchedAtMs = Date.now();
  try {
    const result = spawn(file, spawnArgs, {
      cwd: parsed.dir,
      stdio: 'inherit',
      env: childEnv,
    });
    if (SUPERVISED_TARGETS.has(parsed.target) && !parsed.resumeRunId && !parsed.noSupervise) {
      const runsRoot = join(parsed.dir, PRODUCT_DIR, 'local', 'workflow_runs');
      const started =
        existsSync(join(runsRoot, preMintedRunId)) ||
        runDirBornSince(runsRoot, `${parsed.workflow}-`, launchedAtMs - 5000);
      if (!started) {
        const hint =
          parsed.target === 'codex-exec'
            ? `Codex reports fatal startup errors (e.g. a model requiring a newer CLI) with exit 0 — ` +
              `check the output above; pin \`model\` in ~/.codex/config.toml or upgrade the codex CLI.`
            : parsed.target.startsWith('copilot')
              ? `A known cause: Copilot's prompt mode skips project-level MCP configs in an ` +
                `untrusted directory (the launcher sets GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP ` +
                `for headless runs, but an interactive 'copilot' launch needs the folder trusted ` +
                `once). Check the output above for 'tool not found' probes.`
              : `The agent exited without ever calling workflow_init — check the output above for ` +
                `startup errors or unavailable engine MCP tools.`;
        process.stderr.write(
          `[riglane] ${parsed.target} exited (code ${result.status ?? 'null'}) but no ` +
            `'${parsed.workflow}' run started after launch. ${hint}\n`,
        );
        return 1;
      }
    }

    if (SUPERVISED_TARGETS.has(parsed.target) && !parsed.noSupervise) {
      const runsRoot = join(parsed.dir, PRODUCT_DIR, 'local', 'workflow_runs');
      const runId = existsSync(join(runsRoot, preMintedRunId))
        ? preMintedRunId
        : newestRunDirBornSince(runsRoot, `${parsed.workflow}-`, launchedAtMs - 5000);
      if (runId !== null) {
        const runDir = join(runsRoot, runId);
        let lastResult = result;
        let deathRelaunches = 0;
        let answerRelaunches = 0;
        let waitingSince = 0;
        let sawOpenQuestion = false;
        for (;;) {
          const st = readRunSupervisionState(runDir);
          const verdict = superviseVerdict(st);
          if (verdict === 'done') return lastResult.status ?? 0;
          if (verdict === 'wait') {
            if (st.openQuestions > 0) sawOpenQuestion = true;
            if (waitingSince === 0) {
              waitingSince = Date.now();
              process.stderr.write(
                `[riglane] supervising run ${runId}: ` +
                  (st.openQuestions > 0
                    ? `waiting for an inbox answer (${st.openQuestions} open question(s)). `
                    : `the engine is still working. `) +
                  `This process stays up and resumes the agent when needed — Ctrl+C stops ` +
                  `supervising (the run stays resumable).\n`,
              );
            } else if (Date.now() - waitingSince >= 300000) {
              waitingSince = Date.now();
              process.stderr.write(`[riglane] still supervising run ${runId} (healthy wait).\n`);
            }
            sleepMs(3000);
            continue;
          }
          waitingSince = 0;
          const answered = sawOpenQuestion;
          if (answered) {
            answerRelaunches += 1;
            if (answerRelaunches > 100) {
              process.stderr.write(
                `[riglane] run ${runId} exceeded 100 supervised resumes — stopping. Resume manually.\n`,
              );
              return 1;
            }
          } else {
            deathRelaunches += 1;
            if (deathRelaunches > 1) {
              process.stderr.write(
                `[riglane] run ${runId} is stalled: the agent exited twice with the run ` +
                  `unfinished and no question waiting. Not relaunching again — inspect the ` +
                  `output above, then resume manually:\n` +
                  `  riglane run-workflow --target ${parsed.target} --workflow ${parsed.workflow} ` +
                  `--dir ${parsed.dir}${parsed.skipApprovals ? ' --skip-approvals' : ''} --resume ${runId}\n`,
              );
              return 1;
            }
          }
          sawOpenQuestion = false;
          process.stderr.write(
            `[riglane] resuming run ${runId} (${answered ? 'the inbox answer arrived' : 'the agent exited with the run unfinished'})…\n`,
          );
          const resumePromptArgs = [
            '--resume',
            runId,
            ...(parsed.modelOverride ? ['--model', parsed.modelOverride] : []),
            ...(parsed.noTraceViewer ? ['--no-trace-viewer'] : []),
          ];
          const resumePrompt =
            parsed.target === 'codex-exec'
              ? buildCodexExecPrompt(parsed.workflow, resumePromptArgs)
              : buildRunWorkflowPrompt(
                  parsed.workflow,
                  resumePromptArgs,
                  skillPrefixForTarget(parsed.target),
                );
          const resumeSpawn = resolveSpawn([...prefix, ...skipArgs, ...promptFlag, resumePrompt]);
          lastResult = spawn(resumeSpawn.file, resumeSpawn.args, {
            cwd: parsed.dir,
            stdio: 'inherit',
            env: { ...childEnv, [ENV_RUN_ID]: runId },
          });
        }
      }
    }
    return result.status ?? 1;
  } finally {
    clearActiveWorkflow(parsed.dir);
  }
}
