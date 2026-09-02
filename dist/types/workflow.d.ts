import type { ParamBindingRef, ParamName, StepName, ToolName, WorkflowName } from './branded.js';
import type { CarryForward, InjectMode, ToolType, WriteProofMode } from './enums.js';
export declare const MODEL_MODES: readonly ["inherit", "auto", "lightest", "strongest"];
export type ModelMode = (typeof MODEL_MODES)[number];
export declare function isModelMode(v: unknown): v is ModelMode;
export interface Workflow {
    readonly name: WorkflowName;
    readonly version: number;
    readonly description: string;
    readonly params?: readonly Param[];
    readonly gate?: WorkflowGateConfig;
    readonly context?: ContextConfig;
    readonly tools?: readonly Tool[];
    readonly parallel_spawn_delay_ms?: number;
    readonly inbox_webhook?: string;
    readonly steps: readonly Step[];
}
export interface Param {
    readonly name: ParamName;
    readonly description?: string;
    readonly required?: boolean;
    readonly default?: unknown;
}
export interface WorkflowGateConfig {
    readonly structural?: boolean;
    readonly semantic?: boolean;
    readonly human?: boolean | {
        readonly script: string;
    };
    readonly human_channel?: 'terminal' | 'external' | 'both';
    readonly max_step_retries?: number;
    readonly max_gate_retries?: number;
}
export type StepGateConfig = WorkflowGateConfig;
export interface ContextConfig {
    readonly carry_forward?: CarryForward;
}
export type Tool = ScriptTool | McpToolDependency;
export interface ScriptTool {
    readonly name: ToolName;
    readonly type: 'script';
    readonly command: string;
    readonly description: string;
    readonly input_schema?: Record<string, unknown>;
}
export interface McpToolDependency {
    readonly name: ToolName;
    readonly type: 'mcp';
    readonly required?: boolean;
    readonly expected_tools?: readonly string[];
    readonly server_config?: {
        readonly command?: string;
        readonly args?: readonly string[];
    };
}
export type ToolKind = ToolType;
export interface Step {
    readonly name: StepName;
    readonly goal?: string;
    readonly type?: 'planning';
    readonly max_plan_attempts?: number;
    readonly max_substeps?: number;
    readonly allow_parallel?: boolean;
    readonly allow_delegation?: boolean;
    readonly subagent?: boolean;
    readonly spec_check?: boolean;
    readonly spec_authoring?: 'persist' | 'validate';
    readonly tools?: readonly string[];
    readonly model?: ModelMode | null;
    readonly parallel?: boolean;
    readonly parallel_key?: string;
    readonly parallel_spawn_delay_ms?: number;
    readonly inputs?: readonly Input[];
    readonly outputs?: readonly Output[];
    readonly param_bindings?: ParamBindings;
    readonly carry_forward?: boolean;
    readonly delegate_to?: WorkflowName;
    readonly params?: Record<string, unknown>;
    readonly gate?: StepGateConfig;
    readonly loop_back?: LoopBackConfig;
    readonly routes?: RoutesConfig;
}
export interface LoopBackConfig {
    readonly to: StepName;
    readonly max_iterations: number;
    readonly when: {
        readonly script?: string;
        readonly semantic?: string;
        readonly human?: boolean;
        readonly human_channel?: 'terminal' | 'external' | 'both';
    };
}
export interface RoutesConfig {
    readonly when: {
        readonly script?: string;
        readonly semantic?: string;
        readonly human?: boolean;
        readonly human_channel?: 'terminal' | 'external' | 'both';
    };
    readonly define: readonly RouteDef[];
}
export interface RouteDef {
    readonly id: string;
    readonly steps: readonly Step[];
}
export interface PlanningRestrictions {
    readonly maxSubsteps: number;
    readonly maxPlanAttempts: number;
    readonly allowParallel: boolean;
    readonly allowDelegation: boolean;
}
export declare const PLANNING_DEFAULTS: PlanningRestrictions;
export declare function resolvePlanningRestrictions(step: Step): PlanningRestrictions;
export interface Input {
    readonly path: string;
    readonly inject?: InjectMode;
    readonly struct?: string;
}
export interface Output {
    readonly path: string;
    readonly struct?: string;
    readonly write_proof?: WriteProofMode;
    readonly optional?: boolean;
    readonly per_iteration?: boolean;
    readonly from_delegated?: string;
}
export type ParamBindings = Readonly<Record<string, ParamBindingRef>>;
