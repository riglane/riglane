
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

import type { EntrySource } from './entry.js';

export class FetchError extends Error {}

interface GitResult {
  readonly status: number;
  readonly stderr: string;
}

function git(args: readonly string[], cwd: string): GitResult {
  const proc = spawnSync('git', args as string[], { cwd, encoding: 'utf-8', timeout: 300_000 });
  if (proc.error) {
    const code = (proc.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new FetchError(
        `git is required to install catalog workflows but was not found on PATH.`,
      );
    }
    throw new FetchError(`git ${args[0]} failed: ${proc.error.message}`);
  }
  return { status: proc.status ?? -1, stderr: (proc.stderr ?? '').trim() };
}

export function fetchSourceTree(
  source: EntrySource,
  scratchParent: string,
): { cloneDir: string; workflowDir: string } {
  const cloneDir = mkdtempSync(join(scratchParent, 'riglane-fetch-'));

  let r = git(['init', '--quiet'], cloneDir);
  if (r.status !== 0) throw new FetchError(`git init failed: ${r.stderr}`);
  r = git(['remote', 'add', 'origin', source.repo], cloneDir);
  if (r.status !== 0) throw new FetchError(`git remote add failed: ${r.stderr}`);

  r = git(['fetch', '--quiet', '--depth', '1', 'origin', source.sha], cloneDir);
  if (r.status !== 0) {
    r = git(['fetch', '--quiet', 'origin'], cloneDir);
    if (r.status !== 0) {
      throw new FetchError(
        `cannot fetch ${source.repo}: ${r.stderr}\n` +
          `Check the repository URL, your network access, and that the repository is public.`,
      );
    }
  }

  r = git(
    ['-c', 'core.autocrlf=false', '-c', 'advice.detachedHead=false', 'checkout', '--quiet', source.sha],
    cloneDir,
  );
  if (r.status !== 0) {
    throw new FetchError(
      `commit ${source.sha} does not exist in ${source.repo} (or is not reachable): ${r.stderr}\n` +
        `The catalog pins full commit SHAs; a rewritten or deleted history breaks the pin.`,
    );
  }

  const workflowDir = source.path === '' ? cloneDir : join(cloneDir, source.path);
  if (!existsSync(join(workflowDir, 'workflow.yaml'))) {
    throw new FetchError(
      `no workflow.yaml at '${source.path || '.'}' inside ${source.repo} @ ${source.sha.slice(0, 12)}… — ` +
        `the entry's source.path does not point at a workflow directory.`,
    );
  }
  return { cloneDir, workflowDir };
}
