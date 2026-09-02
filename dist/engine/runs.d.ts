export declare function runsRootDir(agentDir: string): string;
export declare function runDir(agentDir: string, runId: string): string;
export declare function runManifestPath(agentDir: string, runId: string): string;
export declare function runTracePath(agentDir: string, runId: string): string;
export declare function runDataDir(agentDir: string, runId: string): string;
export declare function runToolEventsPath(agentDir: string, runId: string): string;
export declare function ensureRunDir(agentDir: string, runId: string): string;
export type RunEventKind = 'started' | 'finalized' | 'aborted';
export interface RunEvent {
    readonly run_id: string;
    readonly workflow: string;
    readonly event: RunEventKind;
    readonly status?: string;
    readonly at: string;
}
export declare function runIndexPath(agentDir: string): string;
export declare function appendRunEvent(agentDir: string, evt: RunEvent): void;
export declare function findRunsByWorkflow(agentDir: string, workflowName: string, status?: string): string[];
export declare function findInProgressRuns(agentDir: string): string[];
export declare function readRunIndex(agentDir: string): RunEvent[];
