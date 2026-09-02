export interface MergeOptions {
    readonly force?: boolean;
    readonly update?: boolean;
    readonly dryRun?: boolean;
}
export interface ClaudeSettingsOptions extends MergeOptions {
    readonly mcpTokenLimit?: number;
}
export declare function ensureCursorIgnore(target: string, opts?: {
    dryRun?: boolean;
}): void;
export interface ManagedBlockResult {
    readonly action: 'created' | 'appended' | 'updated' | 'unchanged' | 'removed' | 'absent' | 'would-write' | 'would-remove';
    readonly file: string;
}
export declare function hasManagedBlock(absFile: string, sentinelId: string): boolean;
export declare function injectManagedBlock(absFile: string, sentinelId: string, body: string, opts?: {
    dryRun?: boolean;
    createIfAbsent?: boolean;
}): ManagedBlockResult;
export declare function removeManagedBlock(absFile: string, sentinelId: string, opts?: {
    dryRun?: boolean;
}): ManagedBlockResult;
export declare function checkDependencies(): void;
export declare function isGateCheckCommand(cmd: unknown): boolean;
export declare function isToolCallLoggerCommand(cmd: unknown): boolean;
export declare function isFileGuardCommand(cmd: unknown): boolean;
export declare function isSpawnThrottleCommand(cmd: unknown): boolean;
export declare function mergeHooks(srcHooksPath: string, dstHooksPath: string, opts?: MergeOptions): void;
export declare function mergeCursorLoggerHooks(srcHooksPath: string, dstHooksPath: string, opts?: MergeOptions): void;
export declare function mergeCursorFileGuardHook(srcHooksPath: string, dstHooksPath: string, opts?: MergeOptions): void;
export declare function mergeCursorSpawnThrottleHook(srcHooksPath: string, dstHooksPath: string, opts?: MergeOptions): void;
export declare function normalizeCursorHookShell(dstHooksPath: string, platform?: NodeJS.Platform, opts?: {
    dryRun?: boolean;
}): void;
export declare function mergeMcpConfig(srcMcpPath: string, dstMcpPath: string, opts?: MergeOptions): void;
export declare function mergeClaudeSettings(srcSettingsPath: string, dstSettingsPath: string, opts?: ClaudeSettingsOptions): void;
export interface GeminiSettingsOptions {
    readonly force?: boolean;
    readonly update?: boolean;
    readonly dryRun?: boolean;
}
export declare function mergeGeminiSettings(srcSettingsPath: string, dstSettingsPath: string, opts?: GeminiSettingsOptions): void;
export declare function mergeCodexConfig(srcTemplatePath: string, dstConfigPath: string, opts?: MergeOptions): void;
export declare const OPENCODE_INSTRUCTIONS_ENTRY = ".opencode/riglane/*.md";
export declare const OPENCODE_LEGACY_INSTRUCTIONS_ENTRIES: readonly string[];
export declare const OPENCODE_MCP_SERVERS: readonly ["workflow_engine", "workflow_tools"];
export declare function parseJsonLenient(text: string): unknown;
export declare function mergeOpencodeConfig(srcTemplatePath: string, dstConfigPath: string, opts?: MergeOptions): void;
