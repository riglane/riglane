
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { globSync } from 'glob';

import type { FileFingerprint, OutputSnapshot, Snapshot } from '../types/snapshot.js';
import type { StructSchema, ValidationResult as ValidationResultShape } from '../types/struct.js';
import type { Output } from '../types/workflow.js';
import { PRODUCT_DIR } from '../config/paths.js';
import { ENV_GATE_FILE_WAIT_MS } from '../config/product.js';
import { loadYaml, validateFile } from './schema-validate.js';
import { collectAllSteps } from './workflow-tree.js';
import { resolvePlaceholders } from './placeholders.js';
import { OutputPathError, resolveConcreteOutputPath } from './output-paths.js';



const ROOT_RELATIVE_PREFIXES = [
  `${PRODUCT_DIR}/`,
  '.user/',
  '.cursor/',
  '.claude/',
  `${PRODUCT_DIR}\\`,
  '.user\\',
  '.cursor\\',
  '.claude\\',
] as const;

function isRootRelative(path: string): boolean {
  return ROOT_RELATIVE_PREFIXES.some((p) => path.startsWith(p));
}

function hasGlobChar(path: string): boolean {
  return path.includes('*') || path.includes('?') || path.includes('[');
}

export function normalizePerIterationOutputs(workflow: Record<string, unknown>): void {
  for (const step of collectAllSteps({ steps: workflow.steps })) {
    const outputs = step.outputs as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(outputs)) continue;
    for (const out of outputs) {
      if (out === null || typeof out !== 'object' || out.per_iteration !== true) continue;
      const p = out.path;
      if (typeof p !== 'string' || p.length === 0 || p.includes('{iteration}')) continue;
      const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      const dot = p.lastIndexOf('.');
      out.path =
        dot > slash ? `${p.slice(0, dot)}_{iteration}${p.slice(dot)}` : `${p}_{iteration}`;
    }
  }
}

export function injectSpecAuthoringOutputs(workflow: Record<string, unknown>): void {
  {
    for (const step of collectAllSteps({ steps: workflow.steps })) {
      if (step.spec_authoring !== 'persist') continue;
      const outputs = Array.isArray(step.outputs)
        ? (step.outputs as Array<Record<string, unknown>>)
        : [];
      const manual = outputs.filter(
        (o) => typeof o.path === 'string' && (o.path as string).includes('.riglane/specs/'),
      );
      if (manual.length > 0) {
        const injected = new Set([SPEC_OUTPUT_SCOPED, SPEC_OUTPUT_GENERIC]);
        const foreign = manual.filter((o) => !injected.has(o.path as string));
        if (foreign.length > 0 && manual.length === foreign.length) {
          // eslint-disable-next-line no-console
          console.error(
            `[workflow-engine] Warning: step '${String(step.name)}' declares manual ` +
              `.riglane/specs outputs alongside spec_authoring: persist — the engine ` +
              `auto-declares them; remove the manual declaration (author override kept).`,
          );
          continue;
        }
        if (foreign.length === 0 && manual.length === 2) continue;
      }
      const have = new Set(outputs.map((o) => o.path));
      for (const path of [SPEC_OUTPUT_SCOPED, SPEC_OUTPUT_GENERIC]) {
        if (!have.has(path)) {
          outputs.push({ path, write_proof: 'any_member', optional: true });
        }
      }
      step.outputs = outputs;
    }
  }
}

export const SPEC_OUTPUT_SCOPED = '.riglane/specs/{scope}/**/*.md';
export const SPEC_OUTPUT_GENERIC = '.riglane/specs/generic/**/*.md';

export function resolveOutputPath(pathTemplate: string, runtimeDir: string): string[] {
  const globPattern = pathTemplate.replace(/\{[^}]+\}/g, '*');

  let absPattern: string;
  if (isRootRelative(globPattern) || isAbsolute(globPattern)) {
    absPattern = globPattern;
  } else {
    absPattern = join(runtimeDir, globPattern);
  }

  return globSync(absPattern, { windowsPathsNoEscape: true });
}


export function computeFileFingerprint(filePath: string): FileFingerprint {
  let st: ReturnType<typeof statSync>;
  try {
    if (!existsSync(filePath)) {
      return { exists: false, mtime: null, sha256: null, size: null };
    }
    st = statSync(filePath);
  } catch {
    return { exists: false, mtime: null, sha256: null, size: null };
  }

  const mtime = st.mtimeMs / 1000;
  const size = st.size;

  let hashHex: string | null;
  try {
    const hash = createHash('sha256');
    const fd = openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(65536);
      let bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      while (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
        bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      }
    } finally {
      closeSync(fd);
    }
    hashHex = hash.digest('hex');
  } catch {
    hashHex = null;
  }

  return {
    exists: true,
    mtime,
    sha256: hashHex as FileFingerprint['sha256'],
    size,
  };
}


export function isTouched(
  current: FileFingerprint,
  baseline: FileFingerprint | null,
  stepStartedAt: string | null,
): boolean {
  if (!current.exists) return false;

  if (baseline === null || !baseline.exists) return true;

  const curHash = current.sha256;
  const baseHash = baseline.sha256;
  if (curHash !== null && baseHash !== null && curHash !== baseHash) {
    return true;
  }

  if (stepStartedAt) {
    try {
      const threshold = parseIsoTimestamp(stepStartedAt);
      if (current.mtime !== null && current.mtime > threshold) {
        return true;
      }
    } catch {
    }
  }

  return false;
}

export function parseIsoTimestamp(isoStr: string): number {
  const hasOffset = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(isoStr);
  const normalized = hasOffset ? isoStr : `${isoStr}Z`;
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) {
    throw new TypeError(`Invalid ISO timestamp: ${isoStr}`);
  }
  return ms / 1000;
}

function nowIsoLocalWithOffset(d: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  const offsetMin = -d.getTimezoneOffset();
  const offsetSign = offsetMin >= 0 ? '+' : '-';
  const offsetH = pad(Math.floor(Math.abs(offsetMin) / 60));
  const offsetM = pad(Math.abs(offsetMin) % 60);
  const ms = pad(d.getMilliseconds(), 3);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}` +
    `${offsetSign}${offsetH}:${offsetM}`
  );
}


function defaultWriteProof(pathTemplate: string): 'required' | 'all_members_fresh' {
  return hasGlobChar(pathTemplate) ? 'all_members_fresh' : 'required';
}


export const SNAPSHOT_DIR = join('data', '.snapshots');

function snapshotPath(runtimeDir: string, stepName: string): string {
  return join(runtimeDir, SNAPSHOT_DIR, `${stepName}.json`);
}

export function loadSnapshot(runtimeDir: string, stepName: string): Snapshot | null {
  const path = snapshotPath(runtimeDir, stepName);
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as Snapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(runtimeDir: string, stepName: string, snapshot: Snapshot): void {
  const path = snapshotPath(runtimeDir, stepName);
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  renameSync(tmpPath, path);
}

export function deleteSnapshot(runtimeDir: string, stepName: string): boolean {
  try {
    unlinkSync(snapshotPath(runtimeDir, stepName));
    return true;
  } catch {
    return false;
  }
}

export interface SnapshotBranchInput {
  readonly branch_index: number;
  readonly branch_dir: string;
  readonly outputs: ReadonlyArray<Output | string>;
}

export function createSnapshot(
  outputs: ReadonlyArray<Output | string>,
  runtimeDir: string,
  stepName: string,
  branches?: ReadonlyArray<SnapshotBranchInput>,
): Snapshot {
  const existing = loadSnapshot(runtimeDir, stepName);
  if (existing !== null) return existing;

  const now = nowIsoLocalWithOffset(new Date());
  const snapshot: {
    step: string;
    created_at: string;
    global: Record<string, OutputSnapshot>;
    branches: Record<string, { branch_dir: string; outputs: Record<string, OutputSnapshot> }>;
  } = {
    step: stepName,
    created_at: now,
    global: {},
    branches: {},
  };

  const snapshotOutputList = (
    outs: ReadonlyArray<Output | string>,
    baseDir: string,
  ): Record<string, OutputSnapshot> => {
    const result: Record<string, OutputSnapshot> = {};
    for (const out of outs) {
      let opath: string;
      let wp: string;
      if (typeof out === 'object' && out !== null) {
        opath = out.path ?? '';
        wp = out.write_proof ?? defaultWriteProof(opath);
      } else {
        opath = String(out);
        wp = defaultWriteProof(opath);
      }
      if (wp === 'off' || !opath) continue;

      const matched = resolveOutputPath(opath, baseDir);
      const baseline: Record<string, FileFingerprint> = {};
      for (const mp of matched) baseline[mp] = computeFileFingerprint(mp);
      result[opath] = {
        write_proof: wp as OutputSnapshot['write_proof'],
        baseline,
      };
    }
    return result;
  };

  if (outputs.length > 0 && (!branches || branches.length === 0)) {
    snapshot.global = snapshotOutputList(outputs, runtimeDir);
  }

  if (branches && branches.length > 0) {
    snapshot.global = snapshotOutputList(outputs, runtimeDir);
    for (const branch of branches) {
      const idx = String(branch.branch_index);
      snapshot.branches[idx] = {
        branch_dir: branch.branch_dir,
        outputs: snapshotOutputList(branch.outputs, runtimeDir),
      };
    }
  }

  const finalSnapshot = snapshot as unknown as Snapshot;
  saveSnapshot(runtimeDir, stepName, finalSnapshot);
  return finalSnapshot;
}


export class MutableValidationResult {
  passed = true;
  checks = 0;
  failures = 0;
  readonly details: string[] = [];
  readonly proofResults: ProofResultEntry[] = [];

  addCheck(passed: boolean, detail?: string): void {
    this.checks += 1;
    if (!passed) {
      this.failures += 1;
      this.passed = false;
      if (detail) this.details.push(detail);
    }
  }

  addDetail(detail: string): void {
    this.details.push(detail);
  }

  extend(checks: number, failures: number, details: readonly string[]): void {
    this.checks += checks;
    this.failures += failures;
    this.details.push(...details);
    if (failures > 0) this.passed = false;
  }

  snapshot(): ValidationResultShape {
    return {
      passed: this.passed,
      checks: this.checks,
      failures: this.failures,
      details: [...this.details],
      proof_results: [...this.proofResults],
    };
  }
}

export interface ProofResultEntry {
  readonly path: string;
  readonly mode: string;
  readonly status: 'touched' | 'stale';
}


export interface BranchFilter {
  readonly branch_index: number;
  readonly branch_dir: string;
}

export interface ValidateOutputsOptions {
  readonly snapshot?: Snapshot | null;
  readonly stepStartedAt?: string | null;
  readonly branchFilter?: BranchFilter | null;
  readonly params?: Record<string, unknown> | null;
  readonly waitForFiles?: boolean;
}

export function narrowOutputsForBranch(
  outputs: ReadonlyArray<Output | string>,
  branchIndex: number,
): Array<Output> {
  const narrowed: Array<Output> = [];
  for (const rawOut of outputs) {
    let opath: string;
    let baseProps: Partial<Output>;
    if (typeof rawOut === 'object' && rawOut !== null) {
      baseProps = { ...rawOut };
      opath = rawOut.path;
    } else {
      opath = String(rawOut);
      baseProps = {};
    }
    const parts = opath.split('/');
    const newParts: string[] = [];
    let foundVar = false;
    const fileGlob = parts.length > 0 ? (parts[parts.length - 1] ?? '*') : '*';
    const head = parts.slice(0, -1);
    for (const p of head) {
      if (p.includes('{')) {
        if (!foundVar) {
          newParts.push(`_branch_${branchIndex}`);
          newParts.push('**');
          foundVar = true;
        }
      } else {
        newParts.push(p);
      }
    }
    if (!foundVar) {
      newParts.push(`_branch_${branchIndex}`);
      newParts.push('**');
    }
    newParts.push(fileGlob);
    narrowed.push({ ...baseProps, path: newParts.join('/') });
  }
  return narrowed;
}

export function branchOutputsFromResolved(
  declaredOutputs: ReadonlyArray<Output | string>,
  resolvedOutputs: ReadonlyArray<{
    readonly declared: string;
    readonly working: string;
    readonly struct?: string;
  }>,
): Array<Output> {
  const byDeclared = new Map<string, Output>();
  for (const raw of declaredOutputs) {
    if (typeof raw === 'object' && raw !== null) byDeclared.set(raw.path, { ...raw });
    else byDeclared.set(String(raw), { path: String(raw) });
  }
  return resolvedOutputs.map((ro) => {
    const base = byDeclared.get(ro.declared);
    const merged: Output = base ? { ...base, path: ro.working } : { path: ro.working };
    return typeof ro.struct === 'string' && ro.struct.length > 0
      ? { ...merged, struct: ro.struct }
      : merged;
  });
}

export function validateOutputs(
  outputs: ReadonlyArray<Output | string>,
  definitionDir: string | null,
  runtimeDir: string,
  options?: ValidateOutputsOptions,
): ValidationResultShape {
  const result = new MutableValidationResult();

  if (!outputs || outputs.length === 0) {
    result.addDetail('No output schemas defined — skipping structural gate');
    return result.snapshot();
  }

  const snapshot = options?.snapshot ?? null;
  const stepStartedAt = options?.stepStartedAt ?? null;
  const branchFilter = options?.branchFilter ?? null;
  const params = options?.params ?? null;
  const waitForFiles = options?.waitForFiles ?? true;

  const structsDir = definitionDir ? join(definitionDir, 'structs') : null;

  let baselineMap: Record<string, OutputSnapshot> = {};
  if (snapshot) {
    if (branchFilter) {
      const branchKey = String(branchFilter.branch_index);
      const branchSnap = snapshot.branches?.[branchKey];
      const branchOutputs = branchSnap?.outputs ?? {};
      baselineMap = { ...(snapshot.global ?? {}), ...branchOutputs };
    } else {
      baselineMap = { ...(snapshot.global ?? {}) };
    }
  }

  for (const output of outputs) {
    let outputPath: string;
    let structName: string | undefined;
    let explicitWp: string | undefined;
    let isOptional: boolean;

    if (typeof output === 'object' && output !== null) {
      outputPath = output.path ?? '';
      structName = output.struct;
      explicitWp = output.write_proof;
      isOptional = Boolean(output.optional);
    } else {
      outputPath = String(output);
      structName = undefined;
      explicitWp = undefined;
      isOptional = false;
    }

    if (!outputPath) continue;

    let resolvedPath: string;
    if (branchFilter) {
      resolvedPath = resolvePlaceholders(outputPath, params);
    } else {
      try {
        resolvedPath = resolveConcreteOutputPath(outputPath, params ?? {});
      } catch (e) {
        if (e instanceof OutputPathError) {
          result.addCheck(false, `Output path error: ${e.message}`);
          continue;
        }
        throw e;
      }
    }

    let files = resolveOutputPath(resolvedPath, runtimeDir);
    if (files.length === 0 && !isOptional && waitForFiles) {
      let maxWaitMs: number;
      try {
        const { gateFileWaitMs } = require('../config/config.js') as { gateFileWaitMs: () => number };
        maxWaitMs = gateFileWaitMs();
      } catch {
        maxWaitMs = parseInt(process.env[ENV_GATE_FILE_WAIT_MS] ?? '30000', 10);
      }
      if (Number.isFinite(maxWaitMs) && maxWaitMs > 0) {
        const pollMs = 250;
        const buf = new SharedArrayBuffer(4);
        const arr = new Int32Array(buf);
        let elapsed = 0;
        while (elapsed < maxWaitMs) {
          Atomics.wait(arr, 0, 0, pollMs);
          elapsed += pollMs;
          files = resolveOutputPath(resolvedPath, runtimeDir);
          if (files.length > 0) break;
        }
        if (files.length > 0) {
          result.addDetail(
            `[late write] output '${resolvedPath}' appeared after ${elapsed}ms — ` +
              `waited for the subagent's write to flush.`,
          );
        }
      }
    }

    if (isOptional && files.length === 0) {
      result.addDetail(
        `optional output '${resolvedPath}' absent at gate time — checks skipped ` +
          `(re-checked at step_complete)`,
      );
      continue;
    }

    if (files.length === 0) {
      result.addCheck(false, `No output files matching: ${resolvedPath}`);
      continue;
    }

    if (structName && structsDir) {
      const schemaPath = join(structsDir, `${structName}.schema.yaml`);
      if (!existsSync(schemaPath) || !statSync(schemaPath).isFile()) {
        result.addCheck(false, `Schema not found: ${schemaPath}`);
        continue;
      }
      if (files.length === 0) {
        result.addCheck(false, `No output files matching: ${resolvedPath}`);
        continue;
      }
      let schema: StructSchema;
      try {
        schema = loadYaml<StructSchema>(schemaPath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.addCheck(false, `Schema load error for ${schemaPath}: ${msg}`);
        continue;
      }
      for (const filePath of files) {
        const sub = validateFile(filePath, schema);
        result.extend(sub.checks, sub.failures, sub.details);
      }
    }

    if (snapshot) {
      const wp = explicitWp || defaultWriteProof(resolvedPath);
      if (wp === 'off') continue;

      const baselineEntry = baselineMap[resolvedPath];
      checkWriteProof(resolvedPath, wp, files, baselineEntry, stepStartedAt, result);
    }
  }

  return result.snapshot();
}


function checkWriteProof(
  outputPath: string,
  wpMode: string,
  currentFiles: readonly string[],
  baselineEntry: OutputSnapshot | undefined,
  stepStartedAt: string | null,
  result: MutableValidationResult,
): void {
  const baseline = baselineEntry?.baseline ?? {};

  if (wpMode === 'required') {
    if (currentFiles.length === 0) {
      result.addCheck(
        false,
        `write_proof: required output '${outputPath}' not found on disk. Fix: subagent must produce this file during the step.`,
      );
      return;
    }

    for (const fp of currentFiles) {
      const cur = computeFileFingerprint(fp);
      const base = baseline[fp] ?? null;
      const touched = isTouched(cur, base, stepStartedAt);
      if (touched) {
        result.addCheck(true);
        result.proofResults.push({ path: fp, mode: wpMode, status: 'touched' });
      } else {
        result.addCheck(
          false,
          `write_proof failure: '${fp}' was not modified during step execution (hash unchanged, mtime not advanced past step start). Fix: subagent must write this file — claiming success without writing is not acceptable.`,
        );
        result.proofResults.push({ path: fp, mode: wpMode, status: 'stale' });
      }
    }
  } else if (wpMode === 'all_members_fresh') {
    if (currentFiles.length === 0) {
      result.addCheck(
        false,
        `write_proof: no files matching '${outputPath}' after step. Fix: subagent must produce at least one matching file.`,
      );
      return;
    }
    for (const fp of currentFiles) {
      const cur = computeFileFingerprint(fp);
      const base = baseline[fp] ?? null;
      const touched = isTouched(cur, base, stepStartedAt);
      if (touched) {
        result.addCheck(true);
        result.proofResults.push({ path: fp, mode: wpMode, status: 'touched' });
      } else {
        result.addCheck(
          false,
          `write_proof (all_members_fresh): '${fp}' matches glob '${outputPath}' but was not modified in this step (stale from previous run). Fix: either rewrite this file, or ensure workflow_init clears stale outputs before the step.`,
        );
        result.proofResults.push({ path: fp, mode: wpMode, status: 'stale' });
      }
    }
  } else if (wpMode === 'any_member') {
    if (currentFiles.length === 0) {
      result.addCheck(false, `write_proof: no files matching '${outputPath}' after step.`);
      return;
    }
    let anyTouched = false;
    for (const fp of currentFiles) {
      const cur = computeFileFingerprint(fp);
      const base = baseline[fp] ?? null;
      if (isTouched(cur, base, stepStartedAt)) {
        anyTouched = true;
        result.proofResults.push({ path: fp, mode: wpMode, status: 'touched' });
        break;
      }
    }
    if (anyTouched) {
      result.addCheck(true);
    } else {
      result.addCheck(
        false,
        `write_proof (any_member): no files matching '${outputPath}' were modified in this step. Fix: subagent must write at least one matching file.`,
      );
    }
  }
}
