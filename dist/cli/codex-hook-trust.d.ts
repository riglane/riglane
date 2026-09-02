export declare function codexHomeDir(env?: NodeJS.ProcessEnv): string;
export declare function computeCodexHookHash(identity: Record<string, unknown>): string;
export interface CodexTrustEntry {
    readonly key: string;
    readonly hash: string;
    readonly event: string;
    readonly command: string;
}
export declare function isRiglaneHookCommand(command: string): boolean;
export declare function codexConfigKeyPath(projectConfigPath: string): string;
export declare function computeCodexTrustEntries(projectConfigPath: string, opts?: {
    readonly platform?: NodeJS.Platform;
}): CodexTrustEntry[];
export type CodexTrustStatus = 'trusted' | 'modified' | 'untrusted';
export interface CodexTrustCheck {
    readonly entry: CodexTrustEntry;
    readonly status: CodexTrustStatus;
}
export declare function readCodexHookState(codexHome: string): Record<string, {
    trusted_hash?: string;
    enabled?: boolean;
}> | null;
export declare function checkCodexHookTrust(projectConfigPath: string, opts?: {
    readonly codexHome?: string;
    readonly platform?: NodeJS.Platform;
}): {
    readonly checks: readonly CodexTrustCheck[] | null;
    readonly entries: readonly CodexTrustEntry[];
};
export interface UpsertReport {
    readonly added: readonly string[];
    readonly updated: readonly string[];
    readonly unchanged: readonly string[];
    readonly skipped: boolean;
}
export declare function upsertCodexHookTrust(projectConfigPath: string, opts?: {
    readonly codexHome?: string;
    readonly dryRun?: boolean;
    readonly platform?: NodeJS.Platform;
}): UpsertReport;
