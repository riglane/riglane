
import type { IsoDateTime, RunId, RunToken, StepName, WorkflowName } from './branded.js';
import type {
  StepCollectAction,
  StepCompleteAction,
  TerminalWorkflowStatus,
  WorkflowStatus,
} from './enums.js';


export interface ToolCallSuccess<TResult = unknown> {
  readonly content: readonly [
    {
      readonly type: 'text';
      readonly text: string;
    },
    ...ReadonlyArray<{ readonly type: 'text'; readonly text: string }>,
  ];
  readonly __resultType?: TResult;
}

export interface ToolCallError {
  readonly content: readonly [
    { readonly type: 'text'; readonly text: string },
    ...ReadonlyArray<{ readonly type: 'text'; readonly text: string }>,
  ];
  readonly isError: true;
}

export type ToolCallEnvelope<TResult = unknown> = ToolCallSuccess<TResult> | ToolCallError;


export interface WorkflowResolveInput {
  readonly name: WorkflowName;
}

export interface WorkflowResolveOutput {
  readonly name: WorkflowName;
  readonly version: number;
  readonly description: string;
  readonly definition_dir: string;
  readonly params: readonly Readonly<Record<string, unknown>>[];
  readonly gate: Readonly<Record<string, unknown>>;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly steps: readonly WorkflowResolveStepEntry[];
  readonly step_count: number;
  readonly tools?: readonly Readonly<Record<string, unknown>>[];
  readonly [key: string]: unknown;
}

export interface WorkflowResolveStepEntry {
  readonly name: StepName;
  readonly delegate_to?: WorkflowName;
  readonly parallel?: boolean;
  readonly gate_override?: Readonly<Record<string, unknown>>;
  readonly model?: string;
}


export interface WorkflowInitInput {
  readonly name: WorkflowName;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly model_override?: string;

  readonly trace_viewer?: string;
  readonly inbox_webhook?: string;
}

export interface EngineRunOverrides {
  readonly runtimeDir?: string;
  readonly workflowYamlPath?: string;
}

export interface WorkflowInitSuccess {
  readonly run_id: RunId;
  readonly run_token: RunToken;
  readonly runtime_dir: string;
  readonly first_step: StepName | null;
  readonly total_steps: number;
  readonly step_names: readonly StepName[];
  readonly params: Readonly<Record<string, unknown>>;
  readonly tools?: WorkflowInitToolsReport;
  readonly scope_warning?: string;
  readonly next_begin?: StepBeginOutput;
  readonly [key: string]: unknown;
}

export interface WorkflowInitToolsReport {
  readonly available?: readonly unknown[];
  readonly missing?: readonly unknown[];
  readonly blocked?: boolean;
  readonly block_message?: string;
}

export interface WorkflowInitError {
  readonly error: string;
  readonly active_run_id?: RunId;
}

export type WorkflowInitOutput = WorkflowInitSuccess | WorkflowInitError;


export interface WorkflowResumeInput {
  readonly name: WorkflowName;
  readonly run_id?: RunId;
}

export interface WorkflowResumeSuccess {
  readonly run_id: RunId;
  readonly run_token: RunToken;
  readonly runtime_dir: string;
  readonly status: WorkflowStatus;
  readonly current_step: StepName | null;
  readonly current_step_status?: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly completed_summaries: Readonly<Record<string, string>>;
  readonly steps: Readonly<Record<string, unknown>>;
  readonly warning?: string;
  readonly [key: string]: unknown;
}

export interface WorkflowResumeError {
  readonly error: string;
}

export type WorkflowResumeOutput = WorkflowResumeSuccess | WorkflowResumeError;


export interface StepBeginInput {
  readonly name: WorkflowName;
  readonly step: StepName;
}

export type StepBeginOutput =
  | StepBeginRegular
  | StepBeginDelegation
  | StepBeginParallel
  | StepBeginPlanning;

export interface StepBeginRegular {
  readonly type: 'regular';
  readonly step_name: StepName;
  readonly step_index: number;
  readonly subagent: boolean;
  readonly subagent_type?: string | null;
  readonly prompt_file?: string;
  readonly spawn_prompt?: string;
  readonly goal?: string;
  readonly tool_docs?: string;
  readonly params_text?: string;
  readonly inputs?: readonly unknown[];
  readonly outputs_text?: string;
  readonly output_schemas?: readonly unknown[];
  readonly summaries_text?: string;
  readonly spec_guidance_text?: string;
  readonly constraints_text?: string;
  readonly run_token_text?: string;
  readonly model?: string | null;
  readonly gate?: { readonly semantic: boolean; readonly human: boolean | 'conditional' };
  readonly subagent_warning?: string;
  readonly [key: string]: unknown;
}

export interface StepBeginDelegation {
  readonly type: 'delegation';
  readonly step_name: StepName;
  readonly delegate_to: WorkflowName;
  readonly resolved_params: Readonly<Record<string, unknown>>;
  readonly goal?: string | null;
  readonly param_bindings: Readonly<Record<string, unknown>>;
  readonly model?: string | null;
  readonly [key: string]: unknown;
}

export interface StepBeginParallel {
  readonly type: 'parallel';
  readonly step_name: StepName;
  readonly branch_count: number;
  readonly prompt_dir: string;
  readonly branches: readonly StepBeginParallelBranch[];
  readonly [key: string]: unknown;
}

export interface StepBeginParallelBranch {
  readonly branch_index: number;
  readonly prompt_file: string;
  readonly spawn_prompt: string;
  readonly subagent_type?: string | null;
  readonly model?: string | null;
}

export interface StepBeginPlanning {
  readonly type: 'planning';
  readonly step_name: StepName;
  readonly step_index: number;
  readonly goal: string;
  readonly restrictions: {
    readonly max_substeps: number;
    readonly max_plan_attempts: number;
    readonly allow_parallel: boolean;
    readonly allow_delegation: boolean;
  };
  readonly attempts: number;
  readonly engine_instructions: string;
  readonly model?: string | null;
  readonly [key: string]: unknown;
}


export interface WorkflowValidateDynamicInput {
  readonly parent_workflow: WorkflowName;
  readonly parent_step: StepName;
  readonly workflow_yaml: string;
}

export interface WorkflowValidateDynamicSuccess {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly attempts: number;
  readonly attempts_remaining: number;
}

export interface WorkflowValidateDynamicError {
  readonly error: string;
  readonly action?: 'BLOCKED_PLANNING_FAILURE';
  readonly parent_step?: string;
  readonly attempts?: number;
}

export type WorkflowValidateDynamicOutput =
  | WorkflowValidateDynamicSuccess
  | WorkflowValidateDynamicError;


export interface WorkflowValidateInput {
  readonly workflow_yaml: string;
  readonly workflow_name?: WorkflowName;
}

export interface WorkflowValidateSuccess {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings?: readonly {
    readonly id: string;
    readonly step?: string;
    readonly message: string;
    readonly topic: string;
  }[];
  readonly next_steps?: string;
}

export interface WorkflowValidateError {
  readonly error: string;
}

export type WorkflowValidateOutput = WorkflowValidateSuccess | WorkflowValidateError;


export interface WorkflowInvokeDynamicInput {
  readonly parent_workflow: WorkflowName;
  readonly parent_step: StepName;
  readonly workflow_yaml: string;
  readonly inherit_params?: Readonly<Record<string, unknown>>;
  readonly orchestrator_model_hint?: string;
}

export interface WorkflowInvokeDynamicSuccess {
  readonly child_run_id: RunId;
  readonly child_workflow_path: string;
  readonly child_runtime_dir: string;
  readonly child_workflow_name: WorkflowName;
  readonly first_step: StepName | null;
  readonly step_names: readonly StepName[];
}

export interface WorkflowInvokeDynamicError {
  readonly error: string;
  readonly validation_errors?: readonly string[];
  readonly parent_step?: string;
}

export type WorkflowInvokeDynamicOutput =
  | WorkflowInvokeDynamicSuccess
  | WorkflowInvokeDynamicError;


export interface StepBeginDynamicInput {
  readonly parent_workflow: WorkflowName;
  readonly parent_step: StepName;
  readonly step: StepName;
}

export type StepBeginDynamicOutput = StepBeginOutput | { readonly error: string };


export interface StepCollectResultDynamicInput {
  readonly parent_workflow: WorkflowName;
  readonly parent_step: StepName;
  readonly step?: StepName;
}

export type StepCollectResultDynamicOutput =
  | StepCollectResultOutput
  | { readonly error: string };


export interface StepCompleteDynamicInput {
  readonly parent_workflow: WorkflowName;
  readonly parent_step: StepName;
  readonly step: StepName;
  readonly summary: string;
}

export type StepCompleteDynamicOutput =
  | StepCompleteOutput
  | { readonly error: string };


export interface WorkflowFinalizeDynamicInput {
  readonly parent_workflow: WorkflowName;
  readonly parent_step: StepName;
}

export interface WorkflowFinalizeDynamicSuccess {
  readonly child_status: TerminalWorkflowStatus;
  readonly child_run_id: RunId;
  readonly parent_planning_phase: 'completed' | 'failed';
  readonly engine_instructions?: string;
}

export type WorkflowFinalizeDynamicOutput =
  | WorkflowFinalizeDynamicSuccess
  | { readonly error: string };


export interface AgentNotesWriteInput {
  readonly step_template: string;
  readonly topic: string;
  readonly status: 'success' | 'partial' | 'failed' | 'experimental';
  readonly confidence: 'high' | 'medium' | 'low';
  readonly run_id: string;
  readonly body: string;
  readonly generated_workflow_path?: string;
  readonly tags?: readonly string[];
  readonly related_runs?: readonly string[];
}

export interface AgentNotesWriteSuccess {
  readonly path: string;
  readonly filename: string;
}

export type AgentNotesWriteOutput =
  | AgentNotesWriteSuccess
  | { readonly error: string };


export interface AgentNotesSearchInput {
  readonly step_template: string;
  readonly tags?: readonly string[];
  readonly status?: ReadonlyArray<'success' | 'partial' | 'failed' | 'experimental'>;
  readonly confidence?: ReadonlyArray<'high' | 'medium' | 'low'>;
  readonly limit?: number;
}

export interface AgentNotesSummary {
  readonly file: string;
  readonly path: string;
  readonly topic: string;
  readonly status: 'success' | 'partial' | 'failed' | 'experimental';
  readonly confidence: 'high' | 'medium' | 'low';
  readonly tags: readonly string[];
  readonly date: string;
  readonly project: string;
}

export interface AgentNotesSearchSuccess {
  readonly matches: readonly AgentNotesSummary[];
  readonly total_before_limit: number;
}

export type AgentNotesSearchOutput =
  | AgentNotesSearchSuccess
  | { readonly error: string };


export interface StepCollectResultInput {
  readonly name: WorkflowName;
  readonly step?: StepName;
}

export interface StepCollectResultOutput {
  readonly action: StepCollectAction;
  readonly passed?: boolean;
  readonly step?: StepName;
  readonly checks?: number;
  readonly failures?: number;
  readonly details?: readonly string[];
  readonly loop_count?: number;
  readonly max_step_retries?: number;
  readonly needs_semantic_gate?: boolean;
  readonly needs_human_gate?: boolean;
  readonly stale?: boolean;
  readonly warning?: string;
  readonly error?: string;
  readonly gate_result?: Readonly<Record<string, unknown>>;
  readonly branch_results?: readonly unknown[];
  readonly failed_branches?: readonly number[];
  readonly [key: string]: unknown;
}


export interface StepCompleteInput {
  readonly name: WorkflowName;
  readonly step: StepName;
  readonly summary: string;
  readonly loop_decision?: 'loop' | 'proceed';
  readonly loop_rationale?: string;
  readonly route_decision?: string;
  readonly route_rationale?: string;
  readonly delegated_run_id?: string;
}

export interface StepCompleteSuccess {
  readonly step: StepName;
  readonly next_step?: StepName | null;
  readonly workflow_done: boolean;
  readonly action?: string;
  readonly route_exit?: { readonly from: string; readonly to: string; readonly next_step: string | null };
  readonly next_begin?: StepBeginOutput;
  readonly lanes_begin?: Readonly<Record<string, StepBeginOutput>>;
  readonly [key: string]: unknown;
}

export interface StepCompleteValidationError {
  readonly error: string;
  readonly action: StepCompleteAction;
  readonly validation_errors: readonly string[];
}

export interface StepCompleteBlocked {
  readonly error: string;
  readonly action: 'BLOCKED_PARTIAL_FAILURE';
  readonly step: string;
  readonly blocked_reason:
    | 'all_branches_failed'
    | 'missing_branches'
    | 'partial_branches_failed'
    | 'non_parallel_failed';
  readonly failed_branches: readonly unknown[];
}

export type StepCompleteOutput =
  | StepCompleteSuccess
  | StepCompleteValidationError
  | StepCompleteBlocked;


export interface WorkflowFinalizeInput {
  readonly name: WorkflowName;
}

export interface WorkflowFinalizeOutput {
  readonly workflow: WorkflowName;
  readonly status: TerminalWorkflowStatus;
  readonly steps?: Readonly<Record<string, unknown>>;
  readonly trace_finalized: boolean;
  readonly run_id: RunId;
  readonly [key: string]: unknown;
}


export interface ListAgentFilesInput {
  readonly path?: string;
  readonly pattern?: string;
}

export interface ListAgentFilesOutput {
  readonly files: readonly ListAgentFilesEntry[];
  readonly count: number;
}

export interface ListAgentFilesEntry {
  readonly path: string;
  readonly is_dir: boolean;
}


export interface McpCallLogEntry {
  readonly timestamp: IsoDateTime;
  readonly tool: string;
  readonly duration_ms: number;
  readonly success: boolean;
  readonly workflow?: string;
  readonly step?: string;
  readonly summary?: string;
  readonly error?: string;
}


export interface McpToolRegistry {
  readonly workflow_resolve: {
    readonly input: WorkflowResolveInput;
    readonly output: WorkflowResolveOutput;
  };
  readonly workflow_init: {
    readonly input: WorkflowInitInput;
    readonly output: WorkflowInitOutput;
  };
  readonly workflow_resume: {
    readonly input: WorkflowResumeInput;
    readonly output: WorkflowResumeOutput;
  };
  readonly step_begin: {
    readonly input: StepBeginInput;
    readonly output: StepBeginOutput;
  };
  readonly step_collect_result: {
    readonly input: StepCollectResultInput;
    readonly output: StepCollectResultOutput;
  };
  readonly step_complete: {
    readonly input: StepCompleteInput;
    readonly output: StepCompleteOutput;
  };
  readonly workflow_finalize: {
    readonly input: WorkflowFinalizeInput;
    readonly output: WorkflowFinalizeOutput;
  };
  readonly list_agent_files: {
    readonly input: ListAgentFilesInput;
    readonly output: ListAgentFilesOutput;
  };
}

export type McpToolName = keyof McpToolRegistry;

export type McpToolInput<K extends McpToolName> = McpToolRegistry[K]['input'];

export type McpToolOutput<K extends McpToolName> = McpToolRegistry[K]['output'];
