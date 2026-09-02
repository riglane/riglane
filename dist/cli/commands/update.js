import { runInit } from './init.js';
export function runUpdate(target, opts = {}) {
    return runInit(target, { ...opts, force: false, update: true });
}
