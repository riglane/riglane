export declare const USER_STATE_DIR: string;
export declare const ACTIVE_WORKFLOW_FILE: string;
export declare function readActiveWorkflow(root?: string): string | null;
export declare function writeActiveWorkflow(name: string, root?: string): void;
export declare function clearActiveWorkflow(root?: string): boolean;
export type ActiveWorkflowSource = 'env' | 'marker' | 'none';
export declare function resolveActiveWorkflow(root?: string, env?: NodeJS.ProcessEnv): [string | null, ActiveWorkflowSource];
