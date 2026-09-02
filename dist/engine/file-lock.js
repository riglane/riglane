import { closeSync, copyFileSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import process from 'node:process';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
export const STALE_LOCK_THRESHOLD_MS = 60_000;
let lockErrorLogger = () => { };
export function setFileLockErrorLogger(fn) {
    lockErrorLogger = fn;
}
export function isProcessAlive(pid) {
    if (!Number.isFinite(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        const code = e.code;
        return code === 'EPERM';
    }
}
function ensureLockParent(lockPath) {
    try {
        const parent = lockPath.split(/[\\/]/).slice(0, -1).join('/') || '.';
        mkdirSync(parent, { recursive: true });
    }
    catch {
    }
}
function tryCreateLock(lockPath) {
    try {
        const fd = openSync(lockPath, 'wx');
        try {
            writeFileSync(fd, `${process.pid}:${Date.now()}\n`, 'utf-8');
        }
        catch {
        }
        return fd;
    }
    catch {
        return null;
    }
}
function reapStaleLock(lockPath) {
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
            }
            catch {
                holderAlive = false;
            }
            if (!holderAlive) {
                try {
                    unlinkSync(lockPath);
                }
                catch {
                }
                return true;
            }
        }
    }
    catch {
    }
    return false;
}
export async function acquireFileLock(lockPath, timeoutMs = 30_000) {
    ensureLockParent(lockPath);
    const start = Date.now();
    let attempt = 0;
    let staleChecked = false;
    while (Date.now() - start < timeoutMs) {
        const fd = tryCreateLock(lockPath);
        if (fd !== null)
            return fd;
        if (!staleChecked) {
            staleChecked = true;
            if (reapStaleLock(lockPath))
                continue;
        }
        attempt += 1;
        await setTimeoutPromise(Math.min(50, 5 + attempt * 2));
    }
    return null;
}
function sleepSync(ms) {
    try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    }
    catch {
    }
}
export function acquireFileLockSync(lockPath, timeoutMs = 30_000) {
    ensureLockParent(lockPath);
    const start = Date.now();
    let attempt = 0;
    let staleChecked = false;
    while (Date.now() - start < timeoutMs) {
        const fd = tryCreateLock(lockPath);
        if (fd !== null)
            return fd;
        if (!staleChecked) {
            staleChecked = true;
            if (reapStaleLock(lockPath))
                continue;
        }
        attempt += 1;
        sleepSync(Math.min(50, 5 + attempt * 2));
    }
    return null;
}
export function releaseFileLock(fd, lockPath) {
    try {
        closeSync(fd);
    }
    catch {
    }
    try {
        unlinkSync(lockPath);
    }
    catch {
    }
}
function writeJsonAtomic(path, data) {
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    for (let attempt = 0;; attempt += 1) {
        try {
            renameSync(tmp, path);
            return;
        }
        catch (e) {
            if (e.code === 'EPERM' && attempt < 5) {
                sleepSync(20);
                continue;
            }
            try {
                writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
                unlinkSync(tmp);
            }
            catch {
            }
            return;
        }
    }
}
function readUnderLock(path, defaultValue) {
    let fileExists = false;
    try {
        fileExists = statSync(path).isFile();
    }
    catch {
        fileExists = false;
    }
    if (!fileExists) {
        return defaultValue !== undefined ? defaultValue : {};
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            return JSON.parse(readFileSync(path, 'utf-8'));
        }
        catch {
            if (attempt === 0) {
                sleepSync(40);
            }
        }
    }
    lockErrorLogger(`Corrupt JSON in ${path}, resetting to default`);
    try {
        copyFileSync(path, `${path}.corrupt`);
        lockErrorLogger(`Corrupt file backed up to ${path}.corrupt`);
    }
    catch {
    }
    return defaultValue !== undefined ? defaultValue : {};
}
function describeError(e) {
    const ctor = e instanceof Error ? e.constructor.name : e === null ? 'null' : typeof e;
    const body = e instanceof Error ? e.message : String(e);
    return `${ctor}: ${body}`;
}
export async function lockedJsonReadModifyWrite(path, modifier, defaultValue) {
    const lockPath = `${path}.lock`;
    const fd = await acquireFileLock(lockPath);
    if (fd === null) {
        lockErrorLogger(`lockedJsonReadModifyWrite failed for ${path}: lock timeout`);
        return null;
    }
    try {
        const data = readUnderLock(path, defaultValue);
        const updated = modifier(data);
        writeJsonAtomic(path, updated);
        return updated;
    }
    catch (e) {
        lockErrorLogger(`lockedJsonReadModifyWrite failed for ${path}: ${describeError(e)}`);
        return null;
    }
    finally {
        releaseFileLock(fd, lockPath);
    }
}
export function lockedJsonReadModifyWriteSync(path, modifier, defaultValue) {
    const lockPath = `${path}.lock`;
    const fd = acquireFileLockSync(lockPath);
    if (fd === null) {
        lockErrorLogger(`lockedJsonReadModifyWriteSync failed for ${path}: lock timeout`);
        return null;
    }
    try {
        const data = readUnderLock(path, defaultValue);
        const updated = modifier(data);
        writeJsonAtomic(path, updated);
        return updated;
    }
    catch (e) {
        lockErrorLogger(`lockedJsonReadModifyWriteSync failed for ${path}: ${describeError(e)}`);
        return null;
    }
    finally {
        releaseFileLock(fd, lockPath);
    }
}
