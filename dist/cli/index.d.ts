#!/usr/bin/env node
export interface ParsedArgs {
    readonly path: string;
    readonly claude?: boolean;
    readonly cursor?: boolean;
    readonly codex?: boolean;
    readonly opencode?: boolean;
    readonly copilot?: boolean;
    readonly gemini?: boolean;
    readonly force?: boolean;
    readonly update?: boolean;
    readonly prune?: boolean;
    readonly dryRun?: boolean;
    readonly mcpTokenLimit?: number;
    readonly noSpecGuidance?: boolean;
    readonly backupTo?: string;
    readonly fix?: boolean;
}
export type CommandHandler = (args: ParsedArgs) => Promise<number> | number;
export interface CliOptions {
    readonly runMcpServer?: () => Promise<void>;
    readonly runMcpTools?: () => Promise<void>;
    readonly runGateCheck?: () => Promise<void>;
    readonly runFileGuard?: () => Promise<number>;
    readonly runSpawnThrottle?: () => Promise<number>;
    readonly runToolCallLogger?: () => Promise<number>;
    readonly runWorkflowToolValidator?: (argv: readonly string[]) => Promise<number>;
    readonly runSchemaValidate?: (argv: string[]) => Promise<number>;
    readonly runScope?: (argv: string[]) => Promise<number>;
    readonly runInitWorkflow?: (argv: string[]) => Promise<number>;
    readonly runUpdateWorkflows?: (argv: string[]) => Promise<number>;
    readonly runRunWorkflow?: (argv: string[]) => Promise<number> | number;
    readonly runServe?: (argv: string[]) => Promise<number> | number;
    readonly runStatus?: (argv: string[]) => Promise<number> | number;
    readonly runProjects?: (argv: string[]) => Promise<number> | number;
    readonly runWorkflowClear?: (argv: string[]) => Promise<number>;
    readonly runCatalog?: (argv: string[]) => number;
    readonly runTrust?: (argv: string[]) => Promise<number>;
    readonly runAdd?: (argv: string[]) => Promise<number>;
    readonly runSearch?: (argv: string[]) => Promise<number>;
    readonly runUpdateEntry?: (argv: string[]) => Promise<number>;
    readonly runWizard?: () => Promise<number>;
    readonly init?: CommandHandler;
    readonly update?: CommandHandler;
    readonly doctor?: CommandHandler;
    readonly migrate?: CommandHandler;
}
export declare function stubInit(_args: ParsedArgs): number;
export declare function stubUpdate(_args: ParsedArgs): number;
export declare function stubDoctor(_args: ParsedArgs): number;
export declare function stubMigrate(_args: ParsedArgs): number;
export declare function main(argv?: string[], options?: CliOptions): Promise<number>;
