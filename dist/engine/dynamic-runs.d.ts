export declare function dynamicRootDir(agentDir: string, parentRunId: string): string;
export declare function dynamicRuntimeDir(agentDir: string, parentRunId: string, stepName: string): string;
export declare function dynamicWorkflowPath(agentDir: string, parentRunId: string, stepName: string): string;
export declare function ensureDynamicRuntimeDir(agentDir: string, parentRunId: string, stepName: string): string;
export declare function dynamicRuntimeDirExists(agentDir: string, parentRunId: string, stepName: string): boolean;
export declare function dynamicChildWorkflowName(parentWorkflow: string, parentRunId: string, stepName: string): string;
export interface DynamicOriginMeta {
    readonly parent_workflow: string;
    readonly parent_run_id: string;
    readonly parent_step: string;
    readonly parent_goal: string;
    readonly generated_at: string;
    readonly generated_by_orchestrator_model?: string;
}
export declare function composeDynamicWorkflowYaml(parsedDraft: Record<string, unknown>, childWorkflowName: string, origin: DynamicOriginMeta): string;
export declare function writeDynamicWorkflow(agentDir: string, parentWorkflow: string, parentRunId: string, stepName: string, parsedDraft: Record<string, unknown>, origin: DynamicOriginMeta): {
    path: string;
    childName: string;
};
export declare function copyStructsToDynamicRuntime(parentDefinitionDir: string, childWorkflowYamlPath: string): boolean;
