export interface TrustEntry {
    readonly tree_sha256: string;
    readonly trusted_at: string;
}
export interface TrustStore {
    readonly version: 1;
    readonly workflows: Record<string, TrustEntry>;
}
export type TrustVerdict = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: 'untrusted' | 'changed';
    readonly message: string;
};
export declare class TrustDigestError extends Error {
}
export declare const TRUST_FILENAME = "trusted.json";
export declare function trustStorePath(agentDir: string): string;
export declare function readTrustStore(agentDir: string): TrustStore;
export declare function writeTrustEntry(agentDir: string, workflowId: string, treeSha256: string): TrustEntry;
export declare function removeTrustEntry(agentDir: string, workflowId: string): void;
export declare function computeTreeDigest(workflowDir: string): string;
export declare function checkCommunityTrust(agentDir: string, workflowId: string, workflowDir: string): TrustVerdict;
