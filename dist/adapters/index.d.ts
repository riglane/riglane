import type { Host } from '../types/enums.js';
export type AdapterId = 'claude' | 'cursor' | 'codex' | 'opencode' | 'copilot' | 'gemini';
export interface CopyStep {
    readonly srcSubdir: string;
    readonly dstDir: string;
    readonly prune?: boolean;
}
export type HooksSpec = 
{
    readonly kind: 'claude-settings';
}
 | {
    readonly kind: 'cursor-hooks';
}
 | {
    readonly kind: 'codex-toml';
}
 | {
    readonly kind: 'opencode-plugin';
    readonly srcSubdir: string;
    readonly dstDir: string;
}
 | {
    readonly kind: 'copilot-hooks-json';
    readonly srcSubdir: string;
    readonly dstDir: string;
}
 | {
    readonly kind: 'gemini-settings-json';
};
export type McpSpec = 
{
    readonly kind: 'json-template';
    readonly src: string;
    readonly dst: string;
}
 | {
    readonly kind: 'json-file';
    readonly src: string;
    readonly dst: string;
}
 | {
    readonly kind: 'codex-toml';
}
 | {
    readonly kind: 'opencode-json';
    readonly src: string;
    readonly dst: string;
}
 | {
    readonly kind: 'copilot-mcp-json';
    readonly src: string;
    readonly dst: string;
}
 | {
    readonly kind: 'gemini-settings-json';
};
export type SpecGuidanceSpec = {
    readonly via: 'rule-file';
    readonly path: string;
    readonly frontmatter: string;
} | {
    readonly via: 'managed-block';
    readonly file: string;
    readonly sentinel: string;
};
export interface AdapterDescriptor {
    readonly id: AdapterId;
    readonly label: string;
    readonly projectDir: string;
    readonly srcDir: string;
    readonly skills?: CopyStep;
    readonly rules?: CopyStep;
    readonly hooks: HooksSpec;
    readonly mcp: McpSpec;
    readonly generatesPerStepSubagents: boolean;
    readonly agents?: CopyStep;
    readonly commands?: CopyStep;
    readonly hostId: Host;
    readonly specGuidance?: SpecGuidanceSpec;
}
export declare const ADAPTERS: Record<AdapterId, AdapterDescriptor>;
export declare const SELECTABLE_ADAPTERS: readonly AdapterId[];
export declare const DEFAULT_ADAPTERS: readonly Exclude<AdapterId, 'codex' | 'opencode' | 'copilot' | 'gemini'>[];
export declare function adaptersToInstallOptions(adapters: readonly AdapterId[]): {
    adapters: readonly AdapterId[];
};
export declare function mcpConfigProbe(d: AdapterDescriptor): {
    kind: 'json' | 'toml' | 'opencode-json';
    path: string;
};
