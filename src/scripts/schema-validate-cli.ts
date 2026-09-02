
import { loadYaml, validateFile } from '../engine/schema-validate.js';
import type { StructSchema } from '../types/struct.js';

export interface SchemaValidateCliOptions {
  readonly stdout?: (s: string) => void;
  readonly stderr?: (s: string) => void;
}

interface ResolvedOptions {
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
}

function resolveOpts(opts: SchemaValidateCliOptions = {}): ResolvedOptions {
  return {
    stdout: opts.stdout ?? ((s: string) => void process.stdout.write(s)),
    stderr: opts.stderr ?? ((s: string) => void process.stderr.write(s)),
  };
}

export async function runSchemaValidateCli(
  argv: string[] = process.argv.slice(2),
  opts: SchemaValidateCliOptions = {},
): Promise<number> {
  const r = resolveOpts(opts);

  const outputPath = argv[0];
  const schemaPath = argv[1];

  if (!outputPath || !schemaPath) {
    r.stderr('usage: riglane schema-validate <output-file> <schema-file>\n');
    return 1;
  }

  let schema: StructSchema;
  try {
    schema = loadYaml<StructSchema>(schemaPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    r.stderr(`schema-validate: failed to load schema '${schemaPath}': ${msg}\n`);
    return 1;
  }

  let result: ReturnType<typeof validateFile>;
  try {
    result = validateFile(outputPath, schema);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    r.stderr(`schema-validate: validation runtime error: ${msg}\n`);
    return 1;
  }

  if (result.passed) {
    r.stdout(`PASS: ${outputPath} matches schema ${schemaPath} (${result.checks} checks)\n`);
    return 0;
  }

  r.stderr(
    `FAIL: ${outputPath} does NOT match schema ${schemaPath}\n` +
      `Checks: ${result.checks}, Failures: ${result.failures}\n` +
      `Details:\n${result.details.map((d) => `  - ${d}`).join('\n')}\n`,
  );
  return 2;
}
