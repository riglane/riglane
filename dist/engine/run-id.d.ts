export declare function runIdTimestamp(d?: Date): string;
export declare function generateRunId(workflowName: string, now?: Date): string;
export declare function isValidRunId(s: string): boolean;
export declare function workflowFromRunId(runId: string): string | null;
