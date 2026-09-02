import type { BundledFileEntry, CapabilityFlag, DeciderEntry, ScriptToolEntry, WorkflowInventory } from './inventory.js';
export interface CommandChange {
    readonly key: string;
    readonly before: string;
    readonly after: string;
}
export interface FileChange {
    readonly path: string;
    readonly before: string;
    readonly after: string;
}
export interface InventoryDiff {
    readonly tools: {
        readonly added: readonly ScriptToolEntry[];
        readonly removed: readonly ScriptToolEntry[];
        readonly changed: readonly CommandChange[];
    };
    readonly deciders: {
        readonly added: readonly DeciderEntry[];
        readonly removed: readonly DeciderEntry[];
        readonly changed: readonly CommandChange[];
    };
    readonly executables: {
        readonly added: readonly BundledFileEntry[];
        readonly removed: readonly BundledFileEntry[];
        readonly changed: readonly FileChange[];
    };
    readonly newFlags: readonly CapabilityFlag[];
    readonly shellSurfaceChanged: boolean;
}
export declare function diffInventories(oldInv: WorkflowInventory, newInv: WorkflowInventory): InventoryDiff;
