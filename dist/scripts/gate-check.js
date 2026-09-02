import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import process, { argv, env } from 'node:process';
import { ENV_RUN_ID } from '../config/product.js';
import { fileURLToPath } from 'node:url';
import { lockedJsonReadModifyWrite, setFileLockErrorLogger, } from '../engine/file-lock.js';
import { findStepConfig as treeFindStepConfig } from '../engine/workflow-tree.js';
import { GATE_LEDGER_SCHEMA, STRUCTURAL_GATE_DISABLED_DETAIL, emptyLedger, ledgerForStep, maxLoopOverBranches, recomputeAggregate, resolveStructuralGate, stepAwaitsExternalHuman, upsertBranch, } from '../engine/gate-ledger.js';
import { injectSpecAuthoringOutputs, loadSnapshot, branchOutputsFromResolved, narrowOutputsForBranch, normalizePerIterationOutputs, validateOutputs, } from '../engine/output-validator.js';
import { extractRunToken, resolveRunByToken, runDirFor } from '../engine/run-resolve.js';
import { runsRootDir } from '../engine/runs.js';
import { loadYaml } from '../engine/schema-validate.js';
import { resolveProjectRoot } from '../engine/project-root.js';
import { defaultPaths } from '../engine/workflow-engine.js';
import { GENERIC_SCOPE, resolveActiveScope, scopeFromPath } from '../scope/scope-context.js';
import { parseHostFlag } from './host-flag.js';
export function gateCheckPaths(cwd) {
    const base = defaultPaths(cwd ?? resolveProjectRoot() ?? undefined);
    const scriptsDir = join(base.agentDir, 'scripts');
    return {
        ...base,
        scriptsDir,
        schemaValidate: join(scriptsDir, 'schema-validate.py'),
    };
}
export { lockedJsonReadModifyWrite };
setFileLockErrorLogger((msg) => logGateError(msg));
export function findWorkflowDir(paths = gateCheckPaths()) {
    const runsRoot = runsRootDir(paths.agentDir);
    const envRun = process.env[ENV_RUN_ID];
    if (envRun) {
        const envDir = join(runsRoot, envRun);
        try {
            const envManifest = JSON.parse(readFileSync(join(envDir, 'manifest.json'), 'utf-8'));
            if (envManifest.status === 'in_progress' || envManifest.status === 'paused')
                return envDir;
        }
        catch {
        }
    }
    let bestDir = null;
    let bestTime = '';
    let bestStatus = '';
    const considerManifest = (dir) => {
        const manifestPath = join(dir, 'manifest.json');
        try {
            if (!statSync(manifestPath).isFile())
                return;
        }
        catch {
            return;
        }
        try {
            const data = JSON.parse(readFileSync(manifestPath, 'utf-8'));
            const status = data.status;
            if (status !== 'in_progress' && status !== 'paused')
                return;
            const updated = data.updated_at ?? '';
            const better = updated > bestTime ||
                (updated === bestTime && status === 'in_progress' && bestStatus !== 'in_progress');
            if (better) {
                bestTime = updated;
                bestDir = dir;
                bestStatus = status;
            }
        }
        catch {
        }
    };
    let runIds;
    try {
        runIds = readdirSync(runsRoot);
    }
    catch {
        return bestDir;
    }
    for (const rid of runIds) {
        if (rid === 'index.jsonl')
            continue;
        const runDir = join(runsRoot, rid);
        try {
            if (!statSync(runDir).isDirectory())
                continue;
        }
        catch {
            continue;
        }
        considerManifest(runDir);
        const dynamicDir = join(runDir, 'dynamic');
        let steps;
        try {
            if (!statSync(dynamicDir).isDirectory())
                continue;
            steps = readdirSync(dynamicDir);
        }
        catch {
            continue;
        }
        for (const step of steps) {
            considerManifest(join(dynamicDir, step));
        }
    }
    return bestDir;
}
export function detectRunAttributionWarning(paths, workflowName, env = process.env) {
    if (env[ENV_RUN_ID])
        return null;
    const runsRoot = runsRootDir(paths.agentDir);
    let entries;
    try {
        entries = readdirSync(runsRoot);
    }
    catch {
        return null;
    }
    const active = [];
    for (const rid of entries) {
        if (rid === 'index.jsonl')
            continue;
        try {
            const m = JSON.parse(readFileSync(join(runsRoot, rid, 'manifest.json'), 'utf-8'));
            if (m.workflow === workflowName && (m.status === 'in_progress' || m.status === 'paused')) {
                active.push(rid);
            }
        }
        catch {
        }
    }
    if (active.length <= 1)
        return null;
    return (`Ambiguous run attribution: ${active.length} active runs of workflow ` +
        `'${workflowName}' and no ${ENV_RUN_ID} env — this gate invocation was attributed ` +
        `to the most-recently-updated run (best-effort). For parallel same-workflow ` +
        `execution, set ${ENV_RUN_ID} to pin the exact run. Active runs: ${active.sort().join(', ')}.`);
}
export function findDefinitionDir(workflowDir, paths = gateCheckPaths()) {
    let workflowName = workflowDir.split(/[\\/]/).pop() ?? '';
    try {
        const m = JSON.parse(readFileSync(join(workflowDir, 'manifest.json'), 'utf-8'));
        if (typeof m.workflow === 'string' && m.workflow.length > 0)
            workflowName = m.workflow;
    }
    catch {
    }
    const candidates = [
        join(paths.myWorkflowsDir, workflowName),
        join(paths.predefinedDir, workflowName),
        join(paths.examplesDir, workflowName),
        join(paths.communityDir, workflowName),
    ];
    for (const c of candidates) {
        try {
            if (statSync(join(c, 'workflow.yaml')).isFile())
                return c;
        }
        catch {
        }
    }
    try {
        if (statSync(join(workflowDir, 'workflow.yaml')).isFile())
            return workflowDir;
    }
    catch {
    }
    return workflowDir;
}
export function findCurrentStep(manifest) {
    const current = manifest.current_step;
    const steps = (manifest.steps ?? {});
    if (current && current in steps) {
        return [current, steps[current] ?? null];
    }
    return [null, null];
}
export function definitionIndex(workflowConfig, stepName, fallback) {
    if (workflowConfig) {
        const steps = (workflowConfig.steps ?? []);
        for (let i = 0; i < steps.length; i += 1) {
            if (steps[i]?.name === stepName)
                return i;
        }
    }
    return fallback;
}
export function findStepConfig(workflowYaml, stepName) {
    return treeFindStepConfig(workflowYaml, stepName) ?? {};
}
export function findStepOutputs(workflowYaml, stepName) {
    const step = findStepConfig(workflowYaml, stepName);
    return (step.outputs ?? []);
}
export function getMaxGateRetries(workflowConfig, stepName) {
    const defaultLimit = 5;
    const wfGate = (workflowConfig.gate ?? {});
    const workflowLimit = wfGate.max_gate_retries ?? defaultLimit;
    const step = findStepConfig(workflowConfig, stepName);
    const stepGate = (step.gate ?? {});
    return stepGate.max_gate_retries ?? workflowLimit;
}
export function isCopilotSessionTranscript(transcriptPath) {
    const norm = transcriptPath.replace(/\\/g, '/').toLowerCase();
    return norm.includes('/.copilot/') && norm.includes('/session-state/');
}
export function detectHost(hookInput) {
    if ('cursor_version' in hookInput || 'loop_count' in hookInput)
        return 'cursor';
    if (hookInput.agent_id || hookInput.agent_transcript_path || hookInput.agent_type) {
        return 'claude-code';
    }
    return 'cursor';
}
export function extractFromTranscript(transcriptPath) {
    const empty = {
        model: null,
        duration_ms: null,
        message_count: 0,
        tool_call_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        modified_files: [],
    };
    if (!transcriptPath)
        return empty;
    let isFile = false;
    try {
        isFile = statSync(transcriptPath).isFile();
    }
    catch {
        isFile = false;
    }
    if (!isFile)
        return empty;
    try {
        const timestamps = [];
        const models = new Set();
        const modified = new Set();
        let toolCalls = 0;
        let msgCount = 0;
        let inputTokens = 0;
        let outputTokens = 0;
        const content = readFileSync(transcriptPath, 'utf-8');
        const lines = content.split('\n');
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line)
                continue;
            let entry;
            try {
                entry = JSON.parse(line);
            }
            catch {
                continue;
            }
            msgCount += 1;
            const ts = entry.timestamp;
            if (ts)
                timestamps.push(ts);
            const msg = entry.message;
            if (!msg || typeof msg !== 'object' || Array.isArray(msg))
                continue;
            const model = msg.model;
            if (model)
                models.add(model);
            const usage = msg.usage;
            if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
                inputTokens += usage.input_tokens ?? 0;
                outputTokens += usage.output_tokens ?? 0;
            }
            const blocks = msg.content;
            if (Array.isArray(blocks)) {
                for (const blockRaw of blocks) {
                    if (blockRaw === null || typeof blockRaw !== 'object' || Array.isArray(blockRaw)) {
                        continue;
                    }
                    const block = blockRaw;
                    if (block.type === 'tool_use') {
                        toolCalls += 1;
                        const name = block.name ?? '';
                        const inp = block.input;
                        if (inp && typeof inp === 'object' && !Array.isArray(inp)) {
                            const fp = inp.file_path;
                            if ((name === 'Write' || name === 'Edit') && fp)
                                modified.add(fp);
                        }
                    }
                }
            }
        }
        let durationMs = null;
        if (timestamps.length >= 2) {
            try {
                const t1 = Date.parse(timestamps[0] ?? '');
                const t2 = Date.parse(timestamps[timestamps.length - 1] ?? '');
                if (!Number.isNaN(t1) && !Number.isNaN(t2)) {
                    durationMs = Math.max(0, t2 - t1);
                }
            }
            catch {
            }
        }
        const sortedModels = [...models].sort();
        return {
            model: sortedModels[0] ?? null,
            duration_ms: durationMs,
            message_count: msgCount,
            tool_call_count: toolCalls,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            modified_files: [...modified].sort(),
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logGateError(`Transcript extraction failed for ${transcriptPath}: ${msg}`);
        return empty;
    }
}
const DERIVED_TASK_MAX_CHARS = 32_000;
export function deriveTaskTextFromTranscript(transcriptPath) {
    if (!transcriptPath)
        return null;
    let isFile = false;
    try {
        isFile = statSync(transcriptPath).isFile();
    }
    catch {
        isFile = false;
    }
    if (!isFile)
        return null;
    try {
        const content = readFileSync(transcriptPath, 'utf-8');
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (!line)
                continue;
            let entry;
            try {
                entry = JSON.parse(line);
            }
            catch {
                continue;
            }
            const message = (entry.message ?? {});
            const isUser = entry.type === 'user' || message.role === 'user';
            if (!isUser)
                continue;
            const c = message.content;
            let text;
            if (typeof c === 'string') {
                text = c;
            }
            else if (Array.isArray(c)) {
                text = c
                    .map((b) => typeof b?.text === 'string'
                    ? b.text
                    : '')
                    .join('\n');
            }
            else {
                continue;
            }
            const trimmed = text.trim();
            if (!trimmed)
                continue;
            return trimmed.slice(0, DERIVED_TASK_MAX_CHARS);
        }
        return null;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logGateError(`Task-text derivation failed for ${transcriptPath}: ${msg}`);
        return null;
    }
}
export function buildFollowup(stepName, passed, checks, failures, details) {
    if (passed)
        return null;
    const limited = details.slice(0, 10).join('; ');
    const remaining = details.length - 10;
    const detailStr = remaining > 0 ? `${limited}; ... and ${remaining} more issues` : limited;
    return `STRUCTURAL GATE FAILED for step '${stepName}' (${failures}/${checks} checks failed). Issues: ${detailStr}. Fix the issues and retry the step.`;
}
export function outputAndExit(host, followup, scopeWarning = null) {
    let finalFollowup = followup;
    if (scopeWarning) {
        finalFollowup = finalFollowup ? `${scopeWarning}\n\n${finalFollowup}` : scopeWarning;
    }
    if (host === 'claude-code') {
        if (followup) {
            process.stderr.write(`${finalFollowup ?? ''}\n`);
            process.exit(2);
        }
        else {
            if (scopeWarning)
                process.stderr.write(`${scopeWarning}\n`);
            process.exit(0);
        }
    }
    else if (host === 'codex') {
        if (followup) {
            process.stdout.write(`${JSON.stringify({ decision: 'block', reason: finalFollowup ?? '' })}\n`);
        }
        else {
            if (scopeWarning)
                process.stderr.write(`${scopeWarning}\n`);
            process.stdout.write('{}\n');
        }
        process.exit(0);
    }
    else if (host === 'copilot') {
        if (followup) {
            process.stdout.write(`${JSON.stringify({ decision: 'block', reason: finalFollowup ?? '' })}\n`);
        }
        else {
            if (scopeWarning)
                process.stderr.write(`${scopeWarning}\n`);
            process.stdout.write(`${JSON.stringify({ decision: 'allow' })}\n`);
        }
        process.exit(0);
    }
    else if (host === 'gemini') {
        if (followup) {
            process.stdout.write(`${JSON.stringify({ decision: 'block', reason: finalFollowup ?? '' })}\n`);
        }
        else {
            if (scopeWarning)
                process.stderr.write(`${scopeWarning}\n`);
            process.stdout.write('{}\n');
        }
        process.exit(0);
    }
    else {
        const output = finalFollowup ? { followup_message: finalFollowup } : {};
        process.stdout.write(`${JSON.stringify(output)}\n`);
        process.exit(0);
    }
    throw new Error('unreachable');
}
export function logGateError(message, paths = gateCheckPaths()) {
    try {
        const logPath = join(paths.agentDir, 'gate-check-error.log');
        mkdirSync(paths.agentDir, { recursive: true });
        const line = `${nowIsoNaive()} | ${message}\n`;
        const fd = openSync(logPath, 'a');
        try {
            writeFileSync(fd, line, 'utf-8');
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
    }
}
export function isRootRelativePath(path) {
    return path.length >= 2 && path[0] === '.' && /\p{L}/u.test(path[1] ?? '');
}
export function detectCrossScopeWrites(modifiedFiles) {
    if (modifiedFiles.length === 0)
        return null;
    let activeScope;
    try {
        [activeScope] = resolveActiveScope();
    }
    catch {
        return null;
    }
    const offenders = [];
    const engineOwned = [];
    for (const fp of modifiedFiles) {
        const pathScope = scopeFromPath(fp);
        if (pathScope === null)
            continue;
        const base = fp.replace(/\\/g, '/').split('/').pop() ?? '';
        if (base === '_index.json' || base === '_registry.json') {
            engineOwned.push(fp);
            continue;
        }
        if (pathScope === GENERIC_SCOPE)
            continue;
        if (pathScope === activeScope)
            continue;
        offenders.push([fp, pathScope]);
    }
    const parts = [];
    if (engineOwned.length > 0) {
        parts.push(`ENGINE-OWNED FILE WARNING: detected ${engineOwned.length} manual edit(s) of engine-owned _index.json/_registry.json under .riglane/specs/. These are derived + maintained by the engine (spec_write / spec_link) and must NEVER be hand-edited; the file-guard PreToolUse hook blocks them on Claude Code and Cursor (a drifted _index.json also self-heals via 'riglane doctor --fix'). Revert and use spec_write / spec_link (or spec_write op:update set_domain_description:true to change a domain description):\n${engineOwned.map((f) => `  - ${f}`).join('\n')}`);
    }
    if (offenders.length > 0) {
        const lines = offenders.map(([fp, ps]) => `  - ${fp} (scope: ${ps})`);
        parts.push(`SCOPE WARNING: detected ${offenders.length} spec write(s) outside the active scope '${activeScope}'. There is NO live pre-write block for cross-scope spec writes on any host — this is a post-facto warning only. Review whether this was intentional:\n${lines.join('\n')}\nIf accidental: /riglane-scope-set to the correct scope and re-run with proper --scope param. Consider reverting the listed file(s).`);
    }
    return parts.length > 0 ? parts.join('\n\n') : null;
}
export { resolve as resolvePathAbsolute, isAbsolute as isAbsolutePath, join as joinPath };
export function buildTraceModifier(manifest, stepName, hookInput, gateResult, workflowConfig, loopCount, followupMessage = null, attributionWarning = null) {
    return (trace) => {
        if (!('gate_config' in trace) && workflowConfig) {
            const wfGate = (workflowConfig.gate ?? {});
            trace.gate_config = {
                structural: wfGate.structural ?? true,
                semantic: wfGate.semantic ?? false,
                human: wfGate.human ?? false,
                max_gate_retries: wfGate.max_gate_retries ?? 5,
                max_step_retries: wfGate.max_step_retries ?? 3,
                allow_partial_step_complete: wfGate.allow_partial_step_complete ?? false,
            };
        }
        const steps = (trace.steps ?? []);
        let stepEntry = null;
        for (const s of steps) {
            if (s.name === stepName && s.loop_archived !== true) {
                stepEntry = s;
                break;
            }
        }
        if (stepEntry === null) {
            const stepCfg = workflowConfig ? findStepConfig(workflowConfig, stepName) : {};
            const stepGateOverride = stepCfg.gate ?? null;
            const rawInputs = (stepCfg.inputs ?? []);
            const rawOutputs = (stepCfg.outputs ?? []);
            const inputsList = [];
            for (const inp of rawInputs) {
                if (inp !== null && typeof inp === 'object' && !Array.isArray(inp)) {
                    const i = inp;
                    inputsList.push({
                        path: i.path ?? '',
                        inject: i.inject ?? 'reference',
                        struct: i.struct,
                    });
                }
                else if (typeof inp === 'string') {
                    inputsList.push({ path: inp, inject: 'reference' });
                }
            }
            const outputsList = [];
            for (const out of rawOutputs) {
                if (out !== null && typeof out === 'object' && !Array.isArray(out)) {
                    const o = out;
                    outputsList.push({ path: o.path ?? '', struct: o.struct });
                }
                else if (typeof out === 'string') {
                    outputsList.push({ path: out });
                }
            }
            stepEntry = {
                name: stepName,
                index: definitionIndex(workflowConfig, stepName, steps.length),
                status: 'in_progress',
                config: {
                    spec_check: stepCfg.spec_check ?? false,
                    subagent: stepCfg.subagent ?? true,
                    gate: stepGateOverride,
                },
                goal: stepCfg.goal,
                inputs: inputsList.length > 0 ? inputsList : null,
                outputs: outputsList.length > 0 ? outputsList : null,
                started_at: null,
                completed_at: null,
                duration_ms: null,
                invocations: [],
                retry_count: 0,
                summary: null,
            };
            steps.push(stepEntry);
            trace.steps = steps;
        }
        const invocations = (stepEntry.invocations ?? []);
        const existingCount = invocations.length;
        const taskText = hookInput.task ?? '';
        let retryType;
        if (existingCount === 0) {
            retryType = null;
        }
        else if (taskText.includes('<!--workflow:branch:')) {
            retryType = 'branch';
        }
        else if (loopCount >= 1) {
            retryType = 'gate';
        }
        else {
            retryType = 'step';
        }
        const nowIso = nowIsoLocal();
        const transcriptPath = hookInput.agent_transcript_path ?? null;
        const tx = extractFromTranscript(transcriptPath);
        const durationMs = hookInput.duration_ms || tx.duration_ms || 0;
        const model = hookInput.model || tx.model;
        const messageCount = hookInput.message_count || tx.message_count;
        const toolCallCount = hookInput.tool_call_count || tx.tool_call_count;
        const modifiedFiles = hookInput.modified_files || tx.modified_files;
        const subagentId = hookInput.subagent_id || hookInput.agent_id;
        const invocation = {
            iteration: existingCount + 1,
            retry_type: retryType,
            completed_at: nowIso,
            duration_ms: durationMs,
            hook_status: hookInput.status ?? 'unknown',
            message_count: messageCount,
            tool_call_count: toolCallCount,
            modified_files: modifiedFiles,
            subagent_id: subagentId,
            task_prompt: hookInput.task,
            subagent_summary: hookInput.summary ||
                hookInput.last_assistant_message,
            transcript_path: transcriptPath,
            model,
            token_usage: tx.input_tokens > 0 || tx.output_tokens > 0
                ? { input: tx.input_tokens, output: tx.output_tokens }
                : null,
            gate: {
                type: gateResult.gate_type ?? 'structural',
                passed: gateResult.passed ?? false,
                checks: gateResult.checks ?? 0,
                failures: gateResult.failures ?? 0,
                details: gateResult.details ?? [],
            },
            followup_message: followupMessage,
            ...(attributionWarning ? { attribution_warning: attributionWarning } : {}),
        };
        invocations.push(invocation);
        stepEntry.invocations = invocations;
        if (stepEntry.started_at === null || stepEntry.started_at === undefined) {
            if (durationMs > 0) {
                const startMs = Date.parse(nowIso) - durationMs;
                stepEntry.started_at = new Date(startMs).toISOString();
            }
            else {
                stepEntry.started_at = nowIso;
            }
        }
        stepEntry.completed_at = nowIso;
        stepEntry.retry_count = invocations.filter((inv) => {
            const rt = inv.retry_type;
            return rt !== null && rt !== undefined && rt !== 'branch';
        }).length;
        if (stepEntry.started_at) {
            const startMs = Date.parse(stepEntry.started_at);
            const endMs = Date.parse(nowIso);
            if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
                stepEntry.duration_ms = endMs - startMs;
            }
            else {
                stepEntry.duration_ms = durationMs;
            }
        }
        if (gateResult.passed) {
            const wfGate = (workflowConfig?.gate ?? {});
            const stepCfg = workflowConfig ? findStepConfig(workflowConfig, stepName) : null;
            const stepGate = (stepCfg?.gate ?? {}) ?? {};
            const mSteps = (manifest.steps ?? {});
            const verdictSaysNo = mSteps[stepName]?.human_gate_verdict?.required === false;
            if (workflowConfig && !verdictSaysNo && stepAwaitsExternalHuman(wfGate, stepGate)) {
                stepEntry.status = 'in_progress';
                stepEntry.awaiting_human = true;
                stepEntry.completed_at = null;
            }
            else {
                stepEntry.status = 'completed';
            }
        }
        else {
            const maxGate = workflowConfig ? getMaxGateRetries(workflowConfig, stepName) : 5;
            if (loopCount >= maxGate) {
                stepEntry.status = 'failed';
            }
        }
        return trace;
    };
}
function nowIsoLocal(d = new Date()) {
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const offsetMin = -d.getTimezoneOffset();
    const offsetSign = offsetMin >= 0 ? '+' : '-';
    const offsetH = pad(Math.floor(Math.abs(offsetMin) / 60));
    const offsetM = pad(Math.abs(offsetMin) % 60);
    const ms = pad(d.getMilliseconds(), 3);
    return (`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}` +
        `${offsetSign}${offsetH}:${offsetM}`);
}
function nowIsoNaive(d = new Date()) {
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const ms = pad(d.getMilliseconds(), 3);
    return (`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`);
}
export async function appendTraceEntry(workflowDir, manifest, stepName, hookInput, gateResult, workflowConfig, loopCount, followupMessage = null, attributionWarning = null) {
    try {
        let runId = manifest.run_id ?? '';
        if (!runId) {
            const wfName = manifest.workflow ?? 'unknown';
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            runId =
                `${wfName}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
                    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        }
        const tracePath = join(workflowDir, 'trace.json');
        const wfGate = (workflowConfig?.gate ?? {});
        const defaultTrace = {
            trace_version: 1,
            workflow: manifest.workflow ?? 'unknown',
            workflow_version: manifest.workflow_version ?? 1,
            run_id: runId,
            params: manifest.params ?? {},
            gate_config: {
                structural: wfGate.structural ?? true,
                semantic: wfGate.semantic ?? false,
                human: wfGate.human ?? false,
                max_gate_retries: wfGate.max_gate_retries ?? 5,
                max_step_retries: wfGate.max_step_retries ?? 3,
                allow_partial_step_complete: wfGate.allow_partial_step_complete ?? false,
            },
            started_at: manifest.started_at ?? '',
            completed_at: null,
            status: 'in_progress',
            total_duration_ms: null,
            total_messages: 0,
            total_tool_calls: 0,
            total_modified_files: 0,
            steps: [],
        };
        const modifier = buildTraceModifier(manifest, stepName, hookInput, gateResult, workflowConfig, loopCount, followupMessage, attributionWarning);
        await lockedJsonReadModifyWrite(tracePath, modifier, defaultTrace);
    }
    catch (e) {
        const ctor = e instanceof Error ? e.constructor.name : e === null ? 'null' : typeof e;
        const body = e instanceof Error ? e.message : String(e);
        logGateError(`appendTraceEntry failed: ${ctor}: ${body}`);
    }
}
export { narrowOutputsForBranch };
async function readAllBytes(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
    }
    return Buffer.concat(chunks);
}
export { parseHostFlag };
export function resolveHost(hookInput, override) {
    return override ?? detectHost(hookInput);
}
export async function mainInner(options = {}) {
    const paths = options.paths ?? gateCheckPaths();
    const inStream = options.stdin ?? process.stdin;
    const procEnv = options.env ?? env;
    const hostOverride = options.host ?? parseHostFlag(options.argv ?? argv);
    let rawBytes = Buffer.alloc(0);
    let hookInput;
    try {
        rawBytes = await readAllBytes(inStream);
        if (rawBytes.length >= 3 &&
            rawBytes[0] === 0xef &&
            rawBytes[1] === 0xbb &&
            rawBytes[2] === 0xbf) {
            rawBytes = rawBytes.subarray(3);
        }
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
        if (raw.trim().length === 0) {
            const repr = JSON.stringify(rawBytes.subarray(0, 100).toString('utf-8'));
            logGateError(`Empty stdin received | raw_length=${rawBytes.length} | raw_repr=${repr}`, paths);
        }
        hookInput = raw.trim().length > 0 ? JSON.parse(raw) : {};
    }
    catch (e) {
        const isSyntax = e instanceof SyntaxError;
        const safeRepr = JSON.stringify(rawBytes.subarray(0, 500).toString('utf-8'));
        const len = rawBytes.length;
        const errMsg = e instanceof Error ? e.message : String(e);
        if (isSyntax) {
            logGateError(`Invalid hook input JSON: ${errMsg} | raw_length=${len} | raw_repr=${safeRepr}`, paths);
            process.stdout.write(`${JSON.stringify({ followup_message: `Gate error: invalid hook input — ${errMsg}` })}\n`);
            process.exit(0);
        }
        else {
            logGateError(`Stdin decode error: ${errMsg} | raw_repr=${safeRepr}`, paths);
            process.stdout.write(`${JSON.stringify({ followup_message: `Gate error: stdin decode failed — ${errMsg}` })}\n`);
            process.exit(0);
        }
        throw new Error('unreachable');
    }
    const testExit = procEnv.GATE_TEST_EXIT ?? '';
    if (testExit) {
        const host = resolveHost(hookInput, hostOverride);
        const testCode = Number.parseInt(testExit, 10);
        const msg = `GATE TEST MODE: Returning exit ${testCode}. Host detected: ${host}. If exit 2 works, this agent should NOT stop — it should receive this message and continue.`;
        logGateError(`GATE_TEST_EXIT=${testCode} | host=${host}`, paths);
        if (host === 'claude-code') {
            process.stderr.write(`${msg}\n`);
            process.exit(testCode);
        }
        else if (host === 'codex') {
            process.stdout.write(testCode !== 0 ? `${JSON.stringify({ decision: 'block', reason: msg })}\n` : '{}\n');
            process.exit(0);
        }
        else {
            if (testCode !== 0) {
                process.stdout.write(`${JSON.stringify({ followup_message: msg })}\n`);
            }
            else {
                process.stdout.write(`${JSON.stringify({})}\n`);
            }
            process.exit(0);
        }
        throw new Error('unreachable');
    }
    const gateDebug = procEnv.GATE_DEBUG ?? '';
    if (gateDebug) {
        const debugPath = join(paths.agentDir, 'gate-check-debug.log');
        try {
            mkdirSync(paths.agentDir, { recursive: true });
            const fd = openSync(debugPath, 'a');
            try {
                const ts = nowIsoNaive();
                const sep = '='.repeat(60);
                let body;
                if (gateDebug === '1') {
                    const keys = Object.keys(hookInput).sort();
                    body = `keys: [${keys.map((k) => `'${k}'`).join(', ')}]\nmodel: ${hookInput.model === undefined ? 'None' : JSON.stringify(hookInput.model)}\nstatus: ${hookInput.status === undefined ? 'None' : JSON.stringify(hookInput.status)}\n`;
                }
                else {
                    body = `${JSON.stringify(hookInput, null, 2)}\n`;
                }
                writeFileSync(fd, `\n${sep}\n${ts} | HOOK INPUT DUMP\n${body}`, 'utf-8');
            }
            finally {
                closeSync(fd);
            }
        }
        catch {
        }
    }
    const host = resolveHost(hookInput, hostOverride);
    try {
        const subagentIdRaw = hookInput.subagent_id ?? '';
        const taskRaw = hookInput.task ?? '';
        const statusRaw = hookInput.status ?? '';
        const hookEvent = hookInput.hook_event_name ?? '';
        const cursorVer = hookInput.cursor_version ?? '';
        const loopRaw = hookInput.loop_count;
        const payloadLine = `${nowIsoNaive()} | PAYLOAD | host=${host ?? 'null'} | status=${statusRaw}` +
            ` | subagent_id=${subagentIdRaw.substring(0, 8)}${subagentIdRaw.length > 8 ? '…' : ''}` +
            ` | task_len=${taskRaw.length} | hook_event=${hookEvent}` +
            ` | cursor_version=${cursorVer} | loop_count=${loopRaw ?? 'null'}\n`;
        const logPath = join(paths.agentDir, 'gate-check-invocations.log');
        mkdirSync(paths.agentDir, { recursive: true });
        const fd = openSync(logPath, 'a');
        try {
            writeFileSync(fd, payloadLine, 'utf-8');
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
    }
    if (host === 'claude-code') {
        const tp = [hookInput.transcript_path, hookInput.agent_transcript_path].find((v) => typeof v === 'string' && v.length > 0);
        if (tp) {
            if (isCopilotSessionTranscript(tp)) {
                try {
                    const skipLine = `${nowIsoNaive()} | SKIP copilot-echo | host=claude-code fire for a Copilot-owned stop (transcript under ~/.copilot/session-state/) — the native --host copilot hook owns it\n`;
                    const skipLogPath = join(paths.agentDir, 'gate-check-invocations.log');
                    mkdirSync(paths.agentDir, { recursive: true });
                    const skipFd = openSync(skipLogPath, 'a');
                    try {
                        writeFileSync(skipFd, skipLine, 'utf-8');
                    }
                    finally {
                        closeSync(skipFd);
                    }
                }
                catch {
                }
                process.stdout.write(`${JSON.stringify({})}\n`);
                process.exit(0);
            }
        }
    }
    if (host === 'gemini') {
        const existingTask = hookInput.task ?? '';
        if (existingTask.trim().length === 0) {
            const ti = hookInput.tool_input;
            const prompt = typeof ti?.prompt === 'string' ? ti.prompt : '';
            if (prompt.trim().length > 0)
                hookInput.task = prompt;
        }
    }
    const nativeTaskText = hookInput.task ?? '';
    if (nativeTaskText.trim().length === 0) {
        const derived = deriveTaskTextFromTranscript(hookInput.agent_transcript_path ?? null);
        if (derived) {
            hookInput.task = derived;
            logGateError(`task text derived from transcript (len=${derived.length})`, paths);
        }
    }
    if (host === 'cursor') {
        const status = hookInput.status ?? 'unknown';
        if (status !== 'completed') {
            logGateError(`Skipping non-completed subagent: status=${status}`, paths);
            process.stdout.write(`${JSON.stringify({})}\n`);
            process.exit(0);
        }
        const taskPrompt = hookInput.task ?? '';
        if (taskPrompt.trim().length === 0) {
            process.stdout.write(`${JSON.stringify({})}\n`);
            process.exit(0);
        }
    }
    const hostLoopCount = host === 'cursor' ? (hookInput.loop_count ?? 0) : 0;
    let loopCount = 0;
    let workflowDir = null;
    {
        const earlyTaskText = hookInput.task ?? '';
        const earlyToken = extractRunToken(earlyTaskText);
        if (earlyToken) {
            const byToken = resolveRunByToken(paths.agentDir, earlyToken);
            if (byToken)
                workflowDir = runDirFor(paths.agentDir, byToken);
        }
    }
    if (!workflowDir)
        workflowDir = findWorkflowDir(paths);
    if (!workflowDir) {
        outputAndExit(host, null);
    }
    let manifest;
    let workflowConfig;
    let definitionDir;
    try {
        const manifestPath = join(workflowDir, 'manifest.json');
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (manifest.status !== 'in_progress') {
            process.stdout.write(`${JSON.stringify({})}\n`);
            process.exit(0);
        }
        definitionDir = findDefinitionDir(workflowDir, paths);
        const workflowPath = join(definitionDir, 'workflow.yaml');
        workflowConfig = loadYaml(workflowPath);
        normalizePerIterationOutputs(workflowConfig);
        injectSpecAuthoringOutputs(workflowConfig);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logGateError(`Failed to load manifest/workflow: ${msg} (dir: ${workflowDir})`, paths);
        outputAndExit(host, `Gate error: ${msg}`);
    }
    let stepName;
    {
        const taskTextForStep = hookInput.task ?? '';
        const stepMatch = /<!--workflow:step:(.+?)-->/.exec(taskTextForStep);
        const markerStep = stepMatch?.[1] ?? '';
        const manifestSteps = (manifest.steps ?? {});
        if (markerStep && markerStep in manifestSteps) {
            stepName = markerStep;
        }
        else {
            const [cursorStep] = findCurrentStep(manifest);
            if (!cursorStep) {
                logGateError(`No current step in manifest (workflow_dir: ${workflowDir})`, paths);
                outputAndExit(host, null);
            }
            stepName = cursorStep;
        }
    }
    {
        const taskText = hookInput.task ?? '';
        const rtMatch = /<!--workflow:run_token:(.+?)-->/.exec(taskText);
        const manifestToken = manifest.run_token ?? '';
        if (rtMatch && manifestToken && rtMatch[1] !== manifestToken) {
            logGateError(`run_token mismatch: payload '${(rtMatch[1] ?? '').slice(0, 8)}…' != manifest ` +
                `'${manifestToken.slice(0, 8)}…' — skipping foreign fire`, paths);
            outputAndExit(host, null);
        }
        if (!rtMatch && manifestToken && taskText.trim().length > 0) {
            logGateError(`no run_token marker in task text (len=${taskText.length}) — the stopping ` +
                `subagent is not a step worker. Step subagents must not spawn their own ` +
                `agents; this fire is skipped, the step's gate follows only the worker ` +
                `the orchestrator seeded`, paths);
            outputAndExit(host, null);
        }
    }
    const stepStructural = resolveStructuralGate(workflowConfig.gate, findStepConfig(workflowConfig, stepName).gate);
    const observations = [];
    let firingBranch = null;
    if (!stepStructural) {
        const disabledDetail = STRUCTURAL_GATE_DISABLED_DETAIL;
        const pbDisabled = manifest.parallel_branches;
        if (pbDisabled && Object.keys(pbDisabled).length > 0) {
            for (const k of Object.keys(pbDisabled)) {
                const bi = Number.parseInt(k, 10);
                if (Number.isFinite(bi)) {
                    observations.push({ branchIndex: bi, passed: true, checks: 0, failures: 0, details: [disabledDetail] });
                }
            }
        }
        else {
            observations.push({ branchIndex: null, passed: true, checks: 0, failures: 0, details: [disabledDetail] });
        }
    }
    else {
        const outputs = findStepOutputs(workflowConfig, stepName);
        const stepSnapshot = loadSnapshot(workflowDir, stepName);
        const stepsRecord = (manifest.steps ?? {});
        const stepEntry = stepsRecord[stepName] ?? {};
        const stepStartedAt = stepEntry.first_started_at ??
            stepEntry.started_at ??
            null;
        const parallelBranches = manifest.parallel_branches;
        const paramsForVal = (manifest.params ?? null);
        const hasStructOutputs = outputs.some((o) => typeof o === 'object' && o !== null && o.struct !== undefined);
        if (parallelBranches && Object.keys(parallelBranches).length > 0) {
            const branchMatch = /<!--workflow:branch:(\d+)-->/.exec(nativeTaskText);
            firingBranch = branchMatch ? Number.parseInt(branchMatch[1] ?? '0', 10) : null;
            let priorBranches = {};
            try {
                const perStepLedger = join(workflowDir, 'gate-results', `${stepName}.json`);
                const priorPath = existsSync(perStepLedger)
                    ? perStepLedger
                    : join(workflowDir, 'gate-result.json');
                const prev = JSON.parse(readFileSync(priorPath, 'utf-8'));
                if (prev.schema === GATE_LEDGER_SCHEMA && prev.step === stepName && prev.branches) {
                    priorBranches = prev.branches;
                }
            }
            catch {
                priorBranches = {};
            }
            const sortedKeys = Object.keys(parallelBranches)
                .map((k) => Number.parseInt(k, 10))
                .filter((n) => Number.isFinite(n))
                .sort((a, b) => a - b);
            const toValidate = firingBranch !== null ? [firingBranch] : sortedKeys;
            for (const bi of toValidate) {
                const branchResolved = parallelBranches[String(bi)]?.resolved_outputs;
                const narrowed = branchResolved && branchResolved.length > 0
                    ? branchOutputsFromResolved(outputs, branchResolved)
                    : narrowOutputsForBranch(outputs, bi);
                const waitForFiles = firingBranch !== null ? true : priorBranches[String(bi)]?.passed !== true;
                const r = validateOutputs(narrowed, definitionDir, workflowDir, {
                    snapshot: stepSnapshot,
                    stepStartedAt,
                    branchFilter: { branch_index: bi, branch_dir: `_branch_${bi}` },
                    params: paramsForVal,
                    waitForFiles,
                });
                const bDetails = [...r.details];
                if (!r.passed && hasStructOutputs) {
                    bDetails.push(`EMPTY — 0 output files. Subagent may have written to wrong path. Expected: data/*/_branch_${bi}/**`);
                }
                observations.push({
                    branchIndex: bi,
                    passed: r.passed,
                    checks: r.checks,
                    failures: r.failures,
                    details: bDetails,
                });
            }
        }
        else {
            const result = validateOutputs(outputs, definitionDir, workflowDir, {
                snapshot: stepSnapshot,
                stepStartedAt,
                params: paramsForVal,
            });
            observations.push({
                branchIndex: null,
                passed: result.passed,
                checks: result.checks,
                failures: result.failures,
                details: [...result.details],
            });
        }
    }
    const runToken = manifest.run_token ?? '';
    const validatedAt = nowIsoLocal();
    const isParallelFire = observations.length > 0 && observations[0]?.branchIndex !== null;
    const capturedFiring = firingBranch;
    mkdirSync(join(workflowDir, 'gate-results'), { recursive: true });
    const resultPath = join(workflowDir, 'gate-results', `${stepName}.json`);
    const legacyResultPath = join(workflowDir, 'gate-result.json');
    if (!existsSync(resultPath) && existsSync(legacyResultPath)) {
        try {
            writeFileSync(resultPath, readFileSync(legacyResultPath, 'utf-8'), 'utf-8');
        }
        catch {
        }
    }
    const merged = await lockedJsonReadModifyWrite(resultPath, (prev) => {
        const ledger = ledgerForStep(prev, stepName, runToken);
        if (isParallelFire) {
            for (const o of observations) {
                const bi = o.branchIndex;
                const existing = ledger.branches[String(bi)];
                let lc;
                if (host === 'cursor' && capturedFiring === bi)
                    lc = hostLoopCount;
                else if (!o.passed)
                    lc = existing ? existing.loop_count + 1 : 0;
                else
                    lc = existing ? existing.loop_count : 0;
                upsertBranch(ledger, {
                    branchIndex: bi,
                    passed: o.passed,
                    checks: o.checks,
                    failures: o.failures,
                    details: o.details,
                    loopCount: lc,
                    validatedAt,
                    source: 'hook',
                });
            }
            recomputeAggregate(ledger);
        }
        else {
            const o = observations[0] ?? { passed: true, checks: 0, failures: 0, details: [] };
            const prevLedger = prev;
            const sameStep = !!prevLedger && prevLedger.step === stepName;
            const prevTop = sameStep ? (prevLedger?.loop_count ?? 0) : 0;
            let lc = host === 'cursor' ? hostLoopCount : sameStep ? prevTop + 1 : 0;
            lc = Math.max(prevTop, lc);
            ledger.branches = {};
            ledger.passed = o.passed;
            ledger.checks = o.checks;
            ledger.failures = o.failures;
            ledger.details = o.details;
            ledger.loop_count = lc;
            delete ledger.branch_results;
        }
        return ledger;
    });
    const ledger = merged ?? emptyLedger(stepName, runToken);
    try {
        writeFileSync(legacyResultPath, `${JSON.stringify(ledger, null, 2)}
`, 'utf-8');
    }
    catch {
    }
    const gateResult = ledger;
    const passed = ledger.passed;
    const checks = ledger.checks;
    const failures = ledger.failures;
    const details = ledger.details;
    loopCount = isParallelFire
        ? capturedFiring !== null
            ? (ledger.branches[String(capturedFiring)]?.loop_count ?? 0)
            : maxLoopOverBranches(ledger, ledger.failed_branches)
        : ledger.loop_count;
    let followup = buildFollowup(stepName, passed, checks, failures, details);
    const maxGate = getMaxGateRetries(workflowConfig, stepName);
    if (!passed && loopCount >= maxGate) {
        logGateError(`Gate retry limit reached for step '${stepName}': ` +
            `${loopCount}/${maxGate} (failures: ${failures}/${checks})`, paths);
        followup = null;
    }
    const attributionWarning = detectRunAttributionWarning(paths, manifest.workflow ?? '', procEnv);
    if (attributionWarning)
        logGateError(attributionWarning, paths);
    await appendTraceEntry(workflowDir, manifest, stepName, hookInput, gateResult, workflowConfig, loopCount, followup, attributionWarning);
    const action = followup ? 'RETRY' : passed ? 'PASS' : 'STOP';
    try {
        const logPath = join(paths.agentDir, 'gate-check-invocations.log');
        mkdirSync(paths.agentDir, { recursive: true });
        const fd = openSync(logPath, 'a');
        try {
            const ts = nowIsoNaive();
            const passedStr = passed ? 'True' : 'False';
            const line = `${ts} | RESULT | host=${host} | step=${stepName} | passed=${passedStr}` +
                ` | action=${action} | checks=${checks} | failures=${failures}` +
                ` | loop=${loopCount} | workflow_dir=${workflowDir}\n`;
            writeFileSync(fd, line, 'utf-8');
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
    }
    let scopeWarning = null;
    try {
        let mf = hookInput.modified_files ?? [];
        if (mf.length === 0) {
            try {
                const tp = hookInput.agent_transcript_path ?? null;
                if (tp) {
                    mf = [...extractFromTranscript(tp).modified_files];
                }
            }
            catch {
                mf = [];
            }
        }
        scopeWarning = detectCrossScopeWrites(mf);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logGateError(`scope-warning detection failed: ${msg}`, paths);
    }
    outputAndExit(host, followup, scopeWarning);
}
export async function gateCheckCli(options = {}) {
    const paths = options.paths ?? gateCheckPaths();
    try {
        mkdirSync(paths.agentDir, { recursive: true });
        const logPath = join(paths.agentDir, 'gate-check-invocations.log');
        const fd = openSync(logPath, 'a');
        try {
            const ts = nowIsoNaive();
            const isatty = process.stdin.isTTY ? 'True' : 'False';
            const argvRepr = `[${argv.map((v) => `'${String(v).replace(/'/g, "\\'")}'`).join(', ')}]`;
            const line = `${ts} | INVOKED | cwd=${process.cwd()} | argv=${argvRepr} | stdin_isatty=${isatty}\n`;
            writeFileSync(fd, line, 'utf-8');
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
    }
    try {
        await mainInner(options);
    }
    catch (e) {
        const errorName = e instanceof Error ? e.constructor.name : e === null ? 'null' : typeof e;
        const errorMsg = e instanceof Error ? e.message : String(e);
        const fullMsg = `riglane gate-check unhandled error: ${errorName}: ${errorMsg}`;
        logGateError(fullMsg, paths);
        process.stderr.write(`${fullMsg}\n`);
        process.stdout.write(`${JSON.stringify({})}\n`);
        process.exit(0);
    }
}
const __argv1 = argv[1];
if (__argv1 !== undefined) {
    let __argv1Real;
    let __metaReal;
    try {
        __argv1Real = realpathSync(__argv1);
        __metaReal = realpathSync(fileURLToPath(import.meta.url));
    }
    catch {
        __argv1Real = __argv1;
        __metaReal = fileURLToPath(import.meta.url);
    }
    if (__argv1Real === __metaReal) {
        void gateCheckCli();
    }
}
