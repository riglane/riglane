import { type HostBridge } from '../engine/host-bridge.js';
export interface ToolDescriptor {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
}
export declare const TOOLS: ReadonlyArray<ToolDescriptor>;
export type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;
export declare const TOOL_HANDLERS: ReadonlyMap<string, ToolHandler>;
export declare function summarizeCall(toolName: string, args: Record<string, unknown>, result: unknown): string;
export interface JsonRpcRequest {
    readonly jsonrpc?: string;
    readonly id?: string | number | null;
    readonly method?: string;
    readonly params?: Record<string, unknown>;
}
export interface JsonRpcSuccess {
    readonly jsonrpc: '2.0';
    readonly id: string | number | null;
    readonly result: Record<string, unknown>;
}
export interface JsonRpcError {
    readonly jsonrpc: '2.0';
    readonly id: string | number | null;
    readonly error: {
        readonly code: number;
        readonly message: string;
    };
}
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;
export declare function makeResponse(msgId: string | number | null, result: Record<string, unknown>): JsonRpcSuccess;
export declare function makeError(msgId: string | number | null, code: number, message: string): JsonRpcError;
export declare const SUPPORTED_PROTOCOL_VERSIONS: readonly string[];
export declare const LATEST_PROTOCOL_VERSION: string;
export declare function getNegotiatedProtocolVersion(): string;
export declare function getClientCapabilities(): Record<string, unknown>;
export declare function _resetConnectionState(): void;
export declare function routeIncomingResponse(msg: {
    id?: string | number | null;
    result?: unknown;
    error?: {
        code?: number;
        message?: string;
    };
}): boolean;
export declare function makeStdioBridge(write: (line: string) => void): HostBridge;
export interface DispatchOptions {
    readonly handlers?: ReadonlyMap<string, ToolHandler>;
    readonly tools?: ReadonlyArray<ToolDescriptor>;
    readonly appendMcpCall?: (entry: import('../types/mcp.js').McpCallLogEntry) => void;
}
export declare function handleMessage(msg: JsonRpcRequest, options?: DispatchOptions): Promise<JsonRpcResponse | null>;
export declare function serverLoop(options?: DispatchOptions): Promise<void>;
export declare function runWorkflowEngineCli(options?: DispatchOptions): Promise<void>;
