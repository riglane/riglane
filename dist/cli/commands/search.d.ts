export interface SearchCliDeps {
    readonly fetchJson?: (url: string) => Promise<unknown | null>;
}
export declare function runSearchCli(argv: readonly string[], deps?: SearchCliDeps): Promise<number>;
