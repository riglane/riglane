import type { AdapterId } from '../adapters/index.js';
export type LastAction = 'init' | 'update' | 'migrate';
export interface Entry {
    readonly slug: string;
    readonly id?: string;
    readonly path: string;
    readonly adapters: readonly AdapterId[];
    readonly specGuidance?: boolean;
    readonly registered_at: string;
    readonly last_seen: string;
    readonly last_action: LastAction;
}
interface RegistryFile {
    version: 2;
    projects: Entry[];
}
export declare function registryPath(): string;
export declare function load(): RegistryFile;
export declare function save(reg: RegistryFile): void;
export declare function findByPath(reg: RegistryFile, absPath: string): Entry | undefined;
export declare function findById(reg: RegistryFile, id: string): Entry | undefined;
export declare function list(reg?: RegistryFile): Entry[];
export declare function register(input: {
    id?: string;
    path: string;
    adapters: readonly AdapterId[];
    specGuidance?: boolean;
    action: LastAction;
}): Entry;
export declare function unregister(absPath: string): boolean;
export declare function isTemporaryLocation(p: string): boolean;
export declare function clear(): void;
export declare function canonicalize(p: string): string;
export declare function pathExistsAsDir(p: string): boolean;
export {};
