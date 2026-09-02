
import type { IsoDateTime, RunId } from './branded.js';
import type {
  GateType,
  HookStatus,
  InjectMode,
  RetryType,
  StepStatus,
  WorkflowStatus,
} from './enums.js';
import type { ContextConfig } from './workflow.js';


export interface Trace {
  readonly trace_version: 1;
  readonly workflow: string;
  readonly workflow_version: number;
  readonly run_id: RunId;
  readonly description?: string;
  readonly context?: ContextConfig;
  readonly params: Readonly<Record<string, unknown>>;
  readonly param_defs?: readonly TraceParamDef[];
  readonly gate_config: TraceGateConfig;
  readonly host?: {
    readonly id: string | null;
    readonly client_name: string | null;
    readonly client_version: string | null;
    readonly orchestrator_model: string | null;
  };
  readonly started_at: IsoDateTime;
  readonly completed_at?: IsoDateTime | null;
  readonly status: WorkflowStatus;
  readonly total_duration_ms?: number | null;
  readonly total_messages?: number;
  readonly total_tool_calls?: number;
  readonly total_modified_files?: number;
  readonly total_step_duration_ms?: number;
  readonly warnings?: readonly string[];
  readonly total_mcp_calls?: number;
  readonly mcp_calls?: readonly McpCall[];
  readonly total_tool_calls_proxy?: number;
  readonly tool_calls?: readonly ProxyToolCall[];
  readonly steps: readonly TraceStep[];
}

export interface TraceParamDef {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface TraceGateConfig {
  readonly structural: boolean;
  readonly semantic: boolean;
  readonly human: boolean;
  readonly max_gate_retries: number;
  readonly max_step_retries: number;
}


export interface TraceStep {
  readonly name: string;
  readonly index: number;
  readonly status: StepStatus;
  readonly config?: TraceStepConfig | null;
  readonly goal?: string | null;
  readonly inputs?: readonly TraceStepInput[] | null;
  readonly outputs?: readonly TraceStepOutput[] | null;
  readonly started_at?: IsoDateTime | null;
  readonly completed_at?: IsoDateTime | null;
  readonly duration_ms?: number | null;
  readonly invocations: readonly Invocation[];
  readonly retry_count?: number;
  readonly summary?: string | null;
  readonly prompt_files?: readonly string[] | null;
  readonly param_bindings?: Readonly<Record<string, { readonly expr: string; readonly value: unknown }>>;
  readonly note?: string | null;
}

export interface TraceStepConfig {
  readonly spec_check?: boolean;
  readonly spec_authoring?: 'persist' | 'validate';
  readonly subagent?: boolean;
  readonly gate?: Readonly<Record<string, unknown>> | null;
}

export interface TraceResolvedFile {
  readonly path: string;
  readonly exists: boolean;
  readonly size?: number;
  readonly value_preview?: string | null;
  readonly truncated?: boolean;
  readonly binary?: boolean;
}

export interface TraceStepInput {
  readonly path?: string;
  readonly inject?: InjectMode;
  readonly struct?: string;
  readonly resolved?: readonly TraceResolvedFile[];
}

export interface TraceStepOutput {
  readonly path?: string;
  readonly struct?: string;
  readonly write_proof?: string;
  readonly optional?: boolean;
  readonly resolved?: readonly TraceResolvedFile[];
}


export interface Invocation {
  readonly iteration: number;
  readonly retry_type?: RetryType;
  readonly completed_at: IsoDateTime;
  readonly duration_ms: number;
  readonly hook_status: HookStatus;
  readonly message_count?: number;
  readonly tool_call_count?: number;
  readonly modified_files?: readonly string[];
  readonly subagent_id?: string | null;
  readonly task_prompt?: string | null;
  readonly subagent_summary?: string | null;
  readonly transcript_path?: string | null;
  readonly model?: string | null;
  readonly token_usage?: TokenUsage | null;
  readonly followup_message?: string | null;
  readonly note?: string | null;
  readonly gate?: TraceGateResult;
}

export interface TokenUsage {
  readonly input?: number;
  readonly output?: number;
}


export interface TraceGateResult {
  readonly type: GateType;
  readonly passed: boolean;
  readonly checks: number;
  readonly failures: number;
  readonly details: readonly string[];
}


export interface McpCall {
  readonly timestamp: IsoDateTime;
  readonly tool: string;
  readonly duration_ms: number;
  readonly success: boolean;
  readonly workflow?: string;
  readonly step?: string;
  readonly summary?: string;
  readonly error?: string;
}

export interface ProxyToolCall {
  readonly tool: string;
  readonly tool_short?: string;
  readonly server?: string | null;
  readonly kind?: string;
  readonly agent_id?: string | null;
  readonly agent_type?: string | null;
  readonly step?: string | null;
  readonly args?: unknown;
  readonly result_preview?: string | null;
  readonly success?: boolean | null;
  readonly ts?: IsoDateTime;
  readonly host?: string;
  readonly corr?: string | null;
  readonly source?: string;
  readonly wf_tool?: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
  readonly timestamp?: IsoDateTime;
  readonly duration_ms?: number;
  readonly exit_code?: number;
  readonly output_length?: number;
  readonly error?: string;
}
