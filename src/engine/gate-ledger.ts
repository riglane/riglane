
import type { BranchRecord, GateLedgerV2, LegacyBranchResult } from '../types/gate-result.js';
import { GATE_LEDGER_SCHEMA } from '../types/gate-result.js';

export { GATE_LEDGER_SCHEMA };
export type { BranchRecord, GateLedgerV2, LegacyBranchResult };

export interface BranchObservation {
  branchIndex: number;
  passed: boolean;
  checks: number;
  failures: number;
  details: string[];
  loopCount: number;
  validatedAt: string;
  source: 'hook' | 'engine-inline';
}

export function resolveStructuralGate(workflowGate: unknown, stepGate: unknown): boolean {
  const wf = (workflowGate ?? {}) as Record<string, unknown>;
  const step = (stepGate ?? {}) as Record<string, unknown>;
  const wfStructural = (wf.structural as boolean | undefined) ?? true;
  return (step.structural as boolean | undefined) ?? wfStructural;
}

export const STRUCTURAL_GATE_DISABLED_DETAIL =
  'Structural gate disabled (structural: false) — skipping validation';

export function emptyLedger(step: string, runToken: string): GateLedgerV2 {
  return {
    step,
    run_token: runToken,
    schema: GATE_LEDGER_SCHEMA,
    branches: {},
    passed: true,
    failed_branches: [],
    checks: 0,
    failures: 0,
    details: [],
    loop_count: 0,
  };
}

export function ledgerForStep(
  prev: Partial<GateLedgerV2> | null | undefined,
  step: string,
  runToken: string,
): GateLedgerV2 {
  if (
    prev &&
    prev.schema === GATE_LEDGER_SCHEMA &&
    prev.step === step &&
    (prev.run_token ?? '') === runToken &&
    prev.branches &&
    typeof prev.branches === 'object'
  ) {
    return prev as GateLedgerV2;
  }
  return emptyLedger(step, runToken);
}

function epoch(ts: string | undefined): number {
  if (!ts) return NaN;
  return Date.parse(ts);
}

export function upsertBranch(ledger: GateLedgerV2, obs: BranchObservation): void {
  const key = String(obs.branchIndex);
  const existing = ledger.branches[key];
  const monotonicLoop = Math.max(existing?.loop_count ?? 0, obs.loopCount);

  if (existing) {
    const prevAt = epoch(existing.validated_at);
    const newAt = epoch(obs.validatedAt);
    if (Number.isFinite(prevAt) && Number.isFinite(newAt) && newAt < prevAt) {
      existing.loop_count = monotonicLoop;
      return;
    }
  }

  ledger.branches[key] = {
    passed: obs.passed,
    checks: obs.checks,
    failures: obs.failures,
    details: [...obs.details],
    loop_count: monotonicLoop,
    validated_at: obs.validatedAt,
    source: obs.source,
  };
}

export function recomputeAggregate(ledger: GateLedgerV2): void {
  const keys = Object.keys(ledger.branches);
  if (keys.length === 0) return;

  const sorted = keys
    .map((k) => Number.parseInt(k, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  let checks = 0;
  let failures = 0;
  let maxLoop = 0;
  const details: string[] = [];
  const failed: number[] = [];
  const branchResults: LegacyBranchResult[] = [];

  for (const bi of sorted) {
    const r = ledger.branches[String(bi)];
    if (!r) continue;
    checks += r.checks;
    failures += r.failures;
    maxLoop = Math.max(maxLoop, r.loop_count);
    for (const d of r.details) details.push(`[branch ${bi}] ${d}`);
    if (!r.passed) failed.push(bi);
    branchResults.push({
      branch_index: bi,
      passed: r.passed,
      checks: r.checks,
      failures: r.failures,
      details: [...r.details],
    });
  }

  let passed: boolean;
  if (failed.length === 0) passed = true;
  else if (failed.length === branchResults.length) passed = false;
  else passed = true;

  ledger.passed = passed;
  ledger.failed_branches = failed;
  ledger.checks = checks;
  ledger.failures = failures;
  ledger.details = details;
  ledger.loop_count = maxLoop;
  ledger.branch_results = branchResults;
}

export function maxLoopOverBranches(ledger: GateLedgerV2, branchIndices: number[]): number {
  let max = 0;
  for (const bi of branchIndices) {
    const r = ledger.branches[String(bi)];
    if (r) max = Math.max(max, r.loop_count);
  }
  return max;
}


export function stepGateFlag(
  wfGate: Record<string, unknown>,
  stepGate: Record<string, unknown>,
  key: 'semantic' | 'human',
): boolean {
  return Object.prototype.hasOwnProperty.call(stepGate, key)
    ? Boolean(stepGate[key])
    : Boolean(wfGate[key] ?? false);
}

export function humanGateConfig(
  wfGate: Record<string, unknown>,
  stepGate: Record<string, unknown>,
): boolean | { script: string } {
  const raw = Object.prototype.hasOwnProperty.call(stepGate, 'human')
    ? stepGate.human
    : (wfGate.human ?? false);
  if (typeof raw === 'object' && raw !== null && typeof (raw as { script?: unknown }).script === 'string') {
    return { script: (raw as { script: string }).script };
  }
  return raw === true;
}

export type HumanChannel = 'terminal' | 'external' | 'both';

export function resolveHumanChannel(
  wfGate: Record<string, unknown>,
  stepGate: Record<string, unknown>,
): HumanChannel {
  const raw = Object.prototype.hasOwnProperty.call(stepGate, 'human_channel')
    ? stepGate.human_channel
    : wfGate.human_channel;
  return raw === 'external' || raw === 'both' ? raw : 'terminal';
}

export const isExternalChannel = (raw: unknown): boolean => raw === 'external' || raw === 'both';

export function stepAwaitsExternalHuman(
  wfGate: Record<string, unknown>,
  stepGate: Record<string, unknown>,
): boolean {
  return (
    stepGateFlag(wfGate, stepGate, 'human') &&
    isExternalChannel(resolveHumanChannel(wfGate, stepGate))
  );
}
