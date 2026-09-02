import type { DomainEntry, SpecIndexEntry } from '../types/spec.js';
export declare const SPEC_DEDUP_WEIGHTS: {
    readonly title: 0.4;
    readonly applies_to: 0.25;
    readonly summary: 0.15;
};
export declare const SPEC_DEDUP_THRESHOLD = 0.72;
export declare const SPEC_DEDUP_NEAR_CERTAIN = 0.95;
export declare const DOMAIN_DEDUP_WEIGHTS: {
    readonly name: 0.6;
    readonly description: 0.4;
};
export declare const DOMAIN_DEDUP_THRESHOLD = 0.6;
export type DedupTier = 'near_certain' | 'possible' | 'none';
export interface SpecLike {
    readonly title: string;
    readonly summary: string;
    readonly applies_to: readonly string[];
    readonly domain: string;
    readonly source_sections?: readonly string[];
}
export interface SpecPairScore {
    readonly score: number;
    readonly tier: DedupTier;
    readonly signals: readonly string[];
}
export declare function scoreSpecPair(a: SpecLike, b: SpecLike): SpecPairScore;
export interface SpecMatch {
    readonly spec_id: string;
    readonly title: string;
    readonly summary: string;
    readonly score: number;
    readonly tier: DedupTier;
    readonly signals: readonly string[];
}
export declare function findSpecDuplicates(candidate: SpecLike, existing: readonly SpecIndexEntry[], opts?: {
    crossDomain?: boolean;
}): SpecMatch[];
export declare function dedupMessage(candidateTitle: string, match: SpecMatch): string;
export interface DomainMatch {
    readonly name: string;
    readonly score: number;
    readonly signals: readonly string[];
}
export declare function findDomainDuplicates(candidate: {
    name: string;
    description: string;
}, existing: readonly DomainEntry[]): DomainMatch[];
