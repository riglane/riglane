import type { Workflow } from '../types/workflow.js';
export type BundledFileRole = 'struct' | 'script' | 'mcp-server' | 'other';
export interface BundledFileEntry {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly language: string | null;
    readonly role: BundledFileRole;
}
export interface ScriptToolEntry {
    readonly name: string;
    readonly description: string | null;
    readonly command: string;
    readonly interpreter: string | null;
    readonly references: readonly string[];
}
export interface McpDependencyEntry {
    readonly name: string;
    readonly required: boolean;
    readonly expected_tools: readonly string[];
}
export interface DeciderEntry {
    readonly field: 'loop_back.when.script' | 'routes.when.script' | 'gate.human.script';
    readonly at: string;
    readonly command: string;
}
export interface CapabilityFlag {
    readonly flag: 'network' | 'reads-env' | 'writes-outside-project' | 'shell-indirection' | 'spawns-mcp-server';
    readonly where: string;
    readonly match: string;
}
export interface CapabilitySummary {
    readonly network: boolean;
    readonly reads_env: boolean;
    readonly writes_outside_project: boolean;
    readonly spawns_mcp_server: boolean;
    readonly flags: readonly CapabilityFlag[];
}
export interface LoopBackSummary {
    readonly step: string;
    readonly to: string;
    readonly max_iterations: number;
    readonly when: readonly string[];
}
export interface RoutesSummary {
    readonly step: string;
    readonly route_ids: readonly string[];
    readonly when: readonly string[];
}
export interface LanesSummary {
    readonly step: string;
    readonly lane_ids: readonly string[];
    readonly require: 'all' | 'any';
}
export interface StepSummaryItem {
    readonly name: string;
    readonly subagent: boolean;
    readonly parallel?: boolean;
    readonly parallel_key?: string;
    readonly type?: string;
    readonly delegate_to?: string;
    readonly spec_check?: boolean;
    readonly spec_authoring?: string;
    readonly deny?: readonly string[];
}
export interface GateSummary {
    readonly structural: boolean;
    readonly semantic: boolean;
    readonly human: boolean;
    readonly max_gate_retries: number;
    readonly max_step_retries: number;
    readonly step_overrides: readonly string[];
}
export interface ParamSummary {
    readonly name: string;
    readonly required: boolean;
    readonly default?: unknown;
}
export interface WorkflowInventory {
    readonly workflow: string;
    readonly workflow_version: number;
    readonly workflow_sha256: string;
    readonly steps: {
        readonly count: number;
        readonly items: readonly StepSummaryItem[];
        readonly gates: GateSummary;
        readonly control_flow: {
            readonly loop_back: readonly LoopBackSummary[];
            readonly routes: readonly RoutesSummary[];
            readonly lanes: readonly LanesSummary[];
        };
        readonly delegates_to: readonly string[];
    };
    readonly params: readonly ParamSummary[];
    readonly structs: readonly string[];
    readonly script_tools: readonly ScriptToolEntry[];
    readonly mcp_dependencies: readonly McpDependencyEntry[];
    readonly deciders: readonly DeciderEntry[];
    readonly bundled_files: readonly BundledFileEntry[];
    readonly capabilities: CapabilitySummary;
}
export declare class InventoryError extends Error {
}
export declare const INBOX_WEBHOOK_WHERE = "workflow.inbox_webhook";
export declare function buildWorkflowInventory(workflowDir: string, workflow: Workflow): WorkflowInventory;
