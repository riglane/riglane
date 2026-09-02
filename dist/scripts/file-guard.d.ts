import type { Host } from '../types/enums.js';
export declare const PROTECTED_PREFIXES: readonly string[];
export interface FileGuardOptions {
    readonly stdin?: string;
    readonly stderr?: (chunk: string) => void;
    readonly stdout?: (chunk: string) => void;
    readonly cwd?: string;
    readonly root?: string;
    readonly env?: Record<string, string | undefined>;
    readonly host?: Host;
    readonly argv?: readonly string[];
}
export declare function normalizePath(path: string, cwd: string): string;
export declare function isProtected(filePath: string, cwd: string): boolean;
export declare const PROTECTED_SPEC_FILE_RE: readonly RegExp[];
export declare const PROTECTED_TRUST_FILE_RE: RegExp;
export declare function protectedTrustFileReason(filePath: string, cwd: string): string | null;
export declare function protectedSpecFileReason(filePath: string, cwd: string): string | null;
export declare function protectedRunStateReason(filePath: string, cwd: string): string | null;
export type BoundaryVerdict = {
    readonly kind: 'allow';
} | {
    readonly kind: 'block';
    readonly reason: string;
} | {
    readonly kind: 'warn';
    readonly message: string;
    readonly runId: string;
};
export declare function checkOutputBoundary(filePath: string, projectRoot: string, sessionCwd: string, env: Record<string, string | undefined>): BoundaryVerdict;
export declare function parseApplyPatchTargets(command: string): string[];
export declare function extractWriteTargets(hookInput: Record<string, unknown>): string[];
export declare function runFileGuard(opts?: FileGuardOptions): Promise<number>;
