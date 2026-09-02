import type { SpecFrontmatter, SpecIndex, SpecIndexEntry, SpecRegistry } from '../types/spec.js';
export declare function mintSpecId(domain: string, domainNextSerial: number, existingSpecIds: readonly string[]): {
    specId: string;
    nextSerial: number;
};
export declare function computeContentFingerprint(managedContent: string): string;
export declare function isSummaryStale(prev: {
    readonly content_fingerprint: string;
    readonly summary: string;
}, next: {
    readonly content_fingerprint: string;
    readonly summary: string;
}): boolean;
export declare function deriveIndexEntry(fm: SpecFrontmatter, path: string, contentFingerprint: string): SpecIndexEntry;
export declare function upsertSpecInIndex(index: SpecIndex, entry: SpecIndexEntry): SpecIndex;
export declare function removeSpecFromIndex(index: SpecIndex, specId: string): SpecIndex;
export declare function ensureDomainInIndex(index: SpecIndex, name: string, description: string): SpecIndex;
export declare function setDomainNextSerial(index: SpecIndex, domainName: string, nextSerial: number): SpecIndex;
export declare function setDomainDescription(index: SpecIndex, domainName: string, description: string): SpecIndex;
export declare function reconcileIndex(oldIndex: SpecIndex, derived: readonly SpecIndexEntry[]): {
    index: SpecIndex;
    changes: {
        added: string[];
        removed: string[];
        modified: string[];
    };
};
export declare function reconcileRegistry(oldRegistry: SpecRegistry, validSpecIds: ReadonlySet<string>, fileExists?: (projectRootRelPath: string) => boolean): {
    registry: SpecRegistry;
    changes: {
        removedMappings: string[];
        danglingFiles: Array<{
            spec_id: string;
            file: string;
        }>;
    };
};
