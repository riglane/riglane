export declare function normalizeName(name: string): string;
export declare function makeToolName(workflowName: string, toolName: string): string;
export declare function mcpServerToolName(serverName: string, toolName: string): string;
export declare const DENY_CAPABILITIES: readonly ["shell"];
export type DenyCapability = (typeof DENY_CAPABILITIES)[number];
export declare const DENY_SPELLINGS: Record<DenyCapability, {
    readonly claude: readonly string[];
    readonly opencode: readonly string[];
    readonly copilot: readonly string[];
    readonly gemini: readonly string[];
}>;
export declare function stepDeniedCapabilities(step: Record<string, unknown>): DenyCapability[];
export declare const SPEC_ENGINE_TOOLS: readonly string[];
export declare function stepAuthorsSpecs(step: Record<string, unknown>): boolean;
export interface ToolDeclaringWorkflow {
    name?: string;
    tools?: Array<Record<string, unknown>>;
    [key: string]: unknown;
}
export interface StepToolEntry {
    readonly kind: 'script' | 'mcp' | 'spec';
    readonly tool: string;
    readonly server?: string;
}
export declare function resolveStepToolEntries(workflow: ToolDeclaringWorkflow, step: Record<string, unknown>): StepToolEntry[];
export interface FrozenStepTool {
    readonly kind: 'script' | 'mcp' | 'spec';
    readonly name: string;
    readonly server?: string;
}
export interface BranchProfile {
    readonly tools?: readonly string[];
    readonly struct?: string;
}
export declare function stepBranchProfiles(step: Record<string, unknown>): Record<string, BranchProfile> | null;
export declare function profileIdForItem(item: unknown): string | null;
export declare function profileFreezeKey(stepName: string, profileId: string): string;
export declare function profileNarrowedStep(step: Record<string, unknown>, profile: BranchProfile): Record<string, unknown>;
export declare function freezeStepTools(workflow: ToolDeclaringWorkflow, allSteps: ReadonlyArray<Record<string, unknown>>): Record<string, FrozenStepTool[]>;
export declare function composeUndeclaredToolRefusal(prefix: string, toolLabel: string, scopeClause: string): string;
export type FrozenVerdict = 'declared' | 'undeclared' | 'no-freeze';
export declare function frozenVerdictForStep(agentDir: string, workflowName: string, stepName: string, calledName: string, profileId?: string): FrozenVerdict;
export declare function frozenMcpVerdictForStep(agentDir: string, workflowName: string, stepName: string, calledFullName: string, profileId?: string): FrozenVerdict;
export interface ScriptCallGuardVerdict {
    readonly allowed: boolean;
    readonly reason: 'declared' | 'zero-runs' | 'no-freeze' | 'no-run-of-workflow' | 'undeclared';
    readonly refusal?: string;
}
export declare function guardScriptToolCall(agentDir: string, workflowName: string, calledName: string): ScriptCallGuardVerdict;
