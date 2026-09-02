import type { Host } from '../types/enums.js';
export declare function parseHostFlag(args: readonly string[]): Host | null;
export interface HookIo {
    readonly stdout: (chunk: string) => void;
    readonly stderr: (chunk: string) => void;
}
export declare function emitPreToolUseDeny(host: Host | null, reason: string, io: HookIo): number;
