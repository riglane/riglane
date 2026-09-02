import { statSync } from 'node:fs';
import { globSync } from 'glob';
export function resolveFiles(pattern) {
    try {
        const stat = statSync(pattern);
        if (stat.isFile())
            return [pattern];
    }
    catch {
    }
    const matches = globSync(pattern, { nodir: true, windowsPathsNoEscape: true });
    return matches.filter((p) => {
        try {
            return statSync(p).isFile();
        }
        catch {
            return false;
        }
    });
}
