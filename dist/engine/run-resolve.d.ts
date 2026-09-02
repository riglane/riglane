export declare function ledgerPathFor(agentDir: string, runId: string): string;
export declare function runDirFor(agentDir: string, runId: string): string;
export declare const RUN_TOKEN_RE: RegExp;
export declare const CHILD_SESSION_RE: RegExp;
export declare function sessionMapPath(agentDir: string): string;
export declare function spoolPath(agentDir: string): string;
export declare function extractRunToken(text: string | null | undefined): string | null;
export declare function extractChildSessionId(text: string | null | undefined): string | null;
export declare function extractRunIdRef(agentDir: string, text: string | null | undefined): string | null;
export interface LiveRun {
    readonly runId: string;
    readonly runToken: string | null;
}
export declare function listLiveRuns(agentDir: string): LiveRun[];
export declare function resolveRunByToken(agentDir: string, token: string): string | null;
export declare function appendSessionMapEntry(agentDir: string, key: string, runId: string): void;
export declare function lookupSessionMap(agentDir: string, key: string): string | null;
export declare function claimSpooledEvents(agentDir: string, runId: string, runToken: string | null): Array<Record<string, unknown>>;
export declare function appendSpool(agentDir: string, record: unknown, reason: string): void;
