import type { AgentNotesSearchInput, AgentNotesSearchOutput, AgentNotesWriteInput, AgentNotesWriteOutput, EngineRunOverrides, StepBeginDynamicInput, StepBeginDynamicOutput, StepCollectResultDynamicInput, StepCollectResultDynamicOutput, StepCompleteDynamicInput, StepCompleteDynamicOutput, WorkflowFinalizeDynamicInput, WorkflowFinalizeDynamicOutput, WorkflowInitInput, WorkflowInitOutput, WorkflowInvokeDynamicInput, WorkflowInvokeDynamicOutput, WorkflowResolveInput, WorkflowResolveOutput, WorkflowResumeInput, WorkflowResumeOutput, WorkflowValidateDynamicInput, WorkflowValidateDynamicOutput, WorkflowValidateInput, WorkflowValidateOutput } from '../types/mcp.js';
import type { Trace } from '../types/trace.js';
import type { PlanningRestrictions, Workflow } from '../types/workflow.js';
import type { LintWarning } from './workflow-lint.js';
import type { Host } from '../types/enums.js';
import { collectAllSteps } from './workflow-tree.js';
export interface EnginePaths {
    readonly agentDir: string;
    readonly workflowsDir: string;
    readonly templatesDir: string;
    readonly predefinedDir: string;
    readonly myWorkflowsDir: string;
    readonly examplesDir: string;
    readonly communityDir: string;
}
export declare function defaultPaths(cwd?: string): EnginePaths;
export declare function safeWriteJson(path: string, data: unknown): void;
export declare function safeWriteText(path: string, content: string): void;
export declare function clearWorkflowCache(): void;
export { collectAllSteps };
export declare function fullValidateWorkflow(workflow: Workflow, opts?: {
    readonly definitionDir?: string;
}): {
    ok: boolean;
    errors: string[];
    warnings: LintWarning[];
};
export declare function validateDynamicWorkflow(rawYaml: string, parentDefinitionDir: string, restrictions: PlanningRestrictions): {
    ok: boolean;
    errors: string[];
};
export declare function composePlanningProcedure(stepTemplateName: string, resolvedGoal: string, restrictions: PlanningRestrictions, attempts: number): string;
export declare function toolWorkflowValidateDynamic(args: WorkflowValidateDynamicInput, paths?: EnginePaths): WorkflowValidateDynamicOutput;
export declare function toolWorkflowValidate(args: WorkflowValidateInput, paths?: EnginePaths): WorkflowValidateOutput;
export declare function toolDynamicWorkflowInit(args: {
    parent_workflow: string;
    parent_run_id: string;
    parent_step: string;
    child_workflow_yaml_path: string;
    inherit_params?: Record<string, unknown>;
}, paths?: EnginePaths): WorkflowInitOutput;
export declare function toolWorkflowInvokeDynamic(args: WorkflowInvokeDynamicInput, paths?: EnginePaths): WorkflowInvokeDynamicOutput;
export declare function resolveDynamicChildContext(parentWorkflow: string, parentStep: string, paths?: EnginePaths): {
    child_workflow_path: string;
    child_workflow_name: string;
} | {
    error: string;
};
export declare function toolStepBeginDynamic(args: StepBeginDynamicInput, paths?: EnginePaths): StepBeginDynamicOutput;
export declare function toolStepCollectResultDynamic(args: StepCollectResultDynamicInput, paths?: EnginePaths): StepCollectResultDynamicOutput;
export declare function toolWorkflowFinalizeDynamic(args: WorkflowFinalizeDynamicInput, paths?: EnginePaths): WorkflowFinalizeDynamicOutput;
export declare function toolWorkflowReplanDynamic(args: {
    parent_workflow: string;
    parent_step: string;
}, paths?: EnginePaths): Record<string, unknown>;
export declare function toolAgentNotesWrite(args: AgentNotesWriteInput, paths?: EnginePaths): AgentNotesWriteOutput;
export declare function toolAgentNotesSearch(args: AgentNotesSearchInput, paths?: EnginePaths): AgentNotesSearchOutput;
export interface InboxPostInput {
    readonly name?: string;
    readonly workflow_name?: string;
    readonly step?: string;
    readonly message?: unknown;
}
export interface InboxRulesInput {
    readonly name?: string;
    readonly workflow_name?: string;
    readonly step?: string;
}
export declare function toolInboxRules(args: InboxRulesInput, paths?: EnginePaths): Record<string, unknown>;
export declare function toolInboxPost(args: InboxPostInput, paths?: EnginePaths): Promise<Record<string, unknown>>;
export interface InboxCheckInput {
    readonly name?: string;
    readonly workflow_name?: string;
    readonly message_id?: string;
    readonly wait_ms?: number;
}
export declare function toolInboxCheck(args: InboxCheckInput, paths?: EnginePaths): Promise<Record<string, unknown>>;
export interface InboxRespondInput {
    readonly name?: string;
    readonly workflow_name?: string;
    readonly message_id?: string;
    readonly type?: string;
    readonly text?: string;
    readonly args?: Record<string, unknown>;
    readonly items?: Record<string, {
        type: string;
        text?: string;
        args?: Record<string, unknown>;
    }>;
}
export declare function toolInboxRespond(args: InboxRespondInput, paths?: EnginePaths): Promise<Record<string, unknown>>;
export declare function toolInboxAsk(args: InboxInput, paths?: EnginePaths): Promise<Record<string, unknown>>;
export interface InboxInput {
    readonly op?: string;
    readonly name?: string;
    readonly workflow_name?: string;
    readonly step?: string;
    readonly message?: unknown;
    readonly message_id?: string;
    readonly wait_ms?: number;
    readonly type?: string;
    readonly text?: string;
    readonly args?: Record<string, unknown>;
    readonly items?: Record<string, {
        type: string;
        text?: string;
        args?: Record<string, unknown>;
    }>;
}
export declare function toolInbox(args: InboxInput, paths?: EnginePaths): Promise<Record<string, unknown>>;
export declare function toolStepCompleteDynamic(args: StepCompleteDynamicInput, paths?: EnginePaths): StepCompleteDynamicOutput;
export declare function resolveWorkflow(name: string, paths?: EnginePaths): {
    definitionDir: string;
    workflow: Workflow;
};
import { resolvePlaceholders } from './placeholders.js';
export { resolvePlaceholders };
export declare function isPurePlaceholderSegment(segment: string): boolean;
export declare function readJsonField(data: unknown, fieldPath: string): unknown;
export interface ParsedParallelKey {
    readonly structName: string;
    readonly fieldPath: string;
    readonly filterKey?: string;
    readonly filterVal?: string;
}
export declare function parseParallelKey(parallelKey: string): ParsedParallelKey;
export declare function resolveParallelBranches(parallelKey: string, runtimeDir: string, workflow?: {
    steps?: ReadonlyArray<Record<string, unknown>>;
}, params?: Record<string, unknown>): unknown[];
export declare function normalizeForMcp(name: string | null | undefined): string;
export interface ActiveToolDescriptor {
    readonly name?: string;
    readonly type?: string;
    readonly description?: string;
    readonly command?: string;
    readonly input_schema?: Record<string, unknown>;
    readonly expected_tools?: readonly string[];
}
export declare function renderToolDocsBrief(activeTools: readonly ActiveToolDescriptor[], workflowName: string, host?: Host | null): string;
export declare function renderToolDocsFull(activeTools: readonly ActiveToolDescriptor[], workflowName: string, host?: Host | null): string;
export interface ToolConfig {
    readonly name?: string;
    readonly type?: string;
    readonly command?: string;
    readonly required?: boolean;
    readonly server_config?: Record<string, unknown>;
    readonly [key: string]: unknown;
}
export interface ToolsAvailabilityReport {
    readonly available: readonly Record<string, unknown>[];
    readonly missing: readonly Record<string, unknown>[];
}
export declare function checkToolsAvailability(toolsConfig: readonly ToolConfig[]): ToolsAvailabilityReport;
import type { McpCallLogEntry } from '../types/mcp.js';
export declare function mcpCallLog(): readonly McpCallLogEntry[];
export declare function appendMcpCall(entry: McpCallLogEntry): void;
export declare function clearMcpCallLog(): void;
export declare function toolWorkflowResolve(args: WorkflowResolveInput, paths?: EnginePaths): WorkflowResolveOutput;
export declare function _resetPendingDelegation(): void;
export declare function toolWorkflowInit(args: WorkflowInitInput, paths?: EnginePaths, overrides?: EngineRunOverrides): WorkflowInitOutput;
export declare function toolWorkflowResume(args: WorkflowResumeInput, paths?: EnginePaths): WorkflowResumeOutput;
export type { Trace };
import type { StepBeginInput, StepBeginOutput } from '../types/mcp.js';
import { type SnapshotBranchInput } from './output-validator.js';
export declare function createStepSnapshot(stepName: string, stepConfig: Record<string, unknown>, runtimeDir: string, params: Record<string, unknown>, branches?: ReadonlyArray<SnapshotBranchInput>): void;
interface StepBeginError {
    readonly error: string;
    readonly action?: string;
    readonly step?: string;
    readonly previous_step?: string;
    readonly blocked_reason?: string;
    readonly failed_branches?: readonly unknown[];
    readonly expected_step?: string;
    readonly requested_step?: string;
}
export declare function toolStepBegin(args: StepBeginInput, paths?: EnginePaths, overrides?: EngineRunOverrides): StepBeginOutput | StepBeginError;
export type { HumanChannel } from './gate-ledger.js';
export declare function workflowMayNeedExternalChannel(workflow: Workflow): boolean;
import type { StepCollectResultInput, StepCollectResultOutput } from '../types/mcp.js';
export declare function toolStepCollectResult(args: StepCollectResultInput, paths?: EnginePaths, overrides?: EngineRunOverrides): StepCollectResultOutput;
import type { StepCompleteInput, StepCompleteOutput, WorkflowFinalizeInput, WorkflowFinalizeOutput } from '../types/mcp.js';
export declare function toolStepComplete(args: StepCompleteInput, paths?: EnginePaths, overrides?: EngineRunOverrides): StepCompleteOutput;
export declare function toolWorkflowFinalize(args: WorkflowFinalizeInput, paths?: EnginePaths, overrides?: EngineRunOverrides): WorkflowFinalizeOutput;
export declare function fnmatch(name: string, pattern: string): boolean;
export declare function toolListAgentFiles(args: Record<string, unknown>): {
    files: readonly string[];
    count: number;
} | {
    files: readonly [];
    error: string;
};
