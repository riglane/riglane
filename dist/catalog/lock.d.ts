import type { WorkflowInventory } from './inventory.js';
export declare function normalizeLockEol(text: string): string;
export declare const LOCK_FILENAME = "entry.lock.yaml";
export declare const LOCK_VERSION = 1;
export declare function composeLockDocument(inv: WorkflowInventory): string;
