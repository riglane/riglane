#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { ENV_NO_UI } from '../config/product.js';

import { SELECTABLE_ADAPTERS } from '../adapters/index.js';
import { runWorkflowToolsCli } from '../engine/workflow-tools-loader.js';
import { runScopeCli } from '../scope/scope-cli.js';
import { runFileGuard } from '../scripts/file-guard.js';
import { gateCheckCli } from '../scripts/gate-check.js';
import { runInitWorkflowCli } from '../scripts/init-workflow.js';
import { runSchemaValidateCli } from '../scripts/schema-validate-cli.js';
import { runSpawnThrottle } from '../scripts/spawn-throttle.js';
import { runToolCallLogger } from '../scripts/tool-call-logger.js';
import { runUpdateWorkflowsCli } from '../scripts/update-workflows.js';
import { runWorkflowEngineCli } from '../scripts/workflow-engine-server.js';
import { runWorkflowToolValidator } from '../scripts/workflow-tool-validator.js';

import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { runProjects } from './commands/projects.js';
import { runMigrate } from './commands/migrate.js';
import { runRunWorkflowCli } from './commands/run-workflow.js';
import { runServe } from './commands/serve.js';
import { runStatus } from './commands/status.js';
import { runUpdate } from './commands/update.js';
import { runCatalogCli } from './commands/catalog.js';
import { runAddCli } from './commands/add.js';
import { runSearchCli } from './commands/search.js';
import { isInstalledCommunityWorkflow, runUpdateEntryCli } from './commands/update-entry.js';
import { runTrustCli } from './commands/trust.js';
import { runValidateWorkflowCli } from './commands/validate-workflow.js';
import { runWorkflowClear } from './commands/workflow-clear.js';
import { VERSION } from './version.js';


export interface ParsedArgs {
  readonly path: string;
  readonly claude?: boolean;
  readonly cursor?: boolean;
  readonly codex?: boolean;
  readonly opencode?: boolean;
  readonly copilot?: boolean;
  readonly gemini?: boolean;
  readonly force?: boolean;
  readonly update?: boolean;
  readonly prune?: boolean;
  readonly dryRun?: boolean;
  readonly mcpTokenLimit?: number;
  readonly noSpecGuidance?: boolean;
  readonly backupTo?: string;
  readonly fix?: boolean;
}

export type CommandHandler = (args: ParsedArgs) => Promise<number> | number;

export interface CliOptions {
  readonly runMcpServer?: () => Promise<void>;
  readonly runMcpTools?: () => Promise<void>;
  readonly runGateCheck?: () => Promise<void>;
  readonly runFileGuard?: () => Promise<number>;
  readonly runSpawnThrottle?: () => Promise<number>;
  readonly runToolCallLogger?: () => Promise<number>;
  readonly runWorkflowToolValidator?: (argv: readonly string[]) => Promise<number>;
  readonly runSchemaValidate?: (argv: string[]) => Promise<number>;
  readonly runScope?: (argv: string[]) => Promise<number>;
  readonly runInitWorkflow?: (argv: string[]) => Promise<number>;
  readonly runUpdateWorkflows?: (argv: string[]) => Promise<number>;
  readonly runRunWorkflow?: (argv: string[]) => Promise<number> | number;
  readonly runServe?: (argv: string[]) => Promise<number> | number;
  readonly runStatus?: (argv: string[]) => Promise<number> | number;
  readonly runProjects?: (argv: string[]) => Promise<number> | number;
  readonly runWorkflowClear?: (argv: string[]) => Promise<number>;
  readonly runCatalog?: (argv: string[]) => number;
  readonly runTrust?: (argv: string[]) => Promise<number>;
  readonly runAdd?: (argv: string[]) => Promise<number>;
  readonly runSearch?: (argv: string[]) => Promise<number>;
  readonly runUpdateEntry?: (argv: string[]) => Promise<number>;
  readonly runWizard?: () => Promise<number>;
  readonly init?: CommandHandler;
  readonly update?: CommandHandler;
  readonly doctor?: CommandHandler;
  readonly migrate?: CommandHandler;
}


function notImplemented(name: string): number {
  process.stderr.write(`[riglane] subcommand '${name}' is not yet implemented.\n`);
  return 2;
}

export function stubInit(_args: ParsedArgs): number {
  void _args;
  return notImplemented('init');
}

export function stubUpdate(_args: ParsedArgs): number {
  void _args;
  return notImplemented('update');
}

async function defaultInit(args: ParsedArgs): Promise<number> {
  const opts: Parameters<typeof runInit>[1] = {
    ...(args.force !== undefined ? { force: args.force } : {}),
    ...(args.update !== undefined ? { update: args.update } : {}),
    ...(args.prune !== undefined ? { prune: args.prune } : {}),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.claude !== undefined ? { claude: args.claude } : {}),
    ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
    ...(args.codex !== undefined ? { codex: args.codex } : {}),
    ...(args.opencode !== undefined ? { opencode: args.opencode } : {}),
    ...(args.copilot !== undefined ? { copilot: args.copilot } : {}),
    ...(args.gemini !== undefined ? { gemini: args.gemini } : {}),
    ...(args.mcpTokenLimit !== undefined ? { mcpTokenLimit: args.mcpTokenLimit } : {}),
    ...(args.noSpecGuidance ? { specGuidance: false } : {}),
  };
  return runInit(args.path, opts);
}

async function defaultUpdate(args: ParsedArgs): Promise<number> {
  const opts: Parameters<typeof runUpdate>[1] = {
    ...(args.prune !== undefined ? { prune: args.prune } : {}),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.claude !== undefined ? { claude: args.claude } : {}),
    ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
    ...(args.codex !== undefined ? { codex: args.codex } : {}),
    ...(args.opencode !== undefined ? { opencode: args.opencode } : {}),
    ...(args.copilot !== undefined ? { copilot: args.copilot } : {}),
    ...(args.gemini !== undefined ? { gemini: args.gemini } : {}),
    ...(args.mcpTokenLimit !== undefined ? { mcpTokenLimit: args.mcpTokenLimit } : {}),
    ...(args.noSpecGuidance ? { specGuidance: false } : {}),
  };
  return runUpdate(args.path, opts);
}

async function defaultDoctor(args: ParsedArgs): Promise<number> {
  const opts: Parameters<typeof runDoctor>[1] = {
    ...(args.fix !== undefined ? { fix: args.fix } : {}),
  };
  return runDoctor(args.path, opts);
}

async function defaultMigrate(args: ParsedArgs): Promise<number> {
  const opts: Parameters<typeof runMigrate>[1] = {
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.backupTo !== undefined ? { backupTo: args.backupTo } : {}),
  };
  return runMigrate(args.path, opts);
}

export function stubDoctor(_args: ParsedArgs): number {
  void _args;
  return notImplemented('doctor');
}

export function stubMigrate(_args: ParsedArgs): number {
  void _args;
  return notImplemented('migrate');
}

async function defaultWizard(): Promise<number> {
  const { runWizard } = await import('./commands/wizard.js');
  return runWizard();
}


const HELP_TEXT = `usage: riglane [--version] <command> [<args>]

Riglane — a control plane for coding-agent harnesses.

commands:
  init        Bootstrap Riglane in a project (seed templates, write .mcp.json, wire hooks).
  update      Refresh predefined workflow templates in a project (preserves my_workflows).
  doctor      Diagnose Riglane setup in a project.
  migrate     Migrate a legacy install (.acp / .agent era) to the current Riglane setup.
  mcp-server               Launch the workflow engine as an MCP stdio server.
  mcp-tools                Launch the workflow tools loader as an MCP stdio server.
  gate-check               Run the gate-check hook (invoked by Claude Code / Cursor hooks).
  file-guard               PreToolUse hook protecting engine files (invoked by CC hooks).
  spawn-throttle           SubagentStart hook throttling parallel spawns for prompt-cache reuse.
  tool-call-logger         PostToolUse/afterMCPExecution hook logging tool calls to the trace ledger.
  workflow-tool-validator  PreToolUse hook validating script tool input schemas.
  schema-validate          Validate <output> against <schema> (inline workflow validation).
  validate-workflow        Validate a workflow.yaml (full structural + reference checks).
  catalog pack [dir]       Generate entry.lock.yaml — the capability inventory of a shared workflow.
  search [query]           Find workflows in the public catalog.
  add <id|dir>             Install a catalog workflow (inspect first; lands switched off).
  update <id>              Move an installed catalog workflow to its newer pinned commit (shows the diff).
  trust <id>               Enable a catalog-installed community workflow (shows what it can execute).
  scope                    Manage spec scopes (show/set/unset/list/add/hint).
  init-workflow            Generate per-step subagent files for a workflow.
  update-workflows         Refresh installed workflow templates from package.
  run-workflow             Launch an agent to run a workflow (scopes MCP tools to it).
  serve                    Run the localhost server standalone (tools + Local API, token-gated).
  status                   Report project Riglane state (installed/drift). Use --json for tools.
  projects                 List registered projects; forget scratch ones (--temp, --gone, --delete).
  workflow-clear           Finalize a stuck in-progress workflow run (cleanup).
  ui                       Open the interactive Ink UI (projects / settings / doctor / status).

options:
  --version   Show version and exit.
  -h, --help  Show this help message and exit.
  help        Alias for --help.

init/update flags:
  adapters    --claude | --cursor | --codex | --opencode | --copilot | --gemini
              (mutually exclusive; default: all detected/registered adapters)
  behavior    --force  --dry-run  --no-spec-guidance  --mcp-token-limit <n>

Run \`riglane\` with no command in a terminal to open the interactive menu
(equivalent to \`riglane ui\`); set RIGLANE_NO_UI=1 to print this help instead.
`;


function parseInitOrUpdateArgs(rest: string[], isInit: boolean): ParsedArgs | { error: string } {
  const optionsConfig = {
    claude: { type: 'boolean' as const },
    cursor: { type: 'boolean' as const },
    codex: { type: 'boolean' as const },
    opencode: { type: 'boolean' as const },
    copilot: { type: 'boolean' as const },
    gemini: { type: 'boolean' as const },
    force: { type: 'boolean' as const },
    update: { type: 'boolean' as const },
    prune: { type: 'boolean' as const },
    'dry-run': { type: 'boolean' as const },
    'mcp-token-limit': { type: 'string' as const, default: '50000' },
    'no-spec-guidance': { type: 'boolean' as const },
  };
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: rest,
      options: optionsConfig,
      allowPositionals: true,
      strict: true,
    }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }

  if (parsed.positionals.length > 1) {
    const cmd = isInit ? 'init' : 'update';
    return {
      error: `riglane ${cmd}: unrecognized arguments: ${parsed.positionals.slice(1).join(' ')}`,
    };
  }

  const selectedAdapterFlags = SELECTABLE_ADAPTERS.filter((a) => Boolean(parsed.values[a]));
  if (selectedAdapterFlags.length > 1) {
    const cmd = isInit ? 'init' : 'update';
    return {
      error: `riglane ${cmd}: argument --${selectedAdapterFlags[1]}: not allowed with argument --${selectedAdapterFlags[0]}`,
    };
  }

  const path = parsed.positionals[0] ?? '.';
  const tokenLimitStr = (parsed.values['mcp-token-limit'] as string | undefined) ?? '50000';
  const mcpTokenLimit = Number.parseInt(tokenLimitStr, 10);
  if (!Number.isFinite(mcpTokenLimit)) {
    return { error: `riglane: --mcp-token-limit expects integer, got: ${tokenLimitStr}` };
  }

  const out: ParsedArgs = {
    path,
    claude: Boolean(parsed.values.claude),
    cursor: Boolean(parsed.values.cursor),
    codex: Boolean(parsed.values.codex),
    opencode: Boolean(parsed.values.opencode),
    copilot: Boolean(parsed.values.copilot),
    gemini: Boolean(parsed.values.gemini),
    force: Boolean(parsed.values.force),
    update: Boolean(parsed.values.update),
    prune: Boolean(parsed.values.prune),
    dryRun: Boolean(parsed.values['dry-run']),
    mcpTokenLimit,
    noSpecGuidance: Boolean(parsed.values['no-spec-guidance']),
  };
  return out;
}

function parseDoctorArgs(rest: string[]): ParsedArgs | { error: string } {
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        fix: { type: 'boolean' as const },
      },
      allowPositionals: true,
      strict: true,
    }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
  if (parsed.positionals.length > 1) {
    return {
      error: `riglane doctor: unrecognized arguments: ${parsed.positionals.slice(1).join(' ')}`,
    };
  }
  const path = parsed.positionals[0] ?? '.';
  const fix = Boolean(parsed.values.fix);
  return { path, fix };
}

function parseMigrateArgs(rest: string[]): ParsedArgs | { error: string } {
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        'dry-run': { type: 'boolean' as const },
        'backup-to': { type: 'string' as const },
      },
      allowPositionals: true,
      strict: true,
    }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
  if (parsed.positionals.length > 1) {
    return {
      error: `riglane migrate: unrecognized arguments: ${parsed.positionals.slice(1).join(' ')}`,
    };
  }
  const path = parsed.positionals[0] ?? '.';
  const backupTo = parsed.values['backup-to'] as string | undefined;
  const base: ParsedArgs = {
    path,
    dryRun: Boolean(parsed.values['dry-run']),
  };
  return backupTo !== undefined ? { ...base, backupTo } : base;
}


export async function main(argv?: string[], options: CliOptions = {}): Promise<number> {
  const args = argv ?? process.argv.slice(2);

  if (args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (args[0] === '--version') {
    process.stdout.write(`riglane ${VERSION}\n`);
    return 0;
  }
  if (args.length === 0) {
    const interactive =
      !process.env[ENV_NO_UI] && Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
    if (!interactive) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    const run = options.runWizard ?? defaultWizard;
    try {
      return await run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] ui failed: ${msg}\n`);
      return 1;
    }
  }

  const command = args[0] ?? '';
  const rest = args.slice(1);

  if (command === 'init') {
    const parsed = parseInitOrUpdateArgs(rest, true);
    if ('error' in parsed) {
      process.stderr.write(`${parsed.error}\n`);
      return 2;
    }
    const handler = options.init ?? defaultInit;
    return handler(parsed);
  }
  if (command === 'update') {
    const firstPositional = rest.find((a) => !a.startsWith('--'));
    if (firstPositional !== undefined && isInstalledCommunityWorkflow(undefined, firstPositional)) {
      const run = options.runUpdateEntry ?? runUpdateEntryCli;
      try {
        return await run(rest);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[riglane] update failed: ${msg}
`);
        return 1;
      }
    }
    const parsed = parseInitOrUpdateArgs(rest, false);
    if ('error' in parsed) {
      process.stderr.write(`${parsed.error}\n`);
      return 2;
    }
    const handler = options.update ?? defaultUpdate;
    return handler(parsed);
  }
  if (command === 'doctor') {
    const parsed = parseDoctorArgs(rest);
    if ('error' in parsed) {
      process.stderr.write(`${parsed.error}\n`);
      return 2;
    }
    const handler = options.doctor ?? defaultDoctor;
    return handler(parsed);
  }
  if (command === 'migrate') {
    const parsed = parseMigrateArgs(rest);
    if ('error' in parsed) {
      process.stderr.write(`${parsed.error}\n`);
      return 2;
    }
    const handler = options.migrate ?? defaultMigrate;
    return handler(parsed);
  }

  if (command === 'mcp-server') {
    const run = options.runMcpServer ?? runWorkflowEngineCli;
    try {
      await run();
      return 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] mcp-server failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'mcp-tools') {
    const run = options.runMcpTools ?? runWorkflowToolsCli;
    try {
      await run();
      return 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] mcp-tools failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'gate-check') {
    const run = options.runGateCheck ?? gateCheckCli;
    try {
      await run();
      return 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] gate-check failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'file-guard') {
    const run = options.runFileGuard ?? runFileGuard;
    try {
      return await run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] file-guard failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'spawn-throttle') {
    const run = options.runSpawnThrottle ?? runSpawnThrottle;
    try {
      return await run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] spawn-throttle failed: ${msg}\n`);
      return 0;
    }
  }
  if (command === 'tool-call-logger') {
    const run = options.runToolCallLogger ?? runToolCallLogger;
    try {
      return await run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] tool-call-logger failed: ${msg}\n`);
      return 0;
    }
  }
  if (command === 'workflow-tool-validator') {
    const run = options.runWorkflowToolValidator ?? runWorkflowToolValidator;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] workflow-tool-validator failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'schema-validate') {
    const run = options.runSchemaValidate ?? runSchemaValidateCli;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] schema-validate failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'scope') {
    const run = options.runScope ?? runScopeCli;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] scope failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'init-workflow') {
    const run = options.runInitWorkflow ?? runInitWorkflowCli;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] init-workflow failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'update-workflows') {
    const run = options.runUpdateWorkflows ?? runUpdateWorkflowsCli;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] update-workflows failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'run-workflow') {
    const run = options.runRunWorkflow ?? runRunWorkflowCli;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] run-workflow failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'status') {
    const run = options.runStatus ?? runStatus;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] status failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'serve') {
    const run = options.runServe ?? runServe;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] serve failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'workflow-clear') {
    const run = options.runWorkflowClear ?? runWorkflowClear;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] workflow-clear failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'search') {
    const run = options.runSearch ?? runSearchCli;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] search failed: ${msg}
`);
      return 1;
    }
  }
  if (command === 'add') {
    const run = options.runAdd ?? runAddCli;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] add failed: ${msg}
`);
      return 1;
    }
  }
  if (command === 'trust') {
    const run = options.runTrust ?? runTrustCli;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] trust failed: ${msg}
`);
      return 1;
    }
  }
  if (command === 'catalog') {
    const run = options.runCatalog ?? runCatalogCli;
    try {
      return run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] catalog failed: ${msg}
`);
      return 1;
    }
  }
  if (command === 'validate-workflow') {
    try {
      return runValidateWorkflowCli(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] validate-workflow failed: ${msg}\n`);
      return 1;
    }
  }
  if (command === 'projects') {
    const run = options.runProjects ?? runProjects;
    try {
      return await run(rest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] projects failed: ${msg}
`);
      return 1;
    }
  }
  if (command === 'ui') {
    const run = options.runWizard ?? defaultWizard;
    try {
      return await run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[riglane] ui failed: ${msg}\n`);
      return 1;
    }
  }

  process.stderr.write(`[riglane] subcommand '${command}' is not yet implemented.\n`);
  return 2;
}


const __argv1 = process.argv[1];
if (__argv1 !== undefined) {
  let __argv1Real: string;
  let __metaReal: string;
  try {
    __argv1Real = realpathSync(__argv1);
    __metaReal = realpathSync(fileURLToPath(import.meta.url));
  } catch {
    __argv1Real = __argv1;
    __metaReal = fileURLToPath(import.meta.url);
  }
  if (__argv1Real === __metaReal) {
    process.exitCode = 70;
    void main().then((code) => {
      process.exit(code);
    });
  }
}
