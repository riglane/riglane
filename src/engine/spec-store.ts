
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { atomicWriteJson } from '../cli/_fs.js';
import { PRODUCT_DIR } from '../config/paths.js';
import { ensureScopeDir, scopeDir, specDirFor } from '../scope/scope-context.js';
import type { DomainEntry, SpecIndex, SpecRegistry } from '../types/spec.js';
import { SPEC_INDEX_VERSION, SPEC_REGISTRY_VERSION } from '../types/spec.js';


export function specIndexPath(scope: string, root = '.'): string {
  return join(scopeDir(scope, root), '_index.json');
}

export function specRegistryPath(scope: string, root = '.'): string {
  return join(scopeDir(scope, root), '_registry.json');
}

export function specFilePath(scope: string, domain: string, specId: string, root = '.'): string {
  return join(specDirFor(scope, domain, root), `${specId}.md`);
}

export function specRelPath(scope: string, domain: string, specId: string): string {
  return `${PRODUCT_DIR}/specs/${scope}/${domain}/${specId}.md`;
}


function parseJsonBomTolerant<T>(text: string): T {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as T;
}

export function readSpecIndex(scope: string, root = '.'): SpecIndex {
  ensureScopeDir(scope, root);
  const parsed = parseJsonBomTolerant<Record<string, unknown>>(
    readFileSync(specIndexPath(scope, root), 'utf-8'),
  );
  if (!Array.isArray(parsed.specs)) parsed.specs = [];
  if (!Array.isArray(parsed.domains)) parsed.domains = [];
  if (typeof parsed.version !== 'number') parsed.version = SPEC_INDEX_VERSION;
  if (typeof parsed.scope !== 'string') parsed.scope = scope;
  return parsed as unknown as SpecIndex;
}

export function writeSpecIndex(scope: string, index: SpecIndex, root = '.'): void {
  const path = specIndexPath(scope, root);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteJson(path, index);
}

export function readSpecRegistry(scope: string, root = '.'): SpecRegistry {
  ensureScopeDir(scope, root);
  return parseJsonBomTolerant<SpecRegistry>(readFileSync(specRegistryPath(scope, root), 'utf-8'));
}

export function writeSpecRegistry(scope: string, registry: SpecRegistry, root = '.'): void {
  const path = specRegistryPath(scope, root);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteJson(path, registry);
}

export function readSpecDomains(scope: string, root = '.'): DomainEntry[] {
  const path = specIndexPath(scope, root);
  if (!existsSync(path)) return [];
  try {
    const index = parseJsonBomTolerant<SpecIndex>(readFileSync(path, 'utf-8'));
    return Array.isArray(index.domains) ? [...index.domains] : [];
  } catch {
    return [];
  }
}

export function readSpecIndexRaw(scope: string, root = '.'): SpecIndex | null {
  const path = specIndexPath(scope, root);
  if (!existsSync(path)) return null;
  try {
    return parseJsonBomTolerant<SpecIndex>(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function emptySpecIndex(scope: string): SpecIndex {
  return { version: SPEC_INDEX_VERSION, scope, domains: [], specs: [] };
}
export function emptySpecRegistry(scope: string): SpecRegistry {
  return { version: SPEC_REGISTRY_VERSION, scope, mappings: {} };
}


export function writeSpecMarkdown(
  scope: string,
  domain: string,
  specId: string,
  content: string,
  root = '.',
): string {
  const path = specFilePath(scope, domain, specId, root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
  return path;
}

export function readSpecMarkdown(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function deleteSpecMarkdown(path: string): boolean {
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
