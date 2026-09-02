
import { readFileSync } from 'node:fs';
import { parse as parseYamlText } from 'yaml';


export interface EntrySource {
  readonly repo: string;
  readonly path: string;
  readonly sha: string;
}

export interface CatalogEntry {
  readonly id: string;
  readonly source: EntrySource;
  readonly meta: Record<string, unknown>;
}

export interface PerEntryDocument {
  readonly entry: CatalogEntry;
  readonly lockText: string;
}

export interface RevokedList {
  readonly version: 1;
  readonly revoked: ReadonlyArray<{ readonly id: string; readonly reason?: string }>;
}

export class EntryError extends Error {}


export function catalogEntryUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/catalog/v1/${id}.json`;
}

export function catalogRevokedUrl(baseUrl: string): string {
  return `${baseUrl}/catalog/v1/revoked.json`;
}

export function catalogIndexUrl(baseUrl: string): string {
  return `${baseUrl}/catalog/v1/index.json`;
}

export interface CatalogIndexRow {
  readonly id: string;
  readonly summary: string;
  readonly author?: string;
  readonly level: 'verified' | 'community';
  readonly script_tools: number;
  readonly deciders: number;
  readonly categories?: readonly string[];
  readonly tags?: readonly string[];
}

export interface CatalogIndex {
  readonly catalog_index_version: 1;
  readonly entries: readonly CatalogIndexRow[];
}

export function validateCatalogIndex(raw: unknown): CatalogIndex {
  if (raw === null || typeof raw !== 'object') throw new EntryError('catalog index is not an object');
  const d = raw as Record<string, unknown>;
  if (d.catalog_index_version !== 1) {
    throw new EntryError(
      `unsupported catalog index version '${String(d.catalog_index_version)}' — update riglane, or the catalog is newer than this CLI`,
    );
  }
  if (!Array.isArray(d.entries)) throw new EntryError('catalog index has no entries array');
  const entries = (d.entries as unknown[]).map((r) => {
    if (r === null || typeof r !== 'object') throw new EntryError('catalog index row is not an object');
    const row = r as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.summary !== 'string') {
      throw new EntryError('catalog index row without id/summary');
    }
    return {
      id: row.id,
      summary: row.summary,
      ...(typeof row.author === 'string' ? { author: row.author } : {}),
      level: row.level === 'verified' ? ('verified' as const) : ('community' as const),
      script_tools: typeof row.script_tools === 'number' ? row.script_tools : 0,
      deciders: typeof row.deciders === 'number' ? row.deciders : 0,
      ...(Array.isArray(row.categories) ? { categories: (row.categories as unknown[]).map(String) } : {}),
      ...(Array.isArray(row.tags) ? { tags: (row.tags as unknown[]).map(String) } : {}),
    };
  });
  return { catalog_index_version: 1, entries };
}


const ID_RE = /^[a-z][a-z0-9_-]*$/;
const SHA_RE = /^[0-9a-f]{40}$/;

export function validateEntry(raw: unknown): CatalogEntry {
  if (raw === null || typeof raw !== 'object') throw new EntryError('entry is not a mapping');
  const e = raw as Record<string, unknown>;
  const id = e.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new EntryError(`entry.id must match ${ID_RE} (it doubles as the workflow name and install dir)`);
  }
  const src = e.source;
  if (src === null || typeof src !== 'object') throw new EntryError(`entry.source is required (repo/path/sha)`);
  const s = src as Record<string, unknown>;
  if (typeof s.repo !== 'string' || s.repo.trim() === '') throw new EntryError('entry.source.repo is required');
  const sha = s.sha;
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) {
    throw new EntryError('entry.source.sha must be a FULL 40-character lowercase commit SHA (the pin)');
  }
  const path = typeof s.path === 'string' ? s.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
  if (path.split('/').includes('..')) throw new EntryError('entry.source.path must not traverse upward');
  const { id: _i, source: _s, ...meta } = e;
  return { id, source: { repo: s.repo.trim(), path, sha }, meta };
}

export function readEntryFile(entryYamlPath: string): CatalogEntry {
  let parsed: unknown;
  try {
    parsed = parseYamlText(readFileSync(entryYamlPath, 'utf-8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EntryError(`cannot read ${entryYamlPath}: ${msg}`);
  }
  return validateEntry(parsed);
}

export function validatePerEntryDocument(raw: unknown, expectedId: string): PerEntryDocument {
  if (raw === null || typeof raw !== 'object') throw new EntryError('per-entry document is not an object');
  const d = raw as Record<string, unknown>;
  if (d.catalog_entry_version !== 1) {
    throw new EntryError(
      `unsupported catalog entry version '${String(d.catalog_entry_version)}' — update riglane, or the catalog is newer than this CLI`,
    );
  }
  const entry = validateEntry(d.entry);
  if (entry.id !== expectedId) {
    throw new EntryError(`catalog returned entry '${entry.id}' for requested id '${expectedId}'`);
  }
  if (typeof d.lock !== 'string' || d.lock.length === 0) {
    throw new EntryError('per-entry document carries no lock text');
  }
  return { entry, lockText: d.lock };
}

export function isRevoked(list: RevokedList, id: string): { revoked: boolean; reason?: string } {
  const hit = list.revoked.find((r) => r.id === id);
  return hit ? { revoked: true, ...(hit.reason !== undefined ? { reason: hit.reason } : {}) } : { revoked: false };
}

export function validateRevokedList(raw: unknown): RevokedList {
  if (raw === null || typeof raw !== 'object') throw new EntryError('revoked.json is not an object');
  const d = raw as Record<string, unknown>;
  if (d.version !== 1 || !Array.isArray(d.revoked)) throw new EntryError('revoked.json has an unknown shape');
  const revoked = (d.revoked as unknown[]).map((r) => {
    if (r === null || typeof r !== 'object' || typeof (r as Record<string, unknown>).id !== 'string') {
      throw new EntryError('revoked.json entry without an id');
    }
    const rec = r as Record<string, unknown>;
    return { id: rec.id as string, ...(typeof rec.reason === 'string' ? { reason: rec.reason } : {}) };
  });
  return { version: 1, revoked };
}
