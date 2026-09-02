export interface WorkflowRunState {
    params: Record<string, string>;
    target?: string;
    modelOverride?: string;
}
export declare function workflowParamsPath(): string;
export declare function loadWorkflowState(projectKey: string, workflow: string): WorkflowRunState;
export declare function saveWorkflowParam(projectKey: string, workflow: string, name: string, value: string): void;
export declare function saveWorkflowTarget(projectKey: string, workflow: string, target: string): void;
export declare function saveWorkflowModelOverride(projectKey: string, workflow: string, modelOverride: string): void;
