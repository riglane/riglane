import { type AdapterId } from '../../adapters/index.js';
export interface RunOptions {
    readonly claude?: boolean;
    readonly cursor?: boolean;
    readonly codex?: boolean;
    readonly opencode?: boolean;
    readonly copilot?: boolean;
    readonly gemini?: boolean;
    readonly adapters?: readonly AdapterId[];
    readonly force?: boolean;
    readonly update?: boolean;
    readonly prune?: boolean;
    readonly dryRun?: boolean;
    readonly mcpTokenLimit?: number;
    readonly specGuidance?: boolean;
    readonly templatesRoot?: string;
    readonly runUpdateWorkflows?: (target: string, dryRun: boolean) => void | Promise<void>;
    readonly bootstrapScopeGeneric?: (target: string, dryRun: boolean) => void;
}
interface InternalOptions {
    readonly force: boolean;
    readonly update: boolean;
    readonly prune: boolean;
    readonly dryRun: boolean;
    readonly mcpTokenLimit: number;
    readonly runUpdateWorkflows: (target: string, dryRun: boolean) => void | Promise<void>;
    readonly bootstrapScopeGenericFn: (target: string, dryRun: boolean) => void;
    readonly specGuidanceEnabled: boolean;
}
export declare function printHeader(target: string, adapters: ReadonlyArray<AdapterId>, mode: string, dryRun: boolean): void;
export declare function removeLegacySkills(target: string, adapterDir: '.claude' | '.cursor', dryRun: boolean): void;
export declare function removeLegacyWorkflows(target: string, dryRun: boolean): void;
export declare function removeLegacyBrandArtifacts(target: string, dryRun: boolean): void;
export declare function installUniversal(target: string, srcRoot: string, opts: InternalOptions): void;
export declare function installSpecs(target: string, srcRoot: string, opts: InternalOptions): void;
export declare function ensureWorkflowsDir(target: string): void;
export declare function installAdapter(adapter: AdapterId, target: string, srcRoot: string, opts: InternalOptions): Promise<void>;
export declare function defaultRunUpdateWorkflows(target: string, dryRun: boolean): Promise<void>;
export declare function defaultBootstrapScopeGeneric(target: string, dryRun: boolean): void;
export declare function printSummary(opts: InternalOptions): void;
export declare function runInit(target: string, opts?: RunOptions): Promise<number>;
export declare function writeRiglaneVersion(target: string, dryRun: boolean): void;
export {};
