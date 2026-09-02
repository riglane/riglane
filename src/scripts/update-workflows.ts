
import type { Dirent } from 'node:fs';
import { existsSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { parse as parseYamlString } from 'yaml';

import { PRODUCT_DIR } from '../config/paths.js';
import {
  CLAUDE_AGENTS_DIR,
  GENERATED_MARKER,
  type InitWorkflowOptions,
  agentFileHostLabels,
  initWorkflow,
} from './init-workflow.js';


export interface UpdateWorkflowsOptions {
  readonly dryRun?: boolean;
  readonly cwd?: string;
  readonly stdout?: (s: string) => void;
  readonly stderr?: (s: string) => void;
}

interface ResolvedOptions {
  readonly dryRun: boolean;
  readonly cwd: string;
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
}

function resolveOpts(opts: UpdateWorkflowsOptions = {}): ResolvedOptions {
  return {
    dryRun: opts.dryRun ?? false,
    cwd: opts.cwd ?? '.',
    stdout: opts.stdout ?? ((s: string) => void process.stdout.write(s)),
    stderr: opts.stderr ?? ((s: string) => void process.stderr.write(s)),
  };
}


export function findAllWorkflows(opts: UpdateWorkflowsOptions = {}): [string[], string[]] {
  const r = resolveOpts(opts);
  const templatesRoot = join(r.cwd, PRODUCT_DIR, 'workflows', 'templates');
  const paths = findWorkflowYamlsRecursive(templatesRoot).sort();
  const names = paths.map((p) => basename(dirname(p)));
  return [names, paths];
}

function findWorkflowYamlsRecursive(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root) || !statSync(root).isDirectory()) return out;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name === 'workflow.yaml') {
        out.push(full);
      }
    }
  }
  return out;
}


export function findGlobalOrphans(
  knownWorkflowNames: readonly string[],
  opts: UpdateWorkflowsOptions = {},
): string[] {
  const r = resolveOpts(opts);
  const agentsDir = join(r.cwd, CLAUDE_AGENTS_DIR);
  if (!existsSync(agentsDir) || !statSync(agentsDir).isDirectory()) return [];

  const knownSet = new Set(knownWorkflowNames);
  const orphans: string[] = [];

  const entries = readdirSync(agentsDir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(agentsDir, entry.name);
    const agentMd = join(fullPath, 'AGENT.md');
    if (!existsSync(agentMd) || !statSync(agentMd).isFile()) continue;

    let content: string;
    try {
      content = readFileSync(agentMd, 'utf-8');
    } catch {
      continue;
    }
    if (!content.includes(GENERATED_MARKER)) continue;

    const parts = entry.name.split('-');
    let matched = false;
    for (let splitAt = parts.length - 1; splitAt > 0; splitAt -= 1) {
      const candidateWf = parts.slice(0, splitAt).join('-');
      if (knownSet.has(candidateWf)) {
        matched = true;
        break;
      }
    }
    if (!matched) orphans.push(entry.name);
  }
  return orphans;
}

export function deleteGlobalOrphan(name: string, opts: UpdateWorkflowsOptions = {}): void {
  const r = resolveOpts(opts);
  const fullPath = join(r.cwd, CLAUDE_AGENTS_DIR, name);
  const agentMd = join(fullPath, 'AGENT.md');
  if (r.dryRun) return;
  try {
    if (existsSync(agentMd) && statSync(agentMd).isFile()) {
      unlinkSync(agentMd);
    }
    rmdirSync(fullPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    r.stderr(`Failed to delete ${fullPath}: ${msg}\n`);
  }
}


function parsePlanningStepNames(workflowYamlPath: string): string[] {
  let text: string;
  try {
    text = readFileSync(workflowYamlPath, 'utf-8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = parseYamlString(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const steps = (parsed as { steps?: unknown[] }).steps;
  if (!Array.isArray(steps)) return [];
  const names: string[] = [];
  for (const s of steps) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    const obj = s as { type?: unknown; name?: unknown };
    if (obj.type === 'planning' && typeof obj.name === 'string' && obj.name.length > 0) {
      names.push(obj.name);
    }
  }
  return names;
}

export interface Phase61OrphanReport {
  readonly orphanNotesDirs: readonly string[];
  readonly orphanDynamicByMissingWorkflow: readonly string[];
  readonly orphanDynamicByMissingStep: readonly string[];
}

export function findPhase61Orphans(
  opts: UpdateWorkflowsOptions = {},
): Phase61OrphanReport {
  const r = resolveOpts(opts);
  const [workflowNames, workflowPaths] = findAllWorkflows(opts);

  const planningByWorkflow = new Map<string, Set<string>>();
  const allPlanningSteps = new Set<string>();
  for (let i = 0; i < workflowPaths.length; i += 1) {
    const wf = workflowNames[i] ?? '';
    const wfPath = workflowPaths[i] ?? '';
    if (!wf || !wfPath) continue;
    const stepNames = parsePlanningStepNames(wfPath);
    planningByWorkflow.set(wf, new Set(stepNames));
    for (const n of stepNames) allPlanningSteps.add(n);
  }
  const activeWorkflows = new Set(workflowNames);

  const agentDir = join(r.cwd, PRODUCT_DIR);

  const notesRoot = join(agentDir, 'agent_notes');
  const orphanNotesDirs: string[] = [];
  if (existsSync(notesRoot) && statSync(notesRoot).isDirectory()) {
    let entries: Dirent[];
    try {
      entries = readdirSync(notesRoot, { withFileTypes: true }) as Dirent[];
    } catch {
      entries = [];
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (!allPlanningSteps.has(ent.name)) {
        orphanNotesDirs.push(join(notesRoot, ent.name));
      }
    }
  }

  const runsRoot = join(agentDir, 'local', 'workflow_runs');
  const orphanDynamicByMissingWorkflow: string[] = [];
  const orphanDynamicByMissingStep: string[] = [];
  if (existsSync(runsRoot) && statSync(runsRoot).isDirectory()) {
    let runDirs: Dirent[];
    try {
      runDirs = readdirSync(runsRoot, { withFileTypes: true }) as Dirent[];
    } catch {
      runDirs = [];
    }
    for (const runEnt of runDirs) {
      if (!runEnt.isDirectory()) continue;
      const dynamicPath = join(runsRoot, runEnt.name, 'dynamic');
      if (!existsSync(dynamicPath)) continue;
      let stepDirs: Dirent[];
      try {
        stepDirs = readdirSync(dynamicPath, { withFileTypes: true }) as Dirent[];
      } catch {
        continue;
      }
      let wfName = '';
      try {
        const m = JSON.parse(
          readFileSync(join(runsRoot, runEnt.name, 'manifest.json'), 'utf-8'),
        ) as { workflow?: string };
        wfName = typeof m.workflow === 'string' ? m.workflow : '';
      } catch {
        wfName = '';
      }
      if (!wfName || !activeWorkflows.has(wfName)) {
        for (const stepEnt of stepDirs) {
          if (stepEnt.isDirectory()) {
            orphanDynamicByMissingWorkflow.push(join(dynamicPath, stepEnt.name));
          }
        }
        continue;
      }
      const activePlanningInWf = planningByWorkflow.get(wfName) ?? new Set<string>();
      for (const stepEnt of stepDirs) {
        if (!stepEnt.isDirectory()) continue;
        if (!activePlanningInWf.has(stepEnt.name)) {
          orphanDynamicByMissingStep.push(join(dynamicPath, stepEnt.name));
        }
      }
    }
  }

  orphanNotesDirs.sort();
  orphanDynamicByMissingWorkflow.sort();
  orphanDynamicByMissingStep.sort();

  return { orphanNotesDirs, orphanDynamicByMissingWorkflow, orphanDynamicByMissingStep };
}

export function renderPhase61OrphanReport(
  report: Phase61OrphanReport,
  opts: UpdateWorkflowsOptions = {},
): void {
  const r = resolveOpts(opts);
  const total =
    report.orphanNotesDirs.length +
    report.orphanDynamicByMissingWorkflow.length +
    report.orphanDynamicByMissingStep.length;
  if (total === 0) return;

  r.stdout('\n');
  r.stdout('Phase 61 orphan check (planning step state outside templates):\n');

  if (report.orphanNotesDirs.length > 0) {
    r.stdout(
      `  agent_notes/ dirs for step templates not in any active workflow ` +
        `(${report.orphanNotesDirs.length}):\n`,
    );
    for (const p of report.orphanNotesDirs) r.stdout(`    ${p}\n`);
  }
  if (report.orphanDynamicByMissingWorkflow.length > 0) {
    r.stdout(
      `  dynamic/ subtrees for workflows that no longer exist ` +
        `(${report.orphanDynamicByMissingWorkflow.length}):\n`,
    );
    for (const p of report.orphanDynamicByMissingWorkflow) r.stdout(`    ${p}\n`);
  }
  if (report.orphanDynamicByMissingStep.length > 0) {
    r.stdout(
      `  dynamic/ run dirs for steps no longer marked 'type: planning' ` +
        `(${report.orphanDynamicByMissingStep.length}):\n`,
    );
    for (const p of report.orphanDynamicByMissingStep) r.stdout(`    ${p}\n`);
  }

  r.stdout(
    '\n' +
      '  No automatic cleanup performed. If a step was renamed and you want to\n' +
      "  carry over the notes/runs, copy the orphan dir to the new step's path.\n" +
      '  Otherwise, manually delete the orphan dirs after reviewing their contents.\n',
  );
}


export interface UpdateWorkflowsResult {
  totals: { created: number; updated: number; unchanged: number; deleted: number };
  failed: Array<[string, string]>;
  anyChanges: boolean;
}

export async function updateWorkflows(
  opts: UpdateWorkflowsOptions = {},
): Promise<UpdateWorkflowsResult> {
  const r = resolveOpts(opts);
  const initOpts: InitWorkflowOptions = {
    dryRun: r.dryRun,
    cwd: r.cwd,
    stdout: r.stdout,
    stderr: r.stderr,
  };

  const [names] = findAllWorkflows(opts);
  if (names.length === 0) {
    r.stdout(`No workflows found in ${PRODUCT_DIR}/workflows/templates/\n`);
    return {
      totals: { created: 0, updated: 0, unchanged: 0, deleted: 0 },
      failed: [],
      anyChanges: false,
    };
  }

  r.stdout(`Found ${names.length} workflow(s) to sync\n`);
  r.stdout('\n');

  const totals = { created: 0, updated: 0, unchanged: 0, deleted: 0 };
  const failed: Array<[string, string]> = [];
  let anyChanges = false;

  for (const name of names) {
    try {
      const result = await initWorkflow(name, initOpts);
      totals.created += result.created.length;
      totals.updated += result.updated.length;
      totals.unchanged += result.unchanged.length;
      totals.deleted += result.deleted.length;
      if (result.total > 0) anyChanges = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push([name, msg]);
    }
    r.stdout('\n');
  }

  const globalOrphans = findGlobalOrphans(names, opts);
  if (globalOrphans.length > 0) {
    r.stdout('\n');
    r.stdout('Global orphan cleanup (workflows fully removed):\n');
    for (const orphan of globalOrphans) {
      deleteGlobalOrphan(orphan, opts);
      totals.deleted += 1;
      anyChanges = true;
      r.stdout(`  DELETED  ${orphan} (orphan — workflow no longer exists)\n`);
    }
  }

  const phase61Orphans = findPhase61Orphans(opts);
  renderPhase61OrphanReport(phase61Orphans, opts);

  r.stdout('\n');
  r.stdout(`${'='.repeat(60)}\n`);
  r.stdout(
    `Global summary: ${totals.created} created, ${totals.updated} updated, ` +
      `${totals.unchanged} unchanged, ${totals.deleted} deleted\n`,
  );

  if (failed.length > 0) {
    r.stdout('\n');
    r.stdout(`FAILED workflows (${failed.length}):\n`);
    for (const [name, err] of failed) {
      r.stdout(`  - ${name}: ${err}\n`);
    }
  }

  if (anyChanges) {
    const hosts = agentFileHostLabels(r.cwd);
    r.stdout('\n');
    r.stdout(
      hosts.length > 0
        ? `[!] Restart ${hosts.join(' / ')} to load the new/updated subagents.\n`
        : `[!] Restart your agent host to load the new/updated subagents.\n`,
    );
  }

  return { totals, failed, anyChanges };
}

export async function runUpdateWorkflowsCli(
  argv: string[] = process.argv.slice(2),
  opts: UpdateWorkflowsOptions = {},
): Promise<number> {
  const r = resolveOpts(opts);
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: argv,
      options: { 'dry-run': { type: 'boolean' as const } },
      allowPositionals: true,
      strict: true,
    }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  } catch (e) {
    r.stderr(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  if (parsed.positionals.length > 0) {
    r.stderr(`update-workflows: unrecognized arguments: ${parsed.positionals.join(' ')}\n`);
    return 2;
  }

  const dryRun = Boolean(parsed.values['dry-run']);
  const result = await updateWorkflows({ ...opts, dryRun });
  return result.failed.length > 0 ? 1 : 0;
}
