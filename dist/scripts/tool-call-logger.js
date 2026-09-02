import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { text as readStreamText } from 'node:stream/consumers';
import { PRODUCT_DIR } from '../config/paths.js';
import { ENV_RUN_ID } from '../config/product.js';
import { resolveActiveWorkflow } from '../engine/active-workflow.js';
import { workflowFromRunId } from '../engine/run-id.js';
import { parseRootArg, resolveProjectRoot } from '../engine/project-root.js';
import { isValidRunId } from '../engine/run-id.js';
import { appendSessionMapEntry, appendSpool, extractChildSessionId, extractRunIdRef, extractRunToken, ledgerPathFor, listLiveRuns, lookupSessionMap, resolveRunByToken, runDirFor, } from '../engine/run-resolve.js';
import { HostValues } from '../types/enums.js';
const HOSTS = HostValues;
const READ_ONLY_TOOLS = new Set(
[
    'Read', 'Grep', 'Glob', 'LS', 'list', 'NotebookRead', 'WebFetch', 'WebSearch', 'TodoRead', 'view', 'rg',
    'read_file', 'read_many_files', 'list_directory', 'grep_search', 'search_file_content',
    'google_web_search', 'web_fetch', 'read_mcp_resource', 'list_mcp_resources',
    'update_topic', 'write_todos', 'ask_user', 'enter_plan_mode', 'exit_plan_mode', 'activate_skill',
].map((t) => t.toLowerCase()));
const MUTATION_TOOLS = new Set(
['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'create_file', 'create', 'str_replace_editor', 'write_file', 'replace'].map((t) => t.toLowerCase()));
const ENGINE_TOOL_NAMES = new Set([
    'workflow_resolve',
    'workflow_init',
    'workflow_resume',
    'workflow_finalize',
    'workflow_validate',
    'workflow_learn',
    'workflow_replan_dynamic',
    'workflow_validate_dynamic',
    'workflow_invoke_dynamic',
    'workflow_finalize_dynamic',
    'step_begin',
    'step_collect_result',
    'step_complete',
    'step_begin_dynamic',
    'step_collect_result_dynamic',
    'step_complete_dynamic',
    'agent_notes_write',
    'agent_notes_search',
]);
const ENGINE_STEP_WORK_TOOLS = new Set(['spec_write', 'spec_search', 'spec_link']);
const MAX_ARGS_LEN = 2000;
const MAX_RESULT_LEN = 500;
function asObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
        ? v
        : null;
}
function asStr(v) {
    return typeof v === 'string' && v ? v : null;
}
export function parseHost(argv) {
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--host' && i + 1 < argv.length) {
            const v = argv[i + 1] ?? '';
            return HOSTS.includes(v) ? v : null;
        }
        if (a !== undefined && a.startsWith('--host=')) {
            const v = a.slice('--host='.length);
            return HOSTS.includes(v) ? v : null;
        }
    }
    return null;
}
function parseName(tool) {
    if (tool.startsWith('mcp__')) {
        const seg = tool.split('__');
        return { short: seg[seg.length - 1] ?? tool, server: seg.length >= 3 ? (seg[1] ?? null) : null };
    }
    for (const server of ['workflow_engine', 'workflow_tools']) {
        const prefix = `${server}_`;
        if (tool.startsWith(prefix) && tool.length > prefix.length) {
            return { short: tool.slice(prefix.length), server };
        }
    }
    for (const server of ['workflow_engine', 'workflow_tools']) {
        const prefix = `${server}-`;
        if (tool.startsWith(prefix) && tool.length > prefix.length) {
            return { short: tool.slice(prefix.length), server };
        }
    }
    for (const server of ['workflow_engine', 'workflow_tools']) {
        const prefix = `mcp_${server}_`;
        if (tool.startsWith(prefix) && tool.length > prefix.length) {
            return { short: tool.slice(prefix.length), server };
        }
    }
    return { short: tool, server: null };
}
export function classifyKind(tool, server) {
    const t = tool.toLowerCase();
    if (server === 'workflow_tools' || t.includes('workflow_tools'))
        return 'script';
    if (t.startsWith('mcp__') || t.startsWith('mcp_') || t.startsWith('mcp:'))
        return 'mcp';
    if (tool === 'Bash' || t === 'bash' || t === 'shell' || t === 'powershell')
        return 'shell';
    if (t === 'run_shell_command')
        return 'shell';
    if (MUTATION_TOOLS.has(t))
        return 'builtin';
    if (READ_ONLY_TOOLS.has(t))
        return 'read';
    return 'other';
}
function sanitizeArgs(input) {
    if (input === undefined || input === null)
        return null;
    let s;
    try {
        s = JSON.stringify(input);
    }
    catch {
        return null;
    }
    if (s === undefined)
        return null;
    if (s.length <= MAX_ARGS_LEN)
        return input;
    return { _truncated: true, preview: s.slice(0, MAX_ARGS_LEN) };
}
function resultPreview(result) {
    if (result === undefined || result === null)
        return null;
    let s;
    if (typeof result === 'string')
        s = result;
    else {
        try {
            s = JSON.stringify(result);
        }
        catch {
            s = String(result);
        }
    }
    if (!s)
        return null;
    return s.length > MAX_RESULT_LEN ? `${s.slice(0, MAX_RESULT_LEN)}…` : s;
}
export function normalizeEvent(obj, host, cwd, now) {
    let tool = asStr(obj.tool_name) ?? asStr(obj.toolName) ?? '';
    if (!tool) {
        if (asStr(obj.command) !== null)
            tool = 'Bash';
        else if (asStr(obj.file_path) !== null)
            tool = 'Edit';
    }
    if (!tool)
        return null;
    const { short, server } = parseName(tool);
    if ((server === 'workflow_engine' || ENGINE_TOOL_NAMES.has(short)) &&
        !ENGINE_STEP_WORK_TOOLS.has(short)) {
        return null;
    }
    const kind = classifyKind(tool, server);
    if (kind === 'read')
        return null;
    let copilotArgs;
    if (obj.toolArgs !== undefined) {
        const rawArgs = obj.toolArgs;
        if (typeof rawArgs === 'string') {
            try {
                copilotArgs = JSON.parse(rawArgs);
            }
            catch {
                copilotArgs = rawArgs;
            }
        }
        else {
            copilotArgs = rawArgs;
        }
    }
    const params = obj.tool_input !== undefined
        ? obj.tool_input
        : copilotArgs !== undefined
            ? copilotArgs
            : asStr(obj.command) !== null
                ? { command: obj.command }
                : obj.edits !== undefined
                    ? { file_path: obj.file_path, edits: obj.edits }
                    : undefined;
    const copilotResult = obj.toolResult !== null && typeof obj.toolResult === 'object'
        ? (obj.toolResult.textResultForLlm ?? obj.toolResult)
        : undefined;
    const result = obj.tool_response !== undefined
        ? obj.tool_response
        : copilotResult !== undefined
            ? copilotResult
            : obj.result_json !== undefined
                ? obj.result_json
                : obj.output !== undefined
                    ? obj.output
                    : obj.tool_output;
    let runToken = null;
    let runRef = null;
    try {
        const fullArgsText = params === undefined ? null : JSON.stringify(params);
        runToken = extractRunToken(fullArgsText);
        if (!runToken)
            runRef = extractRunIdRef(join(cwd, PRODUCT_DIR), fullArgsText);
    }
    catch {
        runToken = null;
        runRef = null;
    }
    return {
        v: 1,
        ts: now,
        host: host ?? 'unknown',
        workflow: resolveActiveWorkflow(cwd)[0],
        step: null,
        agent_id: asStr(obj.agent_id),
        agent_type: asStr(obj.agent_type),
        corr: asStr(obj.conversation_id) ?? asStr(obj.turn_id) ?? asStr(obj.agent_id) ?? asStr(obj.sessionId),
        tool,
        tool_short: short,
        server,
        kind,
        args: sanitizeArgs(params),
        result_preview: resultPreview(result),
        success: true,
        source: 'hook',
        run_token: runToken,
        run_ref: runRef,
    };
}
function resolveEventRun(cwd, record) {
    const agentDir = join(cwd, PRODUCT_DIR);
    if (record.run_token) {
        const byToken = resolveRunByToken(agentDir, record.run_token);
        if (byToken) {
            if (record.corr)
                appendSessionMapEntry(agentDir, record.corr, byToken);
            const childSes = extractChildSessionId(record.result_preview);
            if (childSes)
                appendSessionMapEntry(agentDir, childSes, byToken);
            return { runId: byToken, via: 'token' };
        }
    }
    if (record.run_ref) {
        if (record.corr)
            appendSessionMapEntry(agentDir, record.corr, record.run_ref);
        return { runId: record.run_ref, via: 'run-ref' };
    }
    if (record.corr) {
        const mapped = lookupSessionMap(agentDir, record.corr);
        if (mapped && existsSync(runDirFor(agentDir, mapped)))
            return { runId: mapped, via: 'map' };
    }
    const envRunId = process.env[ENV_RUN_ID];
    if (envRunId && isValidRunId(envRunId) && existsSync(runDirFor(agentDir, envRunId))) {
        return { runId: envRunId, via: 'env' };
    }
    const live = listLiveRuns(agentDir);
    if (live.length === 1)
        return { runId: live[0].runId, via: 'unique' };
    return null;
}
export async function runToolCallLogger(opts = {}) {
    const argv = opts.argv ?? process.argv.slice(2);
    const cwd = opts.cwd ?? resolveProjectRoot(opts.startDir, parseRootArg(argv));
    if (cwd === null) {
        process.stderr.write('[tool-call-logger] no riglane project root found from the hook cwd — event dropped\n');
        return 0;
    }
    const host = parseHost(argv);
    const now = opts.now ?? new Date().toISOString();
    let raw;
    if (opts.stdin !== undefined) {
        raw = opts.stdin;
    }
    else {
        try {
            raw = await readStreamText(process.stdin);
        }
        catch {
            return 0;
        }
    }
    if (raw.charCodeAt(0) === 0xfeff)
        raw = raw.slice(1);
    let hookInput;
    try {
        hookInput = raw.trim() ? JSON.parse(raw) : {};
    }
    catch {
        return 0;
    }
    const obj = asObj(hookInput);
    if (!obj)
        return 0;
    const record = normalizeEvent(obj, host, cwd, now);
    if (!record)
        return 0;
    const agentDir = join(cwd, PRODUCT_DIR);
    const resolved = resolveEventRun(cwd, record);
    if (!resolved) {
        const liveCount = listLiveRuns(agentDir).length;
        appendSpool(agentDir, record, liveCount === 0 ? 'no live run' : `ambiguous: ${liveCount} live runs, no token/map/env signal`);
        return 0;
    }
    const ledgerPath = ledgerPathFor(agentDir, resolved.runId);
    const runWorkflow = workflowFromRunId(resolved.runId);
    const finalRecord = runWorkflow !== null ? { ...record, workflow: runWorkflow } : record;
    if (isMixedAdapterDuplicate(ledgerPath, finalRecord))
        return 0;
    try {
        appendFileSync(ledgerPath, `${JSON.stringify(finalRecord)}\n`, { encoding: 'utf-8' });
    }
    catch {
    }
    return 0;
}
const MIXED_ADAPTER_DEDUP_MS = 2500;
export function isMixedAdapterDuplicate(ledgerPath, record) {
    const corr = record.corr;
    const host = record.host;
    const args = (record.args ?? undefined);
    const file = (args && (args.file_path ?? args.filePath ?? args.path ?? args.command));
    const ts = typeof record.ts === 'string' ? Date.parse(record.ts) : NaN;
    const copilotPairCandidate = host === 'claude-code' || host === 'copilot';
    if ((!corr && !copilotPairCandidate) || !host || !file || Number.isNaN(ts))
        return false;
    try {
        const fd = openSync(ledgerPath, 'r');
        let tail;
        let truncated = false;
        try {
            const size = fstatSync(fd).size;
            const readLen = Math.min(size, 8192);
            truncated = size > readLen;
            const buf = Buffer.alloc(readLen);
            readSync(fd, buf, 0, readLen, size - readLen);
            tail = buf.toString('utf-8');
        }
        finally {
            closeSync(fd);
        }
        let lines = tail.split('\n');
        if (truncated)
            lines = lines.slice(1);
        lines = lines.filter((l) => l.trim().length > 0);
        for (let i = lines.length - 1; i >= 0; i -= 1) {
            let prev;
            try {
                prev = JSON.parse(lines[i]);
            }
            catch {
                continue;
            }
            const pTs = typeof prev.ts === 'string' ? Date.parse(prev.ts) : NaN;
            if (!Number.isNaN(pTs) && ts - pTs > MIXED_ADAPTER_DEDUP_MS)
                break;
            const pArgs = prev.args;
            const pFile = (pArgs &&
                (pArgs.file_path ?? pArgs.filePath ?? pArgs.path ?? pArgs.command));
            if (prev.corr === corr &&
                corr !== null &&
                prev.host !== host &&
                pFile === file &&
                !Number.isNaN(pTs) &&
                Math.abs(ts - pTs) <= MIXED_ADAPTER_DEDUP_MS) {
                return true;
            }
            const hostPair = new Set([host, String(prev.host ?? '')]);
            if (hostPair.has('copilot') &&
                hostPair.has('claude-code') &&
                prev.host !== host &&
                pFile === file &&
                !Number.isNaN(pTs) &&
                Math.abs(ts - pTs) <= MIXED_ADAPTER_DEDUP_MS) {
                return true;
            }
        }
    }
    catch {
        return false;
    }
    return false;
}
