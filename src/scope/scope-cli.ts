
import type { Dirent } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { PRODUCT_DIR } from '../config/paths.js';
import {
  ACTIVE_SCOPE_FILE,
  GENERIC_SCOPE,
  InvalidScopeIdError,
  SCOPE_CONFIG_PATH,
  ScopeError,
  clearUserActiveScope,
  ensureScopeDir,
  formatScopeTable,
  getAvailableScopes,
  loadScopeConfig,
  resolveActiveScope,
  saveScopeConfig,
  scopeDir,
  scopeExists,
  validateScopeId,
  writeUserActiveScope,
} from './scope-context.js';


export type ScopeAction = 'show' | 'set' | 'unset' | 'list' | 'add' | 'hint';

export interface ParsedScopeArgs {
  readonly command: ScopeAction;
  readonly scopeId?: string;
  readonly label?: string;
  readonly hint?: string;
  readonly project?: boolean;
  readonly counts?: boolean;
}

export interface ScopeCliOptions {
  readonly stdout?: (s: string) => void;
  readonly stderr?: (s: string) => void;
  readonly root?: string;
}

interface ResolvedOptions {
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
  readonly root: string;
}

function resolveOpts(opts: ScopeCliOptions): ResolvedOptions {
  return {
    stdout: opts.stdout ?? ((s: string) => void process.stdout.write(s)),
    stderr: opts.stderr ?? ((s: string) => void process.stderr.write(s)),
    root: opts.root ?? '.',
  };
}


export function cmdShow(opts: ScopeCliOptions): number {
  const r = resolveOpts(opts);
  let active: string;
  let source: string;
  try {
    [active, source] = resolveActiveScope(undefined, r.root);
  } catch (e) {
    if (e instanceof ScopeError) {
      r.stderr(`Error: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  const scopes = getAvailableScopes(r.root);
  const label = scopes.find((s) => s.id === active)?.label ?? active;
  const srcLabelMap: Record<string, string> = {
    cli: 'CLI --scope flag',
    user: `user override (${PRODUCT_DIR}/local/active-scope)`,
    'project-default': 'project default (_scope-config.json)',
    fallback: 'hard-coded fallback (no config, no override)',
  };
  const srcLabel = srcLabelMap[source] ?? source;

  const hint = scopes.find((s) => s.id === active)?.hint;
  r.stdout(`Active scope: ${active}\n`);
  r.stdout(`Label:        ${label}\n`);
  if (hint) r.stdout(`Coverage:     ${hint}\n`);
  r.stdout(`Source:       ${srcLabel}\n`);
  r.stdout('\n');
  r.stdout('Available scopes:\n');
  r.stdout(`${formatScopeTable(scopes)}\n`);
  return 0;
}

export function cmdSet(opts: ScopeCliOptions, args: ParsedScopeArgs): number {
  const r = resolveOpts(opts);
  const scopeId = args.scopeId ?? '';
  try {
    validateScopeId(scopeId);
  } catch (e) {
    if (e instanceof InvalidScopeIdError) {
      r.stderr(`Error: ${e.message}\n`);
      return 1;
    }
    throw e;
  }

  if (!scopeExists(scopeId, r.root)) {
    const available = getAvailableScopes(r.root)
      .map((s) => s.id)
      .join(', ');
    r.stderr(
      `Error: scope '${scopeId}' is not declared. ` +
        `Available: ${available}.\n` +
        `Hint: /riglane-scope-add ${scopeId} "<label>" to create it first.\n`,
    );
    return 2;
  }

  if (args.project) {
    const config = loadScopeConfig(r.root);
    config.default_active_scope = scopeId;
    saveScopeConfig(config, r.root);
    r.stdout(`Project default_active_scope set to '${scopeId}'.\n`);
    r.stdout('(Committed to _scope-config.json — team-wide.)\n');
  } else {
    writeUserActiveScope(scopeId, r.root);
    r.stdout(`Active scope set to '${scopeId}' (user-level override).\n`);
    r.stdout(`Stored in ${ACTIVE_SCOPE_FILE} (gitignored).\n`);
  }

  return 0;
}

export function cmdUnset(opts: ScopeCliOptions): number {
  const r = resolveOpts(opts);
  const cleared = clearUserActiveScope(r.root);
  if (cleared) {
    r.stdout('User active-scope override cleared.\n');
    const [active, source] = resolveActiveScope(undefined, r.root);
    r.stdout(`Now resolving to: ${active} (source: ${source})\n`);
  } else {
    r.stdout('No user active-scope override to clear.\n');
  }
  return 0;
}

export function cmdList(opts: ScopeCliOptions, args: ParsedScopeArgs): number {
  const r = resolveOpts(opts);
  const scopes = getAvailableScopes(r.root);

  if (args.counts) {
    for (const entry of scopes) {
      const sdir = scopeDir(entry.id, r.root);
      let count = 0;
      try {
        if (statSync(sdir).isDirectory()) {
          count = countMdFiles(sdir);
        }
      } catch {
        count = 0;
      }
      (entry as { label: string }).label = `${entry.label}  (${count} specs)`;
    }
  }

  r.stdout('Available scopes:\n');
  r.stdout(`${formatScopeTable(scopes)}\n`);
  return 0;
}

function countMdFiles(dir: string): number {
  let count = 0;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      count += countMdFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
      count += 1;
    }
  }
  return count;
}

export function cmdAdd(opts: ScopeCliOptions, args: ParsedScopeArgs): number {
  const r = resolveOpts(opts);
  const scopeId = args.scopeId ?? '';
  const label = args.label || scopeId;
  const hint = args.hint?.trim();

  try {
    validateScopeId(scopeId);
  } catch (e) {
    if (e instanceof InvalidScopeIdError) {
      r.stderr(`Error: ${e.message}\n`);
      return 1;
    }
    throw e;
  }

  if (scopeId === GENERIC_SCOPE) {
    r.stderr(`Error: '${GENERIC_SCOPE}' is a reserved implicit scope and cannot be declared.\n`);
    return 1;
  }

  const config = loadScopeConfig(r.root);
  const scopes = config.scopes;
  if (scopes.some((s) => (s as { id?: unknown }).id === scopeId)) {
    r.stderr(`Error: scope '${scopeId}' already exists in _scope-config.json.\n`);
    return 2;
  }

  scopes.push({ id: scopeId, label, ...(hint ? { hint } : {}) });
  if (config.default_active_scope === undefined) {
    config.default_active_scope = null;
  }

  saveScopeConfig(config, r.root);
  const sdir = ensureScopeDir(scopeId, r.root);

  r.stdout(`Scope '${scopeId}' added.\n`);
  r.stdout(`  Config:    ${SCOPE_CONFIG_PATH}\n`);
  r.stdout(`  Directory: ${sdir}/\n`);
  r.stdout('  Indexes:   _index.json, _registry.json (empty)\n');
  if (hint) {
    r.stdout(`  Coverage:  ${hint}\n`);
  } else {
    r.stdout('\n');
    r.stdout(
      `  TIP: record a coverage hint so agents know what '${scopeId}' governs\n` +
        `       (and what belongs elsewhere) — improves scope-orientation in\n` +
        `       spec_check / spec_authoring steps and cross-scope placement:\n` +
        `         riglane scope hint ${scopeId} "<what it covers; NOT ... (→ other-scope)>"\n`,
    );
  }
  r.stdout('\n');
  r.stdout(`Next: /riglane-scope-set ${scopeId}  to switch to it.\n`);
  return 0;
}

export function cmdHint(opts: ScopeCliOptions, args: ParsedScopeArgs): number {
  const r = resolveOpts(opts);
  const scopeId = args.scopeId ?? '';
  const text = (args.hint ?? '').trim();

  try {
    validateScopeId(scopeId);
  } catch (e) {
    if (e instanceof InvalidScopeIdError) {
      r.stderr(`Error: ${e.message}\n`);
      return 1;
    }
    throw e;
  }

  if (scopeId === GENERIC_SCOPE) {
    r.stderr(
      `Error: '${GENERIC_SCOPE}' is the implicit cross-integration scope — it has no ` +
        `config entry to carry a hint.\n`,
    );
    return 1;
  }

  const config = loadScopeConfig(r.root);
  const entry = config.scopes.find((s) => (s as { id?: unknown }).id === scopeId) as
    | Record<string, unknown>
    | undefined;
  if (!entry) {
    r.stderr(
      `Error: scope '${scopeId}' is not declared in _scope-config.json. ` +
        `Add it first: riglane scope add ${scopeId} "<label>".\n`,
    );
    return 2;
  }

  if (text) {
    entry.hint = text;
  } else {
    delete entry.hint;
  }
  saveScopeConfig(config, r.root);

  r.stdout(
    text ? `Coverage hint set for scope '${scopeId}'.\n` : `Coverage hint cleared for scope '${scopeId}'.\n`,
  );
  return 0;
}


export function parseScopeCliArgs(argv: string[]): ParsedScopeArgs | { error: string } {
  const sub = argv[0];
  if (!sub) return { error: 'usage: scope_cli {show,set,unset,list,add,hint} ...' };
  if (!isScopeAction(sub)) {
    return { error: `unknown subcommand '${sub}' (expected: show, set, unset, list, add, hint)` };
  }
  const rest = argv.slice(1);


  if (sub === 'show' || sub === 'unset') {
    if (rest.length > 0) {
      return { error: `scope_cli ${sub}: unrecognized arguments: ${rest.join(' ')}` };
    }
    return { command: sub };
  }

  if (sub === 'set') {
    let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
    try {
      parsed = parseArgs({
        args: rest,
        options: { project: { type: 'boolean' as const } },
        allowPositionals: true,
        strict: true,
      }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    const scopeId = parsed.positionals[0];
    if (!scopeId) return { error: 'scope_cli set: scope_id positional argument is required' };
    if (parsed.positionals.length > 1) {
      return {
        error: `scope_cli set: unrecognized arguments: ${parsed.positionals.slice(1).join(' ')}`,
      };
    }
    return { command: 'set', scopeId, project: Boolean(parsed.values.project) };
  }

  if (sub === 'list') {
    let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
    try {
      parsed = parseArgs({
        args: rest,
        options: { counts: { type: 'boolean' as const } },
        allowPositionals: true,
        strict: true,
      }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    if (parsed.positionals.length > 0) {
      return { error: `scope_cli list: unrecognized arguments: ${parsed.positionals.join(' ')}` };
    }
    return { command: 'list', counts: Boolean(parsed.values.counts) };
  }

  if (sub === 'hint') {
    let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
    try {
      parsed = parseArgs({
        args: rest,
        options: {},
        allowPositionals: true,
        strict: true,
      }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    const scopeId = parsed.positionals[0];
    if (!scopeId) return { error: 'scope_cli hint: scope_id positional argument is required' };
    if (parsed.positionals.length > 2) {
      return {
        error: `scope_cli hint: unrecognized arguments: ${parsed.positionals.slice(2).join(' ')}`,
      };
    }
    return { command: 'hint', scopeId, hint: parsed.positionals[1] ?? '' };
  }

  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: rest,
      options: { hint: { type: 'string' as const } },
      allowPositionals: true,
      strict: true,
    }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const scopeId = parsed.positionals[0];
  const label = parsed.positionals[1];
  const hint = typeof parsed.values.hint === 'string' ? parsed.values.hint : undefined;
  if (!scopeId) return { error: 'scope_cli add: scope_id positional argument is required' };
  if (parsed.positionals.length > 2) {
    return {
      error: `scope_cli add: unrecognized arguments: ${parsed.positionals.slice(2).join(' ')}`,
    };
  }
  return {
    command: 'add',
    scopeId,
    ...(label !== undefined ? { label } : {}),
    ...(hint !== undefined ? { hint } : {}),
  };
}

function isScopeAction(s: string): s is ScopeAction {
  return (
    s === 'show' || s === 'set' || s === 'unset' || s === 'list' || s === 'add' || s === 'hint'
  );
}


export async function runScopeCli(
  argv: string[] = process.argv.slice(2),
  opts: ScopeCliOptions = {},
): Promise<number> {
  const r = resolveOpts(opts);
  const parsed = parseScopeCliArgs(argv);
  if ('error' in parsed) {
    r.stderr(`${parsed.error}\n`);
    return 2;
  }

  try {
    switch (parsed.command) {
      case 'show':
        return cmdShow(opts);
      case 'set':
        return cmdSet(opts, parsed);
      case 'unset':
        return cmdUnset(opts);
      case 'list':
        return cmdList(opts, parsed);
      case 'add':
        return cmdAdd(opts, parsed);
      case 'hint':
        return cmdHint(opts, parsed);
    }
  } catch (e) {
    if (e instanceof ScopeError) {
      r.stderr(`Error: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}
