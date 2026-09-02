import { GATE_LEDGER_SCHEMA } from '../types/gate-result.js';
export { GATE_LEDGER_SCHEMA };
export function resolveStructuralGate(workflowGate, stepGate) {
    const wf = (workflowGate ?? {});
    const step = (stepGate ?? {});
    const wfStructural = wf.structural ?? true;
    return step.structural ?? wfStructural;
}
export const STRUCTURAL_GATE_DISABLED_DETAIL = 'Structural gate disabled (structural: false) — skipping validation';
export function emptyLedger(step, runToken) {
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
export function ledgerForStep(prev, step, runToken) {
    if (prev &&
        prev.schema === GATE_LEDGER_SCHEMA &&
        prev.step === step &&
        (prev.run_token ?? '') === runToken &&
        prev.branches &&
        typeof prev.branches === 'object') {
        return prev;
    }
    return emptyLedger(step, runToken);
}
function epoch(ts) {
    if (!ts)
        return NaN;
    return Date.parse(ts);
}
export function upsertBranch(ledger, obs) {
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
export function recomputeAggregate(ledger) {
    const keys = Object.keys(ledger.branches);
    if (keys.length === 0)
        return;
    const sorted = keys
        .map((k) => Number.parseInt(k, 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
    let checks = 0;
    let failures = 0;
    let maxLoop = 0;
    const details = [];
    const failed = [];
    const branchResults = [];
    for (const bi of sorted) {
        const r = ledger.branches[String(bi)];
        if (!r)
            continue;
        checks += r.checks;
        failures += r.failures;
        maxLoop = Math.max(maxLoop, r.loop_count);
        for (const d of r.details)
            details.push(`[branch ${bi}] ${d}`);
        if (!r.passed)
            failed.push(bi);
        branchResults.push({
            branch_index: bi,
            passed: r.passed,
            checks: r.checks,
            failures: r.failures,
            details: [...r.details],
        });
    }
    let passed;
    if (failed.length === 0)
        passed = true;
    else if (failed.length === branchResults.length)
        passed = false;
    else
        passed = true;
    ledger.passed = passed;
    ledger.failed_branches = failed;
    ledger.checks = checks;
    ledger.failures = failures;
    ledger.details = details;
    ledger.loop_count = maxLoop;
    ledger.branch_results = branchResults;
}
export function maxLoopOverBranches(ledger, branchIndices) {
    let max = 0;
    for (const bi of branchIndices) {
        const r = ledger.branches[String(bi)];
        if (r)
            max = Math.max(max, r.loop_count);
    }
    return max;
}
export function stepGateFlag(wfGate, stepGate, key) {
    return Object.prototype.hasOwnProperty.call(stepGate, key)
        ? Boolean(stepGate[key])
        : Boolean(wfGate[key] ?? false);
}
export function humanGateConfig(wfGate, stepGate) {
    const raw = Object.prototype.hasOwnProperty.call(stepGate, 'human')
        ? stepGate.human
        : (wfGate.human ?? false);
    if (typeof raw === 'object' && raw !== null && typeof raw.script === 'string') {
        return { script: raw.script };
    }
    return raw === true;
}
export function resolveHumanChannel(wfGate, stepGate) {
    const raw = Object.prototype.hasOwnProperty.call(stepGate, 'human_channel')
        ? stepGate.human_channel
        : wfGate.human_channel;
    return raw === 'external' || raw === 'both' ? raw : 'terminal';
}
export const isExternalChannel = (raw) => raw === 'external' || raw === 'both';
export function stepAwaitsExternalHuman(wfGate, stepGate) {
    return (stepGateFlag(wfGate, stepGate, 'human') &&
        isExternalChannel(resolveHumanChannel(wfGate, stepGate)));
}
