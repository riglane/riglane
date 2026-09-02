
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';

import { PRODUCT_DIR } from '../../config/paths.js';
import { VERSION_MARKER } from '../../config/product.js';
import {
  ADAPTERS,
  SELECTABLE_ADAPTERS,
  DEFAULT_ADAPTERS,
  type AdapterId,
  type SpecGuidanceSpec,
} from '../../adapters/index.js';
import { SPEC_GUIDANCE_NUDGE_BODY, ruleFileContent } from '../../adapters/spec-guidance.js';
import { GENERIC_SCOPE, ensureScopeDir } from '../../scope/scope-context.js';
import {
  findByPath as findRegistryEntry,
  isTemporaryLocation,
  load as loadRegistry,
  register as registerInRegistry,
} from '../../registry/registry.js';
import { readOrCreateProjectId } from '../projectId.js';
import { updateWorkflows } from '../../scripts/update-workflows.js';
import { GENERATED_MARKER } from '../../scripts/init-workflow.js';
import { bumpCount, copyTree, getCounts, pruneTree, resetCounts } from '../_fs.js';
import {
  checkDependencies,
  ensureCursorIgnore,
  injectManagedBlock,
  mergeClaudeSettings,
  mergeGeminiSettings,
} from '../_merge.js';
import { ackGeminiAgents } from '../gemini-agent-ack.js';
import {
  mergeCodexConfig,
  mergeOpencodeConfig,
  mergeCursorFileGuardHook,
  mergeCursorLoggerHooks,
  mergeCursorSpawnThrottleHook,
  mergeHooks,
  normalizeCursorHookShell,
  mergeMcpConfig,
  removeManagedBlock,
} from '../_merge.js';
import { upsertCodexHookTrust } from '../codex-hook-trust.js';
import { promoteEditedPredefinedWorkflows, writePredefinedHashes } from '../promote-edited.js';
import { templatesRoot } from '../templates.js';
import { VERSION } from '../version.js';
import { computeTemplatesHash } from '../../registry/templateHash.js';


export interface RunOptions {
  readonly claude?: boolean;
  readonly cursor?: boolean;
  readonly codex?: boolean;
  readonly opencode?: boolean;
  readonly copilot?: boolean;
  readonly gemini?: boolean;
  readonly adapters?: readonly AdapterId[];
  readonly force?: boolean;
  readonly update?: boolean;
  readonly prune?: boolean;
  readonly dryRun?: boolean;
  readonly mcpTokenLimit?: number;
  readonly specGuidance?: boolean;
  readonly templatesRoot?: string;
  readonly runUpdateWorkflows?: (target: string, dryRun: boolean) => void | Promise<void>;
  readonly bootstrapScopeGeneric?: (target: string, dryRun: boolean) => void;
}

interface InternalOptions {
  readonly force: boolean;
  readonly update: boolean;
  readonly prune: boolean;
  readonly dryRun: boolean;
  readonly mcpTokenLimit: number;
  readonly runUpdateWorkflows: (target: string, dryRun: boolean) => void | Promise<void>;
  readonly bootstrapScopeGenericFn: (target: string, dryRun: boolean) => void;
  readonly specGuidanceEnabled: boolean;
}


export function printHeader(
  target: string,
  adapters: ReadonlyArray<AdapterId>,
  mode: string,
  dryRun: boolean,
): void {
  const adapterLabel = adapters.map((a) => ADAPTERS[a].label).join(' + ');
  const prefix = dryRun ? '[DRY RUN] ' : '';
  process.stdout.write(`${prefix}Initializing Riglane in: ${target}\n`);
  process.stdout.write(`Adapter(s): ${adapterLabel}  |  Mode: ${mode}\n`);
  process.stdout.write('\n');
}

const LEGACY_SKILL_NAMES: readonly string[] = [
  'learn-workflows',
  'create-workflow',
  'init-workflow',
  'run-workflow',
  'run-workflow-for-code-spec',
  'scope-add',
  'scope-list',
  'scope-set',
  'scope-show',
  'scope-unset',
  'spec',
  'spec-add',
  'spec-add-do',
  'spec-audit',
  'spec-do',
  'spec-with-workflows',
  'update-workflows',
];

export function removeLegacySkills(
  target: string,
  adapterDir: '.claude' | '.cursor',
  dryRun: boolean,
): void {
  const skillsDir = join(target, adapterDir, 'skills');
  if (!existsSync(skillsDir)) return;

  const found: string[] = [];
  for (const legacy of LEGACY_SKILL_NAMES) {
    const dir = join(skillsDir, legacy);
    if (existsSync(dir)) found.push(legacy);
  }
  if (found.length === 0) return;

  if (dryRun) {
    process.stdout.write(
      `[cleanup] would remove ${found.length} legacy skill(s) from ${adapterDir}/skills/: ${found.join(', ')}\n\n`,
    );
    return;
  }
  for (const legacy of found) {
    rmSync(join(skillsDir, legacy), { recursive: true, force: true });
  }
  process.stdout.write(
    `[cleanup] removed ${found.length} legacy skill(s) from ${adapterDir}/skills/ (Phase 6 /riglane- rename): ${found.join(', ')}\n\n`,
  );
}

const LEGACY_EXAMPLE_NAMES: readonly string[] = [
  'alternative-steps-demo',
  'hook-diagnostic',
];

const LEGACY_WORKFLOW_NAMES: readonly string[] = [
  'spec-write',
  'spec-enforcement',
  'spec-write-and-implement',
  'implement',
  'spec-implement',
  'loop-demo',
  'hook-diagnostic',
  'spec-add',
  'spec-do',
  'spec-add-do',
  'spec-do-high',
];

export function removeLegacyWorkflows(target: string, dryRun: boolean): void {
  const predefinedDir = join(target, PRODUCT_DIR, 'workflows', 'templates', 'predefined');
  const examplesDir = join(target, PRODUCT_DIR, 'workflows', 'templates', 'examples');

  const found: Array<{ dir: string; legacy: string; family: string }> = [];
  if (existsSync(predefinedDir)) {
    for (const legacy of LEGACY_WORKFLOW_NAMES) {
      const dir = join(predefinedDir, legacy);
      if (existsSync(dir)) found.push({ dir, legacy, family: 'predefined' });
    }
  }
  if (existsSync(examplesDir)) {
    for (const legacy of LEGACY_EXAMPLE_NAMES) {
      const dir = join(examplesDir, legacy);
      if (existsSync(dir)) found.push({ dir, legacy, family: 'examples' });
    }
  }
  if (found.length === 0) return;

  const names = found.map((f) => `${f.family}/${f.legacy}`).join(', ');
  if (dryRun) {
    process.stdout.write(
      `[cleanup] would remove ${found.length} legacy workflow(s) from .riglane/workflows/templates/: ${names}\n\n`,
    );
    return;
  }
  for (const f of found) {
    rmSync(f.dir, { recursive: true, force: true });
  }
  process.stdout.write(
    `[cleanup] removed ${found.length} stale workflow(s) from .riglane/workflows/templates/ (renamed or relocated): ${names}\n\n`,
  );
}

function removeLegacyAgentDocs(target: string, opts: InternalOptions): void {
  const dir = join(target, PRODUCT_DIR, 'docs');
  if (!existsSync(dir)) return;
  const dstRel = `${relative(target, dir)}/`.replace(/\\/g, '/');
  if (opts.dryRun) {
    process.stdout.write(`[cleanup] would remove legacy ${dstRel} (Phase 4 deprecation)\n\n`);
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`[cleanup] removed legacy ${dstRel} (engine docs are now served via workflow_learn)\n\n`);
}

const LEGACY_BRAND_SKILLS: readonly string[] = [
  'acp-create-workflow',
  'acp-init-workflow',
  'acp-run-workflow',
  'acp-scope-add',
  'acp-scope-list',
  'acp-scope-set',
  'acp-scope-show',
  'acp-scope-unset',
  'acp-spec-author',
  'acp-spec-check',
  'acp-update-workflows',
];

const LEGACY_BRAND_SKILL_DIRS: readonly string[] = [
  '.claude/skills',
  '.cursor/skills',
  '.agents/skills',
  '.opencode/skills',
  '.github/skills',
];

const LEGACY_BRAND_FILES: readonly string[] = [
  '.opencode/commands/acp-run-workflow.md',
  '.opencode/plugins/acp-hooks.ts',
  '.github/hooks/acp.json',
  '.github/agents/acp-workflow-step.agent.md',
  '.github/instructions/acp-workflow-context.instructions.md',
  '.github/instructions/acp-spec-guidance.instructions.md',
  '.claude/rules/acp-spec-guidance.md',
  '.cursor/rules/acp-spec-guidance.mdc',
  '.gemini/agents/acp-workflow-step.md',
  'acp-workflow-context.md',
];

const LEGACY_BRAND_DIRS: readonly string[] = [
  '.opencode/acp',
  '.gemini/commands/acp',
];

const LEGACY_BRAND_AGENT_DIRS: ReadonlyArray<{ dir: string; ext: string }> = [
  { dir: '.opencode/agents', ext: '.md' },
  { dir: '.github/agents', ext: '.agent.md' },
  { dir: '.gemini/agents', ext: '.md' },
];

export function removeLegacyBrandArtifacts(target: string, dryRun: boolean): void {
  const removed: string[] = [];
  const drop = (abs: string, rel: string, recursive: boolean): void => {
    if (!existsSync(abs)) return;
    if (!dryRun) rmSync(abs, { recursive, force: true });
    removed.push(rel);
  };

  for (const base of LEGACY_BRAND_SKILL_DIRS) {
    for (const name of LEGACY_BRAND_SKILLS) {
      drop(join(target, base, name), `${base}/${name}/`, true);
    }
  }
  for (const rel of LEGACY_BRAND_FILES) drop(join(target, rel), rel, false);
  for (const rel of LEGACY_BRAND_DIRS) drop(join(target, rel), `${rel}/`, true);

  for (const { dir, ext } of LEGACY_BRAND_AGENT_DIRS) {
    const abs = join(target, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (!name.startsWith('acp-') || !name.endsWith(ext)) continue;
      const p = join(abs, name);
      try {
        if (!statSync(p).isFile()) continue;
        if (!readFileSync(p, 'utf-8').includes(GENERATED_MARKER)) continue;
      } catch {
        continue;
      }
      drop(p, `${dir}/${name}`, false);
    }
  }

  if (removed.length === 0) return;
  const verb = dryRun ? 'would remove' : 'removed';
  process.stdout.write(
    `[cleanup] ${verb} ${removed.length} acp-era artifact(s):\n` +
      removed.map((r) => `          ${r}\n`).join(''),
  );
  process.stdout.write('\n');
}

function removeLegacyTools(target: string, opts: InternalOptions): void {
  const file = join(target, PRODUCT_DIR, 'tools', 'audit-viewer.html');
  if (!existsSync(file)) return;
  const dstRel = relative(target, file).replace(/\\/g, '/');
  if (opts.dryRun) {
    process.stdout.write(`[cleanup] would remove legacy ${dstRel} (superseded by projects-spec-audit.html)\n\n`);
    return;
  }
  rmSync(file, { force: true });
  process.stdout.write(
    `[cleanup] removed legacy ${dstRel} (superseded by projects-spec-audit.html — Projects Spec & Audit)\n\n`,
  );
}

export function installUniversal(target: string, srcRoot: string, opts: InternalOptions): void {
  removeLegacyAgentDocs(target, opts);

  removeLegacyTools(target, opts);

  removeLegacyWorkflows(target, opts.dryRun);

  const steps: ReadonlyArray<{ label: string; src: string; dst: string; okToPrune: boolean }> = [
    {
      label: 'tools',
      src: join(srcRoot, 'agent', 'tools'),
      dst: join(target, PRODUCT_DIR, 'tools'),
      okToPrune: true,
    },
    {
      label: 'workflow templates',
      src: join(srcRoot, 'agent', 'workflows', 'templates'),
      dst: join(target, PRODUCT_DIR, 'workflows', 'templates'),
      okToPrune: true,
    },
  ];

  for (let idx = 0; idx < steps.length; idx += 1) {
    const step = steps[idx];
    if (!step) continue;
    const { label, src, dst, okToPrune } = step;
    const totalSteps = steps.length + 2;
    const dstRel = `${relative(target, dst)}/`.replace(/\\/g, '/');
    process.stdout.write(`[${idx + 1}/${totalSteps}] ${label} (${dstRel})\n`);
    if (!isDir(src)) {
      process.stdout.write(`  WARN  source ${src} not found — skipping\n`);
      process.stdout.write('\n');
      continue;
    }
    copyTree(src, dst, {
      force: opts.force,
      update: opts.update,
      dryRun: opts.dryRun,
    });
    if (opts.prune && okToPrune && isDir(dst)) {
      if (label === 'workflow templates') {
        const srcPredefined = join(src, 'predefined');
        const dstPredefined = join(dst, 'predefined');
        if (isDir(dstPredefined) && isDir(srcPredefined)) {
          pruneTree(srcPredefined, dstPredefined, { dryRun: opts.dryRun });
        }
      } else {
        pruneTree(src, dst, { dryRun: opts.dryRun });
      }
    }
    process.stdout.write('\n');
  }

  installSpecs(target, srcRoot, opts);
  ensureWorkflowsDir(target);
}

export function installSpecs(target: string, srcRoot: string, opts: InternalOptions): void {
  process.stdout.write('[4/5] behavioral specs (.riglane/specs/)\n');
  const src = join(srcRoot, 'agent', 'specs');
  const dst = join(target, PRODUCT_DIR, 'specs');
  const userDataFiles = new Set(['_index.json', '_registry.json']);

  if (!isDir(src)) {
    if (!isDir(dst)) {
      if (!opts.dryRun) mkdirSync(dst, { recursive: true });
      process.stdout.write('  MKDIR .riglane/specs/\n');
    }
    process.stdout.write('\n');
    return;
  }

  if (!opts.dryRun) mkdirSync(dst, { recursive: true });

  const entries = walkRelativeSkipSymlinkDirs(src);

  for (const entry of entries) {
    const fullSrc = join(src, entry);
    let st;
    try {
      st = statSync(fullSrc);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
      continue;
    }
    if (st.isDirectory()) {
      if (!opts.dryRun) mkdirSync(join(dst, entry), { recursive: true });
      continue;
    }
    if (!st.isFile()) continue;
    const fileName = basename(entry);
    if (fileName.endsWith('.pyc')) continue;

    const fullDst = join(dst, entry);
    const dstDir = dirname(fullDst);
    if (!opts.dryRun) mkdirSync(dstDir, { recursive: true });
    const relPath = entry.replace(/\\/g, '/');

    if (userDataFiles.has(fileName) && existsSync(fullDst)) {
      process.stdout.write(`  SKIP  .riglane/specs/${relPath} (user data)\n`);
      continue;
    }

    if (existsSync(fullDst)) {
      if (opts.update) {
        if (filesEqual(fullSrc, fullDst)) {
          bumpCount('unchanged');
          continue;
        }
        if (opts.dryRun) {
          process.stdout.write(`  WOULD UPDATE  .riglane/specs/${relPath}\n`);
        } else {
          copyFileSync(fullSrc, fullDst);
          process.stdout.write(`  UPDATE  .riglane/specs/${relPath}\n`);
        }
        bumpCount('updated');
      } else if (opts.force) {
        copyFileSync(fullSrc, fullDst);
        process.stdout.write(`  COPY  .riglane/specs/${relPath}\n`);
      } else {
        bumpCount('skipped');
        process.stdout.write(`  SKIP  .riglane/specs/${relPath} (exists)\n`);
      }
    } else {
      if (opts.dryRun) {
        process.stdout.write(`  WOULD ADD     .riglane/specs/${relPath}\n`);
      } else {
        copyFileSync(fullSrc, fullDst);
        process.stdout.write(`  NEW   .riglane/specs/${relPath}\n`);
      }
      bumpCount('new');
    }
  }
  process.stdout.write('\n');
}

export function ensureWorkflowsDir(target: string): void {
  const workflowsDir = join(target, PRODUCT_DIR, 'workflows');
  if (!isDir(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
    process.stdout.write('Created: .riglane/workflows/ (put your workflow definitions here)\n');
  } else {
    process.stdout.write('Exists:  .riglane/workflows/\n');
  }
  process.stdout.write('\n');
}

function writeSpecGuidanceRuleFile(absPath: string, content: string, dryRun: boolean): void {
  if (isFile(absPath) && readFileSync(absPath, 'utf-8') === content) {
    process.stdout.write(`  SKIP  ${absPath} (up to date)\n`);
    return;
  }
  if (dryRun) {
    process.stdout.write(`  WOULD WRITE  ${absPath}\n`);
    return;
  }
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf-8');
  process.stdout.write(`  NEW   ${absPath}\n`);
}

function removeSpecGuidanceForAdapter(target: string, sg: SpecGuidanceSpec, dryRun: boolean): void {
  if (sg.via === 'managed-block') {
    removeManagedBlock(join(target, sg.file), sg.sentinel, { dryRun });
    return;
  }
  const p = join(target, sg.path);
  if (!isFile(p)) {
    process.stdout.write(`  SKIP  ${p} (already absent)\n`);
    return;
  }
  if (dryRun) {
    process.stdout.write(`  WOULD REMOVE  ${p}\n`);
    return;
  }
  unlinkSync(p);
  process.stdout.write(`  REMOVE  ${p}\n`);
}

export async function installAdapter(
  adapter: AdapterId,
  target: string,
  srcRoot: string,
  opts: InternalOptions,
): Promise<void> {
  const d = ADAPTERS[adapter];
  const adapterDir = d.projectDir;

  process.stdout.write(`=== ${d.label} adapter ===\n\n`);

  if (adapter === 'claude' || adapter === 'cursor') {
    removeLegacySkills(target, adapterDir as '.claude' | '.cursor', opts.dryRun);
  }

  if (d.skills) {
    process.stdout.write(`[1/5] Skills (${d.skills.dstDir}/)\n`);
    const srcSkills = join(srcRoot, d.srcDir, d.skills.srcSubdir);
    const dstSkills = join(target, d.skills.dstDir);
    if (isDir(srcSkills)) {
      copyTree(srcSkills, dstSkills, {
        force: opts.force,
        update: opts.update,
        dryRun: opts.dryRun,
      });
      if (opts.prune && d.skills.prune !== false && isDir(dstSkills)) {
        pruneTree(srcSkills, dstSkills, { dryRun: opts.dryRun });
      }
    } else {
      process.stdout.write(`  WARN  Source ${d.skills.dstDir}/ not found — skipping\n`);
    }
  } else {
    process.stdout.write(`[1/5] Skills — N/A for ${d.label} (procedures ship as commands)\n`);
  }
  process.stdout.write('\n');

  if (d.commands) {
    process.stdout.write(`[1b] Commands (${d.commands.dstDir}/)\n`);
    const srcCommands = join(srcRoot, d.srcDir, d.commands.srcSubdir);
    const dstCommands = join(target, d.commands.dstDir);
    if (isDir(srcCommands)) {
      copyTree(srcCommands, dstCommands, {
        force: opts.force,
        update: opts.update,
        dryRun: opts.dryRun,
      });
      if (opts.prune && d.commands.prune !== false && isDir(dstCommands)) {
        pruneTree(srcCommands, dstCommands, { dryRun: opts.dryRun });
      }
    } else {
      process.stdout.write(`  WARN  Source ${d.srcDir}/${d.commands.srcSubdir}/ not found — skipping\n`);
    }
    process.stdout.write('\n');
  }

  switch (d.hooks.kind) {
    case 'claude-settings': {
      process.stdout.write(`[2/5] Hook configuration (${d.projectDir}/settings.json)\n`);
      const srcSettings = join(srcRoot, d.srcDir, 'settings.json');
      const dstSettings = join(target, d.projectDir, 'settings.json');
      if (isFile(srcSettings)) {
        mergeClaudeSettings(srcSettings, dstSettings, {
          force: opts.force,
          update: opts.update,
          dryRun: opts.dryRun,
          mcpTokenLimit: opts.mcpTokenLimit,
        });
      } else {
        process.stdout.write(`  WARN  Source ${d.projectDir}/settings.json not found\n`);
      }
      break;
    }
    case 'cursor-hooks': {
      process.stdout.write(`[2/5] Hook configuration (${d.projectDir}/hooks.json)\n`);
      const srcHooks = join(srcRoot, d.srcDir, 'hooks.json');
      if (isFile(srcHooks)) {
        const dstHooks = join(target, d.projectDir, 'hooks.json');
        const hookOpts = { force: opts.force, update: opts.update, dryRun: opts.dryRun };
        mergeHooks(srcHooks, dstHooks, hookOpts);
        mergeCursorLoggerHooks(srcHooks, dstHooks, hookOpts);
        mergeCursorFileGuardHook(srcHooks, dstHooks, hookOpts);
        mergeCursorSpawnThrottleHook(srcHooks, dstHooks, hookOpts);
        normalizeCursorHookShell(dstHooks, process.platform, { dryRun: opts.dryRun });
      } else {
        process.stdout.write('  WARN  Source hooks.json not found — skipping\n');
      }
      break;
    }
    case 'codex-toml': {
      process.stdout.write(`[2/5] Config (${d.projectDir}/config.toml — MCP servers + hooks)\n`);
      const srcConfig = join(srcRoot, d.srcDir, 'config.toml.template');
      const dstConfig = join(target, d.projectDir, 'config.toml');
      if (isFile(srcConfig)) {
        mergeCodexConfig(srcConfig, dstConfig, {
          force: opts.force,
          update: opts.update,
          dryRun: opts.dryRun,
        });
        upsertCodexHookTrust(dstConfig, { dryRun: opts.dryRun });
      } else {
        process.stdout.write(`  WARN  Source ${d.srcDir}/config.toml.template not found — skipping\n`);
      }
      break;
    }
    case 'opencode-plugin': {
      process.stdout.write(`[2/5] Hook plugin (${d.hooks.dstDir}/)\n`);
      const srcPlugins = join(srcRoot, d.srcDir, d.hooks.srcSubdir);
      const dstPlugins = join(target, d.hooks.dstDir);
      if (isDir(srcPlugins)) {
        copyTree(srcPlugins, dstPlugins, {
          force: opts.force,
          update: opts.update,
          dryRun: opts.dryRun,
        });
        if (opts.prune && isDir(dstPlugins)) {
          pruneTree(srcPlugins, dstPlugins, { dryRun: opts.dryRun });
        }
      } else {
        process.stdout.write(`  WARN  Source ${d.srcDir}/${d.hooks.srcSubdir}/ not found — skipping\n`);
      }
      break;
    }
    case 'copilot-hooks-json': {
      process.stdout.write(`[2/5] Hook configuration (${d.hooks.dstDir}/)\n`);
      const srcHooksDir = join(srcRoot, d.srcDir, d.hooks.srcSubdir);
      const dstHooksDir = join(target, d.hooks.dstDir);
      if (isDir(srcHooksDir)) {
        copyTree(srcHooksDir, dstHooksDir, {
          force: opts.force,
          update: opts.update,
          dryRun: opts.dryRun,
        });
      } else {
        process.stdout.write(`  WARN  Source ${d.srcDir}/${d.hooks.srcSubdir}/ not found — skipping\n`);
      }
      break;
    }
    case 'gemini-settings-json': {
      process.stdout.write(
        `[2/5] Settings (${d.projectDir}/settings.json — hooks + MCP servers + context)\n`,
      );
      const srcGemini = join(srcRoot, d.srcDir, 'settings.json.template');
      const dstGemini = join(target, d.projectDir, 'settings.json');
      if (isFile(srcGemini)) {
        mergeGeminiSettings(srcGemini, dstGemini, {
          force: opts.force,
          update: opts.update,
          dryRun: opts.dryRun,
        });
      } else {
        process.stdout.write(
          `  WARN  Source ${d.srcDir}/settings.json.template not found — skipping\n`,
        );
      }
      break;
    }
  }
  process.stdout.write('\n');

  switch (d.mcp.kind) {
    case 'json-template':
    case 'json-file': {
      process.stdout.write(`[3/5] MCP server config (${d.mcp.dst})\n`);
      const srcMcp = join(srcRoot, d.mcp.src);
      const dstMcp = join(target, d.mcp.dst);
      if (isFile(srcMcp)) {
        mergeMcpConfig(srcMcp, dstMcp, {
          force: opts.force,
          update: opts.update,
          dryRun: opts.dryRun,
        });
      } else {
        const missingLabel = d.mcp.kind === 'json-template' ? d.mcp.src : d.mcp.dst;
        process.stdout.write(`  WARN  Source ${missingLabel} not found — skipping\n`);
      }
      break;
    }
    case 'codex-toml':
      process.stdout.write(
        `[3/5] MCP server config (${d.projectDir}/config.toml — merged with hooks in step 2)\n`,
      );
      break;
    case 'gemini-settings-json':
      process.stdout.write(
        `[3/5] MCP server config (${d.projectDir}/settings.json — merged with hooks in step 2)\n`,
      );
      break;
    case 'opencode-json': {
      process.stdout.write(`[3/5] MCP + instructions config (${d.mcp.dst})\n`);
      const srcCfg = join(srcRoot, d.mcp.src);
      const dstCfg = join(target, d.mcp.dst);
      if (isFile(srcCfg)) {
        mergeOpencodeConfig(srcCfg, dstCfg, {
          force: opts.force,
          update: opts.update,
          dryRun: opts.dryRun,
        });
      } else {
        process.stdout.write(`  WARN  Source ${d.mcp.src} not found — skipping\n`);
      }
      break;
    }
    case 'copilot-mcp-json': {
      process.stdout.write(`[3/5] MCP server config (${d.mcp.dst})\n`);
      const srcMcpCfg = join(srcRoot, d.mcp.src);
      const dstMcpCfg = join(target, d.mcp.dst);
      if (isFile(srcMcpCfg)) {
        mergeMcpConfig(srcMcpCfg, dstMcpCfg, {
          force: opts.force,
          update: opts.update,
          dryRun: opts.dryRun,
        });
      } else {
        process.stdout.write(`  WARN  Source ${d.mcp.src} not found — skipping\n`);
      }
      break;
    }
  }
  process.stdout.write('\n');

  if (d.rules) {
    process.stdout.write(`[4/5] Rules (${d.rules.dstDir}/)\n`);
    const srcRules = join(srcRoot, d.srcDir, d.rules.srcSubdir);
    const dstRules = join(target, d.rules.dstDir);
    if (isDir(srcRules)) {
      copyTree(srcRules, dstRules, {
        force: opts.force,
        update: opts.update,
        dryRun: opts.dryRun,
      });
      if (opts.prune && d.rules.prune !== false && isDir(dstRules)) {
        pruneTree(srcRules, dstRules, { dryRun: opts.dryRun });
      }
    } else {
      process.stdout.write('  SKIP  No rules to copy\n');
    }
    process.stdout.write('\n');
  }

  if (d.specGuidance) {
    const sg = d.specGuidance;
    const label = sg.via === 'managed-block' ? `${sg.file}, managed block` : `${sg.path}, rules file`;
    if (opts.specGuidanceEnabled) {
      process.stdout.write(`[spec-guidance] L1 nudge (${label})\n`);
      if (sg.via === 'managed-block') {
        injectManagedBlock(join(target, sg.file), sg.sentinel, SPEC_GUIDANCE_NUDGE_BODY, {
          dryRun: opts.dryRun,
        });
      } else {
        writeSpecGuidanceRuleFile(join(target, sg.path), ruleFileContent(sg.frontmatter), opts.dryRun);
      }
    } else {
      process.stdout.write(`[spec-guidance] Removing L1 nudge (${label})\n`);
      removeSpecGuidanceForAdapter(target, sg, opts.dryRun);
    }
    process.stdout.write('\n');
  }

  if (d.generatesPerStepSubagents) {
    process.stdout.write(`[5/5] Agents (${d.projectDir}/agents/)\n`);
    const srcAgents = join(srcRoot, d.srcDir, 'agents');
    const dstAgents = join(target, d.projectDir, 'agents');
    if (isDir(srcAgents)) {
      copyTree(srcAgents, dstAgents, {
        force: opts.force,
        update: opts.update,
        dryRun: opts.dryRun,
      });
      if (opts.prune && isDir(dstAgents)) {
        pruneTree(srcAgents, dstAgents, { dryRun: opts.dryRun });
      }
    } else {
      process.stdout.write(`  WARN  Source ${d.projectDir}/agents/ not found — skipping\n`);
    }
    process.stdout.write('\n');

    if (!opts.dryRun) {
      await opts.runUpdateWorkflows(target, false);
    }
  } else if (d.agents) {
    process.stdout.write(`[5/5] Agents (${d.agents.dstDir}/ — static + generated)\n`);
    const srcAgents = join(srcRoot, d.srcDir, d.agents.srcSubdir);
    const dstAgents = join(target, d.agents.dstDir);
    if (isDir(srcAgents)) {
      copyTree(srcAgents, dstAgents, {
        force: opts.force,
        update: opts.update,
        dryRun: opts.dryRun,
      });
      if (opts.prune && d.agents.prune !== false && isDir(dstAgents)) {
        pruneTree(srcAgents, dstAgents, { dryRun: opts.dryRun });
      }
    } else {
      process.stdout.write(`  WARN  Source ${d.srcDir}/${d.agents.srcSubdir}/ not found — skipping\n`);
    }
    process.stdout.write('\n');

    if (d.id === 'gemini' && !opts.dryRun) {
      const acked = ackGeminiAgents(target);
      if (acked.length > 0) {
        process.stdout.write(`  ACK   ${acked.length} gemini agent(s) acknowledged (headless consent)\n`);
      }
    }

    if (!opts.dryRun) {
      await opts.runUpdateWorkflows(target, false);
    }
  } else {
    process.stdout.write(`[5/5] Agents (${d.label}: N/A — uses global tool inventory)\n`);
    process.stdout.write(`  SKIP  ${d.label} does not use custom per-step subagent definitions\n`);
    process.stdout.write('\n');
  }
}

export async function defaultRunUpdateWorkflows(target: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  process.stdout.write('      Generating per-step subagents from workflow templates\n');
  const origCwd = process.cwd();
  try {
    process.chdir(target);
    try {
      await updateWorkflows({ dryRun: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(`      WARN  failed to run update_workflows: ${msg}\n`);
    }
  } finally {
    process.chdir(origCwd);
  }
  process.stdout.write('\n');
}

export function defaultBootstrapScopeGeneric(target: string, dryRun: boolean): void {
  if (dryRun) return;
  process.stdout.write('Scope system bootstrap (.riglane/specs/generic/)\n');
  try {
    ensureScopeDir(GENERIC_SCOPE, target);
    process.stdout.write('      ensured .riglane/specs/generic/ exists\n');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`      WARN  scope bootstrap failed: ${msg}\n`);
  }
  process.stdout.write('\n');
}

export function printSummary(opts: InternalOptions): void {
  const counts = getCounts();
  process.stdout.write('\n');
  if (opts.update || opts.dryRun) {
    const prefix = opts.dryRun ? '[DRY RUN] ' : '';
    process.stdout.write(`${prefix}Summary:\n`);
    if (counts.new) process.stdout.write(`  New files:     ${counts.new}\n`);
    if (counts.updated) process.stdout.write(`  Updated:       ${counts.updated}\n`);
    if (counts.pruned) process.stdout.write(`  Pruned:        ${counts.pruned}\n`);
    if (counts.unchanged) process.stdout.write(`  Unchanged:     ${counts.unchanged}\n`);
    if (!counts.new && !counts.updated && !counts.pruned) {
      process.stdout.write('  Everything is up to date!\n');
    }
    if (opts.dryRun) {
      process.stdout.write('\n');
      process.stdout.write('  Run without --dry-run to apply changes.\n');
    }
  } else {
    process.stdout.write('Done! Next steps:\n');
    process.stdout.write('  1. Author a workflow:  /riglane-create-workflow\n');
    process.stdout.write('  2. Run a workflow:     /riglane-run-workflow <name>\n');
    process.stdout.write('  3. Manage specs:       /riglane-spec-with-workflows add <component>\n');
    process.stdout.write('  4. Use [spec::X] in chat to capture behavioral requirements\n');
  }
}

function lookupRegistryAdapters(absTarget: string): readonly AdapterId[] | null {
  try {
    const entry = findRegistryEntry(loadRegistry(), absTarget);
    return entry && entry.adapters.length > 0 ? entry.adapters : null;
  } catch {
    return null;
  }
}

function lookupRegistrySpecGuidance(absTarget: string): boolean | undefined {
  try {
    return findRegistryEntry(loadRegistry(), absTarget)?.specGuidance;
  } catch {
    return undefined;
  }
}


export async function runInit(target: string, opts: RunOptions = {}): Promise<number> {
  const force = Boolean(opts.force);
  const update = Boolean(opts.update);
  const prune = Boolean(opts.prune);
  const dryRun = Boolean(opts.dryRun);
  const mcpTokenLimit = opts.mcpTokenLimit ?? 50000;

  if (dryRun && !update) {
    process.stderr.write('ERROR: --dry-run requires --update\n');
    return 1;
  }
  if (prune && !update) {
    process.stderr.write('ERROR: --prune requires --update\n');
    return 1;
  }
  if (force && update) {
    process.stderr.write('ERROR: --force and --update are mutually exclusive\n');
    return 1;
  }

  const absTarget = resolve(target);
  if (!isDir(absTarget)) {
    process.stderr.write(`ERROR: Target directory not found: ${absTarget}\n`);
    return 1;
  }

  const explicit =
    opts.adapters && opts.adapters.length > 0
      ? SELECTABLE_ADAPTERS.filter((a) => opts.adapters!.includes(a))
      : null;
  const selectedAdapter = SELECTABLE_ADAPTERS.find((a) => opts[a] === true);
  const recordedAdapters = lookupRegistryAdapters(absTarget);
  const singleFlagUnion = selectedAdapter
    ? SELECTABLE_ADAPTERS.filter(
        (a) => a === selectedAdapter || (recordedAdapters ?? []).includes(a),
      )
    : null;
  const adapters: ReadonlyArray<AdapterId> =
    explicit ?? singleFlagUnion ?? recordedAdapters ?? DEFAULT_ADAPTERS;

  const specGuidanceEnabled =
    opts.specGuidance ?? (lookupRegistrySpecGuidance(absTarget) ?? true);

  checkDependencies();
  resetCounts();
  const srcRoot = opts.templatesRoot ?? templatesRoot();

  const mode = dryRun ? 'DRY RUN' : update ? 'UPDATE' : force ? 'FORCE' : 'INSTALL';
  printHeader(absTarget, adapters, mode, dryRun);

  const internal: InternalOptions = {
    force,
    update,
    prune,
    dryRun,
    mcpTokenLimit,
    runUpdateWorkflows: opts.runUpdateWorkflows ?? defaultRunUpdateWorkflows,
    bootstrapScopeGenericFn: opts.bootstrapScopeGeneric ?? defaultBootstrapScopeGeneric,
    specGuidanceEnabled,
  };

  const promoteReport = promoteEditedPredefinedWorkflows(absTarget, {
    dryRun,
    pkgTemplatesRoot: srcRoot,
  });
  for (const p of promoteReport.promoted) {
    process.stdout.write(
      dryRun
        ? `  WOULD PROMOTE  predefined/${p.name} → my_workflows/${p.name} (user-edited)\n`
        : `  PROMOTE  predefined/${p.name} → my_workflows/${p.name} (${p.note})\n`,
    );
  }
  for (const c of promoteReport.conflicts) {
    process.stdout.write(`  WARN  ${c.reason}\n`);
  }
  if (promoteReport.promoted.length > 0 || promoteReport.conflicts.length > 0) {
    process.stdout.write('\n');
  }

  removeLegacyBrandArtifacts(absTarget, internal.dryRun);

  installUniversal(absTarget, srcRoot, internal);

  if (!dryRun) writePredefinedHashes(absTarget);

  for (const adapter of adapters) {
    await installAdapter(adapter, absTarget, srcRoot, internal);
  }

  if (adapters.includes('cursor')) {
    ensureCursorIgnore(absTarget, { dryRun });
  }

  internal.bootstrapScopeGenericFn(absTarget, dryRun);

  writeRiglaneVersion(absTarget, dryRun);

  if (!dryRun) {
    try {
      const projectId = readOrCreateProjectId(absTarget, dryRun);
      registerInRegistry({
        id: projectId,
        path: absTarget,
        adapters,
        specGuidance: specGuidanceEnabled,
        action: update ? 'update' : 'init',
      });
      if (isTemporaryLocation(absTarget)) {
        process.stdout.write('      NOTE  This project is under the system temp directory, so it is registered as temporary.\n');
        process.stdout.write('            Forget it when you are done:  riglane projects forget --temp   (add --delete to remove the files)\n');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(`      WARN  failed to update ~/.riglane/projects.json: ${msg}\n`);
    }
  }

  printSummary(internal);
  return 0;
}

export function writeRiglaneVersion(target: string, dryRun: boolean): void {
  if (dryRun) return;
  const agentDir = join(target, PRODUCT_DIR);
  const markerPath = join(agentDir, VERSION_MARKER);
  try {
    mkdirSync(agentDir, { recursive: true });
    const payload = {
      installedBy: VERSION,
      templateHash: computeTemplatesHash(),
    };
    writeFileSync(markerPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`      WARN  failed to write .riglane-version marker: ${msg}\n`);
  }
}


function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
    return false;
  }
}

function filesEqual(a: string, b: string): boolean {
  try {
    return Buffer.compare(readFileSync(a), readFileSync(b)) === 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
    return false;
  }
}

function walkRelativeSkipSymlinkDirs(root: string): string[] {
  const out: string[] = [];
  function recurse(currentDir: string, prefix: string): void {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true, encoding: 'utf-8' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push(rel);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        recurse(join(currentDir, entry.name), rel);
      }
    }
  }
  recurse(root, '');
  return out;
}

void writeFileSync;
