import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCT_DIR } from '../config/paths.js';
import { ENV_ACTIVE_WORKFLOW } from '../config/product.js';
export const USER_STATE_DIR = join(PRODUCT_DIR, 'local');
export const ACTIVE_WORKFLOW_FILE = join(USER_STATE_DIR, 'active-workflow');
export function readActiveWorkflow(root = '.') {
    const path = join(root, ACTIVE_WORKFLOW_FILE);
    if (!existsSync(path) || !statSync(path).isFile())
        return null;
    let text;
    try {
        text = readFileSync(path, 'utf-8');
    }
    catch {
        return null;
    }
    const stripped = text.trim();
    return stripped || null;
}
export function writeActiveWorkflow(name, root = '.') {
    const path = join(root, ACTIVE_WORKFLOW_FILE);
    mkdirSync(join(root, USER_STATE_DIR), { recursive: true });
    writeFileSync(path, `${name}\n`, 'utf-8');
}
export function clearActiveWorkflow(root = '.') {
    const path = join(root, ACTIVE_WORKFLOW_FILE);
    if (existsSync(path) && statSync(path).isFile()) {
        unlinkSync(path);
        return true;
    }
    return false;
}
export function resolveActiveWorkflow(root = '.', env = process.env) {
    const fromEnv = env[ENV_ACTIVE_WORKFLOW]?.trim();
    if (fromEnv)
        return [fromEnv, 'env'];
    const marker = readActiveWorkflow(root);
    if (marker)
        return [marker, 'marker'];
    return [null, 'none'];
}
