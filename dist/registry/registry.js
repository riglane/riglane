import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SELECTABLE_ADAPTERS } from '../adapters/index.js';
import { configDir } from '../config/config.js';
import { ENV_REGISTRY_PATH } from '../config/product.js';
const SCHEMA_VERSION = 2;
export function registryPath() {
    const override = process.env[ENV_REGISTRY_PATH];
    if (override !== undefined && override.length > 0)
        return override;
    return join(configDir(), 'projects.json');
}
export function load() {
    const p = registryPath();
    if (!existsSync(p))
        return { version: SCHEMA_VERSION, projects: [] };
    try {
        const raw = readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.projects)) {
            return { version: SCHEMA_VERSION, projects: [] };
        }
        let rawEntries;
        if (parsed.version === SCHEMA_VERSION) {
            rawEntries = parsed.projects;
        }
        else if (parsed.version === 1) {
            rawEntries = parsed.projects.map(migrateV1Entry);
        }
        else {
            return { version: SCHEMA_VERSION, projects: [] };
        }
        const projects = [];
        for (const e of rawEntries) {
            if (!isValidEntry(e))
                continue;
            projects.push(e);
        }
        return { version: SCHEMA_VERSION, projects };
    }
    catch {
        return { version: SCHEMA_VERSION, projects: [] };
    }
}
export function save(reg) {
    const p = registryPath();
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp.${process.pid}`;
    const body = `${JSON.stringify({ version: SCHEMA_VERSION, projects: reg.projects }, null, 2)}\n`;
    writeFileSync(tmp, body, 'utf-8');
    renameSync(tmp, p);
}
export function findByPath(reg, absPath) {
    const canon = canonicalize(absPath);
    return reg.projects.find((e) => e.path === canon);
}
export function findById(reg, id) {
    if (id.length === 0)
        return undefined;
    return reg.projects.find((e) => e.id === id);
}
export function list(reg) {
    const r = reg ?? load();
    return [...r.projects].sort((a, b) => a.slug.toLowerCase().localeCompare(b.slug.toLowerCase()));
}
export function register(input) {
    const absPath = canonicalize(input.path);
    const reg = load();
    const now = new Date().toISOString();
    const existing = (input.id !== undefined && input.id.length > 0 ? findById(reg, input.id) : undefined) ??
        findByPath(reg, absPath);
    if (existing !== undefined) {
        const updated = {
            ...existing,
            ...(existing.id === undefined && input.id !== undefined && input.id.length > 0
                ? { id: input.id }
                : {}),
            path: absPath,
            adapters: input.adapters,
            ...(input.specGuidance !== undefined ? { specGuidance: input.specGuidance } : {}),
            last_seen: now,
            last_action: input.action,
        };
        const next = reg.projects.map((e) => (e === existing ? updated : e));
        save({ version: SCHEMA_VERSION, projects: next });
        return updated;
    }
    const slug = computeSlug(absPath, reg.projects);
    const fresh = {
        slug,
        ...(input.id !== undefined && input.id.length > 0 ? { id: input.id } : {}),
        path: absPath,
        adapters: input.adapters,
        ...(input.specGuidance !== undefined ? { specGuidance: input.specGuidance } : {}),
        registered_at: now,
        last_seen: now,
        last_action: input.action,
    };
    save({ version: SCHEMA_VERSION, projects: [...reg.projects, fresh] });
    return fresh;
}
export function unregister(absPath) {
    const reg = load();
    const canon = canonicalize(absPath);
    const next = reg.projects.filter((e) => e.path !== canon);
    if (next.length === reg.projects.length)
        return false;
    save({ version: SCHEMA_VERSION, projects: next });
    return true;
}
export function isTemporaryLocation(p) {
    const root = nativeCanonical(tmpdir());
    const candidate = nativeCanonical(p);
    const fold = (x) => (process.platform === 'win32' ? x.toLowerCase() : x);
    const r = fold(root);
    const c = fold(candidate);
    if (c === r)
        return true;
    const sep = r.endsWith('\\') || r.endsWith('/') ? '' : (r.includes('\\') ? '\\' : '/');
    return c.startsWith(r + sep);
}
function nativeCanonical(p) {
    const resolved = resolve(p);
    const missing = [];
    let cur = resolved;
    for (;;) {
        try {
            const real = realpathSync.native(cur);
            return missing.length === 0 ? real : join(real, ...missing.reverse());
        }
        catch {
            const parent = dirname(cur);
            if (parent === cur)
                return resolved;
            missing.push(basename(cur));
            cur = parent;
        }
    }
}
export function clear() {
    const p = registryPath();
    if (existsSync(p))
        unlinkSync(p);
}
export function canonicalize(p) {
    const resolved = resolve(p);
    try {
        return realpathSync(resolved);
    }
    catch {
        return resolved;
    }
}
function migrateV1Entry(e) {
    if (e === null || typeof e !== 'object')
        return e;
    const r = e;
    if (Array.isArray(r.adapters))
        return r;
    const { adapter, ...rest } = r;
    let adapters;
    if (adapter === 'both')
        adapters = ['cursor', 'claude'];
    else if (adapter === 'claude')
        adapters = ['claude'];
    else if (adapter === 'cursor')
        adapters = ['cursor'];
    else
        return e;
    return { ...rest, adapters };
}
function isValidEntry(e) {
    if (e === null || typeof e !== 'object')
        return false;
    const r = e;
    if (r.id !== undefined && (typeof r.id !== 'string' || r.id.length === 0))
        return false;
    return (typeof r.slug === 'string' &&
        typeof r.path === 'string' &&
        Array.isArray(r.adapters) &&
        r.adapters.length > 0 &&
        r.adapters.every((a) => SELECTABLE_ADAPTERS.includes(a)) &&
        typeof r.registered_at === 'string' &&
        typeof r.last_seen === 'string' &&
        (r.last_action === 'init' || r.last_action === 'update' || r.last_action === 'migrate'));
}
function computeSlug(absPath, existing) {
    const base = absPath.split(/[\\/]/).filter((s) => s.length > 0).at(-1) ?? 'project';
    const taken = new Set(existing.map((e) => e.slug));
    if (!taken.has(base))
        return base;
    for (let i = 2; i < 1000; i += 1) {
        const candidate = `${base}-${i}`;
        if (!taken.has(candidate))
            return candidate;
    }
    return `${base}-${Date.now()}`;
}
export function pathExistsAsDir(p) {
    try {
        return statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
