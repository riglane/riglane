export declare function installedPredefinedDir(target: string): string;
export declare function installedMyWorkflowsDir(target: string): string;
export declare function predefinedHashesPath(target: string): string;
export declare function computePredefinedHashes(target: string): Record<string, string>;
export declare function writePredefinedHashes(target: string): void;
export declare function readPredefinedHashes(target: string): Record<string, string> | null;
export declare function detectEditedPredefinedWorkflows(target: string): string[];
export interface PromotedWorkflow {
    readonly name: string;
    readonly note: string;
}
export interface PromoteConflict {
    readonly name: string;
    readonly reason: string;
}
export interface PromoteReport {
    readonly promoted: PromotedWorkflow[];
    readonly conflicts: PromoteConflict[];
}
export interface PromoteOptions {
    readonly dryRun?: boolean;
    readonly pkgTemplatesRoot?: string;
}
export declare function promoteEditedPredefinedWorkflows(target: string, opts?: PromoteOptions): PromoteReport;
