import type { ProbeResult } from '../../registry/probe.js';
import type { Entry } from '../../registry/registry.js';
export interface ProjectReport {
    readonly slug: string;
    readonly path: string;
    readonly adapters: readonly string[];
    readonly drift: ProbeResult['drift'];
    readonly temporary: boolean;
    readonly path_exists: boolean;
    readonly in_progress_runs: readonly string[];
}
export declare function reportFor(entry: Entry): ProjectReport;
export declare function listReports(): ProjectReport[];
export interface ForgetOptions {
    readonly temp: boolean;
    readonly gone: boolean;
    readonly del: boolean;
    readonly force: boolean;
    readonly dryRun: boolean;
}
export interface ForgetOutcome {
    readonly path: string;
    readonly action: 'forgotten' | 'deleted' | 'kept';
    readonly reason: string;
}
export declare function selectForForget(reports: readonly ProjectReport[], opts: Pick<ForgetOptions, 'temp' | 'gone'>): ProjectReport[];
export declare function forgetProjects(selected: readonly ProjectReport[], opts: ForgetOptions): ForgetOutcome[];
export declare function runProjects(args: string[]): Promise<number>;
