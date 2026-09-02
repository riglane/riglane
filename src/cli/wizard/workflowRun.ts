
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, sep } from 'node:path';
import process from 'node:process';

import { type AdapterId } from '../../adapters/index.js';
import { readRunSupervisionState } from '../commands/run-workflow.js';
import { PRODUCT_DIR } from '../../config/paths.js';
import { CLI_NAME } from '../../config/product.js';
import { MODEL_MODES } from '../../types/workflow.js';
import { findRunsByWorkflow, runManifestPath, runTracePath } from '../../engine/runs.js';
import { loadYaml } from '../../engine/schema-validate.js';
import { defaultTemplatesDir, scanWorkflows } from '../../engine/workflow-tools-loader.js';
import { promoteEditedPredefinedWorkflows } from '../promote-edited.js';


export type ParamCategory = 'required' | 'predefined' | 'optional';

export interface WorkflowParamMeta {
  readonly name: string;
  readonly description: string;
  readonly category: ParamCategory;
  readonly defaultText: string;
}

export function categorizeParam(p: {
  required?: unknown;
  default?: unknown;
}): ParamCategory {
  if (p.required === true) return 'required';
  if (Object.prototype.hasOwnProperty.call(p, 'default') && p.default !== undefined) {
    return 'predefined';
  }
  return 'optional';
}

function defaultToText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function parseWorkflowParams(wf: unknown): WorkflowParamMeta[] {
  if (typeof wf !== 'object' || wf === null) return [];
  const raw = (wf as Record<string, unknown>).params;
  if (!Array.isArray(raw)) return [];
  const out: WorkflowParamMeta[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== 'string' || e.name.length === 0) continue;
    out.push({
      name: e.name,
      description: typeof e.description === 'string' ? e.description : '',
      category: categorizeParam(e),
      defaultText: defaultToText(e.default),
    });
  }
  return out;
}


export const BUCKET_ORDER = ['my_workflows', 'predefined', 'examples', 'community'] as const;
export type Bucket = (typeof BUCKET_ORDER)[number];

export interface WorkflowEntry {
  readonly name: string;
  readonly bucket: Bucket | string;
  readonly description: string;
  readonly path: string;
  readonly params: WorkflowParamMeta[];
}

export interface WorkflowGroup {
  readonly bucket: Bucket | string;
  readonly workflows: WorkflowEntry[];
}

export function bucketOf(templatesDir: string, workflowYamlPath: string): string {
  const prefix = templatesDir.endsWith(sep) ? templatesDir : templatesDir + sep;
  if (!workflowYamlPath.startsWith(prefix)) return '';
  const rel = workflowYamlPath.slice(prefix.length);
  const segs = rel.split(/[\\/]/);
  return segs[0] ?? '';
}

export function listProjectWorkflows(projectPath: string): WorkflowGroup[] {
  try {
    promoteEditedPredefinedWorkflows(projectPath);
  } catch {
  }
  const templatesDir = defaultTemplatesDir(projectPath);
  const byBucket = new Map<string, WorkflowEntry[]>();

  for (const yamlPath of scanWorkflows(templatesDir)) {
    let wf: unknown;
    try {
      wf = loadYaml<unknown>(yamlPath);
    } catch {
      continue;
    }
    if (typeof wf !== 'object' || wf === null || Array.isArray(wf)) continue;
    const obj = wf as Record<string, unknown>;
    if (typeof obj.name !== 'string' || obj.name.length === 0) continue;

    const bucket = bucketOf(templatesDir, yamlPath) || 'other';
    const entry: WorkflowEntry = {
      name: obj.name,
      bucket,
      description: typeof obj.description === 'string' ? obj.description.trim() : '',
      path: yamlPath,
      params: parseWorkflowParams(wf),
    };
    const arr = byBucket.get(bucket) ?? [];
    arr.push(entry);
    byBucket.set(bucket, arr);
  }

  const orderedBuckets = [
    ...BUCKET_ORDER.filter((b) => byBucket.has(b)),
    ...[...byBucket.keys()].filter((b) => !(BUCKET_ORDER as readonly string[]).includes(b)).sort(),
  ];

  return orderedBuckets.map((bucket) => ({
    bucket,
    workflows: (byBucket.get(bucket) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
  }));
}


export interface RunAdapterSpec {
  readonly name: string;
  readonly label: string;
  readonly group: string;
  readonly bin: string;
  readonly adapterId: AdapterId;
  readonly disabled?: boolean;
  readonly hint?: string;
}

export const RUN_ADAPTERS: readonly RunAdapterSpec[] = [
  { name: 'claude', label: 'Claude Code', group: 'Claude', bin: 'claude', adapterId: 'claude' },
  {
    name: 'claude-headless',
    label: 'Claude Code (headless)',
    group: 'Claude',
    bin: 'claude',
    adapterId: 'claude',
  },
  {
    name: 'cursor-agent',
    label: 'Cursor Agent',
    group: 'Cursor',
    bin: 'cursor-agent',
    adapterId: 'cursor',
  },
  {
    name: 'cursor-agent-headless',
    label: 'Cursor Agent (headless)',
    group: 'Cursor',
    bin: 'cursor-agent',
    adapterId: 'cursor',
  },
  { name: 'codex', label: 'Codex (interactive)', group: 'Codex', bin: 'codex', adapterId: 'codex' },
  {
    name: 'codex-exec',
    label: 'Codex (headless exec)',
    group: 'Codex',
    bin: 'codex',
    adapterId: 'codex',
    hint: 'requires Skip approvals — runs with the codex sandbox OFF',
  },
  {
    name: 'opencode',
    label: 'OpenCode (interactive)',
    group: 'OpenCode',
    bin: 'opencode',
    adapterId: 'opencode',
  },
  {
    name: 'opencode-headless',
    label: 'OpenCode (headless run)',
    group: 'OpenCode',
    bin: 'opencode',
    adapterId: 'opencode',
    hint: 'unattended permission asks hang — prefer skip-approvals (--auto)',
  },
  {
    name: 'copilot',
    label: 'GitHub Copilot (interactive)',
    group: 'Copilot',
    bin: 'copilot',
    adapterId: 'copilot',
  },
  {
    name: 'copilot-headless',
    label: 'GitHub Copilot (headless -p)',
    group: 'Copilot',
    bin: 'copilot',
    adapterId: 'copilot',
    hint: 'requires Skip approvals — non-interactive runs need --allow-all',
  },
  {
    name: 'gemini',
    label: 'Gemini CLI (interactive)',
    group: 'Gemini',
    bin: 'gemini',
    adapterId: 'gemini',
  },
  {
    name: 'gemini-headless',
    label: 'Gemini CLI (headless -p)',
    group: 'Gemini',
    bin: 'gemini',
    adapterId: 'gemini',
    hint: 'requires Skip approvals — headless approvals resolve to deny',
  },
];

export function detectedAdapterIds(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ReadonlySet<AdapterId> {
  const found = new Set<AdapterId>();
  for (const spec of RUN_ADAPTERS) {
    if (found.has(spec.adapterId)) continue;
    if (commandOnPath(spec.bin, env, platform)) found.add(spec.adapterId);
  }
  return found;
}

export interface RunAdapter extends RunAdapterSpec {
  readonly binOnPath: boolean;
  readonly integrationInstalled: boolean;
  readonly binRunnable: boolean | undefined;
  readonly available: boolean;
}

export type RunAdapterStatusKind = 'ok' | 'error' | 'disabled';

export interface RunAdapterStatus {
  readonly kind: RunAdapterStatusKind;
  readonly text: string;
}

export function runAdapterStatus(a: RunAdapter): RunAdapterStatus {
  if (a.disabled) return { kind: 'disabled', text: a.hint ?? 'unavailable' };
  const missing: string[] = [];
  if (!a.integrationInstalled) missing.push('integration not installed');
  if (!a.binOnPath) missing.push(`'${a.bin}' not found`);
  else if (a.binRunnable === false) missing.push(`'${a.bin}' installed but not runnable`);
  if (missing.length === 0) {
    return { kind: 'ok', text: a.hint ? `available · ${a.hint}` : 'available' };
  }
  return { kind: 'error', text: missing.join(' · ') };
}

export function resolveOnPath(
  bin: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathVar = env.PATH ?? env.Path ?? '';
  if (pathVar.length === 0) return null;
  const dirs = pathVar.split(delimiter).filter(Boolean);
  const exts =
    platform === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = join(dir, bin + ext);
      if (existsSync(p)) return p;
      if (platform === 'win32') {
        const lower = join(dir, bin + ext.toLowerCase());
        if (existsSync(lower)) return lower;
      }
    }
  }
  return null;
}

export function commandOnPath(
  bin: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return resolveOnPath(bin, env, platform) !== null;
}


const runnableCache = new Map<string, boolean>();

export function clearRunnableCache(): void {
  runnableCache.clear();
}

function probeArgv(binPath: string, platform: NodeJS.Platform): [string, string[]] {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(binPath)) {
    return ['cmd', ['/c', binPath, '--version']];
  }
  return [binPath, ['--version']];
}

function probeRunnable(binPath: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    const [cmd, args] = probeArgv(binPath, process.platform);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { stdio: 'ignore' });
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
      }
      finish(false);
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}

function runnableFromCache(
  bin: string,
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): boolean | undefined {
  const path = resolveOnPath(bin, env, platform);
  if (!path) return undefined;
  return runnableCache.get(path);
}

export async function warmRunnableCache(
  adapters: readonly RunAdapter[],
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): Promise<boolean> {
  const seen = new Set<string>();
  const probes: Promise<void>[] = [];
  for (const a of adapters) {
    if (!a.binOnPath) continue;
    const path = resolveOnPath(a.bin, env, platform);
    if (!path || seen.has(path) || runnableCache.has(path)) continue;
    seen.add(path);
    probes.push(
      probeRunnable(path).then((ok) => {
        runnableCache.set(path, ok);
      }),
    );
  }
  await Promise.all(probes);
  return probes.length > 0;
}

export function detectRunAdapters(
  installedAdapters: readonly AdapterId[] = [],
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): RunAdapter[] {
  const installed = new Set(installedAdapters);
  return RUN_ADAPTERS.map((spec) => {
    const binOnPath = commandOnPath(spec.bin, env, platform);
    const binRunnable = runnableFromCache(spec.bin, env, platform);
    const integrationInstalled = installed.has(spec.adapterId);
    return {
      ...spec,
      binOnPath,
      integrationInstalled,
      binRunnable,
      available: spec.disabled
        ? false
        : binOnPath && binRunnable !== false && integrationInstalled,
    };
  });
}


export function buildParamArgs(
  params: readonly WorkflowParamMeta[],
  values: Readonly<Record<string, string>>,
): string[] {
  const args: string[] = [];
  for (const p of params) {
    const v = (values[p.name] ?? '').trim();
    if (v.length > 0) args.push(`--${p.name}`, v);
  }
  return args;
}

export const MODEL_OVERRIDE_CHOICES = ['', ...MODEL_MODES] as const;

export function modelOverrideLabel(value: string): string {
  return value === '' ? 'workflow default' : value;
}

export function buildLaunchArgs(opts: {
  target: string;
  workflow: string;
  dir: string;
  paramArgs: readonly string[];
  skipApprovals?: boolean;
  modelOverride?: string;
}): string[] {
  return [
    '--target',
    opts.target,
    '--workflow',
    opts.workflow,
    '--dir',
    opts.dir,
    ...opts.paramArgs,
    ...(opts.skipApprovals ? ['--skip-approvals'] : []),
    ...(opts.modelOverride ? ['--model', opts.modelOverride] : []),
  ];
}

export function buildWorkflowPrompt(workflow: string, paramArgs: readonly string[]): string {
  return [`/riglane-run-workflow ${workflow}`, ...paramArgs].join(' ').trim();
}

export function buildPreviewCommand(opts: {
  adapter: RunAdapterSpec;
  workflow: string;
  dir: string;
  paramArgs: readonly string[];
  modelOverride?: string;
}): string {
  const { adapter, workflow, dir, paramArgs, modelOverride } = opts;
  return [
    CLI_NAME,
    'run-workflow',
    `--target=${adapter.name}`,
    `--workflow=${workflow}`,
    `--dir=${dir}`,
    ...paramArgs,
    ...(modelOverride ? [`--model=${modelOverride}`] : []),
  ].join(' ');
}

export function missingRequired(
  params: readonly WorkflowParamMeta[],
  values: Readonly<Record<string, string>>,
): string[] {
  return params
    .filter((p) => p.category === 'required' && (values[p.name] ?? '').trim().length === 0)
    .map((p) => p.name);
}


function projectAgentDir(projectPath: string): string {
  return join(projectPath, PRODUCT_DIR);
}

export interface ActiveRunInfo {
  readonly runId: string;
  readonly startedAt: string;
  readonly state: 'running' | 'waiting' | 'stalled';
  readonly currentStep: string | null;
}

export function readActiveRun(projectPath: string, workflowName: string): ActiveRunInfo | null {
  const agentDir = projectAgentDir(projectPath);
  const inProgress = findRunsByWorkflow(agentDir, workflowName, 'in_progress');
  if (inProgress.length === 0) return null;
  const runId = inProgress[inProgress.length - 1] as string;
  try {
    const m = JSON.parse(readFileSync(runManifestPath(agentDir, runId), 'utf-8')) as {
      run_id?: unknown;
      started_at?: unknown;
    };
    const sup = readRunSupervisionState(dirname(runManifestPath(agentDir, runId)));
    const state = sup.ownerAlive ? 'running' : sup.openQuestions > 0 ? 'waiting' : 'stalled';
    return {
      runId: String(m.run_id ?? runId),
      startedAt: String(m.started_at ?? ''),
      state,
      currentStep: sup.currentStep ?? null,
    };
  } catch {
    return null;
  }
}

export type TraceState = 'completed' | 'in-progress' | 'failed' | 'stopped' | 'unknown';

export interface TraceMeta {
  readonly runId: string;
  readonly shortId: string;
  readonly state: TraceState;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly serverPath: string;
}

export function traceState(status: unknown): TraceState {
  switch (status) {
    case 'success':
    case 'completed':
      return 'completed';
    case 'in_progress':
      return 'in-progress';
    case 'failed':
      return 'failed';
    case 'manual_stop':
      return 'stopped';
    default:
      return 'unknown';
  }
}

export function listWorkflowTraces(projectPath: string, workflowName: string): TraceMeta[] {
  const agentDir = projectAgentDir(projectPath);
  const runIds = findRunsByWorkflow(agentDir, workflowName);
  const out: TraceMeta[] = [];
  for (const runId of runIds) {
    try {
      const t = JSON.parse(readFileSync(runTracePath(agentDir, runId), 'utf-8')) as {
        run_id?: unknown;
        status?: unknown;
        started_at?: unknown;
        completed_at?: unknown;
      };
      const rid = String(t.run_id ?? runId);
      out.push({
        runId: rid,
        shortId: rid.split('-').pop() || rid,
        state: traceState(t.status),
        startedAt: String(t.started_at ?? ''),
        completedAt: t.completed_at == null ? null : String(t.completed_at),
        serverPath: ['', 'local', 'workflow_runs', runId, 'trace.json'].join('/'),
      });
    } catch {
    }
  }
  out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return out;
}
