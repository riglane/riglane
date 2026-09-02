
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findInProgressRuns, findRunsByWorkflow, runDir } from './runs.js';


export function normalizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function makeToolName(workflowName: string, toolName: string): string {
  return `${normalizeName(workflowName)}__${normalizeName(toolName)}`;
}

export function mcpServerToolName(serverName: string, toolName: string): string {
  return `mcp__${normalizeName(serverName)}__${normalizeName(toolName)}`;
}


export const DENY_CAPABILITIES = ['shell'] as const;
export type DenyCapability = (typeof DENY_CAPABILITIES)[number];

export const DENY_SPELLINGS: Record<
  DenyCapability,
  { readonly claude: readonly string[]; readonly opencode: readonly string[]; readonly copilot: readonly string[]; readonly gemini: readonly string[] }
> = {
  shell: {
    claude: ['Bash', 'PowerShell'],
    opencode: ['bash'],
    copilot: ['execute'],
    gemini: ['run_shell_command'],
  },
};

export function stepDeniedCapabilities(step: Record<string, unknown>): DenyCapability[] {
  const raw = step.deny;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is DenyCapability =>
      typeof c === 'string' && (DENY_CAPABILITIES as readonly string[]).includes(c),
  );
}


export const SPEC_ENGINE_TOOLS: readonly string[] = ['spec_write', 'spec_search', 'spec_link'];

export function stepAuthorsSpecs(step: Record<string, unknown>): boolean {
  return step.spec_authoring === 'persist' || step.spec_authoring === 'validate';
}

export interface ToolDeclaringWorkflow {
  name?: string;
  tools?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface StepToolEntry {
  readonly kind: 'script' | 'mcp' | 'spec';
  readonly tool: string;
  readonly server?: string;
}

export function resolveStepToolEntries(
  workflow: ToolDeclaringWorkflow,
  step: Record<string, unknown>,
): StepToolEntry[] {
  const wfTools = Array.isArray(workflow.tools)
    ? (workflow.tools as Array<Record<string, unknown>>)
    : [];

  const stepToolsFilter = step.tools as string[] | undefined;
  const active = Array.isArray(stepToolsFilter)
    ? wfTools.filter((t) => stepToolsFilter.includes((t.name as string | undefined) ?? ''))
    : [];

  const entries: StepToolEntry[] = [];
  for (const toolDef of active) {
    const ttype = toolDef.type as string | undefined;
    const tname = toolDef.name as string | undefined;
    if (!tname) continue;

    if (ttype === 'script') {
      entries.push({ kind: 'script', tool: tname });
    } else if (ttype === 'mcp') {
      const expected = Array.isArray(toolDef.expected_tools)
        ? (toolDef.expected_tools as string[])
        : [];
      for (const subTool of expected) {
        entries.push({ kind: 'mcp', tool: subTool, server: tname });
      }
    }
  }

  const specTools = new Set<string>();
  if (step.spec_check === true) {
    specTools.add('spec_search');
    specTools.add('spec_link');
  }
  if (stepAuthorsSpecs(step)) {
    for (const t of SPEC_ENGINE_TOOLS) specTools.add(t);
  }
  for (const t of SPEC_ENGINE_TOOLS) {
    if (specTools.has(t)) entries.push({ kind: 'spec', tool: t });
  }

  return entries;
}


export interface FrozenStepTool {
  readonly kind: 'script' | 'mcp' | 'spec';
  readonly name: string;
  readonly server?: string;
}


export interface BranchProfile {
  readonly tools?: readonly string[];
  readonly struct?: string;
}

export function stepBranchProfiles(
  step: Record<string, unknown>,
): Record<string, BranchProfile> | null {
  const raw = step.branch_profiles;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v),
  );
  if (entries.length === 0) return null;
  return Object.fromEntries(entries) as Record<string, BranchProfile>;
}

export function profileIdForItem(item: unknown): string | null {
  if (item === null || typeof item !== 'object') return null;
  const o = item as { profile?: unknown; name?: unknown };
  if (typeof o.profile === 'string' && o.profile.length > 0) return o.profile;
  if (typeof o.name === 'string' && o.name.length > 0) return o.name;
  return null;
}

export function profileFreezeKey(stepName: string, profileId: string): string {
  return `${stepName}::${profileId}`;
}

export function profileNarrowedStep(
  step: Record<string, unknown>,
  profile: BranchProfile,
): Record<string, unknown> {
  return { ...step, tools: [...(profile.tools ?? [])] };
}

export function freezeStepTools(
  workflow: ToolDeclaringWorkflow,
  allSteps: ReadonlyArray<Record<string, unknown>>,
): Record<string, FrozenStepTool[]> {
  const wfName = (workflow.name as string | undefined) ?? '';
  const toFrozen = (e: StepToolEntry): FrozenStepTool => {
    if (e.kind === 'script') return { kind: 'script', name: makeToolName(wfName, e.tool) };
    if (e.kind === 'mcp') return { kind: 'mcp', name: e.tool, server: e.server ?? '' };
    return { kind: 'spec', name: e.tool };
  };
  const out: Record<string, FrozenStepTool[]> = {};
  for (const step of allSteps) {
    const stepName = (step.name as string | undefined) ?? '';
    if (!stepName) continue;
    out[stepName] = resolveStepToolEntries(workflow, step).map(toFrozen);
    const profiles = stepBranchProfiles(step);
    if (profiles) {
      for (const [pid, profile] of Object.entries(profiles)) {
        out[profileFreezeKey(stepName, pid)] = resolveStepToolEntries(
          workflow,
          profileNarrowedStep(step, profile),
        ).map(toFrozen);
      }
    }
  }
  return out;
}


export function composeUndeclaredToolRefusal(
  prefix: string,
  toolLabel: string,
  scopeClause: string,
): string {
  return (
    `${prefix}: '${toolLabel}' is NOT declared ${scopeClause} and will not run.\n` +
    `Do not call it. Reach the step's goal with the tools it declares; if that is impossible, ` +
    `stop and report why.\n` +
    `Do NOT edit workflow.yaml and do NOT retry — which tools a step may use is an ` +
    `authoring decision, not yours.\n`
  );
}

export type FrozenVerdict = 'declared' | 'undeclared' | 'no-freeze';

interface RunManifestSlice {
  current_step?: string | null;
  step_tools?: Record<string, FrozenStepTool[]>;
  active_lanes?: string[];
  steps?: Record<
    string,
    { lane_state?: { lanes?: Record<string, { cursor?: string | null; status?: string }> } }
  >;
}

function readRunManifest(agentDir: string, runId: string): RunManifestSlice | null {
  try {
    return JSON.parse(
      readFileSync(join(runDir(agentDir, runId), 'manifest.json'), 'utf-8'),
    ) as RunManifestSlice;
  } catch {
    return null;
  }
}

function activeStepsOf(m: RunManifestSlice): string[] {
  const owners = Array.isArray(m.active_lanes)
    ? m.active_lanes.filter((x): x is string => typeof x === 'string')
    : [];
  if (owners.length === 0) {
    return typeof m.current_step === 'string' && m.current_step ? [m.current_step] : [];
  }
  const ownerSet = new Set(owners);
  const out: string[] = [];
  for (const fork of owners) {
    const lanes = m.steps?.[fork]?.lane_state?.lanes ?? {};
    for (const entry of Object.values(lanes)) {
      if (entry.status === 'completed') continue;
      const cur = entry.cursor;
      if (typeof cur !== 'string' || !cur) continue;
      if (ownerSet.has(cur)) continue;
      out.push(cur);
    }
  }
  return out;
}

function setContainsScript(
  set: ReadonlyArray<FrozenStepTool> | undefined,
  calledName: string,
): boolean {
  return (set ?? []).some((e) => e.kind === 'script' && e.name === calledName);
}

function setContainsMcp(
  set: ReadonlyArray<FrozenStepTool> | undefined,
  calledFullName: string,
): boolean {
  return (set ?? []).some(
    (e) => e.kind === 'mcp' && mcpServerToolName(e.server ?? '', e.name) === calledFullName,
  );
}

function frozenVerdictForStepBy(
  agentDir: string,
  workflowName: string,
  stepName: string,
  contains: (set: ReadonlyArray<FrozenStepTool> | undefined) => boolean,
  profileId?: string,
): FrozenVerdict {
  const runs = findRunsByWorkflow(agentDir, workflowName, 'in_progress');
  let sawFreezeForStep = false;
  for (const runId of runs) {
    const m = readRunManifest(agentDir, runId);
    const set =
      (profileId !== undefined
        ? m?.step_tools?.[profileFreezeKey(stepName, profileId)]
        : undefined) ?? m?.step_tools?.[stepName];
    if (set === undefined) continue;
    sawFreezeForStep = true;
    if (contains(set)) return 'declared';
  }
  return sawFreezeForStep ? 'undeclared' : 'no-freeze';
}

export function frozenVerdictForStep(
  agentDir: string,
  workflowName: string,
  stepName: string,
  calledName: string,
  profileId?: string,
): FrozenVerdict {
  return frozenVerdictForStepBy(
    agentDir,
    workflowName,
    stepName,
    (set) => setContainsScript(set, calledName),
    profileId,
  );
}

export function frozenMcpVerdictForStep(
  agentDir: string,
  workflowName: string,
  stepName: string,
  calledFullName: string,
  profileId?: string,
): FrozenVerdict {
  return frozenVerdictForStepBy(
    agentDir,
    workflowName,
    stepName,
    (set) => setContainsMcp(set, calledFullName),
    profileId,
  );
}

export interface ScriptCallGuardVerdict {
  readonly allowed: boolean;
  readonly reason: 'declared' | 'zero-runs' | 'no-freeze' | 'no-run-of-workflow' | 'undeclared';
  readonly refusal?: string;
}

export function guardScriptToolCall(
  agentDir: string,
  workflowName: string,
  calledName: string,
): ScriptCallGuardVerdict {
  const runsOfW = findRunsByWorkflow(agentDir, workflowName, 'in_progress');

  if (runsOfW.length === 0) {
    if (findInProgressRuns(agentDir).length === 0) {
      return { allowed: true, reason: 'zero-runs' };
    }
    return {
      allowed: false,
      reason: 'no-run-of-workflow',
      refusal: composeUndeclaredToolRefusal(
        'workflow_tools',
        calledName,
        `for any active step (no run of workflow '${workflowName}' is in progress)`,
      ),
    };
  }

  const currentSteps: string[] = [];
  let sawFreeze = false;
  for (const runId of runsOfW) {
    const m = readRunManifest(agentDir, runId);
    if (m === null) continue;
    if (m.step_tools === undefined) {
      return { allowed: true, reason: 'no-freeze' };
    }
    sawFreeze = true;
    for (const cur of activeStepsOf(m)) {
      currentSteps.push(cur);
      if (setContainsScript(m.step_tools[cur], calledName)) {
        return { allowed: true, reason: 'declared' };
      }
    }
  }
  if (!sawFreeze) {
    return { allowed: true, reason: 'no-freeze' };
  }

  const curLabel = currentSteps.length > 0 ? currentSteps.join("', '") : '<none>';
  return {
    allowed: false,
    reason: 'undeclared',
    refusal: composeUndeclaredToolRefusal(
      'workflow_tools',
      calledName,
      `for the current step of any in-progress run of workflow '${workflowName}' ` +
        `(current step: '${curLabel}')`,
    ),
  };
}
