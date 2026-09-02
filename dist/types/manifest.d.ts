import type { IsoDateTime, RunId, RunToken, StepName } from './branded.js';
import type { BranchStatus, StepStatus, WorkflowStatus } from './enums.js';
import type { ModelMode } from './workflow.js';
export interface Manifest {
    readonly $schema?: string;
    readonly workflow: string;
    readonly workflow_version: number;
    readonly run_id: RunId;
    readonly run_token: RunToken;
    readonly params: Readonly<Record<string, unknown>>;
    readonly status: WorkflowStatus;
    readonly current_step?: StepName | null;
    readonly started_at: IsoDateTime;
    readonly updated_at: IsoDateTime;
    readonly steps: Readonly<Record<string, StepState>>;
    readonly completed_at?: IsoDateTime | null;
    readonly model_override?: ModelMode;
    readonly parallel_branches?: Readonly<Record<string, ManifestParallelBranch>>;
    readonly route_stack?: readonly RouteStackFrame[];
    readonly owner_instance_id?: string;
    readonly owner_pid?: number;
    readonly tool_events_offset?: number;
    readonly step_tools?: Readonly<Record<string, ReadonlyArray<{
        kind: 'script' | 'mcp' | 'spec';
        name: string;
        server?: string;
    }>>>;
}
export interface RouteStackFrame {
    readonly route_id: string;
    readonly owner_step: StepName;
    readonly return_to: StepName | null;
}
export interface ManifestParallelBranch {
    readonly branch_dir: string;
    readonly status: BranchStatus;
    readonly resolved_outputs?: ReadonlyArray<ManifestBranchOutput>;
}
export interface ManifestBranchOutput {
    readonly declared: string;
    readonly working: string;
    readonly semantic: string;
    readonly scaffolded: boolean;
}
export interface StepState {
    readonly status: StepStatus;
    readonly started_at?: IsoDateTime | null;
    readonly first_started_at?: IsoDateTime | null;
    readonly completed_at?: IsoDateTime | null;
    readonly duration_ms?: number;
    readonly prompt_files?: readonly string[];
    readonly tool_warnings?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    readonly gate_results?: GateResults;
    readonly summary?: string | null;
    readonly parallel_tasks?: readonly ParallelTaskState[];
    readonly planning?: PlanningStepState;
    readonly loop_state?: LoopState;
    readonly route_state?: RouteState;
    readonly delegation?: DelegationLinkState;
    readonly human_gate_verdict?: HumanGateVerdict;
}
export interface HumanGateVerdict {
    readonly required: boolean;
    readonly decided_by: 'script';
    readonly evaluated_at: string;
}
export interface DelegationLinkState {
    readonly target: string;
    readonly child_run_id: string | null;
    readonly linked_at?: string;
}
export interface RouteState {
    readonly pending?: {
        readonly script_route?: string;
        readonly asked_at: string;
    } | null;
    readonly last_decision?: string;
    readonly last_decided_by?: 'script' | 'orchestrator';
    readonly last_rationale?: string;
}
export interface LoopState {
    readonly iterations: number;
    readonly pending?: {
        readonly script_says_loop?: boolean;
        readonly asked_at: string;
    } | null;
    readonly last_decision?: 'loop' | 'proceed';
    readonly last_decided_by?: 'script' | 'orchestrator' | 'budget_exhausted';
    readonly last_rationale?: string;
}
export interface PlanningStepState {
    readonly attempts: number;
    readonly phase: 'planning' | 'validating' | 'executing' | 'completed' | 'failed';
    readonly child_run_id?: string | null;
    readonly child_workflow_path?: string | null;
}
export interface GateResults {
    readonly structural?: StructuralGateResult;
    readonly semantic?: SemanticGateResult;
    readonly human?: HumanGateResult;
}
export interface StructuralGateResult {
    readonly passed: boolean;
    readonly checks: number;
    readonly failures: number;
    readonly details: readonly string[];
}
export interface SemanticGateResult {
    readonly passed: boolean;
    readonly notes?: string;
}
export interface HumanGateResult {
    readonly passed: boolean;
    readonly approved_by?: string;
}
export interface ParallelTaskState {
    readonly key: string;
    readonly status: BranchStatus;
    readonly started_at?: IsoDateTime | null;
    readonly completed_at?: IsoDateTime | null;
    readonly summary?: string | null;
}
