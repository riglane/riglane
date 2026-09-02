export interface TrustCliDeps {
    readonly prompt?: (question: string) => Promise<string>;
    readonly cwd?: string;
}
export declare function runTrustCli(argv: readonly string[], deps?: TrustCliDeps): Promise<number>;
