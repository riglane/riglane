import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
function readPackageVersion() {
    try {
        const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (typeof pkg.version === 'string' && pkg.version.length > 0)
            return pkg.version;
    }
    catch {
    }
    return '0.0.0-unknown';
}
export const VERSION = readPackageVersion();
