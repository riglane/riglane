import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { PRODUCT_DIR } from '../config/paths.js';
import { canonicalCompareForm } from './path-canon.js';
export function isRiglaneRoot(dir) {
    try {
        return existsSync(join(dir, PRODUCT_DIR, 'workflows'));
    }
    catch {
        return false;
    }
}
export function resolveProjectRoot(startDir, bakedRoot) {
    if (bakedRoot !== undefined && bakedRoot !== null && bakedRoot !== '') {
        const baked = canonicalCompareForm(bakedRoot);
        if (isRiglaneRoot(baked))
            return baked;
    }
    const start = canonicalCompareForm(startDir ?? process.cwd());
    const runSegment = `${sep}${PRODUCT_DIR}${sep}local${sep}workflow_runs${sep}`;
    const segIdx = start.indexOf(runSegment);
    if (segIdx > 0)
        return start.slice(0, segIdx);
    if (start.endsWith(`${sep}${PRODUCT_DIR}${sep}local${sep}workflow_runs`)) {
        return start.slice(0, start.length - runSegment.length + sep.length);
    }
    let dir = start;
    for (;;) {
        if (isRiglaneRoot(dir))
            return dir;
        const parent = dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
    }
}
export function parseRootArg(argv) {
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i] ?? '';
        if (a === '--root' && i + 1 < argv.length)
            return argv[i + 1] ?? null;
        if (a.startsWith('--root='))
            return a.slice('--root='.length);
    }
    return null;
}
