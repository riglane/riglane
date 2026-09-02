export type ScopeAction = 'show' | 'set' | 'unset' | 'list' | 'add' | 'hint';
export interface ParsedScopeArgs {
    readonly command: ScopeAction;
    readonly scopeId?: string;
    readonly label?: string;
    readonly hint?: string;
    readonly project?: boolean;
    readonly counts?: boolean;
}
export interface ScopeCliOptions {
    readonly stdout?: (s: string) => void;
    readonly stderr?: (s: string) => void;
    readonly root?: string;
}
export declare function cmdShow(opts: ScopeCliOptions): number;
export declare function cmdSet(opts: ScopeCliOptions, args: ParsedScopeArgs): number;
export declare function cmdUnset(opts: ScopeCliOptions): number;
export declare function cmdList(opts: ScopeCliOptions, args: ParsedScopeArgs): number;
export declare function cmdAdd(opts: ScopeCliOptions, args: ParsedScopeArgs): number;
export declare function cmdHint(opts: ScopeCliOptions, args: ParsedScopeArgs): number;
export declare function parseScopeCliArgs(argv: string[]): ParsedScopeArgs | {
    error: string;
};
export declare function runScopeCli(argv?: string[], opts?: ScopeCliOptions): Promise<number>;
