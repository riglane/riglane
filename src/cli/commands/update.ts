
import type { RunOptions } from './init.js';
import { runInit } from './init.js';

export function runUpdate(target: string, opts: RunOptions = {}): Promise<number> {
  return runInit(target, { ...opts, force: false, update: true });
}
