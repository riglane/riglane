import { type EntrySource } from '../../catalog/entry.js';
export interface UpdateEntryCliDeps {
    readonly cwd?: string;
    readonly prompt?: (question: string) => Promise<string>;
    readonly fetchJson?: (url: string) => Promise<unknown | null>;
    readonly fetchTree?: (source: EntrySource, scratchParent: string) => {
        cloneDir: string;
        workflowDir: string;
    };
}
export declare function isInstalledCommunityWorkflow(cwd: string | undefined, id: string): boolean;
export declare function runUpdateEntryCli(argv: readonly string[], deps?: UpdateEntryCliDeps): Promise<number>;
