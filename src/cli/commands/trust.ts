
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { confirmByTypingId, confirmationPrompt, noTerminalReason } from '../_confirm.js';
import { InventoryError, buildWorkflowInventory } from '../../catalog/inventory.js';
import { TrustDigestError, computeTreeDigest, writeTrustEntry } from '../../catalog/trust.js';
import { loadYaml } from '../../engine/schema-validate.js';
import { defaultPaths } from '../../engine/workflow-engine.js';
import type { Workflow } from '../../types/workflow.js';

const USAGE = 'Usage: riglane trust <workflow-id>\n';

export interface TrustCliDeps {
  readonly prompt?: (question: string) => Promise<string>;
  readonly cwd?: string;
}

export async function runTrustCli(argv: readonly string[], deps: TrustCliDeps = {}): Promise<number> {
  const positionals = argv.filter((a) => !a.startsWith('--'));
  const flags = argv.filter((a) => a.startsWith('--'));
  if (flags.length > 0) {
    process.stderr.write(`trust: unknown option '${flags[0]}'\n${USAGE}`);
    return 2;
  }
  const id = positionals[0];
  if (id === undefined || positionals.length > 1) {
    process.stderr.write(USAGE);
    return 2;
  }

  const paths = defaultPaths(deps.cwd);
  const workflowDir = join(paths.communityDir, id);
  const yamlPath = join(workflowDir, 'workflow.yaml');
  if (!existsSync(yamlPath)) {
    process.stderr.write(
      `trust: no community workflow '${id}' — expected ${yamlPath}\n` +
        `Community workflows are installed from the catalog into ` +
        `.riglane/workflows/templates/community/.\n`,
    );
    return 2;
  }

  let workflow: Workflow;
  try {
    workflow = loadYaml<Workflow>(yamlPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`trust: cannot read '${id}' — YAML parse error: ${msg}\nNothing was trusted.\n`);
    return 1;
  }

  let digest: string;
  try {
    digest = computeTreeDigest(workflowDir);
    const inv = buildWorkflowInventory(workflowDir, workflow);
    printSurface(id, inv);
  } catch (e) {
    if (e instanceof TrustDigestError || e instanceof InventoryError) {
      process.stderr.write(`trust: ${e.message}\nNothing was trusted.\n`);
      return 1;
    }
    throw e;
  }

  const confirmed = await confirmByTypingId(
    id,
    confirmationPrompt(id, 'trust it'),
    deps.prompt,
  );
  if (!confirmed.ok) {
    process.stderr.write(
      confirmed.reason === 'no-terminal'
        ? `trust: ${noTerminalReason()}\nNothing was trusted. Run 'riglane trust ${id}' from a terminal.\n`
        : `trust: confirmation did not match '${id}'. Nothing was trusted.\n`,
    );
    return 1;
  }

  const entry = writeTrustEntry(paths.agentDir, id, digest);
  process.stdout.write(
    `Trusted '${id}' at ${entry.trusted_at} (content digest ${digest.slice(0, 12)}…).\n` +
      `Any change to the installed files switches it off again until re-trusted.\n`,
  );
  return 0;
}


function printSurface(id: string, inv: ReturnType<typeof buildWorkflowInventory>): void {
  const w = (line: string): boolean => process.stdout.write(`${line}\n`);
  w(`About to trust community workflow '${id}' — this is what it can execute:`);
  w('');
  if (inv.script_tools.length === 0 && inv.deciders.length === 0) {
    w('  Shell commands: NONE declared (no script tools, no decider scripts).');
  } else {
    if (inv.script_tools.length > 0) {
      w(`  Script tools (${inv.script_tools.length}) — commands run verbatim from the project root:`);
      for (const t of inv.script_tools) w(`    [tools.${t.name}]  ${t.command}`);
    }
    if (inv.deciders.length > 0) {
      w(`  Decider scripts (${inv.deciders.length}) — the engine executes these itself:`);
      for (const d of inv.deciders) w(`    [${d.field} @ ${d.at}]  ${d.command}`);
    }
  }
  if (inv.mcp_dependencies.length > 0) {
    w(`  External MCP dependencies: ${inv.mcp_dependencies.map((m) => m.name).join(', ')}`);
  }
  const scripts = inv.bundled_files.filter((b) => b.role === 'script' || b.role === 'mcp-server');
  if (scripts.length > 0) {
    w(`  Bundled executable files (${scripts.length}):`);
    for (const b of scripts) w(`    ${b.path}  (${b.bytes} bytes, sha256 ${b.sha256.slice(0, 12)}…)`);
  }
  if (inv.capabilities.flags.length > 0) {
    w(`  Capability signals (pattern hits — absence of a flag is NOT a guarantee):`);
    for (const f of inv.capabilities.flags) w(`    ${f.flag}: '${f.match}' in ${f.where}`);
  }
  w(`  Steps: ${inv.steps.count} · params: ${inv.params.map((p) => p.name).join(', ') || 'none'}`);
  w('');
  w('  Step goals are part of the surface too — prose reaches a subagent that');
  w('  has tools in this project. Review the workflow.yaml if in doubt.');
  w('');
}
