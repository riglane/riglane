declare const HOSTS: readonly ["cursor", "claude-code", "codex", "opencode", "copilot", "gemini"];
type LoggerHost = (typeof HOSTS)[number];
export type ToolKind = 'mcp' | 'script' | 'builtin' | 'shell' | 'read' | 'other';
export interface ToolEventRecord {
    readonly v: 1;
    readonly ts: string;
    readonly host: string;
    readonly workflow: string | null;
    readonly step: string | null;
    readonly agent_id: string | null;
    readonly agent_type: string | null;
    readonly corr: string | null;
    readonly tool: string;
    readonly tool_short: string;
    readonly server: string | null;
    readonly kind: ToolKind;
    readonly args: unknown;
    readonly result_preview: string | null;
    readonly success: boolean | null;
    readonly source: 'hook';
    readonly run_token?: string | null;
    readonly run_ref?: string | null;
}
export interface ToolCallLoggerOptions {
    readonly stdin?: string;
    readonly argv?: readonly string[];
    readonly cwd?: string;
    readonly startDir?: string;
    readonly now?: string;
}
export declare function parseHost(argv: readonly string[]): LoggerHost | null;
export declare function classifyKind(tool: string, server: string | null): ToolKind;
export declare function normalizeEvent(obj: Record<string, unknown>, host: LoggerHost | null, cwd: string, now: string): ToolEventRecord | null;
export declare function runToolCallLogger(opts?: ToolCallLoggerOptions): Promise<number>;
export declare function isMixedAdapterDuplicate(ledgerPath: string, record: Pick<ToolEventRecord, 'corr' | 'host' | 'args' | 'ts'>): boolean;
export {};
