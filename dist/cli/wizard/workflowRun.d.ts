import { type AdapterId } from '../../adapters/index.js';
export type ParamCategory = 'required' | 'predefined' | 'optional';
export interface WorkflowParamMeta {
    readonly name: string;
    readonly description: string;
    readonly category: ParamCategory;
    readonly defaultText: string;
}
export declare function categorizeParam(p: {
    required?: unknown;
    default?: unknown;
}): ParamCategory;
export declare function parseWorkflowParams(wf: unknown): WorkflowParamMeta[];
export declare const BUCKET_ORDER: readonly ["my_workflows", "predefined", "examples", "community"];
export type Bucket = (typeof BUCKET_ORDER)[number];
export interface WorkflowEntry {
    readonly name: string;
    readonly bucket: Bucket | string;
    readonly description: string;
    readonly path: string;
    readonly params: WorkflowParamMeta[];
}
export interface WorkflowGroup {
    readonly bucket: Bucket | string;
    readonly workflows: WorkflowEntry[];
}
export declare function bucketOf(templatesDir: string, workflowYamlPath: string): string;
export declare function listProjectWorkflows(projectPath: string): WorkflowGroup[];
export interface RunAdapterSpec {
    readonly name: string;
    readonly label: string;
    readonly group: string;
    readonly bin: string;
    readonly adapterId: AdapterId;
    readonly disabled?: boolean;
    readonly hint?: string;
}
export declare const RUN_ADAPTERS: readonly RunAdapterSpec[];
export declare function detectedAdapterIds(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): ReadonlySet<AdapterId>;
export interface RunAdapter extends RunAdapterSpec {
    readonly binOnPath: boolean;
    readonly integrationInstalled: boolean;
    readonly binRunnable: boolean | undefined;
    readonly available: boolean;
}
export type RunAdapterStatusKind = 'ok' | 'error' | 'disabled';
export interface RunAdapterStatus {
    readonly kind: RunAdapterStatusKind;
    readonly text: string;
}
export declare function runAdapterStatus(a: RunAdapter): RunAdapterStatus;
export declare function resolveOnPath(bin: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string | null;
export declare function commandOnPath(bin: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): boolean;
export declare function clearRunnableCache(): void;
export declare function warmRunnableCache(adapters: readonly RunAdapter[], env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Promise<boolean>;
export declare function detectRunAdapters(installedAdapters?: readonly AdapterId[], env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): RunAdapter[];
export declare function buildParamArgs(params: readonly WorkflowParamMeta[], values: Readonly<Record<string, string>>): string[];
export declare const MODEL_OVERRIDE_CHOICES: readonly ["", "inherit", "auto", "lightest", "strongest"];
export declare function modelOverrideLabel(value: string): string;
export declare function buildLaunchArgs(opts: {
    target: string;
    workflow: string;
    dir: string;
    paramArgs: readonly string[];
    skipApprovals?: boolean;
    modelOverride?: string;
}): string[];
export declare function buildWorkflowPrompt(workflow: string, paramArgs: readonly string[]): string;
export declare function buildPreviewCommand(opts: {
    adapter: RunAdapterSpec;
    workflow: string;
    dir: string;
    paramArgs: readonly string[];
    modelOverride?: string;
}): string;
export declare function missingRequired(params: readonly WorkflowParamMeta[], values: Readonly<Record<string, string>>): string[];
export interface ActiveRunInfo {
    readonly runId: string;
    readonly startedAt: string;
    readonly state: 'running' | 'waiting' | 'stalled';
    readonly currentStep: string | null;
}
export declare function readActiveRun(projectPath: string, workflowName: string): ActiveRunInfo | null;
export type TraceState = 'completed' | 'in-progress' | 'failed' | 'stopped' | 'unknown';
export interface TraceMeta {
    readonly runId: string;
    readonly shortId: string;
    readonly state: TraceState;
    readonly startedAt: string;
    readonly completedAt: string | null;
    readonly serverPath: string;
}
export declare function traceState(status: unknown): TraceState;
export declare function listWorkflowTraces(projectPath: string, workflowName: string): TraceMeta[];
