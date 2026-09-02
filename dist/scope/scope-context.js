import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { atomicWriteJson } from '../cli/_fs.js';
import { PRODUCT_DIR } from '../config/paths.js';
import { SPEC_INDEX_VERSION, SPEC_REGISTRY_VERSION } from '../types/spec.js';
export const GENERIC_SCOPE = 'generic';
export const SPEC_ROOT = join(PRODUCT_DIR, 'specs');
export const SCOPE_CONFIG_PATH = join(SPEC_ROOT, '_scope-config.json');
export const USER_STATE_DIR = join(PRODUCT_DIR, 'local');
export const ACTIVE_SCOPE_FILE = join(USER_STATE_DIR, 'active-scope');
export const SCOPE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
export class ScopeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ScopeError';
    }
}
export class ScopeNotFoundError extends ScopeError {
    constructor(message) {
        super(message);
        this.name = 'ScopeNotFoundError';
    }
}
export class InvalidScopeIdError extends ScopeError {
    constructor(message) {
        super(message);
        this.name = 'InvalidScopeIdError';
    }
}
export class ScopeConfigError extends ScopeError {
    constructor(message) {
        super(message);
        this.name = 'ScopeConfigError';
    }
}
export function loadScopeConfig(root = '.') {
    const path = join(root, SCOPE_CONFIG_PATH);
    if (!existsSync(path) || !statSync(path).isFile()) {
        return { scopes: [], default_active_scope: null };
    }
    let text;
    try {
        text = readFileSync(path, 'utf-8');
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new ScopeConfigError(`Cannot read ${path}: ${msg}`);
    }
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new ScopeConfigError(`Cannot read ${path}: ${msg}`);
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        const typeName = Array.isArray(data) ? 'list' : data === null ? 'NoneType' : typeof data;
        throw new ScopeConfigError(`${path}: expected object, got ${typeName}`);
    }
    const obj = data;
    let scopesRaw;
    if (Array.isArray(obj.scopes)) {
        scopesRaw = obj.scopes;
    }
    else if (!obj.scopes) {
        scopesRaw = [];
    }
    else {
        throw new ScopeConfigError(`${path}: 'scopes' must be a list`);
    }
    const defaultActive = obj.default_active_scope;
    return {
        scopes: scopesRaw,
        default_active_scope: typeof defaultActive === 'string' ? defaultActive : null,
    };
}
export function saveScopeConfig(config, root = '.') {
    const path = join(root, SCOPE_CONFIG_PATH);
    const parent = join(root, SPEC_ROOT);
    mkdirSync(parent, { recursive: true });
    atomicWriteJson(path, config);
}
export function configExists(root = '.') {
    const path = join(root, SCOPE_CONFIG_PATH);
    return existsSync(path) && statSync(path).isFile();
}
export function readUserActiveScope(root = '.') {
    const path = join(root, ACTIVE_SCOPE_FILE);
    if (!existsSync(path) || !statSync(path).isFile())
        return null;
    let text;
    try {
        text = readFileSync(path, 'utf-8');
    }
    catch {
        return null;
    }
    const stripped = text.trim();
    return stripped || null;
}
export function writeUserActiveScope(scopeId, root = '.') {
    validateScopeId(scopeId);
    const path = join(root, ACTIVE_SCOPE_FILE);
    mkdirSync(join(root, USER_STATE_DIR), { recursive: true });
    writeFileSync(path, `${scopeId}\n`, 'utf-8');
}
export function clearUserActiveScope(root = '.') {
    const path = join(root, ACTIVE_SCOPE_FILE);
    if (existsSync(path) && statSync(path).isFile()) {
        unlinkSync(path);
        return true;
    }
    return false;
}
export function resolveActiveScope(cliScope, root = '.') {
    if (cliScope)
        return [cliScope, 'cli'];
    const userScope = readUserActiveScope(root);
    if (userScope)
        return [userScope, 'user'];
    const config = loadScopeConfig(root);
    const def = config.default_active_scope;
    if (def)
        return [def, 'project-default'];
    return [GENERIC_SCOPE, 'fallback'];
}
export function validateScopeId(scopeId) {
    if (typeof scopeId !== 'string' || !SCOPE_ID_PATTERN.test(scopeId)) {
        throw new InvalidScopeIdError(`Invalid scope id '${String(scopeId)}'. Must match ${SCOPE_ID_PATTERN.source} (lowercase letter start, then lowercase/digits/hyphens only).`);
    }
}
export function getAvailableScopes(root = '.') {
    const result = [
        {
            id: GENERIC_SCOPE,
            label: 'Cross-integration invariants (implicit; always available)',
            source: 'implicit',
        },
    ];
    const config = loadScopeConfig(root);
    const seen = new Set([GENERIC_SCOPE]);
    for (const entry of config.scopes) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
            continue;
        const sid = entry.id;
        if (typeof sid !== 'string' || seen.has(sid))
            continue;
        const labelRaw = entry.label;
        const label = typeof labelRaw === 'string' && labelRaw ? labelRaw : sid;
        const hintRaw = entry.hint;
        const hint = typeof hintRaw === 'string' && hintRaw.trim() ? hintRaw.trim() : undefined;
        result.push({ id: sid, label, source: 'config', ...(hint ? { hint } : {}) });
        seen.add(sid);
    }
    return result;
}
export function getScopeHint(scopeId, root = '.') {
    try {
        return getAvailableScopes(root).find((s) => s.id === scopeId)?.hint ?? null;
    }
    catch {
        return null;
    }
}
export function scopeExists(scopeId, root = '.') {
    return getAvailableScopes(root).some((s) => s.id === scopeId);
}
export function validateScopeExists(scopeId, root = '.') {
    if (!scopeExists(scopeId, root)) {
        const available = getAvailableScopes(root)
            .map((s) => s.id)
            .join(', ');
        throw new ScopeNotFoundError(`Scope '${scopeId}' not found. Available: ${available}.`);
    }
}
export function scopeDir(scopeId, root = '.') {
    validateScopeId(scopeId);
    return join(root, SPEC_ROOT, scopeId);
}
export function specDirFor(scopeId, domain, root = '.') {
    validateScopeId(scopeId);
    if (typeof domain !== 'string' || !domain) {
        throw new Error(`Invalid domain: ${JSON.stringify(domain)}`);
    }
    return join(scopeDir(scopeId, root), domain);
}
export function ensureScopeDir(scopeId, root = '.') {
    validateScopeId(scopeId);
    const sdir = scopeDir(scopeId, root);
    mkdirSync(sdir, { recursive: true });
    const indexPath = join(sdir, '_index.json');
    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
        atomicWriteJson(indexPath, {
            version: SPEC_INDEX_VERSION,
            scope: scopeId,
            domains: [],
            specs: [],
        });
    }
    const registryPath = join(sdir, '_registry.json');
    if (!existsSync(registryPath) || !statSync(registryPath).isFile()) {
        atomicWriteJson(registryPath, {
            version: SPEC_REGISTRY_VERSION,
            scope: scopeId,
            mappings: {},
        });
    }
    return sdir;
}
export function scopeFromPath(path, root = '.') {
    let p;
    let specRootAbs;
    try {
        p = resolve(path);
        specRootAbs = resolve(join(root, SPEC_ROOT));
    }
    catch {
        return null;
    }
    const rel = relative(specRootAbs, p);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
        return null;
    const parts = rel.split(sep).filter((s) => s.length > 0);
    if (parts.length === 0)
        return null;
    const candidate = parts[0];
    if (candidate.startsWith('_'))
        return null;
    return SCOPE_ID_PATTERN.test(candidate) ? candidate : null;
}
export function* iterSpecFiles(scopes, root = '.') {
    for (const scopeId of scopes) {
        if (!scopeExists(scopeId, root))
            continue;
        const sdir = scopeDir(scopeId, root);
        if (!existsSync(sdir) || !statSync(sdir).isDirectory())
            continue;
        yield* walkMd(sdir);
    }
}
function* walkMd(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            yield* walkMd(full);
        }
        else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
            yield full;
        }
    }
}
export function resolveReadScopes(activeScope, includeGeneric = true) {
    if (activeScope === GENERIC_SCOPE || !includeGeneric) {
        return [activeScope];
    }
    return [activeScope, GENERIC_SCOPE];
}
export function formatScopeTable(scopes) {
    if (scopes.length === 0)
        return '(no scopes)';
    const widthId = Math.max(...scopes.map((s) => s.id.length));
    const widthSrc = Math.max(...scopes.map((s) => (s.source ?? '').length));
    const lines = [];
    for (const s of scopes) {
        const src = s.source ?? '';
        const label = s.label ?? '';
        lines.push(`  ${s.id.padEnd(widthId)}  [${src.padEnd(widthSrc)}]  ${label}`);
        if (s.hint)
            lines.push(`  ${' '.repeat(widthId)}  ${' '.repeat(widthSrc + 2)}  ↳ ${s.hint}`);
    }
    return lines.join('\n');
}
