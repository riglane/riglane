import type { IsoDateTime, Sha256Hex, StepName } from './branded.js';
import type { SnapshotWriteProofMode } from './enums.js';
export interface Snapshot {
    readonly step: StepName;
    readonly created_at: IsoDateTime;
    readonly global: Readonly<Record<string, OutputSnapshot>>;
    readonly branches: Readonly<Record<string, BranchSnapshot>>;
}
export interface BranchSnapshot {
    readonly branch_dir: string;
    readonly outputs: Readonly<Record<string, OutputSnapshot>>;
}
export interface OutputSnapshot {
    readonly write_proof: SnapshotWriteProofMode;
    readonly baseline: Readonly<Record<string, FileFingerprint>>;
}
export interface FileFingerprint {
    readonly exists: boolean;
    readonly mtime: number | null;
    readonly sha256: Sha256Hex | null;
    readonly size: number | null;
}
