export interface UpdateWorkflowsOptions {
    readonly dryRun?: boolean;
    readonly cwd?: string;
    readonly stdout?: (s: string) => void;
    readonly stderr?: (s: string) => void;
}
export declare function findAllWorkflows(opts?: UpdateWorkflowsOptions): [string[], string[]];
export declare function findGlobalOrphans(knownWorkflowNames: readonly string[], opts?: UpdateWorkflowsOptions): string[];
export declare function deleteGlobalOrphan(name: string, opts?: UpdateWorkflowsOptions): void;
export interface Phase61OrphanReport {
    readonly orphanNotesDirs: readonly string[];
    readonly orphanDynamicByMissingWorkflow: readonly string[];
    readonly orphanDynamicByMissingStep: readonly string[];
}
export declare function findPhase61Orphans(opts?: UpdateWorkflowsOptions): Phase61OrphanReport;
export declare function renderPhase61OrphanReport(report: Phase61OrphanReport, opts?: UpdateWorkflowsOptions): void;
export interface UpdateWorkflowsResult {
    totals: {
        created: number;
        updated: number;
        unchanged: number;
        deleted: number;
    };
    failed: Array<[string, string]>;
    anyChanges: boolean;
}
export declare function updateWorkflows(opts?: UpdateWorkflowsOptions): Promise<UpdateWorkflowsResult>;
export declare function runUpdateWorkflowsCli(argv?: string[], opts?: UpdateWorkflowsOptions): Promise<number>;
