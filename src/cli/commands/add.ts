
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import process from 'node:process';

import { confirmByTypingId, confirmationPrompt, noTerminalReason } from '../_confirm.js';
import { INBOX_WEBHOOK_WHERE, buildWorkflowInventory } from '../../catalog/inventory.js';
import { composeLockDocument, normalizeLockEol } from '../../catalog/lock.js';
import {
  type CatalogEntry,
  EntryError,
  type EntrySource,
  type PerEntryDocument,
  catalogEntryUrl,
  catalogRevokedUrl,
  isRevoked,
  readEntryFile,
  validatePerEntryDocument,
  validateRevokedList,
} from '../../catalog/entry.js';
import { FetchError, fetchSourceTree } from '../../catalog/fetch.js';
import { catalogBaseUrl } from '../../config/config.js';
import { loadYaml } from '../../engine/schema-validate.js';
import { defaultPaths, fullValidateWorkflow } from '../../engine/workflow-engine.js';
import type { Workflow } from '../../types/workflow.js';

const USAGE = 'Usage: riglane add <id>            (from the catalog)\n' +
  '       riglane add <entry-dir>     (local entry.yaml + entry.lock.yaml)\n';

export interface AddCliDeps {
  readonly cwd?: string;
  readonly prompt?: (question: string) => Promise<string>;
  readonly fetchJson?: (url: string) => Promise<unknown | null>;
  readonly fetchTree?: (source: EntrySource, scratchParent: string) => { cloneDir: string; workflowDir: string };
}

export async function runAddCli(argv: readonly string[], deps: AddCliDeps = {}): Promise<number> {
  const flags = argv.filter((a) => a.startsWith('--'));
  const positionals = argv.filter((a) => !a.startsWith('--'));
  if (flags.length > 0) {
    process.stderr.write(`add: unknown option '${flags[0]}'\n${USAGE}`);
    return 2;
  }
  const target = positionals[0];
  if (target === undefined || positionals.length > 1) {
    process.stderr.write(USAGE);
    return 2;
  }

  let doc: PerEntryDocument;
  try {
    if (existsSync(join(target, 'entry.yaml'))) {
      doc = readLocalEntry(target);
    } else {
      const fetched = await fetchCatalogEntry(target, deps);
      if (fetched === null) return 1;
      doc = fetched;
    }
  } catch (e) {
    if (e instanceof EntryError) {
      process.stderr.write(`add: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
  const { entry, lockText } = doc;

  const paths = defaultPaths(deps.cwd);
  const installDir = join(paths.communityDir, entry.id);
  if (existsSync(installDir)) {
    process.stderr.write(
      `add: '${entry.id}' is already installed at ${installDir}.\n` +
        `To move to a newer pinned commit use 'riglane update ${entry.id}'.\n`,
    );
    return 1;
  }

  process.stderr.write(`Fetching ${entry.source.repo} @ ${entry.source.sha.slice(0, 12)}…\n`);
  const fetchTree = deps.fetchTree ?? fetchSourceTree;
  let cloneDir: string;
  let workflowDir: string;
  try {
    ({ cloneDir, workflowDir } = fetchTree(entry.source, tmpdir()));
  } catch (e) {
    if (e instanceof FetchError) {
      process.stderr.write(`add: ${e.message}\n`);
      return 1;
    }
    throw e;
  }

  try {
    const yamlPath = join(workflowDir, 'workflow.yaml');
    let workflow: Workflow;
    try {
      workflow = loadYaml<Workflow>(yamlPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`add: fetched workflow.yaml does not parse: ${msg}\nNothing was installed.\n`);
      return 1;
    }
    const wfName = (workflow as { name?: unknown }).name;
    if (wfName !== entry.id) {
      process.stderr.write(
        `add: entry id '${entry.id}' but the workflow is named '${String(wfName)}' — these must be ` +
          `one identity (the engine refuses a workflow whose name differs from its directory; ` +
          `name the source directory '${entry.id}' too).\n` +
          `Nothing was installed.\n`,
      );
      return 1;
    }
    const { ok, errors } = fullValidateWorkflow(workflow, { definitionDir: workflowDir });
    if (!ok) {
      process.stderr.write(`add: fetched workflow is INVALID — ${errors.length} issue(s):\n`);
      for (const err of errors) process.stderr.write(`  - ${err}\n`);
      process.stderr.write('Nothing was installed.\n');
      return 1;
    }
    const inv = buildWorkflowInventory(workflowDir, workflow);
    const regenerated = composeLockDocument(inv);
    if (regenerated !== normalizeLockEol(lockText)) {
      process.stderr.write(
        `\n✗ NOT INSTALLED — '${entry.id}' was refused.\n\n` +
          `The workflow fetched from the pinned commit is not the one this entry promises:\n` +
          `its capability inventory does not regenerate to the entry's lock. This is the\n` +
          `check that stops a swapped or tampered tree — do not work around it.\n\n` +
          `What to do:\n` +
          `  - If this is YOUR entry: re-run 'riglane catalog pack' at the pinned tree and\n` +
          `    resubmit (a stale lock, or one packed by a different riglane version, is the\n` +
          `    common benign cause).\n` +
          `  - If you installed it from the catalog: stop and report the entry — the catalog\n` +
          `    CI verifies every entry, so a mismatch reaching you is a real signal.\n`,
      );
      return 1;
    }

    printInspectScreen(entry, inv, workflow, installDir);

    const confirmed = await confirmByTypingId(
      entry.id,
      confirmationPrompt(entry.id, 'install it'),
      deps.prompt,
    );
    if (!confirmed.ok) {
      process.stderr.write(
        confirmed.reason === 'no-terminal'
          ? `add: ${noTerminalReason()}\nNothing was installed. Run 'riglane add ${target}' from a terminal.\n`
          : `add: confirmation did not match '${entry.id}'. Nothing was installed.\n`,
      );
      return 1;
    }

    mkdirSync(paths.communityDir, { recursive: true });
    cpSync(workflowDir, installDir, {
      recursive: true,
      filter: (src) => !src.split(sep).includes('.git'),
    });
    writeFileSync(join(installDir, 'entry.yaml'), serializeEntryProvenance(entry), 'utf-8');
    writeFileSync(join(installDir, 'entry.lock.yaml'), normalizeLockEol(lockText), 'utf-8');

    process.stdout.write(
      `Installed '${entry.id}' to ${installDir} — SWITCHED OFF.\n` +
        `Enable it deliberately: riglane trust ${entry.id}\n`,
    );
    if (inv.script_tools.length > 0) {
      process.stdout.write(
        `Note: it declares script tools — after trusting, run 'riglane init-workflow ${entry.id}' ` +
          `and RESTART your host so the tools become visible.\n`,
      );
    }
    return 0;
  } finally {
    rmSync(cloneDir, { recursive: true, force: true });
  }
}


function readLocalEntry(dir: string): PerEntryDocument {
  const entry = readEntryFile(join(dir, 'entry.yaml'));
  const lockPath = join(dir, 'entry.lock.yaml');
  if (!existsSync(lockPath)) {
    throw new EntryError(
      `${dir} has entry.yaml but no entry.lock.yaml — generate it with 'riglane catalog pack' first; ` +
        `the lock is the verified surface, installation without one is not supported.`,
    );
  }
  return { entry, lockText: readFileSync(lockPath, 'utf-8') };
}

async function fetchCatalogEntry(id: string, deps: AddCliDeps): Promise<PerEntryDocument | null> {
  const base = catalogBaseUrl();
  const fetchJson = deps.fetchJson ?? defaultFetchJson;

  const revokedRaw = await fetchJson(catalogRevokedUrl(base));
  if (revokedRaw !== null) {
    const verdict = isRevoked(validateRevokedList(revokedRaw), id);
    if (verdict.revoked) {
      process.stderr.write(
        `add: '${id}' has been REVOKED by the catalog${verdict.reason ? ` — ${verdict.reason}` : ''}.\n` +
          `Nothing was installed.\n`,
      );
      return null;
    }
  }

  const raw = await fetchJson(catalogEntryUrl(base, id));
  if (raw === null) {
    process.stderr.write(
      `add: no catalog entry '${id}' at ${base} — check the id (riglane search), ` +
        `or pass a local entry directory instead.\n`,
    );
    return null;
  }
  return validatePerEntryDocument(raw, id);
}

async function defaultFetchJson(url: string): Promise<unknown | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new EntryError(`cannot reach the catalog at ${url}: ${msg}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new EntryError(`catalog request failed: ${url} → HTTP ${res.status}`);
  return (await res.json()) as unknown;
}


export function printInspectScreen(
  entry: CatalogEntry,
  inv: ReturnType<typeof buildWorkflowInventory>,
  workflow: Workflow,
  installDir: string,
): void {
  const w = (line: string): boolean => process.stdout.write(`${line}\n`);
  const meta = entry.meta as { summary?: unknown; author?: unknown; license?: unknown };
  w('');
  w(`── ${entry.id} ─ pre-install inspection ──`);
  if (typeof meta.summary === 'string') w(`  ${meta.summary}`);
  const byline = [
    typeof meta.author === 'string' ? `author: ${meta.author}` : null,
    typeof meta.license === 'string' ? `license: ${meta.license}` : null,
  ].filter((x) => x !== null);
  if (byline.length > 0) w(`  ${byline.join(' · ')}`);
  w('');
  w(`  Source:  ${entry.source.repo}`);
  w(`  Pinned:  ${entry.source.sha}  (installs stay on this commit; later pushes do not follow)`);
  if (entry.source.path !== '') w(`  Path:    ${entry.source.path}`);
  w(`  Target:  ${installDir}`);
  w('');
  if (inv.script_tools.length === 0 && inv.deciders.length === 0) {
    w('  Shell commands: NONE declared (no script tools, no decider scripts).');
  } else {
    w('  These commands WILL RUN on your machine, in your project:');
    for (const t of inv.script_tools) w(`    [tools.${t.name}]  ${t.command}`);
    for (const d of inv.deciders) w(`    [${d.field} @ ${d.at}]  ${d.command}`);
  }
  const executables = inv.bundled_files.filter((b) => b.role === 'script' || b.role === 'mcp-server');
  if (executables.length > 0) {
    w(`  Bundled executable files:`);
    for (const b of executables) {
      const label = b.role === 'mcp-server' ? 'MCP server' : b.language ?? 'script';
      w(`    ${b.path}  (${label}, ${b.bytes} bytes, sha256 ${b.sha256.slice(0, 12)}…)`);
    }
  }
  if (inv.mcp_dependencies.length > 0) {
    w(`  External MCP dependencies: ${inv.mcp_dependencies.map((m) => `${m.name}${m.required ? '' : ' (optional)'}`).join(', ')}`);
  }
  const egress = inv.capabilities.flags.filter((f) => f.where === INBOX_WEBHOOK_WHERE);
  for (const f of egress) {
    w('  This workflow SENDS ITS MESSAGES OFF YOUR MACHINE:');
    w(`    every message it posts — questions it asks you and notices it emits,`);
    w(`    with this run's id and a reply token — is POSTed to ${f.match}`);
    w('    (declared by the author; override it per run with --inbox-webhook)');
  }
  const narrowed = inv.steps.items.filter((it) => Array.isArray(it.deny) && it.deny.length > 0);
  if (narrowed.length > 0) {
    w('  Steps that RENOUNCE part of the native surface (deny):');
    for (const it of narrowed) w(`    ${it.name}: no ${(it.deny ?? []).join(', no ')}`);
  }
  const patternFlags = inv.capabilities.flags.filter((f) => f.where !== INBOX_WEBHOOK_WHERE);
  if (patternFlags.length > 0) {
    w('  Capability signals (pattern hits — absence of a flag is NOT a guarantee):');
    for (const f of patternFlags) w(`    ${f.flag}: '${f.match}' in ${f.where}`);
  }
  w(`  Params: ${inv.params.map((p) => p.name).join(', ') || 'none'}`);
  w('');
  w(`  Steps (${inv.steps.count}) and their goals — prose reaches a subagent holding tools here:`);
  const steps = ((workflow as { steps?: unknown }).steps ?? []) as Array<Record<string, unknown>>;
  printStepGoals(steps, w, '    ');
  w('');
  w('  It installs SWITCHED OFF; nothing runs before riglane trust.');
  w('');
}

function printStepGoals(
  steps: ReadonlyArray<Record<string, unknown>>,
  w: (line: string) => boolean,
  indent: string,
): void {
  for (const s of steps) {
    const name = String(s.name ?? '');
    const goal = typeof s.goal === 'string' ? s.goal.trim() : '(no goal — delegation/planning step)';
    const goalLines = goal.split('\n');
    w(`${indent}${name}:`);
    for (const line of goalLines) w(`${indent}  ${line}`);
    const routes = s.routes as { define?: Array<{ steps?: Array<Record<string, unknown>> }> } | undefined;
    if (routes?.define) {
      for (const r of routes.define) printStepGoals(r.steps ?? [], w, `${indent}  `);
    }
    const lanes = s.lanes as { define?: Array<{ steps?: Array<Record<string, unknown>> }> } | undefined;
    if (lanes?.define) {
      for (const l of lanes.define) printStepGoals(l.steps ?? [], w, `${indent}  `);
    }
  }
}

function serializeEntryProvenance(entry: CatalogEntry): string {
  const lines = [
    `# Written by \`riglane add\` — provenance of this installed workflow.`,
    `id: ${entry.id}`,
    `source:`,
    `  repo: ${JSON.stringify(entry.source.repo)}`,
    `  path: ${JSON.stringify(entry.source.path)}`,
    `  sha: ${entry.source.sha}`,
  ];
  return `${lines.join('\n')}\n`;
}
