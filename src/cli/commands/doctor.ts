
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { PRODUCT_DIR } from '../../config/paths.js';
import { GENERIC_SCOPE, ensureScopeDir, getAvailableScopes } from '../../scope/scope-context.js';
import { auditRelatedSpecRefsOnDisk, reconcileSpecIndexOnDisk, reconcileSpecRegistryOnDisk } from '../../engine/spec-tools.js';
import { templatesRoot } from '../templates.js';
import { VERSION } from '../version.js';
import { writeRiglaneVersion } from './init.js';
import { computeTemplatesHash } from '../../registry/templateHash.js';
import { ADAPTERS, mcpConfigProbe } from '../../adapters/index.js';
import { checkCodexHookTrust, codexHomeDir, upsertCodexHookTrust } from '../codex-hook-trust.js';
import { ackGeminiAgents, checkGeminiAgentAcks } from '../gemini-agent-ack.js';
import { probeWorkflowEngineMcp } from '../mcpProbe.js';
import { readEngineClientSidecar, recordedElicitation } from '../../engine/host-context.js';

export interface DoctorOptions {
  readonly templatesRoot?: string;
  readonly fix?: boolean;
}


function check(label: string, ok: boolean, detail = ''): boolean {
  const mark = ok ? 'OK  ' : 'WARN';
  const sep = detail ? ' - ' : '';
  process.stdout.write(`  [${mark}] ${label}${sep}${detail}\n`);
  return ok;
}


export async function runDoctor(target: string, opts: DoctorOptions = {}): Promise<number> {
  const absTarget = resolve(target);
  process.stdout.write(`riglane doctor: ${absTarget}\n`);
  process.stdout.write('\n');

  let allOk = true;

  process.stdout.write('Package\n');
  const tplRoot = opts.templatesRoot ?? templatesRoot();
  check(`riglane ${VERSION}`, true, `templates at ${tplRoot}`);

  allOk = check('yaml (TS: hard dep in package.json)', true, '') && allOk;

  check('ajv (TS: hard dep, replaces jsonschema)', true, '');

  process.stdout.write('\n');

  process.stdout.write('Target project\n');
  if (!isDir(absTarget)) {
    allOk = check('target directory exists', false, `not a directory: ${absTarget}`) && allOk;
    return allOk ? 0 : 1;
  }

  const versionMarker = join(absTarget, PRODUCT_DIR, '.riglane-version');
  if (isFile(versionMarker)) {
    let raw = '';
    try {
      raw = readFileSync(versionMarker, 'utf-8').trim();
    } catch {
      raw = '';
    }
    const installedHash = computeTemplatesHash();
    let parsed: { installedBy?: string; templateHash?: string } | null = null;
    if (raw.startsWith('{')) {
      try {
        parsed = JSON.parse(raw) as { installedBy?: string; templateHash?: string };
      } catch {
        parsed = null;
      }
    }
    if (parsed && typeof parsed.templateHash === 'string') {
      if (parsed.templateHash === installedHash) {
        check(
          '.riglane/.riglane-version templates match installed',
          true,
          `installedBy=${parsed.installedBy ?? '?'} hash=${parsed.templateHash.slice(0, 12)}`,
        );
      } else {
        allOk =
          check(
            '.riglane/.riglane-version drift detected',
            false,
            `project hash=${parsed.templateHash.slice(0, 12)}, installed hash=${installedHash.slice(0, 12)} — run \`riglane update\``,
          ) && allOk;
      }
    } else {
      allOk =
        check(
          '.riglane/.riglane-version legacy format (plain-string marker)',
          false,
          `marker=${raw.slice(0, 32) || '?'} — run \`riglane update\` to migrate to hash-based format`,
        ) && allOk;
    }
  } else {
    process.stdout.write(
      '  [INFO] .riglane/.riglane-version absent (legacy or pre-Phase-55 install — run `riglane update` to add)\n',
    );
  }

  const workflowsDir = join(absTarget, PRODUCT_DIR, 'workflows');
  allOk =
    check(
      '.riglane/workflows/ present',
      isDir(workflowsDir),
      isDir(workflowsDir) ? '' : 'run `riglane init` to bootstrap',
    ) && allOk;

  const legacyOrphans = findLegacyRuntimeOrphans(workflowsDir);
  if (legacyOrphans.length > 0) {
    process.stdout.write(
      `  [INFO] ${legacyOrphans.length} legacy runtime dir(s) under .riglane/workflows/ ` +
        `(pre-per-run layout) — harmless orphans; runtime now lives in .riglane/local/workflow_runs/<run_id>/. ` +
        'Run `riglane doctor --fix` to prune.\n',
    );
  }

  const specsGeneric = join(absTarget, PRODUCT_DIR, 'specs', 'generic');
  check(
    '.riglane/specs/generic/ present',
    isDir(specsGeneric),
    isDir(specsGeneric) ? '' : 'run `riglane init` to bootstrap',
  );

  const mcpCandidates = Object.values(ADAPTERS).map((d) => {
    const probe = mcpConfigProbe(d);
    return { label: probe.path, path: join(absTarget, probe.path), kind: probe.kind };
  });
  for (const { label, path, kind } of mcpCandidates) {
    if (!isFile(path)) continue;
    let text = '';
    try {
      text = readFileSync(path, 'utf-8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      allOk = check(`${label} is readable`, false, msg) && allOk;
      continue;
    }
    const probe = probeWorkflowEngineMcp(text, kind);
    if (probe.parseError) {
      allOk = check(`${label} is valid ${kind.toUpperCase()}`, false, probe.detail) && allOk;
      continue;
    }
    allOk = check(`${label} workflow_engine -> riglane mcp-server`, probe.ok, probe.detail) && allOk;
  }
  process.stdout.write('\n');

  let codexTrustFixNeeded = false;
  const codexProjectConfig = join(absTarget, '.codex', 'config.toml');
  if (isFile(codexProjectConfig)) {
    process.stdout.write('Codex hook trust\n');
    try {
      const { checks, entries } = checkCodexHookTrust(codexProjectConfig);
      if (checks === null) {
        allOk =
          check(
            'global codex config.toml readable',
            false,
            `${join(codexHomeDir(), 'config.toml')} is malformed — hooks stay untrusted until fixed`,
          ) && allOk;
      } else if (entries.length === 0) {
        check('riglane hooks in .codex/config.toml', true, 'none found — nothing to trust');
      } else {
        for (const { entry, status } of checks) {
          const ok = status === 'trusted';
          allOk =
            check(
              `hook trusted: ${entry.command}`,
              ok,
              ok
                ? ''
                : status === 'untrusted'
                  ? 'no trust entry — Codex silently skips this hook; run --fix or `riglane update`'
                  : 'trust hash mismatch (command changed or formula drift) — run --fix or `riglane update`',
            ) && allOk;
          if (!ok) codexTrustFixNeeded = true;
        }
      }
    } catch (e) {
      allOk =
        check('codex hook trust checkable', false, e instanceof Error ? e.message : String(e)) &&
        allOk;
    }
    process.stdout.write('\n');
  }

  let ocPluginFixNeeded = false;
  const ocConfigPath = join(absTarget, '.opencode', 'opencode.json');
  if (isFile(ocConfigPath)) {
    process.stdout.write('OpenCode plugin\n');
    const installedPluginPath = join(absTarget, '.opencode', 'plugins', 'riglane-hooks.ts');
    const packagedPluginPath = join(tplRoot, 'opencode', 'plugins', 'riglane-hooks.ts');
    if (!isFile(installedPluginPath)) {
      ocPluginFixNeeded = true;
      allOk =
        check(
          '.opencode/plugins/riglane-hooks.ts present',
          false,
          'missing — gate/ledger/file-guard hooks will NOT fire; run --fix or `riglane update`, then restart OpenCode',
        ) && allOk;
    } else if (isFile(packagedPluginPath)) {
      let same = false;
      try {
        same =
          readFileSync(installedPluginPath, 'utf-8') === readFileSync(packagedPluginPath, 'utf-8');
      } catch {
        same = false;
      }
      if (!same) ocPluginFixNeeded = true;
      allOk =
        check(
          '.opencode/plugins/riglane-hooks.ts up to date',
          same,
          same ? '' : 'differs from the packaged shim — run --fix or `riglane update`, then restart OpenCode',
        ) && allOk;
    }
    process.stdout.write('\n');
  }

  let copilotHooksFixNeeded = false;
  const copilotHooksPath = join(absTarget, '.github', 'hooks', 'riglane.json');
  const copilotPackagedHooksPath = join(tplRoot, 'copilot', 'hooks', 'riglane.json');
  const copilotInstalled =
    isFile(copilotHooksPath) || isFile(join(absTarget, '.github', 'mcp.json'));
  if (isFile(copilotHooksPath)) {
    process.stdout.write('Copilot hooks\n');
    if (isFile(copilotPackagedHooksPath)) {
      let same = false;
      try {
        same =
          readFileSync(copilotHooksPath, 'utf-8') ===
          readFileSync(copilotPackagedHooksPath, 'utf-8');
      } catch {
        same = false;
      }
      if (!same) copilotHooksFixNeeded = true;
      allOk =
        check(
          '.github/hooks/riglane.json up to date',
          same,
          same
            ? ''
            : 'differs from the packaged hooks config — run --fix or `riglane update`, then restart the Copilot session',
        ) && allOk;
    }
    process.stdout.write('\n');
  } else if (copilotInstalled) {
    process.stdout.write('Copilot hooks\n');
    copilotHooksFixNeeded = true;
    allOk =
      check(
        '.github/hooks/riglane.json present',
        false,
        'missing — gate/ledger/file-guard hooks will NOT fire; run --fix or `riglane update`, then restart the Copilot session',
      ) && allOk;
    process.stdout.write('\n');
  }

  let geminiAgentAckFixNeeded = false;
  const geminiSettingsPath = join(absTarget, '.gemini', 'settings.json');
  const geminiAgentsMarker = join(absTarget, '.gemini', 'agents', 'riglane-workflow-step.md');
  let geminiHooksPresent = false;
  if (isFile(geminiSettingsPath)) {
    try {
      const raw = readFileSync(geminiSettingsPath, 'utf-8');
      geminiHooksPresent =
        raw.includes('riglane gate-check --host gemini') &&
        raw.includes('riglane file-guard --host gemini') &&
        raw.includes('riglane tool-call-logger --host gemini');
    } catch {
      geminiHooksPresent = false;
    }
  }
  const geminiInstalled = isFile(geminiAgentsMarker) || geminiHooksPresent;
  if (geminiInstalled) {
    process.stdout.write('Gemini adapter\n');
    allOk =
      check(
        '.gemini/settings.json carries the riglane hooks',
        geminiHooksPresent,
        geminiHooksPresent
          ? ''
          : 'gate/veto/ledger hook commands missing from the merged settings — run `riglane update --gemini`, then restart the Gemini session',
      ) && allOk;
    const driftedAgents = checkGeminiAgentAcks(absTarget);
    if (driftedAgents.length > 0) geminiAgentAckFixNeeded = true;
    allOk =
      check(
        'gemini agents acknowledged (headless consent)',
        driftedAgents.length === 0,
        driftedAgents.length === 0
          ? ''
          : `${driftedAgents.length} un-acknowledged/stale agent(s): ${driftedAgents.join(', ')} — ` +
            `these are SILENTLY absent in headless runs; run --fix or \`riglane init-workflow <workflow>\``,
      ) && allOk;
    process.stdout.write(
      '  [INFO] If Gemini silently ignores project hooks/MCP/commands, check folder trust ' +
        '(~/.gemini/trustedFolders.json) — an untrusted folder loads NO project settings; ' +
        'headless runs exit 55.\n',
    );
    process.stdout.write('\n');
  }

  {
    process.stdout.write('Harness\n');
    const rec = readEngineClientSidecar(absTarget);
    const elicit = recordedElicitation(rec);
    if (rec === null) {
      process.stdout.write(
        '  [INFO] no handshake recorded yet — open this project in your harness once ' +
          '(any engine call records it), then re-run doctor\n',
      );
    } else {
      const who = `${rec.host ?? rec.name}${rec.version ? ` ${rec.version}` : ''}`;
      if (elicit === true) {
        process.stdout.write(
          `  [OK  ] ${who} — native question dialog: yes (declares MCP elicitation)\n`,
        );
      } else if (elicit === false) {
        process.stdout.write(
          `  [INFO] ${who} — native question dialog: no; a human-gate question is relayed by the agent in its reply instead\n`,
        );
      } else {
        process.stdout.write(
          `  [INFO] ${who} — native question dialog: unknown (this record predates capability capture; reconnect the harness to refresh it)\n`,
        );
      }
    }
    process.stdout.write('\n');
  }

  const driftedScopes: string[] = [];
  const specsRoot = join(absTarget, PRODUCT_DIR, 'specs');
  if (isDir(specsRoot)) {
    process.stdout.write('Spec index\n');
    for (const sc of getAvailableScopes(absTarget).map((s) => s.id)) {
      try {
        const { changes } = reconcileSpecIndexOnDisk(sc, absTarget, { write: false });
        const n = changes.added.length + changes.removed.length + changes.modified.length;
        allOk =
          check(
            `scope '${sc}' _index.json matches .md files`,
            n === 0,
            n === 0
              ? ''
              : `${n} drift(s): ${changes.added.length} missing, ${changes.removed.length} stale, ${changes.modified.length} altered — run --fix`,
          ) && allOk;
        if (n > 0) driftedScopes.push(sc);
      } catch (e) {
        allOk =
          check(`scope '${sc}' _index.json checkable`, false, e instanceof Error ? e.message : String(e)) &&
          allOk;
      }
    }
    process.stdout.write('\n');
  }

  const registryDriftedScopes: string[] = [];
  if (isDir(specsRoot)) {
    process.stdout.write('Spec registry\n');
    for (const sc of getAvailableScopes(absTarget).map((s) => s.id)) {
      try {
        const { changes } = reconcileSpecRegistryOnDisk(sc, absTarget, { write: false });
        const orphaned = changes.removedMappings.length;
        allOk =
          check(
            `scope '${sc}' _registry.json mappings all point to live specs`,
            orphaned === 0,
            orphaned === 0
              ? ''
              : `${orphaned} orphaned mapping(s) (spec deleted): ${changes.removedMappings.join(', ')} — run --fix`,
          ) && allOk;
        if (orphaned > 0) registryDriftedScopes.push(sc);
        if (changes.danglingFiles.length > 0) {
          process.stdout.write(
            `  INFO  scope '${sc}': ${changes.danglingFiles.length} registry file ref(s) point to missing files (possible rename) — review via registry-sync; not auto-fixed:\n` +
              changes.danglingFiles.map((d) => `          - ${d.spec_id} → ${d.file}`).join('\n') +
              '\n',
          );
        }
      } catch (e) {
        allOk =
          check(`scope '${sc}' _registry.json checkable`, false, e instanceof Error ? e.message : String(e)) &&
          allOk;
      }
    }
    process.stdout.write('\n');
  }

  if (isDir(specsRoot)) {
    process.stdout.write('Spec cross-refs\n');
    for (const sc of getAvailableScopes(absTarget).map((s) => s.id)) {
      try {
        const { audited, findings } = auditRelatedSpecRefsOnDisk(sc, absTarget);
        const n = findings.length;
        allOk =
          check(
            `scope '${sc}' related_specs all point to existing specs`,
            n === 0,
            n === 0
              ? audited > 0
                ? `${audited} spec(s) audited`
                : ''
              : `${n} spec(s) carry dangling ref(s) — repair via spec_write(op:update), not by hand:\n` +
                findings
                  .map((f) => `          - ${f.spec_id} → ${f.dangling.join(', ')}`)
                  .join('\n'),
          ) && allOk;
      } catch (e) {
        allOk =
          check(`scope '${sc}' related_specs checkable`, false, e instanceof Error ? e.message : String(e)) &&
          allOk;
      }
    }
    process.stdout.write('\n');
  }

  if (opts.fix) {
    process.stdout.write('\n');
    process.stdout.write('Repair mode (--fix): attempting non-destructive recovery\n');
    let fixCount = 0;

    const specsGenericPath = join(absTarget, PRODUCT_DIR, 'specs', 'generic');
    if (!isDir(specsGenericPath)) {
      try {
        ensureScopeDir(GENERIC_SCOPE, absTarget);
        process.stdout.write(`  FIXED: ensured ${specsGenericPath}/\n`);
        fixCount += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  SKIP:  failed to create ${specsGenericPath}/: ${msg}\n`);
      }
    }

    if (!isFile(versionMarker)) {
      writeRiglaneVersion(absTarget, false);
      process.stdout.write(`  FIXED: wrote ${versionMarker}\n`);
      fixCount += 1;
    } else {
      const installedHash = computeTemplatesHash();
      const current = (() => {
        try {
          return readFileSync(versionMarker, 'utf-8').trim();
        } catch {
          return '';
        }
      })();
      let markerHash: string | null = null;
      if (current.startsWith('{')) {
        try {
          const obj = JSON.parse(current) as { templateHash?: string };
          markerHash = typeof obj.templateHash === 'string' ? obj.templateHash : null;
        } catch {
          markerHash = null;
        }
      }
      if (markerHash !== installedHash) {
        writeRiglaneVersion(absTarget, false);
        process.stdout.write(
          `  FIXED: updated ${versionMarker} (hash → ${installedHash.slice(0, 12)})\n`,
        );
        fixCount += 1;
      }
    }

    for (const orphan of findLegacyRuntimeOrphans(join(absTarget, PRODUCT_DIR, 'workflows'))) {
      try {
        rmSync(orphan, { recursive: true, force: true });
        process.stdout.write(`  FIXED: pruned legacy runtime dir ${orphan}\n`);
        fixCount += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  SKIP:  failed to prune ${orphan}: ${msg}\n`);
      }
    }

    for (const sc of driftedScopes) {
      try {
        const { changes } = reconcileSpecIndexOnDisk(sc, absTarget, { write: true });
        const n = changes.added.length + changes.removed.length + changes.modified.length;
        if (n > 0) {
          process.stdout.write(
            `  FIXED: reconciled scope '${sc}' _index.json (${changes.added.length} added, ${changes.removed.length} removed, ${changes.modified.length} repaired)\n`,
          );
          fixCount += 1;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  SKIP:  reconcile scope '${sc}' failed: ${msg}\n`);
      }
    }

    for (const sc of registryDriftedScopes) {
      try {
        const { changes } = reconcileSpecRegistryOnDisk(sc, absTarget, { write: true });
        if (changes.removedMappings.length > 0) {
          process.stdout.write(
            `  FIXED: pruned ${changes.removedMappings.length} orphaned mapping(s) from scope '${sc}' _registry.json (${changes.removedMappings.join(', ')})\n`,
          );
          fixCount += 1;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  SKIP:  registry reconcile scope '${sc}' failed: ${msg}\n`);
      }
    }

    if (codexTrustFixNeeded) {
      try {
        const report = upsertCodexHookTrust(codexProjectConfig, {});
        const n = report.added.length + report.updated.length;
        if (n > 0) {
          process.stdout.write(
            `  FIXED: persisted codex hook trust (${report.added.length} added, ${report.updated.length} re-trusted)\n`,
          );
          fixCount += 1;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  SKIP:  codex hook trust upsert failed: ${msg}\n`);
      }
    }

    if (ocPluginFixNeeded) {
      try {
        const dstPlugin = join(absTarget, '.opencode', 'plugins', 'riglane-hooks.ts');
        const srcPlugin = join(tplRoot, 'opencode', 'plugins', 'riglane-hooks.ts');
        if (isFile(srcPlugin)) {
          mkdirSync(join(absTarget, '.opencode', 'plugins'), { recursive: true });
          copyFileSync(srcPlugin, dstPlugin);
          process.stdout.write(
            '  FIXED: refreshed .opencode/plugins/riglane-hooks.ts (restart OpenCode to load it)\n',
          );
          fixCount += 1;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  SKIP:  opencode plugin refresh failed: ${msg}\n`);
      }
    }

    if (copilotHooksFixNeeded) {
      try {
        const dstHooks = join(absTarget, '.github', 'hooks', 'riglane.json');
        const srcHooks = join(tplRoot, 'copilot', 'hooks', 'riglane.json');
        if (isFile(srcHooks)) {
          mkdirSync(join(absTarget, '.github', 'hooks'), { recursive: true });
          copyFileSync(srcHooks, dstHooks);
          process.stdout.write(
            '  FIXED: refreshed .github/hooks/riglane.json (restart the Copilot session to load it)\n',
          );
          fixCount += 1;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  SKIP:  copilot hooks refresh failed: ${msg}\n`);
      }
    }

    if (geminiAgentAckFixNeeded) {
      try {
        const acked = ackGeminiAgents(absTarget);
        if (acked.length > 0) {
          process.stdout.write(
            `  FIXED: acknowledged ${acked.length} gemini agent(s) (headless consent)\n`,
          );
          fixCount += 1;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`  SKIP:  gemini agent acknowledgment failed: ${msg}\n`);
      }
    }

    if (fixCount === 0) {
      process.stdout.write(
        '  No auto-repairable items found. Run `riglane update` for full refresh.\n',
      );
    } else {
      process.stdout.write(
        `  ${fixCount} item(s) repaired. For more (skill files, hooks, MCP config), run \`riglane update\`.\n`,
      );
    }
  }

  if (allOk) {
    process.stdout.write('All checks passed.\n');
    return 0;
  }
  process.stderr.write('Some checks failed — see WARN lines above.\n');
  if (!opts.fix)
    process.stderr.write(
      'Run `riglane doctor --fix` to auto-repair fixable issues (spec-index, version marker, scope dirs, orphans).\n',
    );
  return 1;
}


function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function findLegacyRuntimeOrphans(workflowsDir: string): string[] {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(workflowsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'templates' || e.name === 'dynamic') continue;
    const dir = join(workflowsDir, e.name);
    if (isFile(join(dir, 'manifest.json')) && !isFile(join(dir, 'workflow.yaml'))) {
      out.push(dir);
    }
  }
  return out;
}

void existsSync;
