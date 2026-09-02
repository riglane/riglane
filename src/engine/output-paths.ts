
const PARALLEL_KEY_NS = 'parallel_key';

export class OutputPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputPathError';
  }
}

export function assertConcreteParamValue(value: string, token: string): string {
  if (value.includes('*') || value.includes('?') || value.includes('[')) {
    throw new OutputPathError(
      `'{${token}}' resolved to '${value}', which contains a glob character (*, ?, or [). ` +
        `A param value used in an output path must be concrete — write a literal '*' in the path if you intend a wildcard.`,
    );
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new OutputPathError(
      `'{${token}}' resolved to '${value}', which contains a path separator. ` +
        `A param value used in an output path segment must be a single name (use separate path segments or params).`,
    );
  }
  return value;
}

export function resolveConcreteOutputPath(
  rawPath: string,
  params: Record<string, unknown>,
): string {
  const segs: string[] = [];

  for (const seg of rawPath.split('/')) {
    if (seg === '{}' || seg.includes('{}')) {
      throw new OutputPathError(
        `'{}' (branch-index slot) is only valid in a parallel step's output path, not '${rawPath}'.`,
      );
    }

    const resolved = seg.replace(/\{([^}]*)\}/g, (_match, token: string) => {
      if (token === PARALLEL_KEY_NS || token.startsWith(`${PARALLEL_KEY_NS}.`)) {
        throw new OutputPathError(
          `'{${token}}' is only valid in a parallel step's output path (parallel_key namespace), not '${rawPath}'.`,
        );
      }
      if (Object.prototype.hasOwnProperty.call(params, token)) {
        const v = params[token];
        if (v === null || v === undefined) return '';
        return assertConcreteParamValue(String(v), token);
      }
      throw new OutputPathError(
        `'{${token}}' in output path '${rawPath}' is not a declared workflow param. ` +
          `Declare it in params:, or write a literal '*' for a glob.`,
      );
    });

    if (resolved === '') continue;
    segs.push(resolved);
  }

  if (segs.length === 0) {
    throw new OutputPathError(
      `Output path '${rawPath}' resolved to nothing (all segments empty). ` +
        `Declare at least one non-placeholder or non-null segment.`,
    );
  }

  return segs.join('/');
}
