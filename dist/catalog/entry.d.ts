export interface EntrySource {
    readonly repo: string;
    readonly path: string;
    readonly sha: string;
}
export interface CatalogEntry {
    readonly id: string;
    readonly source: EntrySource;
    readonly meta: Record<string, unknown>;
}
export interface PerEntryDocument {
    readonly entry: CatalogEntry;
    readonly lockText: string;
}
export interface RevokedList {
    readonly version: 1;
    readonly revoked: ReadonlyArray<{
        readonly id: string;
        readonly reason?: string;
    }>;
}
export declare class EntryError extends Error {
}
export declare function catalogEntryUrl(baseUrl: string, id: string): string;
export declare function catalogRevokedUrl(baseUrl: string): string;
export declare function catalogIndexUrl(baseUrl: string): string;
export interface CatalogIndexRow {
    readonly id: string;
    readonly summary: string;
    readonly author?: string;
    readonly level: 'verified' | 'community';
    readonly script_tools: number;
    readonly deciders: number;
    readonly categories?: readonly string[];
    readonly tags?: readonly string[];
}
export interface CatalogIndex {
    readonly catalog_index_version: 1;
    readonly entries: readonly CatalogIndexRow[];
}
export declare function validateCatalogIndex(raw: unknown): CatalogIndex;
export declare function validateEntry(raw: unknown): CatalogEntry;
export declare function readEntryFile(entryYamlPath: string): CatalogEntry;
export declare function validatePerEntryDocument(raw: unknown, expectedId: string): PerEntryDocument;
export declare function isRevoked(list: RevokedList, id: string): {
    revoked: boolean;
    reason?: string;
};
export declare function validateRevokedList(raw: unknown): RevokedList;
