import type { EntrySource } from './entry.js';
export declare class FetchError extends Error {
}
export declare function fetchSourceTree(source: EntrySource, scratchParent: string): {
    cloneDir: string;
    workflowDir: string;
};
