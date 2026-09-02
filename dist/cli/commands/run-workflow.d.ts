import { type SpawnSyncOptions } from 'node:child_process';
export declare const RUN_WORKFLOW_TARGETS: Record<string, readonly string[]>;
export declare const SKIP_APPROVALS_ARGS: Record<string, readonly string[]>;
export declare const TARGET_SKILL_PREFIX: Record<string, '/' | '$' | '' | '/riglane:'>;
export declare function skillPrefixForTarget(target: string): '/' | '$' | '' | '/riglane:';
export type SpawnFn = (file: string, args: string[], options: SpawnSyncOptions) => {
    status: number | null;
};
export interface RunWorkflowOptions {
    readonly spawn?: SpawnFn;
    readonly cwd?: string;
}
export interface ParsedRunWorkflowArgs {
    readonly target: string;
    readonly workflow: string;
    readonly dir: string;
    readonly passthrough: string[];
    readonly skipApprovals: boolean;
    readonly modelOverride?: string;
    readonly inboxWebhook?: string;
    readonly noTraceViewer: boolean;
    readonly resumeRunId?: string;
    readonly noSupervise: boolean;
    readonly forceMsysEnv: boolean;
}
export declare function parseRunWorkflowArgs(args: string[], baseCwd: string): ParsedRunWorkflowArgs | {
    error: string;
};
export declare function workflowExists(dir: string, name: string): boolean;
export declare function buildRunWorkflowPrompt(workflow: string, passthrough: string[], prefix?: '/' | '$' | '' | '/riglane:'): string;
export declare function buildCodexExecPrompt(workflow: string, passthrough: string[]): string;
export declare const SUPERVISED_TARGETS: ReadonlySet<string>;
export interface RunSupervisionState {
    readonly exists: boolean;
    readonly terminal: boolean;
    readonly openQuestions: number;
    readonly ownerAlive: boolean;
    readonly status?: string;
    readonly workflow?: string;
    readonly currentStep?: string;
    readonly updatedAt?: string;
}
export declare function readRunSupervisionState(runDir: string): RunSupervisionState;
export type SuperviseVerdict = 'done' | 'wait' | 'relaunch';
export declare function superviseVerdict(state: RunSupervisionState): SuperviseVerdict;
export declare function runDirBornSince(runsRoot: string, prefix: string, sinceMs: number): boolean;
export declare function newestRunDirBornSince(runsRoot: string, prefix: string, sinceMs: number): string | null;
export type CmdShimTarget = {
    readonly kind: 'node';
    readonly entry: string;
} | {
    readonly kind: 'exe';
    readonly path: string;
};
export declare function resolveWindowsCmdShim(command: string, env?: Record<string, string | undefined>): CmdShimTarget | null;
export declare function resolveSpawn(argv: string[], platform?: NodeJS.Platform, env?: Record<string, string | undefined>): {
    file: string;
    args: string[];
};
export declare function isGitBashDir(dir: string): boolean;
export declare function runRunWorkflowCli(args: string[], options?: RunWorkflowOptions): number;
