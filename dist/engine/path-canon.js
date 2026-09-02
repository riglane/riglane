import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
const memo = new Map();
export function _resetPathCanonMemo() {
    memo.clear();
}
export function canonicalCompareForm(p) {
    const abs = resolve(p);
    const hit = memo.get(abs);
    if (hit !== undefined)
        return hit;
    let out = abs;
    try {
        let dir = abs;
        const tail = [];
        for (;;) {
            try {
                const real = realpathSync.native(dir);
                out = tail.length > 0 ? join(real, ...tail.reverse()) : real;
                break;
            }
            catch {
                const parent = dirname(dir);
                if (parent === dir)
                    break;
                tail.push(basename(dir));
                dir = parent;
            }
        }
    }
    catch {
        out = abs;
    }
    memo.set(abs, out);
    return out;
}
