import { buildWorkflowInventory } from '../../catalog/inventory.js';
import { type CatalogEntry, type EntrySource } from '../../catalog/entry.js';
import type { Workflow } from '../../types/workflow.js';
export interface AddCliDeps {
    readonly cwd?: string;
    readonly prompt?: (question: string) => Promise<string>;
    readonly fetchJson?: (url: string) => Promise<unknown | null>;
    readonly fetchTree?: (source: EntrySource, scratchParent: string) => {
        cloneDir: string;
        workflowDir: string;
    };
}
export declare function runAddCli(argv: readonly string[], deps?: AddCliDeps): Promise<number>;
export declare function printInspectScreen(entry: CatalogEntry, inv: ReturnType<typeof buildWorkflowInventory>, workflow: Workflow, installDir: string): void;
