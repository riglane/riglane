import { loadYaml, validateFile } from '../engine/schema-validate.js';
function resolveOpts(opts = {}) {
    return {
        stdout: opts.stdout ?? ((s) => void process.stdout.write(s)),
        stderr: opts.stderr ?? ((s) => void process.stderr.write(s)),
    };
}
export async function runSchemaValidateCli(argv = process.argv.slice(2), opts = {}) {
    const r = resolveOpts(opts);
    const outputPath = argv[0];
    const schemaPath = argv[1];
    if (!outputPath || !schemaPath) {
        r.stderr('usage: riglane schema-validate <output-file> <schema-file>\n');
        return 1;
    }
    let schema;
    try {
        schema = loadYaml(schemaPath);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        r.stderr(`schema-validate: failed to load schema '${schemaPath}': ${msg}\n`);
        return 1;
    }
    let result;
    try {
        result = validateFile(outputPath, schema);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        r.stderr(`schema-validate: validation runtime error: ${msg}\n`);
        return 1;
    }
    if (result.passed) {
        r.stdout(`PASS: ${outputPath} matches schema ${schemaPath} (${result.checks} checks)\n`);
        return 0;
    }
    r.stderr(`FAIL: ${outputPath} does NOT match schema ${schemaPath}\n` +
        `Checks: ${result.checks}, Failures: ${result.failures}\n` +
        `Details:\n${result.details.map((d) => `  - ${d}`).join('\n')}\n`);
    return 2;
}
