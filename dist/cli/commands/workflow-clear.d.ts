import { type EnginePaths } from '../../engine/workflow-engine.js';
export interface WorkflowClearOptions {
    readonly finalize?: (name: string, paths: EnginePaths) => {
        status: string;
        run_id: string;
    };
    readonly runId?: string;
}
export interface ClearResult {
    readonly name: string;
    readonly cleared: boolean;
    readonly reason: 'no-run' | 'not-in-progress' | 'owner-alive' | 'cleared' | 'unknown-run';
    readonly status?: string;
    readonly run_id?: string;
    readonly owner_pid?: number;
    readonly detail?: string;
}
export declare function clearWorkflowRun(name: string, target: string, options?: WorkflowClearOptions): ClearResult;
export declare function runWorkflowClear(args: string[], options?: WorkflowClearOptions): Promise<number>;
