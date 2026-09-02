export declare const STALE_LOCK_THRESHOLD_MS = 60000;
export declare function setFileLockErrorLogger(fn: (msg: string) => void): void;
export declare function isProcessAlive(pid: number): boolean;
export declare function acquireFileLock(lockPath: string, timeoutMs?: number): Promise<number | null>;
export declare function acquireFileLockSync(lockPath: string, timeoutMs?: number): number | null;
export declare function releaseFileLock(fd: number, lockPath: string): void;
export declare function lockedJsonReadModifyWrite<T>(path: string, modifier: (data: T) => T, defaultValue?: T): Promise<T | null>;
export declare function lockedJsonReadModifyWriteSync<T>(path: string, modifier: (data: T) => T, defaultValue?: T): T | null;
