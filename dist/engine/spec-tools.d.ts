import type { DomainSummary, SpecIndexEntry, SpecRole } from '../types/spec.js';
import type { StructSchema, ValidationResult } from '../types/struct.js';
import { type SpecMatch } from './spec-dedup.js';
export declare const ENGINE_SET_FRONTMATTER_FIELDS: ReadonlySet<string>;
export declare function premintSpecSchema(): StructSchema;
export declare function composeSpecMarkdown(frontmatter: Record<string, unknown>, body: string): string;
export declare function validateSpecContentPremint(content: string): ValidationResult;
export declare const DOMAIN_NAME_PATTERN: RegExp;
export declare const DOMAIN_NAME_MAX_LEN = 64;
export declare function validateDomainForWrite(domain: unknown, domainDescription: unknown, isNewDomain: boolean): string[];
export interface SpecGuidanceFlags {
    readonly specCheck: boolean;
    readonly specAuthoring?: 'persist' | 'validate' | undefined;
}
export declare function composeSpecGuidance(flags: SpecGuidanceFlags, scope: string, domains: readonly DomainSummary[], scopeHint?: string | null): string;
export interface SpecWriteArgs {
    readonly op: 'create' | 'update' | 'delete';
    readonly scope?: string;
    readonly content?: string;
    readonly draft_path?: string;
    readonly spec_id?: string;
    readonly dry_run?: boolean;
    readonly acknowledge_distinct?: boolean;
    readonly acknowledge_single_rule?: boolean;
    readonly set_domain_description?: boolean;
}
export interface SpecWriteResult {
    readonly ok: boolean;
    readonly assigned_spec_id?: string;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly status?: 'near_certain' | 'multi_rule';
    readonly matches?: readonly SpecMatch[];
    readonly guidance?: string;
    readonly domains?: readonly DomainSummary[];
}
export interface SpecMoveArgs {
    readonly op: 'move' | 'rename_domain';
    readonly scope?: string;
    readonly spec_id?: string;
    readonly spec_ids?: readonly string[];
    readonly to_domain?: string;
    readonly to_scope?: string;
    readonly to_domain_description?: string;
    readonly domain?: string;
    readonly new_domain?: string;
    readonly dry_run?: boolean;
}
export interface RemapEntry {
    readonly old_id: string;
    readonly new_id: string;
    readonly old_path: string;
    readonly new_path: string;
}
export interface MoveRefWarning {
    readonly referrer_spec_id: string;
    readonly referrer_scope: string;
    readonly referrer_path: string;
    readonly old_ref?: string;
    readonly section?: string;
    readonly snippet?: string;
}
export interface SpecMoveResult {
    readonly ok: boolean;
    readonly remap: readonly RemapEntry[];
    readonly rewritten_related_specs: readonly {
        spec_id: string;
        path: string;
    }[];
    readonly cross_scope_refs: readonly MoveRefWarning[];
    readonly body_refs: readonly MoveRefWarning[];
    readonly warnings: readonly string[];
    readonly errors: readonly string[];
    readonly engine_instructions?: string;
}
export declare function composeDomainsEcho(scope: string, root: string): DomainSummary[];
export declare function toolSpecWrite(args: SpecWriteArgs, root?: string): SpecWriteResult;
export declare function toolSpecMove(args: SpecMoveArgs, root?: string): SpecMoveResult;
export declare function reconcileSpecIndexOnDisk(scope: string, root: string, opts?: {
    write?: boolean;
}): {
    changes: {
        added: string[];
        removed: string[];
        modified: string[];
    };
    warnings: string[];
};
export declare function auditRelatedSpecRefsOnDisk(scope: string, root: string): {
    audited: number;
    findings: Array<{
        spec_id: string;
        dangling: string[];
    }>;
};
export declare function reconcileSpecRegistryOnDisk(scope: string, root: string, opts?: {
    write?: boolean;
}): {
    changes: {
        removedMappings: string[];
        danglingFiles: Array<{
            spec_id: string;
            file: string;
        }>;
    };
};
export interface SpecBatchDraft {
    readonly path: string;
    readonly temp_key: string;
    readonly related_by_temp_key?: readonly string[];
}
export interface SpecBatchArgs {
    readonly op: 'create_batch';
    readonly scope?: string;
    readonly drafts: readonly SpecBatchDraft[];
    readonly dry_run?: boolean;
    readonly acknowledge_distinct_temp_keys?: readonly string[];
    readonly acknowledge_single_rule_temp_keys?: readonly string[];
}
export type SpecBatchVerdict = 'written' | 'clean' | 'held' | 'error';
export interface SpecBatchDraftResult {
    readonly temp_key: string;
    readonly path: string;
    readonly verdict: SpecBatchVerdict;
    readonly assigned_spec_id?: string;
    readonly status?: 'near_certain';
    readonly matches?: readonly SpecMatch[];
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
}
export interface SpecBatchResult {
    readonly ok: boolean;
    readonly results: readonly SpecBatchDraftResult[];
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly domains?: readonly DomainSummary[];
}
export declare function toolSpecCreateBatch(args: SpecBatchArgs, root?: string): SpecBatchResult;
export interface SpecSearchArgs {
    readonly query?: string;
    readonly domain?: string;
    readonly applies_to?: readonly string[];
    readonly scope?: string;
}
export interface SpecSearchResult {
    readonly results: readonly SpecIndexEntry[];
    readonly domains: readonly DomainSummary[];
}
export declare function toolSpecSearch(args: SpecSearchArgs, root?: string): SpecSearchResult;
export declare const SPEC_ROLES: readonly SpecRole[];
export interface SpecLinkArgs {
    readonly spec_id: string;
    readonly scope?: string;
    readonly op: 'add' | 'remove';
    readonly file: string;
    readonly role?: SpecRole;
    readonly reason?: string;
    readonly note?: string;
    readonly added_by?: string;
}
export interface SpecLinkResult {
    readonly ok: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
}
export declare function toolSpecLink(args: SpecLinkArgs, root?: string): SpecLinkResult;
