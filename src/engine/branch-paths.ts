
import { assertConcreteParamValue } from './output-paths.js';

const PARALLEL_KEY_NS = 'parallel_key';

export interface BranchPathResult {
  readonly workingPath: string;
  readonly semanticPath: string;
  readonly scaffolded: boolean;
  readonly autoFallback: boolean;
}

export class BranchPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BranchPathError';
  }
}

function assertPathSafe(value: string, token: string): void {
  if (value.length === 0) {
    throw new BranchPathError(
      `'{${token}}' resolved to an empty string. A parallel_key field used in an output path is the branch identity and must be a non-empty scalar.`,
    );
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new BranchPathError(
      `'{${token}}' resolved to '${value}', which contains a path separator. A branch-key path segment must be a single name.`,
    );
  }
  if (value === '.' || value === '..' || value.includes('..')) {
    throw new BranchPathError(
      `'{${token}}' resolved to '${value}', which contains '.'/'..'. Path-traversal segments are not allowed.`,
    );
  }
  if (/\s/.test(value)) {
    throw new BranchPathError(
      `'{${token}}' resolved to '${value}', which contains whitespace. Use a whitespace-free key for path segments.`,
    );
  }
}

function resolveParallelKeyToken(fieldPath: string | null, branchItem: unknown): string {
  if (fieldPath === null) {
    if (typeof branchItem === 'string' || typeof branchItem === 'number') {
      return String(branchItem);
    }
    const kind =
      branchItem === null ? 'null' : Array.isArray(branchItem) ? 'an array' : typeof branchItem;
    throw new BranchPathError(
      `'{parallel_key}' requires the parallel_key item to be a scalar (string/number), but the item is ${kind}. Use '{parallel_key.<field>}' to select a scalar field.`,
    );
  }
  let cur: unknown = branchItem;
  for (const seg of fieldPath.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) {
      throw new BranchPathError(
        `'{parallel_key.${fieldPath}}' — cannot read field '${seg}' because the branch item (or an intermediate value) is not an object.`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) {
      throw new BranchPathError(
        `'{parallel_key.${fieldPath}}' — field '${seg}' is not present on the branch item. Check the parallel_key struct.`,
      );
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (typeof cur === 'string' || typeof cur === 'number') {
    return String(cur);
  }
  const kind = cur === null ? 'null' : Array.isArray(cur) ? 'an array' : typeof cur;
  throw new BranchPathError(
    `'{parallel_key.${fieldPath}}' must resolve to a string or number, but got ${kind}. A path segment cannot be built from a non-scalar.`,
  );
}

export function resolveBranchPath(
  rawPath: string,
  params: Record<string, unknown>,
  branchItem: unknown,
  branchIndex: number,
): BranchPathResult {
  const workingSegs: string[] = [];
  const semanticSegs: string[] = [];
  let hasBranchVariant = false;
  let scaffolded = false;

  for (const seg of rawPath.split('/')) {
    if (seg === '{}') {
      workingSegs.push(`_branch_${branchIndex}`);
      hasBranchVariant = true;
      scaffolded = true;
      continue;
    }
    if (seg.includes('{}')) {
      throw new BranchPathError(
        `'{}' (branch-index slot) must be its own path segment, but got '${seg}'.`,
      );
    }

    const resolved = seg.replace(/\{([^}]*)\}/g, (_match, token: string) => {
      if (token === PARALLEL_KEY_NS) {
        hasBranchVariant = true;
        const v = resolveParallelKeyToken(null, branchItem);
        assertPathSafe(v, token);
        return v;
      }
      if (token.startsWith(`${PARALLEL_KEY_NS}.`)) {
        hasBranchVariant = true;
        const v = resolveParallelKeyToken(token.slice(PARALLEL_KEY_NS.length + 1), branchItem);
        assertPathSafe(v, token);
        return v;
      }
      if (Object.prototype.hasOwnProperty.call(params, token)) {
        const v = params[token];
        return v === null || v === undefined ? '' : assertConcreteParamValue(String(v), token);
      }
      throw new BranchPathError(
        `'{${token}}' in a parallel output path is neither a declared workflow param nor a parallel_key field. ` +
          `Use {param}, {parallel_key.<field>}, {parallel_key}, or {} (branch index).`,
      );
    });

    if (resolved === '') {
      continue;
    }
    workingSegs.push(resolved);
    semanticSegs.push(resolved);
  }

  if (workingSegs.length === 0) {
    throw new BranchPathError(
      `Output path '${rawPath}' resolved to nothing (all segments empty). Declare at least one non-placeholder or non-null segment.`,
    );
  }

  let autoFallback = false;
  if (!hasBranchVariant) {
    workingSegs.splice(Math.max(workingSegs.length - 1, 0), 0, `_branch_${branchIndex}`);
    scaffolded = true;
    autoFallback = true;
  }

  return {
    workingPath: workingSegs.join('/'),
    semanticPath: semanticSegs.join('/'),
    scaffolded,
    autoFallback,
  };
}

export function assertBranchPathsUnique(results: ReadonlyArray<BranchPathResult>): void {
  const seen = new Map<string, number>();
  for (let i = 0; i < results.length; i += 1) {
    const sp = results[i]?.semanticPath ?? '';
    if (sp.includes('*') || sp.includes('?') || sp.includes('[')) continue;
    const prev = seen.get(sp);
    if (prev !== undefined) {
      throw new BranchPathError(
        `Parallel branches ${prev} and ${i} both resolve to the same concrete output '${sp}' — they would overwrite each other when branch outputs are merged. ` +
          `Give each branch a distinct path with {parallel_key.<field>}, or use a glob basename (e.g. *.md) with distinct filenames.`,
      );
    }
    seen.set(sp, i);
  }
}
