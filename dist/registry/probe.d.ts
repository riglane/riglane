import type { Entry } from './registry.js';
export type DriftStatus = 
'up-to-date'
 | 'outdated'
 | 'legacy-marker'
 | 'missing-marker'
 | 'legacy-dir'
 | 'no-agent-dir'
 | 'path-gone';
export interface MarkerPayload {
    readonly installedBy: string;
    readonly templateHash: string;
}
export interface ProbeResult {
    readonly pathExists: boolean;
    readonly agentDirExists: boolean;
    readonly markerVersion: string | null;
    readonly markerHash: string | null;
    readonly installedVersion: string;
    readonly installedHash: string;
    readonly drift: DriftStatus;
    readonly temporary: boolean;
}
export declare function probe(entry: Entry): ProbeResult;
export declare function driftLabel(d: DriftStatus): string;
