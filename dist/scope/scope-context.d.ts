export declare const GENERIC_SCOPE = "generic";
export declare const SPEC_ROOT: string;
export declare const SCOPE_CONFIG_PATH: string;
export declare const USER_STATE_DIR: string;
export declare const ACTIVE_SCOPE_FILE: string;
export declare const SCOPE_ID_PATTERN: RegExp;
export declare class ScopeError extends Error {
    constructor(message: string);
}
export declare class ScopeNotFoundError extends ScopeError {
    constructor(message: string);
}
export declare class InvalidScopeIdError extends ScopeError {
    constructor(message: string);
}
export declare class ScopeConfigError extends ScopeError {
    constructor(message: string);
}
export interface ScopeConfig {
    scopes: Array<Record<string, unknown>>;
    default_active_scope: string | null;
}
export interface AvailableScope {
    id: string;
    label: string;
    source: 'implicit' | 'config';
    hint?: string;
}
export declare function loadScopeConfig(root?: string): ScopeConfig;
export declare function saveScopeConfig(config: ScopeConfig, root?: string): void;
export declare function configExists(root?: string): boolean;
export declare function readUserActiveScope(root?: string): string | null;
export declare function writeUserActiveScope(scopeId: string, root?: string): void;
export declare function clearUserActiveScope(root?: string): boolean;
export type ScopeSource = 'cli' | 'user' | 'project-default' | 'fallback';
export declare function resolveActiveScope(cliScope?: string | null, root?: string): [string, ScopeSource];
export declare function validateScopeId(scopeId: unknown): asserts scopeId is string;
export declare function getAvailableScopes(root?: string): AvailableScope[];
export declare function getScopeHint(scopeId: string, root?: string): string | null;
export declare function scopeExists(scopeId: string, root?: string): boolean;
export declare function validateScopeExists(scopeId: string, root?: string): void;
export declare function scopeDir(scopeId: string, root?: string): string;
export declare function specDirFor(scopeId: string, domain: string, root?: string): string;
export declare function ensureScopeDir(scopeId: string, root?: string): string;
export declare function scopeFromPath(path: string, root?: string): string | null;
export declare function iterSpecFiles(scopes: Iterable<string>, root?: string): Generator<string, void, void>;
export declare function resolveReadScopes(activeScope: string, includeGeneric?: boolean): string[];
export declare function formatScopeTable(scopes: AvailableScope[]): string;
