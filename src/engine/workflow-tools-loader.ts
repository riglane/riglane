
import { spawnSync } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import process from 'node:process';
import { createInterface } from 'node:readline';

import { join } from 'node:path';
import * as ajvNs from 'ajv';
import { globSync } from 'glob';

import { resolveActiveWorkflow } from './active-workflow.js';
import { loadYaml } from './schema-validate.js';
import {
  guardScriptToolCall,
  makeToolName,
  type ScriptCallGuardVerdict,
} from './step-tool-rights.js';
import { defaultPaths } from './workflow-engine.js';

const Ajv = ajvNs.default as unknown as new (
  opts?: ConstructorParameters<typeof ajvNs.Ajv>[0],
) => InstanceType<typeof ajvNs.Ajv>;
const ajv = new Ajv({ strict: false, allErrors: true });


export function log(message: string): void {
  process.stderr.write(`[workflow-tools-loader] ${message}\n`);
}


let _resolvedPython: string | null = null;

export function resolvePython(): string {
  if (_resolvedPython !== null) return _resolvedPython;

  for (const candidate of ['python', 'python3']) {
    try {
      const r = spawnSync(candidate, ['--version'], {
        shell: true,
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (r.status === 0) {
        _resolvedPython = candidate;
        log(`Python resolved: ${candidate}`);
        return _resolvedPython;
      }
    } catch { }
  }

  _resolvedPython = 'python';
  log('Python resolution failed — falling back to "python"');
  return _resolvedPython;
}

export function resolveCommand(command: string): string {
  if (command.startsWith('python ') || command === 'python') {
    return resolvePython() + command.slice(6);
  }
  return command;
}


export function defaultTemplatesDir(cwd?: string): string {
  return defaultPaths(cwd).templatesDir;
}


export { makeToolName, normalizeName } from './step-tool-rights.js';


export function scanWorkflows(templatesDir: string): string[] {
  const pattern = join(templatesDir, '**', 'workflow.yaml');
  const matches = globSync(pattern, { windowsPathsNoEscape: true });
  return [...matches].sort();
}

export interface ScriptTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly _command: string;
  readonly _workflow: string;
  readonly _original_name: string;
}

export function buildToolRegistry(
  templatesDir: string,
  activeWorkflow: string | null = null,
): ScriptTool[] {
  const tools: ScriptTool[] = [];
  const paths = scanWorkflows(templatesDir);
  log(`Scanning ${paths.length} workflow.yaml files in ${templatesDir}`);

  for (const path of paths) {
    let wf: unknown;
    try {
      wf = loadYaml<unknown>(path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`Failed to load ${path}: ${msg}`);
      continue;
    }
    if (typeof wf !== 'object' || wf === null || Array.isArray(wf)) continue;

    const wfDict = wf as Record<string, unknown>;
    const wfName = wfDict.name;
    if (typeof wfName !== 'string' || !wfName) {
      log(`Skipping ${path}: no name field`);
      continue;
    }

    if (activeWorkflow && wfName !== activeWorkflow) continue;

    const wfTools = wfDict.tools;
    if (!Array.isArray(wfTools)) continue;

    for (const toolDef of wfTools) {
      if (typeof toolDef !== 'object' || toolDef === null || Array.isArray(toolDef)) continue;
      const td = toolDef as Record<string, unknown>;
      if (td.type !== 'script') continue;

      const toolName = td.name;
      const command = td.command;
      if (typeof toolName !== 'string' || !toolName || typeof command !== 'string' || !command) {
        log(`Skipping incomplete tool in ${path}: ${JSON.stringify(td)}`);
        continue;
      }

      const mcpName = makeToolName(wfName, toolName);
      const description =
        typeof td.description === 'string'
          ? td.description
          : `Script tool '${toolName}' from workflow '${wfName}'`;
      const inputSchemaRaw = td.input_schema;
      const isPopulatedSchema =
        typeof inputSchemaRaw === 'object' &&
        inputSchemaRaw !== null &&
        !Array.isArray(inputSchemaRaw) &&
        Object.keys(inputSchemaRaw).length > 0;
      const inputSchema: Record<string, unknown> = isPopulatedSchema
        ? (inputSchemaRaw as Record<string, unknown>)
        : { type: 'object', properties: {} };

      tools.push({
        name: mcpName,
        description,
        inputSchema,
        _command: command,
        _workflow: wfName,
        _original_name: toolName,
      });
    }
  }

  log(`Loaded ${tools.length} script tools from workflows`);
  return tools;
}


export type ArgValidator = (
  args: Record<string, unknown>,
  schema: Record<string, unknown>,
) => string | null;

export function validateArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown> | null | undefined,
): string | null {
  if (typeof schema !== 'object' || schema === null || Object.keys(schema).length === 0) {
    return null;
  }
  try {
    const validate = ajv.compile(schema);
    const ok = validate(args);
    if (ok) return null;
    const errs = validate.errors ?? [];
    const first = errs[0];
    if (!first) return 'Input validation failed: (no error detail)';
    const msg = first.message ?? '(no message)';
    const path =
      first.instancePath.length > 0
        ? first.instancePath.split('/').filter((s) => s.length > 0)
        : [];
    const reprSegments = path.map((p) => (/^\d+$/.test(p) ? p : `'${p}'`));
    return `Input validation failed: ${msg} (path: [${reprSegments.join(', ')}])`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Schema validation error: ${msg}`;
  }
}


export interface McpContentItem {
  readonly type: 'text';
  readonly text: string;
}

export interface ExecuteResult {
  readonly isError: boolean;
  readonly content: readonly McpContentItem[];
}

export function executeScriptTool(
  tool: ScriptTool,
  args: Record<string, unknown>,
  timeoutMs = 300_000,
): ExecuteResult {
  const command = resolveCommand(tool._command);
  const argsJson = JSON.stringify(args);

  const argParts: string[] = [];
  for (const [k, v] of Object.entries(args ?? {})) {
    let vStr: string;
    if (typeof v === 'object' && v !== null) {
      vStr = JSON.stringify(v);
    } else if (v === null || v === undefined) {
      vStr = '';
    } else {
      vStr = String(v);
    }
    argParts.push(`--${k}=${vStr}`);
  }
  const fullCommand = argParts.length > 0 ? `${command} ${argParts.join(' ')}` : command;

  const env = {
    ...process.env,
    WORKFLOW_TOOL_ARGS: argsJson,
    WORKFLOW_TOOL_NAME: tool._original_name,
    WORKFLOW_TOOL_WORKFLOW: tool._workflow,
  };

  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(fullCommand, [], {
      shell: true,
      encoding: 'utf-8',
      env,
      cwd: process.cwd(),
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      isError: true,
      content: [{ type: 'text', text: `Tool '${tool.name}' execution failed: ${msg}` }],
    };
  }

  const timedOut =
    result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (timedOut) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Tool '${tool.name}' timed out after ${Math.round(timeoutMs / 1000)}s`,
        },
      ],
    };
  }

  if (result.error) {
    const msg = result.error.message;
    return {
      isError: true,
      content: [{ type: 'text', text: `Tool '${tool.name}' execution failed: ${msg}` }],
    };
  }

  const signum =
    result.signal !== null && result.signal !== undefined
      ? osConstants.signals[result.signal as keyof typeof osConstants.signals]
      : undefined;
  const status = result.status ?? (signum !== undefined ? -signum : -1);
  if (status !== 0) {
    const stderr = (result.stderr as string | undefined) ?? '';
    const stdout = (result.stdout as string | undefined) ?? '';
    const errOutput = stderr || stdout || '(no output)';
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Tool '${tool.name}' exited with code ${status}\nstderr: ${errOutput.trim()}`,
        },
      ],
    };
  }

  const output = (result.stdout as string | undefined) ?? '';
  return {
    isError: false,
    content: [{ type: 'text', text: output }],
  };
}


export interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

export type Send = (payload: Record<string, unknown>) => void;

export function send(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function publicTool(t: ScriptTool): Record<string, unknown> {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  };
}

export interface DispatchOptions {
  readonly send?: Send;
  readonly validator?: ArgValidator;
  readonly timeoutMs?: number;
  readonly cwd?: string;
  readonly declarationGuard?: (
    agentDir: string,
    workflowName: string,
    calledName: string,
  ) => ScriptCallGuardVerdict;
}

export function dispatchMessage(
  req: JsonRpcRequest,
  toolMap: ReadonlyMap<string, ScriptTool>,
  publicTools: ReadonlyArray<Record<string, unknown>>,
  options: DispatchOptions = {},
): void {
  const writer = options.send ?? send;
  const validator = options.validator ?? validateArgs;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const method = req.method;
  const reqId = req.id ?? null;

  if (method === 'initialize') {
    writer({
      jsonrpc: '2.0',
      id: reqId,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'workflow_tools', version: '1.0.0' },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    writer({
      jsonrpc: '2.0',
      id: reqId,
      result: { tools: publicTools },
    });
    return;
  }

  if (method === 'tools/call') {
    const params = (req.params ?? {}) as Record<string, unknown>;
    const toolName = typeof params.name === 'string' ? params.name : '';
    const argsRaw = params.arguments;
    const args =
      typeof argsRaw === 'object' && argsRaw !== null && !Array.isArray(argsRaw)
        ? (argsRaw as Record<string, unknown>)
        : {};

    const tool = toolMap.get(toolName);
    if (!tool) {
      writer({
        jsonrpc: '2.0',
        id: reqId,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      });
      return;
    }

    if (options.cwd !== undefined) {
      const agentDir = defaultPaths(options.cwd).agentDir;
      const guard = options.declarationGuard ?? guardScriptToolCall;
      const verdict = guard(agentDir, tool._workflow, tool.name);
      if (!verdict.allowed) {
        log(`Declaration guard refused '${tool.name}' (${verdict.reason})`);
        writer({
          jsonrpc: '2.0',
          id: reqId,
          result: {
            isError: true,
            content: [{ type: 'text', text: verdict.refusal ?? 'Tool call refused.' }],
          },
        });
        return;
      }
      if (verdict.reason !== 'declared') {
        log(`Declaration guard passed '${tool.name}' permissively (${verdict.reason})`);
      }
    }

    const err = validator(args, tool.inputSchema);
    if (err) {
      writer({
        jsonrpc: '2.0',
        id: reqId,
        result: {
          isError: true,
          content: [{ type: 'text', text: err }],
        },
      });
      return;
    }

    const result = executeScriptTool(tool, args, timeoutMs);
    writer({
      jsonrpc: '2.0',
      id: reqId,
      result: {
        isError: result.isError,
        content: result.content,
      },
    });
    return;
  }

  if (reqId !== null) {
    writer({
      jsonrpc: '2.0',
      id: reqId,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

export async function serverLoop(
  toolMap: ReadonlyMap<string, ScriptTool>,
  publicTools: ReadonlyArray<Record<string, unknown>>,
  options: DispatchOptions = {},
): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`Invalid JSON-RPC: ${msg}`);
      continue;
    }
    dispatchMessage(req, toolMap, publicTools, options);
  }
}

export async function runWorkflowToolsCli(options: { cwd?: string } = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  log(`Starting workflow-tools-loader (cwd=${cwd})`);

  const [activeWorkflow, source] = resolveActiveWorkflow(cwd);
  if (activeWorkflow) {
    log(`Active workflow filter: '${activeWorkflow}' (source: ${source}) — registering only its script tools`);
  }

  const toolsInternal = buildToolRegistry(defaultTemplatesDir(cwd), activeWorkflow);
  if (activeWorkflow && toolsInternal.length === 0) {
    log(`Warning: active workflow '${activeWorkflow}' matched no scanned workflow.yaml — no script tools registered`);
  }
  const publicTools: ReadonlyArray<Record<string, unknown>> = toolsInternal.map(publicTool);
  const toolMap = new Map<string, ScriptTool>(toolsInternal.map((t) => [t.name, t]));

  await serverLoop(toolMap, publicTools, { cwd });

  log('workflow-tools-loader shutting down');
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  void runWorkflowToolsCli();
}
