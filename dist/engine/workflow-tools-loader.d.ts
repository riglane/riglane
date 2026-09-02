import { type ScriptCallGuardVerdict } from './step-tool-rights.js';
export declare function log(message: string): void;
export declare function resolvePython(): string;
export declare function resolveCommand(command: string): string;
export declare function defaultTemplatesDir(cwd?: string): string;
export { makeToolName, normalizeName } from './step-tool-rights.js';
export declare function scanWorkflows(templatesDir: string): string[];
export interface ScriptTool {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
    readonly _command: string;
    readonly _workflow: string;
    readonly _original_name: string;
}
export declare function buildToolRegistry(templatesDir: string, activeWorkflow?: string | null): ScriptTool[];
export type ArgValidator = (args: Record<string, unknown>, schema: Record<string, unknown>) => string | null;
export declare function validateArgs(args: Record<string, unknown>, schema: Record<string, unknown> | null | undefined): string | null;
export interface McpContentItem {
    readonly type: 'text';
    readonly text: string;
}
export interface ExecuteResult {
    readonly isError: boolean;
    readonly content: readonly McpContentItem[];
}
export declare function executeScriptTool(tool: ScriptTool, args: Record<string, unknown>, 
timeoutMs?: number): ExecuteResult;
export interface JsonRpcRequest {
    readonly jsonrpc?: string;
    readonly id?: string | number | null;
    readonly method?: string;
    readonly params?: Record<string, unknown>;
}
export type Send = (payload: Record<string, unknown>) => void;
export declare function send(payload: Record<string, unknown>): void;
export interface DispatchOptions {
    readonly send?: Send;
    readonly validator?: ArgValidator;
    readonly timeoutMs?: number;
    readonly cwd?: string;
    readonly declarationGuard?: (agentDir: string, workflowName: string, calledName: string) => ScriptCallGuardVerdict;
}
export declare function dispatchMessage(req: JsonRpcRequest, toolMap: ReadonlyMap<string, ScriptTool>, publicTools: ReadonlyArray<Record<string, unknown>>, options?: DispatchOptions): void;
export declare function serverLoop(toolMap: ReadonlyMap<string, ScriptTool>, publicTools: ReadonlyArray<Record<string, unknown>>, options?: DispatchOptions): Promise<void>;
export declare function runWorkflowToolsCli(options?: {
    cwd?: string;
}): Promise<void>;
