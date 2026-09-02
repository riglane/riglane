import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteJson } from '../cli/_fs.js';
import { PRODUCT_DIR } from '../config/paths.js';
import { ensureScopeDir, scopeDir, specDirFor } from '../scope/scope-context.js';
import { SPEC_INDEX_VERSION, SPEC_REGISTRY_VERSION } from '../types/spec.js';
export function specIndexPath(scope, root = '.') {
    return join(scopeDir(scope, root), '_index.json');
}
export function specRegistryPath(scope, root = '.') {
    return join(scopeDir(scope, root), '_registry.json');
}
export function specFilePath(scope, domain, specId, root = '.') {
    return join(specDirFor(scope, domain, root), `${specId}.md`);
}
export function specRelPath(scope, domain, specId) {
    return `${PRODUCT_DIR}/specs/${scope}/${domain}/${specId}.md`;
}
function parseJsonBomTolerant(text) {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}
export function readSpecIndex(scope, root = '.') {
    ensureScopeDir(scope, root);
    const parsed = parseJsonBomTolerant(readFileSync(specIndexPath(scope, root), 'utf-8'));
    if (!Array.isArray(parsed.specs))
        parsed.specs = [];
    if (!Array.isArray(parsed.domains))
        parsed.domains = [];
    if (typeof parsed.version !== 'number')
        parsed.version = SPEC_INDEX_VERSION;
    if (typeof parsed.scope !== 'string')
        parsed.scope = scope;
    return parsed;
}
export function writeSpecIndex(scope, index, root = '.') {
    const path = specIndexPath(scope, root);
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteJson(path, index);
}
export function readSpecRegistry(scope, root = '.') {
    ensureScopeDir(scope, root);
    return parseJsonBomTolerant(readFileSync(specRegistryPath(scope, root), 'utf-8'));
}
export function writeSpecRegistry(scope, registry, root = '.') {
    const path = specRegistryPath(scope, root);
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteJson(path, registry);
}
export function readSpecDomains(scope, root = '.') {
    const path = specIndexPath(scope, root);
    if (!existsSync(path))
        return [];
    try {
        const index = parseJsonBomTolerant(readFileSync(path, 'utf-8'));
        return Array.isArray(index.domains) ? [...index.domains] : [];
    }
    catch {
        return [];
    }
}
export function readSpecIndexRaw(scope, root = '.') {
    const path = specIndexPath(scope, root);
    if (!existsSync(path))
        return null;
    try {
        return parseJsonBomTolerant(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function emptySpecIndex(scope) {
    return { version: SPEC_INDEX_VERSION, scope, domains: [], specs: [] };
}
export function emptySpecRegistry(scope) {
    return { version: SPEC_REGISTRY_VERSION, scope, mappings: {} };
}
export function writeSpecMarkdown(scope, domain, specId, content, root = '.') {
    const path = specFilePath(scope, domain, specId, root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
    return path;
}
export function readSpecMarkdown(path) {
    return readFileSync(path, 'utf-8');
}
export function deleteSpecMarkdown(path) {
    if (!existsSync(path))
        return false;
    unlinkSync(path);
    return true;
}
