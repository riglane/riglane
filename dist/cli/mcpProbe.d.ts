export interface McpProbeResult {
    readonly ok: boolean;
    readonly detail: string;
    readonly parseError: boolean;
}
export declare function probeWorkflowEngineMcp(text: string, kind: 'json' | 'toml' | 'opencode-json'): McpProbeResult;
