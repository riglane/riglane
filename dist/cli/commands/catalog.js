import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { InventoryError, buildWorkflowInventory } from '../../catalog/inventory.js';
import { LOCK_FILENAME, composeLockDocument } from '../../catalog/lock.js';
import { loadYaml } from '../../engine/schema-validate.js';
import { fullValidateWorkflow } from '../../engine/workflow-engine.js';
const USAGE = 'Usage: riglane catalog pack [workflow-dir] [--out <file>] [--stdout]\n';
export function runCatalogCli(argv) {
    const sub = argv[0];
    if (sub === 'pack')
        return runPack(argv.slice(1));
    process.stderr.write(sub === undefined ? USAGE : `catalog: unknown subcommand '${sub}'\n${USAGE}`);
    return 2;
}
function runPack(argv) {
    const toStdout = argv.includes('--stdout');
    let outPath = null;
    const positionals = [];
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--stdout')
            continue;
        if (a === '--out') {
            const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) {
                process.stderr.write(`catalog pack: --out requires a file path\n${USAGE}`);
                return 2;
            }
            outPath = v;
            i += 1;
            continue;
        }
        if (a.startsWith('--')) {
            process.stderr.write(`catalog pack: unknown option '${a}'\n${USAGE}`);
            return 2;
        }
        positionals.push(a);
    }
    if (positionals.length > 1) {
        process.stderr.write(`catalog pack: expected at most one workflow-dir argument\n${USAGE}`);
        return 2;
    }
    if (toStdout && outPath !== null) {
        process.stderr.write(`catalog pack: --stdout and --out are mutually exclusive\n${USAGE}`);
        return 2;
    }
    const workflowDir = resolve(positionals[0] ?? '.');
    const yamlPath = join(workflowDir, 'workflow.yaml');
    if (!existsSync(yamlPath)) {
        process.stderr.write(`catalog pack: no workflow.yaml in ${workflowDir}\n`);
        return 2;
    }
    let workflow;
    try {
        workflow = loadYaml(yamlPath);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`catalog pack: YAML parse error: ${msg}\n`);
        return 1;
    }
    const { ok, errors, warnings } = fullValidateWorkflow(workflow, { definitionDir: workflowDir });
    if (!ok) {
        process.stderr.write(`catalog pack: workflow is INVALID — ${errors.length} issue(s):\n`);
        for (const err of errors)
            process.stderr.write(`  - ${err}\n`);
        return 1;
    }
    for (const w of warnings) {
        const anchor = w.step !== undefined ? ` [step: ${w.step}]` : '';
        process.stderr.write(`  advisory ${w.id}${anchor}: ${w.message}\n`);
    }
    let document;
    let summary;
    try {
        const inv = buildWorkflowInventory(workflowDir, workflow);
        document = composeLockDocument(inv);
        summary =
            `${inv.bundled_files.length} bundled file(s), ${inv.script_tools.length} script tool(s), ` +
                `${inv.deciders.length} decider script(s), ${inv.steps.count} step(s)`;
    }
    catch (e) {
        if (e instanceof InventoryError) {
            process.stderr.write(`catalog pack: ${e.message}\n`);
            return 1;
        }
        throw e;
    }
    if (toStdout) {
        process.stdout.write(document);
        process.stderr.write(`catalog pack: ${summary}\n`);
        return 0;
    }
    const target = resolve(outPath ?? LOCK_FILENAME);
    writeFileSync(target, document, 'utf-8');
    process.stdout.write(`Wrote ${target} — ${summary}.\n`);
    return 0;
}
