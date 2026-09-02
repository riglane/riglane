import { isAbsolute, join, resolve } from 'node:path';
import { lockedJsonReadModifyWrite } from '../engine/file-lock.js';
import { narrowOutputsForBranch } from '../engine/output-validator.js';
import { type EnginePaths } from '../engine/workflow-engine.js';
import type { Host } from '../types/enums.js';
import { parseHostFlag } from './host-flag.js';
export interface GateCheckPaths extends EnginePaths {
    readonly scriptsDir: string;
    readonly schemaValidate: string;
}
export declare function gateCheckPaths(cwd?: string): GateCheckPaths;
export { lockedJsonReadModifyWrite };
export declare function findWorkflowDir(paths?: GateCheckPaths): string | null;
export declare function detectRunAttributionWarning(paths: GateCheckPaths, workflowName: string, env?: NodeJS.ProcessEnv): string | null;
export declare function findDefinitionDir(workflowDir: string, paths?: GateCheckPaths): string;
export declare function findCurrentStep(manifest: Record<string, unknown>): [string | null, Record<string, unknown> | null];
export declare function definitionIndex(workflowConfig: Record<string, unknown> | null, stepName: string, fallback: number): number;
export declare function findStepConfig(workflowYaml: Record<string, unknown>, stepName: string): Record<string, unknown>;
export declare function findStepOutputs(workflowYaml: Record<string, unknown>, stepName: string): ReadonlyArray<unknown>;
export declare function getMaxGateRetries(workflowConfig: Record<string, unknown>, stepName: string): number;
export type { Host };
export declare function isCopilotSessionTranscript(transcriptPath: string): boolean;
export declare function detectHost(hookInput: Record<string, unknown>): Host;
export interface TranscriptExtractResult {
    readonly model: string | null;
    readonly duration_ms: number | null;
    readonly message_count: number;
    readonly tool_call_count: number;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly modified_files: readonly string[];
}
export declare function extractFromTranscript(transcriptPath: string | null): TranscriptExtractResult;
export declare function deriveTaskTextFromTranscript(transcriptPath: string | null): string | null;
export declare function buildFollowup(stepName: string, passed: boolean, checks: number, failures: number, details: readonly string[]): string | null;
export declare function outputAndExit(host: Host, followup: string | null, scopeWarning?: string | null): never;
export declare function logGateError(message: string, paths?: GateCheckPaths): void;
export declare function isRootRelativePath(path: string): boolean;
export declare function detectCrossScopeWrites(modifiedFiles: readonly string[]): string | null;
export { resolve as resolvePathAbsolute, isAbsolute as isAbsolutePath, join as joinPath };
export type HookInputShape = Record<string, unknown>;
export interface GateResultShape {
    readonly step?: string;
    readonly passed?: boolean;
    readonly checks?: number;
    readonly failures?: number;
    readonly details?: readonly string[];
    readonly gate_type?: string;
    readonly [key: string]: unknown;
}
type TraceModifier = (trace: Record<string, unknown>) => Record<string, unknown>;
export declare function buildTraceModifier(manifest: Record<string, unknown>, stepName: string, hookInput: HookInputShape, gateResult: GateResultShape, workflowConfig: Record<string, unknown> | null, loopCount: number, followupMessage?: string | null, attributionWarning?: string | null): TraceModifier;
export declare function appendTraceEntry(workflowDir: string, manifest: Record<string, unknown>, stepName: string, hookInput: HookInputShape, gateResult: GateResultShape, workflowConfig: Record<string, unknown> | null, loopCount: number, followupMessage?: string | null, attributionWarning?: string | null): Promise<void>;
export { narrowOutputsForBranch };
export interface MainInnerOptions {
    readonly stdin?: NodeJS.ReadableStream;
    readonly paths?: GateCheckPaths;
    readonly env?: NodeJS.ProcessEnv;
    readonly host?: Host;
    readonly argv?: readonly string[];
}
export { parseHostFlag };
export declare function resolveHost(hookInput: Record<string, unknown>, override: Host | null): Host;
export declare function mainInner(options?: MainInnerOptions): Promise<void>;
export declare function gateCheckCli(options?: MainInnerOptions): Promise<void>;
