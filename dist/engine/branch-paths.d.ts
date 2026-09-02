export interface BranchPathResult {
    readonly workingPath: string;
    readonly semanticPath: string;
    readonly scaffolded: boolean;
    readonly autoFallback: boolean;
}
export declare class BranchPathError extends Error {
    constructor(message: string);
}
export declare function resolveBranchPath(rawPath: string, params: Record<string, unknown>, branchItem: unknown, branchIndex: number): BranchPathResult;
export declare function assertBranchPathsUnique(results: ReadonlyArray<BranchPathResult>): void;
