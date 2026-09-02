
import type { StructSchema } from './struct.js';

import specSchemaJson from './schemas/spec.schema.json' with { type: 'json' };

export const SPEC_SCHEMA = specSchemaJson as StructSchema;

export interface SpecFrontmatter {
  readonly spec_id: string;
  readonly domain: string;
  readonly title: string;
  readonly summary: string;
  readonly applies_to: readonly string[];
  readonly scope: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly source_sections?: readonly string[];
  readonly related_specs?: readonly string[];
  readonly domain_description?: string;
}


export const SPEC_INDEX_VERSION = 1;

export interface DomainEntry {
  readonly name: string;
  readonly description: string;
  readonly next_serial: number;
}

export interface DomainSummary {
  readonly name: string;
  readonly description: string;
}

export interface SpecIndexEntry {
  readonly spec_id: string;
  readonly domain: string;
  readonly title: string;
  readonly summary: string;
  readonly applies_to: readonly string[];
  readonly path: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly content_fingerprint: string;
}

export interface SpecIndex {
  readonly version: number;
  readonly scope: string;
  readonly domains: readonly DomainEntry[];
  readonly specs: readonly SpecIndexEntry[];
}


export const SPEC_REGISTRY_VERSION = 1;

export type SpecRole = 'implements' | 'configures' | 'verifies' | 'uses' | 'affects';

export interface ImplementedByEntry {
  readonly file: string;
  readonly role: SpecRole;
  readonly note?: string;
  readonly added_by: string;
  readonly added_at: string;
}

export interface SpecMapping {
  readonly spec: string;
  readonly implemented_by: readonly ImplementedByEntry[];
}

export interface SpecRegistry {
  readonly version: number;
  readonly scope: string;
  readonly mappings: Readonly<Record<string, SpecMapping>>;
}
