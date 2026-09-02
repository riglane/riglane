import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import process from 'node:process';
import { parse as parseYamlText } from 'yaml';
import { confirmByTypingId, confirmationPrompt, noTerminalReason } from '../_confirm.js';
import { diffInventories } from '../../catalog/diff.js';
import { EntryError, catalogEntryUrl, catalogRevokedUrl, isRevoked, readEntryFile, validatePerEntryDocument, validateRevokedList, } from '../../catalog/entry.js';
import { FetchError, fetchSourceTree } from '../../catalog/fetch.js';
import { buildWorkflowInventory } from '../../catalog/inventory.js';
import { composeLockDocument, normalizeLockEol } from '../../catalog/lock.js';
import { removeTrustEntry } from '../../catalog/trust.js';
import { catalogBaseUrl } from '../../config/config.js';
import { loadYaml } from '../../engine/schema-validate.js';
import { defaultPaths, fullValidateWorkflow } from '../../engine/workflow-engine.js';
const USAGE = 'Usage: riglane update <id> [local-entry-dir]\n';
export function isInstalledCommunityWorkflow(cwd, id) {
    return existsSync(join(defaultPaths(cwd).communityDir, id, 'workflow.yaml'));
}
export async function runUpdateEntryCli(argv, deps = {}) {
    const flags = argv.filter((a) => a.startsWith('--'));
    const positionals = argv.filter((a) => !a.startsWith('--'));
    if (flags.length > 0 || positionals.length === 0 || positionals.length > 2) {
        process.stderr.write(USAGE);
        return 2;
    }
    const id = positionals[0];
    const localEntryDir = positionals[1];
    const paths = defaultPaths(deps.cwd);
    const installDir = join(paths.communityDir, id);
    if (!existsSync(join(installDir, 'workflow.yaml'))) {
        process.stderr.write(`update: '${id}' is not an installed community workflow — install it with 'riglane add ${id}'.\n`);
        return 2;
    }
    let doc;
    try {
        if (localEntryDir !== undefined) {
            const entry = readEntryFile(join(localEntryDir, 'entry.yaml'));
            if (entry.id !== id)
                throw new EntryError(`the entry dir describes '${entry.id}', not '${id}'`);
            const lockPath = join(localEntryDir, 'entry.lock.yaml');
            if (!existsSync(lockPath))
                throw new EntryError(`${localEntryDir} has no entry.lock.yaml`);
            doc = { entry, lockText: readFileSync(lockPath, 'utf-8') };
        }
        else {
            const fetched = await fetchCurrentEntry(id, deps);
            if (fetched === null)
                return 1;
            doc = fetched;
        }
    }
    catch (e) {
        if (e instanceof EntryError) {
            process.stderr.write(`update: ${e.message}\n`);
            return 1;
        }
        throw e;
    }
    const { entry, lockText } = doc;
    const installedSha = readInstalledPin(installDir);
    const installedLock = readIfExists(join(installDir, 'entry.lock.yaml'));
    if (installedSha === entry.source.sha &&
        installedLock !== null &&
        normalizeLockEol(installedLock) === normalizeLockEol(lockText)) {
        process.stdout.write(`'${id}' is already at the catalog's pinned commit (${entry.source.sha.slice(0, 12)}…).\n`);
        return 0;
    }
    process.stderr.write(`Fetching ${entry.source.repo} @ ${entry.source.sha.slice(0, 12)}…\n`);
    const fetchTree = deps.fetchTree ?? fetchSourceTree;
    let cloneDir;
    let workflowDir;
    try {
        ({ cloneDir, workflowDir } = fetchTree(entry.source, tmpdir()));
    }
    catch (e) {
        if (e instanceof FetchError) {
            process.stderr.write(`update: ${e.message}\n`);
            return 1;
        }
        throw e;
    }
    try {
        let newWorkflow;
        try {
            newWorkflow = loadYaml(join(workflowDir, 'workflow.yaml'));
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            process.stderr.write(`update: fetched workflow.yaml does not parse: ${msg}\nNothing was changed.\n`);
            return 1;
        }
        if (newWorkflow.name !== id) {
            process.stderr.write(`update: the fetched workflow is named '${String(newWorkflow.name)}', not '${id}'. Nothing was changed.\n`);
            return 1;
        }
        const { ok, errors } = fullValidateWorkflow(newWorkflow, { definitionDir: workflowDir });
        if (!ok) {
            process.stderr.write(`update: the fetched workflow is INVALID — ${errors.length} issue(s):\n`);
            for (const err of errors)
                process.stderr.write(`  - ${err}\n`);
            process.stderr.write('Nothing was changed.\n');
            return 1;
        }
        const newInv = buildWorkflowInventory(workflowDir, newWorkflow);
        if (composeLockDocument(newInv) !== normalizeLockEol(lockText)) {
            process.stderr.write(
            `\n✗ NOT UPDATED — '${id}' was refused; the installed version is untouched.\n\n` +
                `The workflow fetched from the new pinned commit is not the one the entry\n` +
                `promises: its capability inventory does not regenerate to the entry's lock.\n` +
                `If this is your entry, re-run 'riglane catalog pack' at the pinned tree; if it\n` +
                `came from the catalog, stop and report it.\n`);
            return 1;
        }
        const oldInv = readInstalledInventory(installDir);
        printUpdateDiff(id, installedSha, entry.source.sha, oldInv, newInv);
        const confirmed = await confirmByTypingId(id, confirmationPrompt(id, 'update it'), deps.prompt);
        if (!confirmed.ok) {
            process.stderr.write(confirmed.reason === 'no-terminal'
                ? `update: ${noTerminalReason()}\nNothing was changed. Run 'riglane update ${id}' from a terminal.\n`
                : `update: confirmation did not match '${id}'. Nothing was changed.\n`);
            return 1;
        }
        const staging = `${installDir}.new.${process.pid}`;
        cpSync(workflowDir, staging, { recursive: true, filter: (src) => !src.split(sep).includes('.git') });
        writeFileSync(join(staging, 'entry.yaml'), serializeEntryProvenance(entry.id, entry.source), 'utf-8');
        writeFileSync(join(staging, 'entry.lock.yaml'), normalizeLockEol(lockText), 'utf-8');
        rmSync(installDir, { recursive: true, force: true });
        renameSync(staging, installDir);
        removeTrustEntry(paths.agentDir, id);
        process.stdout.write(`Updated '${id}' to ${entry.source.sha.slice(0, 12)}… — it is SWITCHED OFF again.\n` +
            `Review the changes above, then re-enable: riglane trust ${id}\n`);
        return 0;
    }
    finally {
        rmSync(cloneDir, { recursive: true, force: true });
    }
}
async function fetchCurrentEntry(id, deps) {
    const base = catalogBaseUrl();
    const fetchJson = deps.fetchJson ?? defaultFetchJson;
    const revokedRaw = await fetchJson(catalogRevokedUrl(base));
    if (revokedRaw !== null) {
        const verdict = isRevoked(validateRevokedList(revokedRaw), id);
        if (verdict.revoked) {
            process.stderr.write(`update: '${id}' has been REVOKED by the catalog${verdict.reason ? ` — ${verdict.reason}` : ''}.\n` +
                `Consider removing the installed copy; it stays switched off unless you trust it explicitly.\n`);
            return null;
        }
    }
    const raw = await fetchJson(catalogEntryUrl(base, id));
    if (raw === null) {
        process.stderr.write(`update: '${id}' is no longer listed in the catalog at ${base}.\n`);
        return null;
    }
    return validatePerEntryDocument(raw, id);
}
async function defaultFetchJson(url) {
    let res;
    try {
        res = await fetch(url);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new EntryError(`cannot reach the catalog at ${url}: ${msg}`);
    }
    if (res.status === 404)
        return null;
    if (!res.ok)
        throw new EntryError(`catalog request failed: ${url} → HTTP ${res.status}`);
    return (await res.json());
}
function readInstalledPin(installDir) {
    try {
        return readEntryFile(join(installDir, 'entry.yaml')).source.sha;
    }
    catch {
        return null;
    }
}
function readIfExists(path) {
    try {
        return readFileSync(path, 'utf-8');
    }
    catch {
        return null;
    }
}
function readInstalledInventory(installDir) {
    try {
        return buildWorkflowInventory(installDir, loadYaml(join(installDir, 'workflow.yaml')));
    }
    catch {
        const lockRaw = readIfExists(join(installDir, 'entry.lock.yaml'));
        if (lockRaw !== null) {
            try {
                return parseYamlText(lockRaw);
            }
            catch {
            }
        }
        return {
            workflow: '',
            workflow_version: 0,
            workflow_sha256: '',
            steps: {
                count: 0,
                items: [],
                gates: { structural: true, semantic: false, human: false, max_gate_retries: 5, max_step_retries: 3, step_overrides: [] },
                control_flow: { loop_back: [], routes: [], lanes: [] },
                delegates_to: [],
            },
            params: [],
            structs: [],
            script_tools: [],
            mcp_dependencies: [],
            deciders: [],
            bundled_files: [],
            capabilities: { network: false, reads_env: false, writes_outside_project: false, spawns_mcp_server: false, flags: [] },
        };
    }
}
function printUpdateDiff(id, oldSha, newSha, oldInv, newInv) {
    const w = (line) => process.stdout.write(`${line}\n`);
    const d = diffInventories(oldInv, newInv);
    w('');
    w(`── ${id} ─ update ──`);
    w(`  Pinned:  ${oldSha ?? '(unknown)'}`);
    w(`       →   ${newSha}`);
    w('');
    if (!d.shellSurfaceChanged) {
        w('  Shell surface unchanged: same commands, same decider scripts, same executable files.');
    }
    else {
        w('  Shell surface CHANGES:');
        for (const t of d.tools.added)
            w(`    + [tools.${t.name}]  ${t.command}`);
        for (const t of d.tools.removed)
            w(`    - [tools.${t.name}]  ${t.command}`);
        for (const c of d.tools.changed) {
            w(`    ~ [tools.${c.key}] command changed:`);
            w(`        - ${c.before}`);
            w(`        + ${c.after}`);
        }
        for (const dd of d.deciders.added)
            w(`    + [${dd.field} @ ${dd.at}]  ${dd.command}`);
        for (const dd of d.deciders.removed)
            w(`    - [${dd.field} @ ${dd.at}]  ${dd.command}`);
        for (const c of d.deciders.changed) {
            w(`    ~ [${c.key}] command changed:`);
            w(`        - ${c.before}`);
            w(`        + ${c.after}`);
        }
        for (const b of d.executables.added)
            w(`    + ${b.path}  (${b.bytes} bytes, sha256 ${b.sha256.slice(0, 12)}…)`);
        for (const b of d.executables.removed)
            w(`    - ${b.path}`);
        for (const c of d.executables.changed) {
            w(`    ~ ${c.path}  content changed (sha256 ${c.before.slice(0, 12)}… → ${c.after.slice(0, 12)}…)`);
        }
        if (d.newFlags.length > 0) {
            w('  NEW capability signals:');
            for (const f of d.newFlags)
                w(`    + ${f.flag}: '${f.match}' in ${f.where}`);
        }
    }
    w('');
    w(`  Structure: ${oldInv.steps.count} → ${newInv.steps.count} step(s), version ${oldInv.workflow_version} → ${newInv.workflow_version}.`);
    w('  Applying the update drops the trust grant — it will not run again before riglane trust.');
    w('');
}
function serializeEntryProvenance(id, source) {
    const lines = [
        `# Written by \`riglane update\` — provenance of this installed workflow.`,
        `id: ${id}`,
        `source:`,
        `  repo: ${JSON.stringify(source.repo)}`,
        `  path: ${JSON.stringify(source.path)}`,
        `  sha: ${source.sha}`,
    ];
    return `${lines.join('\n')}\n`;
}
