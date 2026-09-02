
import { createHash } from 'node:crypto';

import type {
  DomainEntry,
  SpecFrontmatter,
  SpecIndex,
  SpecIndexEntry,
  SpecRegistry,
} from '../types/spec.js';


function highestExistingSerial(domain: string, existingSpecIds: readonly string[]): number {
  const prefix = `${domain}-`;
  let max = 0;
  for (const id of existingSpecIds) {
    if (!id.startsWith(prefix)) continue;
    const suffix = id.slice(prefix.length);
    if (!/^\d{3,}$/.test(suffix)) continue;
    const n = Number.parseInt(suffix, 10);
    if (n > max) max = n;
  }
  return max;
}

export function mintSpecId(
  domain: string,
  domainNextSerial: number,
  existingSpecIds: readonly string[],
): { specId: string; nextSerial: number } {
  const serial = Math.max(domainNextSerial, highestExistingSerial(domain, existingSpecIds) + 1);
  if (serial > 999) {
    throw new Error(
      `domain '${domain}' has reached its id ceiling (${domain}-999). Ids are never reused, so ` +
        `deleting specs cannot free it. A domain this large has outgrown its grouping — split ` +
        `it: spec_write(op:move) relocates specs into a new or existing domain (ids are ` +
        `re-minted there), spec_write(op:rename_domain) renames it wholesale.`,
    );
  }
  return {
    specId: `${domain}-${String(serial).padStart(3, '0')}`,
    nextSerial: serial + 1,
  };
}


export function computeContentFingerprint(managedContent: string): string {
  const hex = createHash('sha256').update(managedContent.trim(), 'utf-8').digest('hex');
  return `sha256:${hex}`;
}

export function isSummaryStale(
  prev: { readonly content_fingerprint: string; readonly summary: string },
  next: { readonly content_fingerprint: string; readonly summary: string },
): boolean {
  return next.content_fingerprint !== prev.content_fingerprint && next.summary === prev.summary;
}


export function deriveIndexEntry(
  fm: SpecFrontmatter,
  path: string,
  contentFingerprint: string,
): SpecIndexEntry {
  return {
    spec_id: fm.spec_id,
    domain: fm.domain,
    title: fm.title,
    summary: fm.summary,
    applies_to: [...fm.applies_to],
    path,
    created_at: fm.created_at,
    updated_at: fm.updated_at,
    content_fingerprint: contentFingerprint,
  };
}

export function upsertSpecInIndex(index: SpecIndex, entry: SpecIndexEntry): SpecIndex {
  const exists = index.specs.some((s) => s.spec_id === entry.spec_id);
  const specs = exists
    ? index.specs.map((s) => (s.spec_id === entry.spec_id ? entry : s))
    : [...index.specs, entry];
  return { ...index, specs };
}

export function removeSpecFromIndex(index: SpecIndex, specId: string): SpecIndex {
  return { ...index, specs: index.specs.filter((s) => s.spec_id !== specId) };
}

export function ensureDomainInIndex(
  index: SpecIndex,
  name: string,
  description: string,
): SpecIndex {
  if (index.domains.some((d) => d.name === name)) return index;
  const domain: DomainEntry = { name, description, next_serial: 1 };
  return { ...index, domains: [...index.domains, domain] };
}

export function setDomainNextSerial(
  index: SpecIndex,
  domainName: string,
  nextSerial: number,
): SpecIndex {
  return {
    ...index,
    domains: index.domains.map((d) =>
      d.name === domainName ? { ...d, next_serial: nextSerial } : d,
    ),
  };
}

export function setDomainDescription(
  index: SpecIndex,
  domainName: string,
  description: string,
): SpecIndex {
  return {
    ...index,
    domains: index.domains.map((d) => (d.name === domainName ? { ...d, description } : d)),
  };
}


export function reconcileIndex(
  oldIndex: SpecIndex,
  derived: readonly SpecIndexEntry[],
): { index: SpecIndex; changes: { added: string[]; removed: string[]; modified: string[] } } {
  const oldById = new Map(oldIndex.specs.map((s) => [s.spec_id, s]));
  const derivedIds = new Set(derived.map((s) => s.spec_id));

  const added: string[] = [];
  const modified: string[] = [];
  for (const d of derived) {
    const prev = oldById.get(d.spec_id);
    if (!prev) added.push(d.spec_id);
    else if (JSON.stringify(prev) !== JSON.stringify(d)) modified.push(d.spec_id);
  }
  const removed = oldIndex.specs.filter((s) => !derivedIds.has(s.spec_id)).map((s) => s.spec_id);

  const oldDomainByName = new Map(oldIndex.domains.map((d) => [d.name, d]));
  const derivedDomainNames = [...new Set(derived.map((s) => s.domain))];
  const orderedNames = [
    ...oldIndex.domains.map((d) => d.name),
    ...derivedDomainNames.filter((n) => !oldDomainByName.has(n)),
  ];
  const derivedIdList = derived.map((s) => s.spec_id);
  const domains: DomainEntry[] = orderedNames.map((name) => {
    const old = oldDomainByName.get(name);
    const nextSerial = Math.max(old?.next_serial ?? 1, highestExistingSerial(name, derivedIdList) + 1);
    return { name, description: old?.description ?? '', next_serial: nextSerial };
  });

  return {
    index: { ...oldIndex, domains, specs: [...derived] },
    changes: { added, removed, modified },
  };
}

export function reconcileRegistry(
  oldRegistry: SpecRegistry,
  validSpecIds: ReadonlySet<string>,
  fileExists?: (projectRootRelPath: string) => boolean,
): {
  registry: SpecRegistry;
  changes: { removedMappings: string[]; danglingFiles: Array<{ spec_id: string; file: string }> };
} {
  const mappings: Record<string, (typeof oldRegistry.mappings)[string]> = {};
  const removedMappings: string[] = [];
  const danglingFiles: Array<{ spec_id: string; file: string }> = [];

  for (const [specId, mapping] of Object.entries(oldRegistry.mappings)) {
    if (!validSpecIds.has(specId)) {
      removedMappings.push(specId);
      continue;
    }
    mappings[specId] = mapping;
    if (fileExists) {
      for (const ib of mapping.implemented_by) {
        if (!fileExists(ib.file)) danglingFiles.push({ spec_id: specId, file: ib.file });
      }
    }
  }

  return { registry: { ...oldRegistry, mappings }, changes: { removedMappings, danglingFiles } };
}
