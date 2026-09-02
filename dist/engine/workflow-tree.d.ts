export interface StepTreeWorkflow {
    readonly steps?: unknown;
}
export declare function collectAllSteps(workflow: StepTreeWorkflow): Array<Record<string, unknown>>;
export declare function findStepConfig(workflow: StepTreeWorkflow, stepName: string): Record<string, unknown> | null;
