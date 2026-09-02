
import type { Dirent } from 'node:fs';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { text as readStreamText } from 'node:stream/consumers';

import { PRODUCT_DIR } from '../config/paths.js';
import { resolveProjectRoot } from '../engine/project-root.js';
import { loadYaml } from '../engine/schema-validate.js';
import {
  composeUndeclaredToolRefusal,
  frozenMcpVerdictForStep,
  frozenVerdictForStep,
  makeToolName,
  mcpServerToolName,
  normalizeName,
  profileNarrowedStep,
  resolveStepToolEntries,
  stepBranchProfiles,
} from '../engine/step-tool-rights.js';
import { validateArgs } from '../engine/workflow-tools-loader.js';
import { subagentSteps } from './init-workflow.js';


export const WORKFLOW_TOOL_RE = /^mcp__workflow_tools__([a-zA-Z0-9_]+)__([a-zA-Z0-9_]+)$/;


export interface WorkflowToolValidatorOptions {
  readonly stdin?: string;
  readonly stderr?: (chunk: string) => void;
  readonly cwd?: string;
  readonly workflow?: string;
  readonly step?: string;
  readonly profile?: string;
  readonly root?: string;
  readonly startDir?: string;
}

interface ResolvedOptions {
  readonly stderr: (chunk: string) => void;
  readonly cwd: string;
  readonly workflow: string | null;
  readonly step: string | null;
  readonly profile: string | null;
}

function resolveOpts(opts: WorkflowToolValidatorOptions = {}): ResolvedOptions {
  return {
    stderr: opts.stderr ?? ((s: string) => void process.stderr.write(s)),
    cwd: opts.cwd ?? resolveProjectRoot(opts.startDir, opts.root) ?? process.cwd(),
    workflow: opts.workflow !== undefined && opts.workflow !== '' ? opts.workflow : null,
    step: opts.step !== undefined && opts.step !== '' ? opts.step : null,
    profile: opts.profile !== undefined && opts.profile !== '' ? opts.profile : null,
  };
}

export function parseValidatorArgs(
  argv: readonly string[],
): { workflow?: string; step?: string; profile?: string; root?: string } {
  const out: { workflow?: string; step?: string; profile?: string; root?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    for (const key of ['workflow', 'step', 'profile', 'root'] as const) {
      if (a === `--${key}`) {
        const v = argv[i + 1];
        if (v !== undefined && !v.startsWith('--')) {
          out[key] = v;
          i += 1;
        }
      } else if (a.startsWith(`--${key}=`)) {
        out[key] = a.slice(`--${key}=`.length);
      }
    }
  }
  return out;
}

interface WorkflowDoc {
  name?: string;
  tools?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}


export function readPayload(stdinText: string): unknown {
  try {
    return JSON.parse(stdinText);
  } catch {
    return null;
  }
}

export function extractToolName(payload: unknown): string {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const obj = payload as Record<string, unknown>;
  const a = obj.tool_name;
  const b = obj.toolName;
  if (typeof a === 'string' && a) return a;
  if (typeof b === 'string' && b) return b;
  return '';
}

export function extractToolInput(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const obj = payload as Record<string, unknown>;
  const isPopulatedDict = (v: unknown): boolean =>
    v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
  const candidates = [obj.tool_input, obj.toolInput, obj.arguments];
  for (const c of candidates) {
    if (isPopulatedDict(c)) return c as Record<string, unknown>;
  }
  return {};
}


export function parseWorkflowTool(toolName: string): string | null {
  const m = WORKFLOW_TOOL_RE.exec(toolName ?? '');
  if (!m) return null;
  return `${m[1] ?? ''}__${m[2] ?? ''}`;
}


export function loadWorkflowByName(name: string, cwd: string): WorkflowDoc | null {
  const wanted = normalizeName(name);
  const templatesRoot = join(cwd, PRODUCT_DIR, 'workflows', 'templates');
  for (const path of findWorkflowYamlsRecursive(templatesRoot)) {
    let wf: unknown;
    try {
      wf = loadYaml(path);
    } catch {
      continue;
    }
    if (wf === null || typeof wf !== 'object' || Array.isArray(wf)) continue;
    const wfDoc = wf as WorkflowDoc;
    if (normalizeName((wfDoc.name as string | undefined) ?? '') === wanted) return wfDoc;
  }
  return null;
}

export function findWorkflowWithTool(
  calledCombined: string,
  cwd: string,
): [WorkflowDoc, Record<string, unknown>] | null {
  const templatesRoot = join(cwd, PRODUCT_DIR, 'workflows', 'templates');
  const yamlPaths = findWorkflowYamlsRecursive(templatesRoot);
  for (const path of yamlPaths) {
    let wf: unknown;
    try {
      wf = loadYaml(path);
    } catch {
      continue;
    }
    if (wf === null || typeof wf !== 'object' || Array.isArray(wf)) continue;
    const wfDoc = wf as WorkflowDoc;
    const wfName = (wfDoc.name as string | undefined) ?? '';
    const tools = Array.isArray(wfDoc.tools) ? (wfDoc.tools as Array<Record<string, unknown>>) : [];
    for (const t of tools) {
      if (t === null || typeof t !== 'object') continue;
      if (t.type !== 'script') continue;
      const tname = (t.name as string | undefined) ?? '';
      if (makeToolName(wfName, tname) === calledCombined) {
        return [wfDoc, t];
      }
    }
  }
  return null;
}

function findWorkflowYamlsRecursive(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root) || !statSync(root).isDirectory()) return out;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name === 'workflow.yaml') {
        out.push(full);
      }
    }
  }
  return out;
}


function stepForProfile(
  step: Record<string, unknown>,
  profileId: string | null,
): Record<string, unknown> {
  if (profileId === null) return step;
  const p = stepBranchProfiles(step)?.[profileId];
  return p !== undefined ? profileNarrowedStep(step, p) : step;
}

function stepDeclaresTool(
  callerWorkflow: string,
  stepName: string,
  calledCombined: string,
  cwd: string,
  profileId: string | null = null,
): 'declared' | 'undeclared' | 'unknown' {
  const doc = loadWorkflowByName(callerWorkflow, cwd);
  if (doc === null) return 'unknown';

  const found = subagentSteps(doc as never).find(([name]) => name === stepName)?.[1];
  if (found === undefined) return 'unknown';
  const step = stepForProfile(found, profileId);

  for (const entry of resolveStepToolEntries(doc as never, step)) {
    if (entry.kind !== 'script') continue;
    if (makeToolName(callerWorkflow, entry.tool) === calledCombined) {
      return 'declared';
    }
  }
  return 'undeclared';
}

function checkExternalMcpDeclaration(toolName: string, r: ResolvedOptions): number {
  if (!toolName.startsWith('mcp__')) return 0;
  if (toolName.startsWith('mcp__workflow_engine__')) return 0;
  if (toolName.startsWith('mcp__workflow_tools__')) return 0;
  if (r.workflow === null || r.step === null) return 0;

  const agentDir = join(r.cwd, PRODUCT_DIR);
  let verdict: FrozenExternalVerdict = frozenMcpVerdictForStep(
    agentDir,
    r.workflow,
    r.step,
    toolName,
    r.profile ?? undefined,
  );
  if (verdict === 'no-freeze') {
    verdict = yamlMcpVerdict(r.workflow, r.step, toolName, r.cwd, r.profile);
  }
  if (verdict === 'undeclared') {
    r.stderr(
      composeUndeclaredToolRefusal('workflow-tool-validator', toolName, `for step '${r.step}'`),
    );
    return 2;
  }
  return 0;
}

type FrozenExternalVerdict = 'declared' | 'undeclared' | 'no-freeze' | 'unknown';

function yamlMcpVerdict(
  callerWorkflow: string,
  stepName: string,
  calledFullName: string,
  cwd: string,
  profileId: string | null = null,
): 'declared' | 'undeclared' | 'unknown' {
  const doc = loadWorkflowByName(callerWorkflow, cwd);
  if (doc === null) return 'unknown';
  const found = subagentSteps(doc as never).find(([name]) => name === stepName)?.[1];
  if (found === undefined) return 'unknown';
  const step = stepForProfile(found, profileId);
  for (const entry of resolveStepToolEntries(doc as never, step)) {
    if (entry.kind !== 'mcp') continue;
    if (mcpServerToolName(entry.server ?? '', entry.tool) === calledFullName) return 'declared';
  }
  return 'undeclared';
}

export async function runWorkflowToolValidator(
  argvOrOpts: readonly string[] | WorkflowToolValidatorOptions = {},
): Promise<number> {
  const opts: WorkflowToolValidatorOptions = Array.isArray(argvOrOpts)
    ? parseValidatorArgs(argvOrOpts)
    : (argvOrOpts as WorkflowToolValidatorOptions);
  const r = resolveOpts(opts);

  let raw: string;
  if (opts.stdin !== undefined) {
    raw = opts.stdin;
  } else {
    try {
      raw = await readStreamText(process.stdin);
    } catch {
      return 0;
    }
  }

  const payload = readPayload(raw);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return 0;
  }

  const toolName = extractToolName(payload);
  const calledCombined = parseWorkflowTool(toolName);
  if (calledCombined === null) {
    return checkExternalMcpDeclaration(toolName, r);
  }

  if (r.workflow !== null && r.step !== null) {
    const agentDir = join(r.cwd, PRODUCT_DIR);
    let verdict: 'declared' | 'undeclared' | 'unknown';
    const frozen = frozenVerdictForStep(
      agentDir,
      r.workflow,
      r.step,
      calledCombined,
      r.profile ?? undefined,
    );
    if (frozen === 'no-freeze') {
      verdict = stepDeclaresTool(r.workflow, r.step, calledCombined, r.cwd, r.profile);
    } else {
      verdict = frozen;
    }
    if (verdict === 'undeclared') {
      r.stderr(
        composeUndeclaredToolRefusal('workflow-tool-validator', toolName, `for step '${r.step}'`),
      );
      return 2;
    }
  }

  const found = findWorkflowWithTool(calledCombined, r.cwd);
  if (found === null) {
    return 0;
  }

  const [, toolDef] = found;
  const rawSchema = toolDef.input_schema;
  const schema =
    rawSchema !== null && typeof rawSchema === 'object' && !Array.isArray(rawSchema)
      ? (rawSchema as Record<string, unknown>)
      : {};
  if (Object.keys(schema).length === 0) {
    return 0;
  }

  const args = extractToolInput(payload);

  const error = validateArgs(args, schema);
  if (error === null) {
    return 0;
  }

  r.stderr(
    `workflow-tool-validator: ${toolName} input rejected.\n` +
      `${error}\n` +
      `Expected schema: ${JSON.stringify(schema)}\n` +
      `Received args: ${JSON.stringify(args)}\n`,
  );
  return 2;
}
