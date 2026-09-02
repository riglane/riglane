export declare function normalizeText(s: string): string;
export declare function levenshtein(a: string, b: string): number;
export declare function simRatio(a: string, b: string): number;
export declare function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number;
export declare function tokenSet(s: string): Set<string>;
export declare function tokenJaccard(a: string, b: string): number;
export declare function textSimilarity(a: string, b: string): number;
export declare function listJaccard(a: readonly string[], b: readonly string[]): number;
