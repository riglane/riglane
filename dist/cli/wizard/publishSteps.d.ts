export interface GitFacts {
    readonly isRepo: boolean;
    readonly headSha: string;
    readonly clean: boolean;
    readonly remoteUrl: string;
    readonly headPushed: 'yes' | 'no' | 'unknown';
}
export declare function gitFacts(dir: string): GitFacts;
export interface PreflightRow {
    readonly label: string;
    readonly status: 'ok' | 'fail' | 'warn';
    readonly detail: string;
    readonly blocking: boolean;
}
export interface PreflightReport {
    readonly rows: PreflightRow[];
    readonly blocked: boolean;
    readonly id: string;
    readonly git: GitFacts;
    readonly licenseName: string;
}
export declare function detectLicense(repoRoot: string): string;
export declare function runPreflight(workflowDir: string): PreflightReport;
export interface PackResult {
    readonly lockText: string;
    readonly summary: string;
    readonly level: 'verified' | 'community';
    readonly fromCommit: boolean;
}
export declare function packLock(workflowDir: string): PackResult;
export interface EntryPin {
    readonly repo: string;
    readonly path: string;
    readonly sha: string;
}
export declare function repinEntryText(raw: string, pin: EntryPin): string;
export interface ScaffoldFields {
    readonly id: string;
    readonly summary: string;
    readonly author: string;
    readonly license: string;
    readonly pin: EntryPin;
}
export declare function scaffoldEntryText(f: ScaffoldFields): string;
export declare function writeEntryFiles(entryDir: string, entryText: string, lockText: string): void;
export declare function sanitizeOutput(raw: string): string[];
export declare function validateCatalogCheckout(catalogRoot: string): {
    ran: boolean;
    ok: boolean;
    output: string;
};
export declare function pathInsideRepo(workflowDir: string): string;
