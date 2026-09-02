export interface Counts {
    new: number;
    updated: number;
    unchanged: number;
    skipped: number;
    pruned: number;
}
export declare function resetCounts(): void;
export declare function getCounts(): Counts;
export declare function bumpCount(key: keyof Counts, n?: number): void;
export interface InstallOptions {
    readonly force?: boolean;
    readonly update?: boolean;
    readonly dryRun?: boolean;
}
export declare function copyTree(src: string, dst: string, opts?: InstallOptions): string[];
export interface PruneOptions {
    readonly dryRun?: boolean;
    readonly excludeFiles?: ReadonlyArray<string>;
}
export declare function pruneTree(src: string, dst: string, opts?: PruneOptions): string[];
export declare function atomicWriteJson(path: string, data: unknown): void;
