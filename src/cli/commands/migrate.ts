
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import process from 'node:process';

import { copyTree, pruneTree } from '../_fs.js';
import { writePredefinedHashes } from '../promote-edited.js';
import { ACP_DIR, LEGACY_ACP_DIR } from '../../config/paths.js';
import { LEGACY_DIRS } from '../../config/product.js';
import { PROJECT_ID_MARKER, VERSION_MARKER } from '../../config/product.js';
import { removeLegacySkills, removeLegacyWorkflows, runInit } from './init.js';
import { templatesRoot } from '../templates.js';
import { VERSION } from '../version.js';
import {
  findByPath as findRegistryByPath,
  load as loadRegistry,
  register as registerInRegistry,
} from '../../registry/registry.js';
import { ADAPTERS, SELECTABLE_ADAPTERS, mcpConfigProbe } from '../../adapters/index.js';
import type { AdapterId } from '../../adapters/index.js';
import { readOrCreateProjectId } from '../projectId.js';


const ENGINE_SCRIPT_FILES: ReadonlySet<string> = new Set([
  'workflow-engine.py',
  'output_validator.py',
  'gate-check.py',
  'schema-validate.py',
  'scope_context.py',
  'scope_cli.py',
  'scope_migrate_flat_to_scoped.py',
  'scope-write-validator.py',
  'workflow-tool-validator.py',
  'file-guard.py',
  'hook-diagnostic.py',
  'init-workflow.py',
  'update-workflows.py',
  'count-lines.py',
  'transform-json.py',
]);

const BACKUP_PATHS: ReadonlyArray<string> = [
  '.agent',
  LEGACY_ACP_DIR,
  ACP_DIR,
  '.mcp.json',
  '.claude/settings.json',
  '.cursor/hooks.json',
  '.cursor/mcp.json',
  '.codex/config.toml',
  '.opencode/opencode.json',
  '.opencode/plugins',
  '.github/mcp.json',
  '.github/hooks',
  '.gemini/settings.json',
  '.cursorignore',
  '.gitignore',
];

const BACKUP_GITIGNORE_PATTERN = `${ACP_DIR}.backup-*.tar.gz\n`;


export type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd?: string; timeout?: number; encoding?: 'utf-8' | 'buffer' },
) => SpawnSyncReturns<string | Buffer>;

export interface MigrateOptions {
  readonly dryRun?: boolean;
  readonly backupTo?: string;
  readonly templatesRoot?: string;
  readonly spawnTar?: SpawnFn;
  readonly spawnGit?: SpawnFn;
}

interface InternalOptions {
  readonly dryRun: boolean;
  readonly backupTo: string | null;
  readonly srcRoot: string;
  readonly spawnTar: SpawnFn;
  readonly spawnGit: SpawnFn;
}


export function isCopyBased(target: string): boolean {
  const dirs = [...LEGACY_DIRS, ACP_DIR];
  return dirs.some(
    (d) =>
      isFile(join(target, d, 'mcp', 'workflow-engine.py')) ||
      isFile(join(target, d, 'scripts', 'gate-check.py')),
  );
}

export function firstLegacyDir(target: string): string | null {
  for (const d of LEGACY_DIRS) {
    if (isDir(join(target, d))) return d;
  }
  return null;
}


export function preflight(target: string, opts: InternalOptions): boolean {
  if (!isDir(target)) {
    process.stderr.write(`ERROR: target is not a directory: ${target}\n`);
    return false;
  }

  const hasLegacy = firstLegacyDir(target) !== null;
  const hasNew = isDir(join(target, ACP_DIR));
  if (!hasLegacy && !hasNew) {
    process.stderr.write(
      `NOTICE: ${target} has none of ${[...LEGACY_DIRS, ACP_DIR].map((d) => `${d}/`).join(', ')} — Riglane is not installed here.\n`,
    );
    process.stderr.write('        `riglane init` is the right command to set it up.\n');
    return false;
  }

  if (isDir(join(target, '.git'))) {
    try {
      const result = opts.spawnGit('git', ['-C', target, 'status', '--porcelain'], {
        timeout: 10_000,
        encoding: 'utf-8',
      });
      const stdout = (result.stdout as string | undefined) ?? '';
      if (result.status === 0 && stdout.trim()) {
        process.stdout.write(
          '  WARN  git working tree in target has uncommitted changes — ' +
            'backup will include them, but consider committing first.\n',
        );
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT' && code !== 'ETIMEDOUT') throw e;
    }
  }

  return true;
}


export function makeBackup(target: string, opts: InternalOptions): string {
  const ts = nowTimestamp();
  const name = `${ACP_DIR}.backup-${ts}.tar.gz`;
  const backupPath = opts.backupTo !== null ? join(opts.backupTo, name) : join(target, name);

  if (opts.dryRun) {
    process.stdout.write(`  WOULD BACKUP to ${backupPath}\n`);
    return backupPath;
  }

  if (opts.backupTo !== null) {
    mkdirSync(opts.backupTo, { recursive: true });
  }

  const existing = BACKUP_PATHS.filter((rel) => existsSync(join(target, rel)));

  const relArchive = relative(target, backupPath);
  const archiveArg = relArchive && !relArchive.includes(':') ? relArchive : backupPath;

  const result = opts.spawnTar('tar', ['-czf', archiveArg, '-C', target, ...existing], {
    cwd: target,
    encoding: 'utf-8',
  });
  if (result.error || (result.status !== null && result.status !== 0)) {
    const errMsg =
      result.error instanceof Error
        ? result.error.message
        : ((result.stderr as string | undefined) ?? `exit code ${result.status}`);
    throw new Error(
      `ERROR: tar invocation failed (${errMsg}). Aborting to avoid data loss without backup. Install \`tar\` (apt/brew/chocolatey) or perform manual backup before re-running migrate.`,
    );
  }

  let sizeMb: number;
  try {
    sizeMb = statSync(backupPath).size / (1024 * 1024);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      throw new Error(
        `ERROR: backup tar reported success but ${backupPath} does not exist. Aborting migrate to avoid data loss without verifiable backup.`,
      );
    }
    throw e;
  }
  const rel = relative(target, backupPath) || backupPath;
  process.stdout.write(`  BACKUP  ${rel} (${sizeMb.toFixed(1)} MB)\n`);
  return backupPath;
}

function nowTimestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}


export function deleteEngineFiles(target: string, opts: InternalOptions): string[] {
  const removed: string[] = [];

  const mcpDir = join(target, ACP_DIR, 'mcp');
  if (isDir(mcpDir)) {
    if (opts.dryRun) {
      process.stdout.write(`  WOULD DELETE  .agent/mcp/ (${countFiles(mcpDir)} files)\n`);
    } else {
      rmSync(mcpDir, { recursive: true, force: true });
      process.stdout.write('  DELETE  .agent/mcp/\n');
    }
    removed.push('.agent/mcp/');
  }

  const scriptsDir = join(target, ACP_DIR, 'scripts');
  if (isDir(scriptsDir)) {
    let entries: string[];
    try {
      entries = readdirSync(scriptsDir);
    } catch {
      entries = [];
    }
    entries.sort();
    for (const name of entries) {
      const path = join(scriptsDir, name);
      if (name === '__pycache__' && isDir(path)) {
        if (opts.dryRun) {
          process.stdout.write('  WOULD DELETE  .agent/scripts/__pycache__/\n');
        } else {
          rmSync(path, { recursive: true, force: true });
          process.stdout.write('  DELETE  .agent/scripts/__pycache__/\n');
        }
        continue;
      }
      if (isFile(path) && ENGINE_SCRIPT_FILES.has(name)) {
        if (opts.dryRun) {
          process.stdout.write(`  WOULD DELETE  .agent/scripts/${name}\n`);
        } else {
          rmSync(path, { force: true });
          process.stdout.write(`  DELETE  .agent/scripts/${name}\n`);
        }
        removed.push(`.agent/scripts/${name}`);
      }
    }

    if (!opts.dryRun) {
      try {
        if (readdirSync(scriptsDir).length === 0) {
          rmdirSync(scriptsDir);
          process.stdout.write('  DELETE  .agent/scripts/ (empty)\n');
          removed.push('.agent/scripts/');
        }
      } catch {
      }
    }
  }

  return removed;
}

function countFiles(path: string): number {
  let count = 0;
  function recurse(dir: string): void {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        recurse(join(dir, entry.name));
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }
  recurse(path);
  return count;
}


export function refreshPredefinedWorkflows(target: string, opts: InternalOptions): void {
  const src = join(opts.srcRoot, 'agent', 'workflows', 'templates', 'predefined');
  const dst = join(target, ACP_DIR, 'workflows', 'templates', 'predefined');

  if (!isDir(src)) {
    process.stdout.write('  WARN  source predefined/ templates not found in package\n');
    return;
  }

  process.stdout.write(`  REFRESH ${ACP_DIR}/workflows/templates/predefined/\n`);
  copyTree(src, dst, { force: false, update: true, dryRun: opts.dryRun });
  if (isDir(dst)) {
    pruneTree(src, dst, { dryRun: opts.dryRun });
  }
  if (!opts.dryRun) writePredefinedHashes(target);
}


export function rewriteMcpJson(path: string, opts: InternalOptions): void {
  if (!isFile(path)) return;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`  WARN  ${path} not valid JSON (${msg}) — skipping rewrite\n`);
    return;
  }

  const servers = data.mcpServers;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return;
  const serversObj = servers as Record<string, unknown>;

  const changed: string[] = [];
  const rewriteSpecs: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ['workflow_engine', ['mcp-server']],
    ['workflow_tools', ['mcp-tools']],
  ];
  for (const [name, newCmd] of rewriteSpecs) {
    const entry = serversObj[name];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const entryObj = entry as Record<string, unknown>;
    const curCmd = entryObj.command;
    const curArgs = entryObj.args;
    if (
      curCmd === 'riglane' &&
      Array.isArray(curArgs) &&
      arrayEquals(curArgs as ReadonlyArray<string>, newCmd)
    ) {
      continue;
    }
    const newEntry: Record<string, unknown> = {
      command: 'riglane',
      args: [...newCmd],
    };
    if ('type' in entryObj) {
      newEntry.type = entryObj.type;
    }
    serversObj[name] = newEntry;
    changed.push(name);
  }

  const label = path.split(/[\\/]/).pop() ?? path;
  if (changed.length === 0) {
    process.stdout.write(`  SKIP  ${label} (already riglane-based)\n`);
    return;
  }

  if (opts.dryRun) {
    process.stdout.write(`  WOULD REWRITE  ${label}: ${changed.join(', ')}\n`);
    return;
  }

  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  process.stdout.write(`  REWRITE  ${label} (${changed.join(', ')} -> acp CLI)\n`);
}


export function rewriteClaudeSettings(target: string, opts: InternalOptions): void {
  const path = join(target, '.claude', 'settings.json');
  if (!isFile(path)) return;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`  WARN  .claude/settings.json not valid JSON (${msg}) — skipping\n`);
    return;
  }

  const groups = readArrayPath(data, ['hooks', 'SubagentStop']);
  let changed = false;
  for (const group of groups) {
    const groupObj = group as Record<string, unknown>;
    const hooks = (groupObj.hooks as unknown[] | undefined) ?? [];
    for (const hook of hooks) {
      const hookObj = hook as Record<string, unknown>;
      const cmd = (hookObj.command as string | undefined) ?? '';
      if (
        cmd.includes('scripts/gate-check.py') ||
        cmd.includes('.agent\\scripts\\gate-check.py')
      ) {
        if (cmd !== 'riglane gate-check') {
          if (opts.dryRun) {
            process.stdout.write(
              '  WOULD REWRITE  .claude/settings.json SubagentStop -> riglane gate-check\n',
            );
            return;
          }
          hookObj.command = 'riglane gate-check';
          changed = true;
        }
      }
    }
  }

  if (!changed) {
    process.stdout.write('  SKIP  .claude/settings.json (no legacy gate-check reference found)\n');
    return;
  }

  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  process.stdout.write('  REWRITE  .claude/settings.json (SubagentStop -> riglane gate-check)\n');
}

export function rewriteCursorHooks(target: string, opts: InternalOptions): void {
  const path = join(target, '.cursor', 'hooks.json');
  if (!isFile(path)) return;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stdout.write(`  WARN  .cursor/hooks.json not valid JSON (${msg}) — skipping\n`);
    return;
  }

  const hooks = readArrayPath(data, ['hooks', 'subagentStop']);
  let changed = false;
  for (const hook of hooks) {
    const hookObj = hook as Record<string, unknown>;
    const cmd = (hookObj.command as string | undefined) ?? '';
    if (
      cmd.includes('scripts/gate-check.py') ||
      cmd.includes('.agent\\scripts\\gate-check.py')
    ) {
      if (cmd !== 'riglane gate-check') {
        if (opts.dryRun) {
          process.stdout.write(
            '  WOULD REWRITE  .cursor/hooks.json subagentStop -> riglane gate-check\n',
          );
          return;
        }
        hookObj.command = 'riglane gate-check';
        changed = true;
      }
    }
  }

  if (!changed) {
    process.stdout.write('  SKIP  .cursor/hooks.json (no legacy gate-check reference found)\n');
    return;
  }

  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  process.stdout.write('  REWRITE  .cursor/hooks.json (subagentStop -> riglane gate-check)\n');
}


export function appendGitignoreBackupPattern(target: string, opts: InternalOptions): void {
  const path = join(target, '.gitignore');
  let existing = '';
  if (isFile(path)) {
    existing = readFileSync(path, 'utf-8');
  }

  if (existing.includes(BACKUP_GITIGNORE_PATTERN.trim())) {
    process.stdout.write('  SKIP  .gitignore (backup pattern already present)\n');
    return;
  }

  if (opts.dryRun) {
    process.stdout.write(`  WOULD APPEND  .gitignore: ${BACKUP_GITIGNORE_PATTERN.trim()}\n`);
    return;
  }

  if (existing && !existing.endsWith('\n')) {
    appendFileSync(path, '\n', 'utf-8');
  }
  appendFileSync(path, BACKUP_GITIGNORE_PATTERN, 'utf-8');
  process.stdout.write(`  APPEND  .gitignore (${BACKUP_GITIGNORE_PATTERN.trim()})\n`);
}


function rewriteAgentRefs(target: string, acpDir: string, opts: InternalOptions): void {
  if (opts.dryRun) return;
  const fromTok = `${LEGACY_ACP_DIR}/`;
  const toTok = `${ACP_DIR}/`;
  const tokenPairs: ReadonlyArray<[string, string]> = LEGACY_DIRS.flatMap((legacy) => [
    [`${legacy}/`, `${ACP_DIR}/`] as [string, string],
    [`${legacy}\\`, `${ACP_DIR}\\`] as [string, string],
  ]);
  const hasAnyToken = (text: string): boolean => tokenPairs.some(([from]) => text.includes(from));
  const rewriteTokens = (text: string): string =>
    tokenPairs.reduce((acc, [from, to]) => acc.split(from).join(to), text);

  const templatesDir = join(acpDir, 'workflows', 'templates');
  const exts = new Set(['.yaml', '.yml', '.py', '.md', '.json', '.mjs', '.cjs', '.js', '.sh']);
  const files: string[] = [];
  const walk = (dir: string): void => {
    const entries = ((): Dirent[] => {
      try {
        return readdirSync(dir, { withFileTypes: true });
      } catch {
        return [];
      }
    })();
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && exts.has(extname(e.name))) files.push(p);
    }
  };
  walk(templatesDir);
  const specsDir = join(acpDir, 'specs');
  const walkSpecs = (dir: string): void => {
    const entries = ((): Dirent[] => {
      try {
        return readdirSync(dir, { withFileTypes: true });
      } catch {
        return [];
      }
    })();
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkSpecs(p);
      else if (e.isFile() && (e.name === '_registry.json' || e.name === '_index.json'))
        files.push(p);
    }
  };
  walkSpecs(specsDir);
  let count = 0;
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(f, 'utf-8');
    } catch {
      continue;
    }
    if (!hasAnyToken(text)) continue;
    writeFileSync(f, rewriteTokens(text), 'utf-8');
    count += 1;
  }
  if (count > 0) {
    process.stdout.write(`  REWRITE ${count} workflow file(s): legacy dir → ${toTok} paths\n`);
  }

  for (const ig of ['.gitignore', '.cursorignore']) {
    const p = join(target, ig);
    if (!isFile(p)) continue;
    let text: string;
    try {
      text = readFileSync(p, 'utf-8');
    } catch {
      continue;
    }
    if (!hasAnyToken(text)) continue;
    writeFileSync(p, rewriteTokens(text), 'utf-8');
    process.stdout.write(`  REWRITE ${ig}: legacy dir → ${toTok}\n`);
  }

  for (const rel of HOST_CONFIG_REF_PATHS) {
    const p = join(target, rel);
    if (!isFile(p)) continue;
    let text: string;
    try {
      text = readFileSync(p, 'utf-8');
    } catch {
      continue;
    }
    if (!hasAnyToken(text)) continue;
    writeFileSync(p, rewriteTokens(text), 'utf-8');
    process.stdout.write(`  REWRITE ${rel}: ${fromTok} → ${toTok} path refs\n`);
  }
}

const HOST_CONFIG_REF_PATHS: ReadonlyArray<string> = [
  '.mcp.json',
  'mcp.json',
  '.claude/settings.json',
  '.cursor/hooks.json',
  '.cursor/mcp.json',
  '.codex/config.toml',
  '.opencode/opencode.json',
  '.github/mcp.json',
  '.gemini/settings.json',
  '.vscode/mcp.json',
];

export function renameRiglaneDir(target: string, opts: InternalOptions): boolean {
  const legacyName = firstLegacyDir(target);
  const next = join(target, ACP_DIR);
  if (legacyName === null || isDir(next)) return false;
  const legacy = join(target, legacyName);

  if (opts.dryRun) {
    process.stdout.write(`  WOULD RENAME  ${legacyName}/ → ${ACP_DIR}/\n`);
    return true;
  }

  renameSync(legacy, next);
  process.stdout.write(`  RENAME  ${legacyName}/ → ${ACP_DIR}/\n`);
  renameMarkerFiles(next);
  rewriteAgentRefs(target, next, opts);
  return true;
}

function renameMarkerFiles(acpDir: string): void {
  const pairs: ReadonlyArray<[string, string]> = [
    ['.acp-project-id', PROJECT_ID_MARKER],
    ['.acp-version', VERSION_MARKER],
  ];
  for (const [oldName, newName] of pairs) {
    const oldPath = join(acpDir, oldName);
    const newPath = join(acpDir, newName);
    if (!isFile(oldPath) || existsSync(newPath)) continue;
    try {
      renameSync(oldPath, newPath);
      process.stdout.write(`  RENAME  ${oldName} → ${newName}\n`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(`  WARN  could not rename ${oldName}: ${msg}\n`);
    }
  }
}


export async function runMigrate(target: string, opts: MigrateOptions = {}): Promise<number> {
  const absTarget = resolve(target);
  const dryRun = Boolean(opts.dryRun);

  const internal: InternalOptions = {
    dryRun,
    backupTo: opts.backupTo ?? null,
    srcRoot: opts.templatesRoot ?? templatesRoot(),
    spawnTar: opts.spawnTar ?? defaultSpawn,
    spawnGit: opts.spawnGit ?? defaultSpawn,
  };

  const mode = dryRun ? 'DRY RUN' : 'MIGRATE';
  process.stdout.write(`[${mode}] riglane migrate ${absTarget}\n`);
  process.stdout.write(`       riglane version ${VERSION}\n`);
  process.stdout.write('\n');

  if (!preflight(absTarget, internal)) {
    return 1;
  }

  const legacyName = firstLegacyDir(absTarget);
  const hasNew = isDir(join(absTarget, ACP_DIR));
  const needsRename = legacyName !== null && !hasNew;
  const copyBased = isCopyBased(absTarget);

  if (!needsRename && !copyBased) {
    process.stdout.write(
      `Nothing to migrate: ${ACP_DIR}/ is already in place and no copy-based engine files were found.\n`,
    );
    process.stdout.write(
      '(Use `riglane update` to refresh templates/skills and `riglane doctor` to verify.)\n',
    );
    return 0;
  }

  process.stdout.write('== Backup ==\n');
  const backupPath = makeBackup(absTarget, internal);
  process.stdout.write('\n');

  if (needsRename) {
    process.stdout.write(`== Rename ${legacyName}/ → ${ACP_DIR}/ ==\n`);
    renameRiglaneDir(absTarget, internal);
    process.stdout.write('\n');
  }

  if (copyBased) {
    process.stdout.write('== Delete legacy engine files ==\n');
    deleteEngineFiles(absTarget, internal);
    process.stdout.write('\n');

    process.stdout.write('== Refresh predefined workflows from package ==\n');
    refreshPredefinedWorkflows(absTarget, internal);
    removeLegacySkills(absTarget, '.claude', internal.dryRun);
    removeLegacySkills(absTarget, '.cursor', internal.dryRun);
    removeLegacyWorkflows(absTarget, internal.dryRun);
    process.stdout.write('\n');
  }

  process.stdout.write('== Rewrite MCP configs ==\n');
  rewriteMcpJson(join(absTarget, '.mcp.json'), internal);
  rewriteMcpJson(join(absTarget, '.cursor', 'mcp.json'), internal);
  process.stdout.write('\n');

  process.stdout.write('== Rewire hooks ==\n');
  rewriteClaudeSettings(absTarget, internal);
  rewriteCursorHooks(absTarget, internal);
  process.stdout.write('\n');

  process.stdout.write('== Refresh install (riglane update pass) ==\n');
  if (dryRun) {
    process.stdout.write('  WOULD RUN  riglane update (config rewrite ×adapters, skills, agents, re-trust)\n');
  } else {
    try {
      const initRc = await runInit(absTarget, {
        update: true,
        force: false,
        templatesRoot: internal.srcRoot,
      });
      if (initRc !== 0) {
        process.stdout.write(
          '  WARN  the update pass returned non-zero — run `riglane update` manually and check output.\n',
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(`  WARN  update pass failed (${msg}) — run \`riglane update\` manually.\n`);
    }
  }
  process.stdout.write('\n');

  process.stdout.write('== .gitignore backup pattern ==\n');
  appendGitignoreBackupPattern(absTarget, internal);
  process.stdout.write('\n');

  if (!dryRun) {
    let adapters: AdapterId[] | null = null;
    try {
      const entry = findRegistryByPath(loadRegistry(), absTarget);
      if (entry && entry.adapters.length > 0) adapters = [...entry.adapters];
    } catch {
    }
    if (adapters === null) {
      const probed = SELECTABLE_ADAPTERS.filter((id) => {
        const d = ADAPTERS[id];
        const probePath = mcpConfigProbe(d).path;
        return existsSync(join(absTarget, probePath));
      });
      adapters = probed.length > 0 ? probed : ['claude'];
    }
    try {
      const projectId = readOrCreateProjectId(absTarget, dryRun);
      registerInRegistry({
        id: projectId,
        path: absTarget,
        adapters,
        action: 'migrate',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(`      WARN  failed to update the project registry: ${msg}\n`);
    }
  }

  process.stdout.write(`${dryRun ? '[DRY RUN] ' : ''}Done.\n`);
  if (!dryRun) {
    const rel = relative(absTarget, backupPath) || backupPath;
    process.stdout.write(`Backup: ${rel}\n`);
    process.stdout.write(`Preserved: ${ACP_DIR}/specs/, ${ACP_DIR}/tools/, \n`);
    process.stdout.write(
      `           ${ACP_DIR}/workflows/<id>/ runtime data, my_workflows/, ${ACP_DIR}/local/\n`,
    );
    process.stdout.write('\n');
    process.stdout.write('Next steps:\n');
    process.stdout.write(`  cd ${absTarget}\n`);
    process.stdout.write('  riglane doctor    # verify the migration landed\n');
    process.stdout.write('  # restart the agent hosts (MCP servers + skills reload at startup)\n');
  }
  return 0;
}


const defaultSpawn: SpawnFn = (command, args, options) =>
  spawnSync(command, [...args], options) as SpawnSyncReturns<string | Buffer>;

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

function arrayEquals<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function readArrayPath(obj: Record<string, unknown>, path: ReadonlyArray<string>): unknown[] {
  let cur: unknown = obj;
  for (const seg of path) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return [];
    cur = (cur as Record<string, unknown>)[seg];
    if (cur === undefined) return [];
  }
  return Array.isArray(cur) ? cur : [];
}
