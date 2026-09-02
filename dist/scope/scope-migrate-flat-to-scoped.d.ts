export declare const FRONTMATTER_RE: RegExp;
export interface MigrateOptions {
    readonly targetScope: string;
    readonly label?: string | null;
    readonly projectRoot: string;
    readonly dryRun: boolean;
    readonly force: boolean;
    readonly stdout?: (s: string) => void;
    readonly stderr?: (s: string) => void;
}
export interface MigrateCliOptions {
    readonly stdout?: (s: string) => void;
    readonly stderr?: (s: string) => void;
}
export declare function ensureScopeInFrontmatter(content: string, scope: string): [string, boolean];
export declare function findSpecDomains(specsRoot: string, knownScopeIds: Set<string>): string[];
export declare function rewriteIndexPaths(indexData: Record<string, unknown>, targetScope: string): Record<string, unknown>;
export declare function updateScopeConfig(configPath: string, targetScope: string, label: string | null | undefined, dryRun: boolean, stdout: (s: string) => void): void;
export declare function migrate(opts: MigrateOptions): Promise<number>;
export declare function runScopeMigrateCli(argv?: string[], opts?: MigrateCliOptions): Promise<number>;
