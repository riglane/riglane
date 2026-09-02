
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import process from 'node:process';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

export const STALE_LOCK_THRESHOLD_MS = 60_000;

let lockErrorLogger: (msg: string) => void = () => {};

export function setFileLockErrorLogger(fn: (msg: string) => void): void {
  lockErrorLogger = fn;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

function ensureLockParent(lockPath: string): void {
  try {
    const parent = lockPath.split(/[\\/]/).slice(0, -1).join('/') || '.';
    mkdirSync(parent, { recursive: true });
  } catch {
  }
}

function tryCreateLock(lockPath: string): number | null {
  try {
    const fd = openSync(lockPath, 'wx');
    try {
      writeFileSync(fd, `${process.pid}:${Date.now()}\n`, 'utf-8');
    } catch {
    }
    return fd;
  } catch {
    return null;
  }
}

function reapStaleLock(lockPath: string): boolean {
  try {
    const lockStat = statSync(lockPath);
    const ageMs = Date.now() - lockStat.mtimeMs;
    if (ageMs > STALE_LOCK_THRESHOLD_MS) {
      let holderAlive = false;
      try {
        const content = readFileSync(lockPath, 'utf-8').trim();
        const pidStr = content.split(':')[0] ?? '';
        const pid = Number.parseInt(pidStr, 10);
        if (Number.isFinite(pid) && pid > 0) {
          holderAlive = isProcessAlive(pid);
        }
      } catch {
        holderAlive = false;
      }
      if (!holderAlive) {
        try {
          unlinkSync(lockPath);
        } catch {
        }
        return true;
      }
    }
  } catch {
  }
  return false;
}

export async function acquireFileLock(lockPath: string, timeoutMs = 30_000): Promise<number | null> {
  ensureLockParent(lockPath);
  const start = Date.now();
  let attempt = 0;
  let staleChecked = false;
  while (Date.now() - start < timeoutMs) {
    const fd = tryCreateLock(lockPath);
    if (fd !== null) return fd;
    if (!staleChecked) {
      staleChecked = true;
      if (reapStaleLock(lockPath)) continue;
    }
    attempt += 1;
    await setTimeoutPromise(Math.min(50, 5 + attempt * 2));
  }
  return null;
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
  }
}

export function acquireFileLockSync(lockPath: string, timeoutMs = 30_000): number | null {
  ensureLockParent(lockPath);
  const start = Date.now();
  let attempt = 0;
  let staleChecked = false;
  while (Date.now() - start < timeoutMs) {
    const fd = tryCreateLock(lockPath);
    if (fd !== null) return fd;
    if (!staleChecked) {
      staleChecked = true;
      if (reapStaleLock(lockPath)) continue;
    }
    attempt += 1;
    sleepSync(Math.min(50, 5 + attempt * 2));
  }
  return null;
}

export function releaseFileLock(fd: number, lockPath: string): void {
  try {
    closeSync(fd);
  } catch {
  }
  try {
    unlinkSync(lockPath);
  } catch {
  }
}

function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(tmp, path);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM' && attempt < 5) {
        sleepSync(20);
        continue;
      }
      try {
        writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
        unlinkSync(tmp);
      } catch {
      }
      return;
    }
  }
}

function readUnderLock<T>(path: string, defaultValue?: T): T {
  let fileExists = false;
  try {
    fileExists = statSync(path).isFile();
  } catch {
    fileExists = false;
  }
  if (!fileExists) {
    return defaultValue !== undefined ? defaultValue : ({} as T);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch {
      if (attempt === 0) {
        sleepSync(40);
      }
    }
  }
  lockErrorLogger(`Corrupt JSON in ${path}, resetting to default`);
  try {
    copyFileSync(path, `${path}.corrupt`);
    lockErrorLogger(`Corrupt file backed up to ${path}.corrupt`);
  } catch {
  }
  return defaultValue !== undefined ? defaultValue : ({} as T);
}

function describeError(e: unknown): string {
  const ctor = e instanceof Error ? e.constructor.name : e === null ? 'null' : typeof e;
  const body = e instanceof Error ? e.message : String(e);
  return `${ctor}: ${body}`;
}

export async function lockedJsonReadModifyWrite<T>(
  path: string,
  modifier: (data: T) => T,
  defaultValue?: T,
): Promise<T | null> {
  const lockPath = `${path}.lock`;
  const fd = await acquireFileLock(lockPath);
  if (fd === null) {
    lockErrorLogger(`lockedJsonReadModifyWrite failed for ${path}: lock timeout`);
    return null;
  }
  try {
    const data = readUnderLock<T>(path, defaultValue);
    const updated = modifier(data);
    writeJsonAtomic(path, updated);
    return updated;
  } catch (e) {
    lockErrorLogger(`lockedJsonReadModifyWrite failed for ${path}: ${describeError(e)}`);
    return null;
  } finally {
    releaseFileLock(fd, lockPath);
  }
}

export function lockedJsonReadModifyWriteSync<T>(
  path: string,
  modifier: (data: T) => T,
  defaultValue?: T,
): T | null {
  const lockPath = `${path}.lock`;
  const fd = acquireFileLockSync(lockPath);
  if (fd === null) {
    lockErrorLogger(`lockedJsonReadModifyWriteSync failed for ${path}: lock timeout`);
    return null;
  }
  try {
    const data = readUnderLock<T>(path, defaultValue);
    const updated = modifier(data);
    writeJsonAtomic(path, updated);
    return updated;
  } catch (e) {
    lockErrorLogger(`lockedJsonReadModifyWriteSync failed for ${path}: ${describeError(e)}`);
    return null;
  } finally {
    releaseFileLock(fd, lockPath);
  }
}
