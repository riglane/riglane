
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { PRODUCT_DIR } from '../config/paths.js';
import { templatesRoot } from './templates.js';


export function installedPredefinedDir(target: string): string {
  return join(target, PRODUCT_DIR, 'workflows', 'templates', 'predefined');
}

export function installedMyWorkflowsDir(target: string): string {
  return join(target, PRODUCT_DIR, 'workflows', 'templates', 'my_workflows');
}

export function predefinedHashesPath(target: string): string {
  return join(target, PRODUCT_DIR, 'workflows', '.predefined-hashes.json');
}

function packagePredefinedDir(pkgTemplatesRoot: string): string {
  return join(pkgTemplatesRoot, 'agent', 'workflows', 'templates', 'predefined');
}


function hashFile(abs: string): string {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root, { recursive: true }) as unknown as string[];
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const abs = join(root, entry);
    try {
      if (statSync(abs).isFile()) out.push(entry.split(sep).join('/'));
    } catch {
    }
  }
  return out.sort();
}

export function computePredefinedHashes(target: string): Record<string, string> {
  const root = installedPredefinedDir(target);
  const out: Record<string, string> = {};
  for (const rel of walkFiles(root)) {
    try {
      out[rel] = hashFile(join(root, rel));
    } catch {
    }
  }
  return out;
}

interface HashManifest {
  readonly version: 1;
  readonly files: Record<string, string>;
}

export function writePredefinedHashes(target: string): void {
  const manifest: HashManifest = { version: 1, files: computePredefinedHashes(target) };
  const path = predefinedHashesPath(target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

export function readPredefinedHashes(target: string): Record<string, string> | null {
  try {
    const raw = JSON.parse(readFileSync(predefinedHashesPath(target), 'utf-8')) as {
      version?: unknown;
      files?: unknown;
    };
    if (raw.version !== 1 || typeof raw.files !== 'object' || raw.files === null) return null;
    return raw.files as Record<string, string>;
  } catch {
    return null;
  }
}


function workflowOf(rel: string): string {
  return rel.split('/')[0] ?? '';
}

export function detectEditedPredefinedWorkflows(target: string): string[] {
  const recorded = readPredefinedHashes(target);
  if (recorded === null) return [];

  const root = installedPredefinedDir(target);
  const current = walkFiles(root);
  const edited = new Set<string>();
  const currentSet = new Set(current);

  for (const rel of current) {
    const wf = workflowOf(rel);
    if (wf === '' || edited.has(wf)) continue;
    const want = recorded[rel];
    if (want === undefined) {
      edited.add(wf);
      continue;
    }
    try {
      if (hashFile(join(root, rel)) !== want) edited.add(wf);
    } catch {
      edited.add(wf);
    }
  }
  for (const rel of Object.keys(recorded)) {
    const wf = workflowOf(rel);
    if (wf === '' || edited.has(wf)) continue;
    if (!currentSet.has(rel)) edited.add(wf);
  }
  return [...edited].sort();
}


export interface PromotedWorkflow {
  readonly name: string;
  readonly note: string;
}

export interface PromoteConflict {
  readonly name: string;
  readonly reason: string;
}

export interface PromoteReport {
  readonly promoted: PromotedWorkflow[];
  readonly conflicts: PromoteConflict[];
}

function copyDirQuiet(src: string, dst: string): void {
  for (const rel of walkFiles(src)) {
    const from = join(src, rel);
    const to = join(dst, rel);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(from));
  }
}

function dirsIdentical(a: string, b: string): boolean {
  const filesA = walkFiles(a);
  const filesB = walkFiles(b);
  if (filesA.length !== filesB.length) return false;
  for (let i = 0; i < filesA.length; i += 1) {
    if (filesA[i] !== filesB[i]) return false;
    try {
      if (
        Buffer.compare(readFileSync(join(a, filesA[i]!)), readFileSync(join(b, filesB[i]!))) !== 0
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

const TEXT_EXTENSIONS = new Set(['.yaml', '.yml', '.md', '.py', '.mjs', '.js', '.json', '.sh']);

function rewriteSelfReferences(dir: string, name: string): void {
  const from = `workflows/templates/predefined/${name}/`;
  const to = `workflows/templates/my_workflows/${name}/`;
  for (const rel of walkFiles(dir)) {
    const dot = rel.lastIndexOf('.');
    if (dot < 0 || !TEXT_EXTENSIONS.has(rel.slice(dot))) continue;
    const abs = join(dir, rel);
    let text: string;
    try {
      text = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    if (!text.includes(from)) continue;
    writeFileSync(abs, text.split(from).join(to), 'utf-8');
  }
}

export interface PromoteOptions {
  readonly dryRun?: boolean;
  readonly pkgTemplatesRoot?: string;
}

export function promoteEditedPredefinedWorkflows(
  target: string,
  opts: PromoteOptions = {},
): PromoteReport {
  const dryRun = Boolean(opts.dryRun);
  const pkgRoot = packagePredefinedDir(opts.pkgTemplatesRoot ?? templatesRoot());
  const promoted: PromotedWorkflow[] = [];
  const conflicts: PromoteConflict[] = [];

  const edited = detectEditedPredefinedWorkflows(target);
  if (edited.length === 0) return { promoted, conflicts };

  for (const name of edited) {
    const src = join(installedPredefinedDir(target), name);
    const dst = join(installedMyWorkflowsDir(target), name);
    const pkg = join(pkgRoot, name);
    const pkgShips = existsSync(pkg) && statSync(pkg).isDirectory();
    const srcExists = existsSync(src) && statSync(src).isDirectory();

    if (existsSync(dst)) {
      if (srcExists && dirsIdentical(src, dst)) {
        if (!dryRun) {
          rmSync(src, { recursive: true, force: true });
          if (pkgShips) copyDirQuiet(pkg, src);
        }
        promoted.push({
          name,
          note: 'identical copy already in my_workflows — predefined restored pristine',
        });
      } else {
        conflicts.push({
          name,
          reason:
            `my_workflows/${name} already exists with different content — ` +
            `left everything untouched; merge manually`,
        });
      }
      continue;
    }

    if (!srcExists) {
      if (!dryRun && pkgShips) copyDirQuiet(pkg, src);
      promoted.push({ name, note: 'predefined directory was deleted — restored pristine' });
      continue;
    }

    if (!dryRun) {
      copyDirQuiet(src, dst);
      rewriteSelfReferences(dst, name);
      rmSync(src, { recursive: true, force: true });
      if (pkgShips) copyDirQuiet(pkg, src);
    }
    promoted.push({
      name,
      note: pkgShips
        ? `edited copy moved to my_workflows/${name}; predefined restored pristine`
        : `edited copy moved to my_workflows/${name}; package no longer ships it`,
    });
  }

  if (!dryRun && promoted.length > 0) {
    const previous = readPredefinedHashes(target) ?? {};
    const fresh = computePredefinedHashes(target);
    for (const { name } of conflicts) {
      const prefix = `${name}/`;
      for (const rel of Object.keys(fresh)) {
        if (rel.startsWith(prefix)) delete fresh[rel];
      }
      for (const [rel, hash] of Object.entries(previous)) {
        if (rel.startsWith(prefix)) fresh[rel] = hash;
      }
    }
    const manifest: HashManifest = { version: 1, files: fresh };
    const path = predefinedHashesPath(target);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  }
  return { promoted, conflicts };
}
