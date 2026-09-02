import type { SpawnSyncReturns } from 'node:child_process';
export type SpawnFn = (command: string, args: ReadonlyArray<string>, options: {
    cwd?: string;
    timeout?: number;
    encoding?: 'utf-8' | 'buffer';
}) => SpawnSyncReturns<string | Buffer>;
export interface MigrateOptions {
    readonly dryRun?: boolean;
    readonly backupTo?: string;
    readonly templatesRoot?: string;
    readonly spawnTar?: SpawnFn;
    readonly spawnGit?: SpawnFn;
}
interface InternalOptions {
    readonly dryRun: boolean;
    readonly backupTo: string | null;
    readonly srcRoot: string;
    readonly spawnTar: SpawnFn;
    readonly spawnGit: SpawnFn;
}
export declare function isCopyBased(target: string): boolean;
export declare function firstLegacyDir(target: string): string | null;
export declare function preflight(target: string, opts: InternalOptions): boolean;
export declare function makeBackup(target: string, opts: InternalOptions): string;
export declare function deleteEngineFiles(target: string, opts: InternalOptions): string[];
export declare function refreshPredefinedWorkflows(target: string, opts: InternalOptions): void;
export declare function rewriteMcpJson(path: string, opts: InternalOptions): void;
export declare function rewriteClaudeSettings(target: string, opts: InternalOptions): void;
export declare function rewriteCursorHooks(target: string, opts: InternalOptions): void;
export declare function appendGitignoreBackupPattern(target: string, opts: InternalOptions): void;
export declare function renameRiglaneDir(target: string, opts: InternalOptions): boolean;
export declare function runMigrate(target: string, opts?: MigrateOptions): Promise<number>;
export {};
