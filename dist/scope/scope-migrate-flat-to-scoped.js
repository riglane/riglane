import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PRODUCT_DIR } from '../config/paths.js';
import { SPEC_INDEX_VERSION, SPEC_REGISTRY_VERSION } from '../types/spec.js';
import { GENERIC_SCOPE, InvalidScopeIdError, SPEC_ROOT, validateScopeId } from './scope-context.js';
export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
function resolveWriters(opts) {
    return {
        stdout: opts.stdout ?? ((s) => void process.stdout.write(s)),
        stderr: opts.stderr ?? ((s) => void process.stderr.write(s)),
    };
}
export function ensureScopeInFrontmatter(content, scope) {
    const m = FRONTMATTER_RE.exec(content);
    if (!m)
        return [content, false];
    const fmText = m[1] ?? '';
    if (/^scope:/m.test(fmText))
        return [content, false];
    const lines = fmText.split('\n');
    let insertIdx = 0;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i]?.startsWith('spec_id:')) {
            insertIdx = i + 1;
            break;
        }
    }
    lines.splice(insertIdx, 0, `scope: [${scope}]`);
    const newFm = lines.join('\n');
    const newContent = content.replace(m[0], `---\n${newFm}\n---\n`);
    return [newContent, true];
}
function moveFsEntry(src, dst) {
    mkdirSync(join(dst, '..'), { recursive: true });
    try {
        renameSync(src, dst);
        return;
    }
    catch (e) {
        const code = e.code;
        if (code !== 'EXDEV')
            throw e;
    }
    if (statSync(src).isDirectory()) {
        cpSync(src, dst, { recursive: true });
        rmSync(src, { recursive: true, force: true });
    }
    else {
        copyFileSync(src, dst);
        unlinkSync(src);
    }
}
export function findSpecDomains(specsRoot, knownScopeIds) {
    if (!existsSync(specsRoot) || !statSync(specsRoot).isDirectory())
        return [];
    const entries = readdirSync(specsRoot, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
        let isDirectory = entry.isDirectory();
        if (!isDirectory && entry.isSymbolicLink()) {
            try {
                isDirectory = statSync(join(specsRoot, entry.name)).isDirectory();
            }
            catch {
                continue;
            }
        }
        if (!isDirectory)
            continue;
        if (knownScopeIds.has(entry.name))
            continue;
        if (entry.name.startsWith('_') || entry.name === 'local')
            continue;
        result.push(entry.name);
    }
    return result.sort();
}
function loadJson(path) {
    const text = readFileSync(path, 'utf-8');
    return JSON.parse(text);
}
function saveJson(path, data, dryRun, stdout) {
    if (dryRun) {
        stdout(`  WOULD WRITE ${path}\n`);
        return;
    }
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    stdout(`  WROTE       ${path}\n`);
}
export function rewriteIndexPaths(indexData, targetScope) {
    const specs = indexData.specs ?? [];
    for (const entry of specs) {
        const fp = entry.file_path ?? '';
        let norm = fp;
        if (norm.startsWith(`${PRODUCT_DIR}/specs/`))
            norm = norm.slice(`${PRODUCT_DIR}/specs/`.length);
        else if (norm.startsWith(`${PRODUCT_DIR}\\specs\\`))
            norm = norm.slice(`${PRODUCT_DIR}\\specs\\`.length);
        entry.file_path = `${PRODUCT_DIR}/specs/${targetScope}/${norm}`;
    }
    indexData.scope = targetScope;
    return indexData;
}
export function updateScopeConfig(configPath, targetScope, label, dryRun, stdout) {
    let config;
    if (existsSync(configPath) && statSync(configPath).isFile()) {
        config = loadJson(configPath);
    }
    else {
        config = { scopes: [], default_active_scope: null };
    }
    const existingScopes = config.scopes ?? [];
    const existingIds = new Set(existingScopes.map((s) => s.id));
    if (existingIds.has(targetScope)) {
        stdout(`  SKIP        _scope-config.json already has '${targetScope}'\n`);
        return;
    }
    const entry = { id: targetScope };
    if (label)
        entry.label = label;
    if (!Array.isArray(config.scopes))
        config.scopes = [];
    config.scopes.push(entry);
    saveJson(configPath, config, dryRun, stdout);
}
export async function migrate(opts) {
    const w = resolveWriters(opts);
    const { targetScope, label, projectRoot, dryRun, force } = opts;
    const specsRoot = join(projectRoot, SPEC_ROOT);
    if (!existsSync(specsRoot) || !statSync(specsRoot).isDirectory()) {
        w.stderr(`ERROR: ${specsRoot} does not exist.\n`);
        return 1;
    }
    const targetScopeDir = join(specsRoot, targetScope);
    const genericDir = join(specsRoot, 'generic');
    if (existsSync(targetScopeDir) && statSync(targetScopeDir).isDirectory()) {
        const nonMgmt = readdirSync(targetScopeDir, { withFileTypes: true })
            .filter((e) => !e.name.startsWith('_'))
            .map((e) => e.name);
        if (nonMgmt.length > 0 && !force) {
            w.stderr(`ERROR: ${targetScopeDir} already contains spec content:\n  ${JSON.stringify(nonMgmt)}\nUse --force to proceed anyway.\n`);
            return 1;
        }
    }
    w.stdout(`Migrating specs -> scope '${targetScope}'\n` +
        `  Project root: ${projectRoot}\n` +
        `  Dry-run:      ${dryRun}\n\n`);
    const knownScopes = new Set([targetScope, 'generic']);
    const domains = findSpecDomains(specsRoot, knownScopes);
    if (domains.length === 0) {
        w.stdout('  No domain directories to migrate. Already migrated?\n');
    }
    else {
        w.stdout(`  Discovered ${domains.length} domain(s): ${JSON.stringify(domains)}\n`);
    }
    w.stdout('\n[1/5] Moving domain directories\n');
    for (const dom of domains) {
        const srcDom = join(specsRoot, dom);
        const targetDom = join(targetScopeDir, dom);
        if (dryRun) {
            w.stdout(`  WOULD MOVE  ${srcDom} -> ${targetDom}\n`);
            for (const md of walkMd(srcDom).sort()) {
                const content = readFileSync(md, 'utf-8');
                const [, modified] = ensureScopeInFrontmatter(content, targetScope);
                if (modified) {
                    const name = basename(md);
                    w.stdout(`              + scope: [${targetScope}] -> ${name}\n`);
                }
            }
        }
        else {
            mkdirSync(targetScopeDir, { recursive: true });
            moveFsEntry(srcDom, targetDom);
            w.stdout(`  MOVED       ${dom}/ -> ${targetScope}/${dom}/\n`);
        }
    }
    w.stdout('\n[2/5] Updating spec frontmatters\n');
    if (!dryRun && existsSync(targetScopeDir) && statSync(targetScopeDir).isDirectory()) {
        let countModified = 0;
        let countTotal = 0;
        for (const md of walkMd(targetScopeDir).sort()) {
            const name = md.slice(md.lastIndexOf('/') + 1);
            if (name.startsWith('_'))
                continue;
            countTotal += 1;
            const content = readFileSync(md, 'utf-8');
            const [newContent, modified] = ensureScopeInFrontmatter(content, targetScope);
            if (modified) {
                writeFileSync(md, newContent, 'utf-8');
                countModified += 1;
            }
        }
        w.stdout(`  Modified ${countModified}/${countTotal} spec files\n`);
    }
    else {
        w.stdout('  (shown above in dry-run mode)\n');
    }
    w.stdout('\n[3/5] Migrating index and registry\n');
    const oldIndex = join(specsRoot, '_index.json');
    const newIndex = join(targetScopeDir, '_index.json');
    if (existsSync(oldIndex) && statSync(oldIndex).isFile()) {
        const data = rewriteIndexPaths(loadJson(oldIndex), targetScope);
        saveJson(newIndex, data, dryRun, w.stdout);
        if (!dryRun) {
            unlinkSync(oldIndex);
            w.stdout(`  REMOVED     ${oldIndex}\n`);
        }
    }
    else if (!existsSync(newIndex)) {
        saveJson(newIndex, { version: SPEC_INDEX_VERSION, scope: targetScope, domains: [], specs: [] }, dryRun, w.stdout);
    }
    const oldReg = join(specsRoot, '_registry.json');
    const newReg = join(targetScopeDir, '_registry.json');
    if (existsSync(oldReg) && statSync(oldReg).isFile()) {
        const data = loadJson(oldReg);
        data.scope = targetScope;
        saveJson(newReg, data, dryRun, w.stdout);
        if (!dryRun) {
            unlinkSync(oldReg);
            w.stdout(`  REMOVED     ${oldReg}\n`);
        }
    }
    else if (!existsSync(newReg)) {
        saveJson(newReg, { version: SPEC_REGISTRY_VERSION, scope: targetScope, mappings: {} }, dryRun, w.stdout);
    }
    w.stdout('\n[4/5] Ensuring generic/ scope directory\n');
    const genericIndex = join(genericDir, '_index.json');
    if (!existsSync(genericDir) || !statSync(genericDir).isDirectory() || !existsSync(genericIndex)) {
        saveJson(genericIndex, { version: SPEC_INDEX_VERSION, scope: 'generic', domains: [], specs: [] }, dryRun, w.stdout);
        saveJson(join(genericDir, '_registry.json'), { version: SPEC_REGISTRY_VERSION, scope: 'generic', mappings: {} }, dryRun, w.stdout);
    }
    else {
        w.stdout('  SKIP        generic/ already initialized\n');
    }
    w.stdout('\n[5/5] Updating _scope-config.json\n');
    updateScopeConfig(join(specsRoot, '_scope-config.json'), targetScope, label ?? null, dryRun, w.stdout);
    w.stdout(`\nMigration ${dryRun ? 'DRY-RUN complete — no changes made.' : 'complete.'}\n`);
    if (!dryRun) {
        w.stdout('\nNext steps:\n');
        w.stdout('  /riglane-scope-show                # verify\n');
        w.stdout(`  /riglane-scope-set ${targetScope}           # switch your active context\n`);
    }
    return 0;
}
function walkMd(dir) {
    const out = [];
    if (!existsSync(dir) || !statSync(dir).isDirectory())
        return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            out.push(...walkMd(full));
        }
        else if (entry.isFile() && entry.name.endsWith('.md')) {
            out.push(full);
        }
    }
    return out;
}
export async function runScopeMigrateCli(argv = process.argv.slice(2), opts = {}) {
    const w = resolveWriters(opts);
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            options: {
                label: { type: 'string' },
                'project-root': { type: 'string', default: '.' },
                'dry-run': { type: 'boolean' },
                force: { type: 'boolean' },
            },
            allowPositionals: true,
            strict: true,
        });
    }
    catch (e) {
        w.stderr(`${e instanceof Error ? e.message : String(e)}\n`);
        return 2;
    }
    const targetScope = parsed.positionals[0];
    if (!targetScope) {
        w.stderr('usage: scope_migrate_flat_to_scoped <target_scope> [--label ...] [--project-root ...] [--dry-run] [--force]\n');
        return 2;
    }
    if (parsed.positionals.length > 1) {
        w.stderr(`scope_migrate_flat_to_scoped: unrecognized arguments: ${parsed.positionals.slice(1).join(' ')}\n`);
        return 2;
    }
    if (targetScope === GENERIC_SCOPE) {
        w.stderr(`ERROR: '${GENERIC_SCOPE}' is reserved. Cannot migrate into generic directly.\n`);
        return 1;
    }
    try {
        validateScopeId(targetScope);
    }
    catch (e) {
        if (e instanceof InvalidScopeIdError) {
            w.stderr(`ERROR: ${e.message}\n`);
            return 1;
        }
        throw e;
    }
    const labelVal = parsed.values.label;
    const migrateArgs = {
        targetScope,
        label: labelVal ?? null,
        projectRoot: resolve(parsed.values['project-root'] ?? '.'),
        dryRun: Boolean(parsed.values['dry-run']),
        force: Boolean(parsed.values.force),
        ...(opts.stdout ? { stdout: opts.stdout } : {}),
        ...(opts.stderr ? { stderr: opts.stderr } : {}),
    };
    return migrate(migrateArgs);
}
