import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import process from 'node:process';
const _counts = {
    new: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    pruned: 0,
};
export function resetCounts() {
    _counts.new = 0;
    _counts.updated = 0;
    _counts.unchanged = 0;
    _counts.skipped = 0;
    _counts.pruned = 0;
}
export function getCounts() {
    return { ..._counts };
}
export function bumpCount(key, n = 1) {
    _counts[key] += n;
}
function filesEqual(a, b) {
    try {
        const bufA = readFileSync(a);
        const bufB = readFileSync(b);
        return Buffer.compare(bufA, bufB) === 0;
    }
    catch {
        return false;
    }
}
export function copyTree(src, dst, opts = {}) {
    const force = Boolean(opts.force);
    const update = Boolean(opts.update);
    const dryRun = Boolean(opts.dryRun);
    const copied = [];
    let entries;
    try {
        entries = readdirSync(src, { recursive: true });
    }
    catch {
        entries = [];
    }
    const fileEntries = [];
    for (const entry of entries) {
        const normalized = entry.replace(/\\/g, '/');
        const segments = normalized.split('/');
        if (segments.includes('__pycache__'))
            continue;
        const fileName = segments[segments.length - 1] ?? '';
        if (fileName.endsWith('.pyc'))
            continue;
        const fullSrc = join(src, entry);
        let isFile = false;
        try {
            isFile = statSync(fullSrc).isFile();
        }
        catch {
            isFile = false;
        }
        if (isFile)
            fileEntries.push(entry);
    }
    for (const relEntry of fileEntries) {
        const srcFile = join(src, relEntry);
        const dstFile = join(dst, relEntry);
        const relPath = relative(dst, dstFile).replace(/\\/g, '/');
        const dstDir = dirname(dstFile);
        if (!dryRun) {
            mkdirSync(dstDir, { recursive: true });
        }
        if (existsSync(dstFile)) {
            if (update) {
                if (filesEqual(srcFile, dstFile)) {
                    _counts.unchanged += 1;
                    continue;
                }
                if (dryRun) {
                    process.stdout.write(`  WOULD UPDATE  ${relPath}\n`);
                    _counts.updated += 1;
                }
                else {
                    writeFileSync(dstFile, readFileSync(srcFile));
                    copied.push(relPath);
                    _counts.updated += 1;
                    process.stdout.write(`  UPDATE  ${relPath}\n`);
                }
            }
            else if (force) {
                writeFileSync(dstFile, readFileSync(srcFile));
                copied.push(relPath);
                process.stdout.write(`  COPY  ${relPath}\n`);
            }
            else {
                _counts.skipped += 1;
                process.stdout.write(`  SKIP  ${relPath} (exists)\n`);
            }
        }
        else {
            if (dryRun) {
                process.stdout.write(`  WOULD ADD     ${relPath}\n`);
                _counts.new += 1;
            }
            else {
                writeFileSync(dstFile, readFileSync(srcFile));
                copied.push(relPath);
                _counts.new += 1;
                process.stdout.write(`  NEW   ${relPath}\n`);
            }
        }
    }
    return copied;
}
export function pruneTree(src, dst, opts = {}) {
    const dryRun = Boolean(opts.dryRun);
    const excludeFiles = new Set(opts.excludeFiles ?? []);
    const pruned = [];
    let entries;
    try {
        entries = readdirSync(dst, { recursive: true });
    }
    catch {
        return pruned;
    }
    const sorted = [...entries].sort((a, b) => {
        const depthA = a.replace(/\\/g, '/').split('/').length;
        const depthB = b.replace(/\\/g, '/').split('/').length;
        if (depthA !== depthB)
            return depthB - depthA;
        return b.localeCompare(a);
    });
    for (const entry of sorted) {
        const fullDst = join(dst, entry);
        let isFile = false;
        try {
            isFile = statSync(fullDst).isFile();
        }
        catch {
            continue;
        }
        if (!isFile)
            continue;
        const fileName = basename(entry);
        if (excludeFiles.has(fileName))
            continue;
        const fullSrc = join(src, entry);
        if (existsSync(fullSrc))
            continue;
        const relPath = entry.replace(/\\/g, '/');
        if (dryRun) {
            process.stdout.write(`  WOULD PRUNE   ${relPath}\n`);
        }
        else {
            try {
                unlinkSync(fullDst);
                process.stdout.write(`  PRUNE ${relPath}\n`);
            }
            catch {
            }
        }
        pruned.push(relPath);
        _counts.pruned += 1;
    }
    for (const entry of sorted) {
        const fullDst = join(dst, entry);
        let isDir = false;
        try {
            isDir = statSync(fullDst).isDirectory();
        }
        catch {
            continue;
        }
        if (!isDir)
            continue;
        if (basename(entry) === '__pycache__')
            continue;
        const fullSrc = join(src, entry);
        let srcIsDir = false;
        try {
            srcIsDir = statSync(fullSrc).isDirectory();
        }
        catch {
            srcIsDir = false;
        }
        let dstEmpty = false;
        try {
            dstEmpty = readdirSync(fullDst).length === 0;
        }
        catch {
            dstEmpty = false;
        }
        if (!srcIsDir || dstEmpty) {
            const relDir = entry.replace(/\\/g, '/');
            if (dryRun) {
                if (dstEmpty) {
                    process.stdout.write(`  WOULD PRUNE   ${relDir}/\n`);
                }
            }
            else {
                try {
                    rmdirSync(fullDst);
                    process.stdout.write(`  PRUNE ${relDir}/\n`);
                }
                catch {
                }
            }
        }
    }
    return pruned;
}
export function atomicWriteJson(path, data) {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    renameSync(tmp, path);
}
