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
export declare function resolveStructuralGate(workflowGate: unknown, stepGate: unknown): boolean;
export declare const STRUCTURAL_GATE_DISABLED_DETAIL = "Structural gate disabled (structural: false) \u2014 skipping validation";
export declare function emptyLedger(step: string, runToken: string): GateLedgerV2;
export declare function ledgerForStep(prev: Partial<GateLedgerV2> | null | undefined, step: string, runToken: string): GateLedgerV2;
export declare function upsertBranch(ledger: GateLedgerV2, obs: BranchObservation): void;
export declare function recomputeAggregate(ledger: GateLedgerV2): void;
export declare function maxLoopOverBranches(ledger: GateLedgerV2, branchIndices: number[]): number;
export declare function stepGateFlag(wfGate: Record<string, unknown>, stepGate: Record<string, unknown>, key: 'semantic' | 'human'): boolean;
export declare function humanGateConfig(wfGate: Record<string, unknown>, stepGate: Record<string, unknown>): boolean | {
    script: string;
};
export type HumanChannel = 'terminal' | 'external' | 'both';
export declare function resolveHumanChannel(wfGate: Record<string, unknown>, stepGate: Record<string, unknown>): HumanChannel;
export declare const isExternalChannel: (raw: unknown) => boolean;
export declare function stepAwaitsExternalHuman(wfGate: Record<string, unknown>, stepGate: Record<string, unknown>): boolean;
