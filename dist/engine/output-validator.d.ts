import type { FileFingerprint, Snapshot } from '../types/snapshot.js';
import type { ValidationResult as ValidationResultShape } from '../types/struct.js';
import type { Output } from '../types/workflow.js';
export declare function normalizePerIterationOutputs(workflow: Record<string, unknown>): void;
export declare function injectSpecAuthoringOutputs(workflow: Record<string, unknown>): void;
export declare const SPEC_OUTPUT_SCOPED = ".riglane/specs/{scope}/**/*.md";
export declare const SPEC_OUTPUT_GENERIC = ".riglane/specs/generic/**/*.md";
export declare function resolveOutputPath(pathTemplate: string, runtimeDir: string): string[];
export declare function computeFileFingerprint(filePath: string): FileFingerprint;
export declare function isTouched(current: FileFingerprint, baseline: FileFingerprint | null, stepStartedAt: string | null): boolean;
export declare function parseIsoTimestamp(isoStr: string): number;
export declare const SNAPSHOT_DIR: string;
export declare function loadSnapshot(runtimeDir: string, stepName: string): Snapshot | null;
export declare function saveSnapshot(runtimeDir: string, stepName: string, snapshot: Snapshot): void;
export declare function deleteSnapshot(runtimeDir: string, stepName: string): boolean;
export interface SnapshotBranchInput {
    readonly branch_index: number;
    readonly branch_dir: string;
    readonly outputs: ReadonlyArray<Output | string>;
}
export declare function createSnapshot(outputs: ReadonlyArray<Output | string>, runtimeDir: string, stepName: string, branches?: ReadonlyArray<SnapshotBranchInput>): Snapshot;
export declare class MutableValidationResult {
    passed: boolean;
    checks: number;
    failures: number;
    readonly details: string[];
    readonly proofResults: ProofResultEntry[];
    addCheck(passed: boolean, detail?: string): void;
    addDetail(detail: string): void;
    extend(checks: number, failures: number, details: readonly string[]): void;
    snapshot(): ValidationResultShape;
}
export interface ProofResultEntry {
    readonly path: string;
    readonly mode: string;
    readonly status: 'touched' | 'stale';
}
export interface BranchFilter {
    readonly branch_index: number;
    readonly branch_dir: string;
}
export interface ValidateOutputsOptions {
    readonly snapshot?: Snapshot | null;
    readonly stepStartedAt?: string | null;
    readonly branchFilter?: BranchFilter | null;
    readonly params?: Record<string, unknown> | null;
    readonly waitForFiles?: boolean;
}
export declare function narrowOutputsForBranch(outputs: ReadonlyArray<Output | string>, branchIndex: number): Array<Output>;
export declare function branchOutputsFromResolved(declaredOutputs: ReadonlyArray<Output | string>, resolvedOutputs: ReadonlyArray<{
    readonly declared: string;
    readonly working: string;
    readonly struct?: string;
}>): Array<Output>;
export declare function validateOutputs(outputs: ReadonlyArray<Output | string>, definitionDir: string | null, runtimeDir: string, options?: ValidateOutputsOptions): ValidationResultShape;
