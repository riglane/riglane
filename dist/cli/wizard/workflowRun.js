import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, sep } from 'node:path';
import process from 'node:process';
import { readRunSupervisionState } from '../commands/run-workflow.js';
import { PRODUCT_DIR } from '../../config/paths.js';
import { CLI_NAME } from '../../config/product.js';
import { MODEL_MODES } from '../../types/workflow.js';
import { findRunsByWorkflow, runManifestPath, runTracePath } from '../../engine/runs.js';
import { loadYaml } from '../../engine/schema-validate.js';
import { defaultTemplatesDir, scanWorkflows } from '../../engine/workflow-tools-loader.js';
import { promoteEditedPredefinedWorkflows } from '../promote-edited.js';
export function categorizeParam(p) {
    if (p.required === true)
        return 'required';
    if (Object.prototype.hasOwnProperty.call(p, 'default') && p.default !== undefined) {
        return 'predefined';
    }
    return 'optional';
}
function defaultToText(value) {
    if (value === undefined || value === null)
        return '';
    if (typeof value === 'string')
        return value;
    return JSON.stringify(value);
}
export function parseWorkflowParams(wf) {
    if (typeof wf !== 'object' || wf === null)
        return [];
    const raw = wf.params;
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null)
            continue;
        const e = entry;
        if (typeof e.name !== 'string' || e.name.length === 0)
            continue;
        out.push({
            name: e.name,
            description: typeof e.description === 'string' ? e.description : '',
            category: categorizeParam(e),
            defaultText: defaultToText(e.default),
        });
    }
    return out;
}
export const BUCKET_ORDER = ['my_workflows', 'predefined', 'examples', 'community'];
export function bucketOf(templatesDir, workflowYamlPath) {
    const prefix = templatesDir.endsWith(sep) ? templatesDir : templatesDir + sep;
    if (!workflowYamlPath.startsWith(prefix))
        return '';
    const rel = workflowYamlPath.slice(prefix.length);
    const segs = rel.split(/[\\/]/);
    return segs[0] ?? '';
}
export function listProjectWorkflows(projectPath) {
    try {
        promoteEditedPredefinedWorkflows(projectPath);
    }
    catch {
    }
    const templatesDir = defaultTemplatesDir(projectPath);
    const byBucket = new Map();
    for (const yamlPath of scanWorkflows(templatesDir)) {
        let wf;
        try {
            wf = loadYaml(yamlPath);
        }
        catch {
            continue;
        }
        if (typeof wf !== 'object' || wf === null || Array.isArray(wf))
            continue;
        const obj = wf;
        if (typeof obj.name !== 'string' || obj.name.length === 0)
            continue;
        const bucket = bucketOf(templatesDir, yamlPath) || 'other';
        const entry = {
            name: obj.name,
            bucket,
            description: typeof obj.description === 'string' ? obj.description.trim() : '',
            path: yamlPath,
            params: parseWorkflowParams(wf),
        };
        const arr = byBucket.get(bucket) ?? [];
        arr.push(entry);
        byBucket.set(bucket, arr);
    }
    const orderedBuckets = [
        ...BUCKET_ORDER.filter((b) => byBucket.has(b)),
        ...[...byBucket.keys()].filter((b) => !BUCKET_ORDER.includes(b)).sort(),
    ];
    return orderedBuckets.map((bucket) => ({
        bucket,
        workflows: (byBucket.get(bucket) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
export const RUN_ADAPTERS = [
    { name: 'claude', label: 'Claude Code', group: 'Claude', bin: 'claude', adapterId: 'claude' },
    {
        name: 'claude-headless',
        label: 'Claude Code (headless)',
        group: 'Claude',
        bin: 'claude',
        adapterId: 'claude',
    },
    {
        name: 'cursor-agent',
        label: 'Cursor Agent',
        group: 'Cursor',
        bin: 'cursor-agent',
        adapterId: 'cursor',
    },
    {
        name: 'cursor-agent-headless',
        label: 'Cursor Agent (headless)',
        group: 'Cursor',
        bin: 'cursor-agent',
        adapterId: 'cursor',
    },
    { name: 'codex', label: 'Codex (interactive)', group: 'Codex', bin: 'codex', adapterId: 'codex' },
    {
        name: 'codex-exec',
        label: 'Codex (headless exec)',
        group: 'Codex',
        bin: 'codex',
        adapterId: 'codex',
        hint: 'requires Skip approvals — runs with the codex sandbox OFF',
    },
    {
        name: 'opencode',
        label: 'OpenCode (interactive)',
        group: 'OpenCode',
        bin: 'opencode',
        adapterId: 'opencode',
    },
    {
        name: 'opencode-headless',
        label: 'OpenCode (headless run)',
        group: 'OpenCode',
        bin: 'opencode',
        adapterId: 'opencode',
        hint: 'unattended permission asks hang — prefer skip-approvals (--auto)',
    },
    {
        name: 'copilot',
        label: 'GitHub Copilot (interactive)',
        group: 'Copilot',
        bin: 'copilot',
        adapterId: 'copilot',
    },
    {
        name: 'copilot-headless',
        label: 'GitHub Copilot (headless -p)',
        group: 'Copilot',
        bin: 'copilot',
        adapterId: 'copilot',
        hint: 'requires Skip approvals — non-interactive runs need --allow-all',
    },
    {
        name: 'gemini',
        label: 'Gemini CLI (interactive)',
        group: 'Gemini',
        bin: 'gemini',
        adapterId: 'gemini',
    },
    {
        name: 'gemini-headless',
        label: 'Gemini CLI (headless -p)',
        group: 'Gemini',
        bin: 'gemini',
        adapterId: 'gemini',
        hint: 'requires Skip approvals — headless approvals resolve to deny',
    },
];
export function detectedAdapterIds(env = process.env, platform = process.platform) {
    const found = new Set();
    for (const spec of RUN_ADAPTERS) {
        if (found.has(spec.adapterId))
            continue;
        if (commandOnPath(spec.bin, env, platform))
            found.add(spec.adapterId);
    }
    return found;
}
export function runAdapterStatus(a) {
    if (a.disabled)
        return { kind: 'disabled', text: a.hint ?? 'unavailable' };
    const missing = [];
    if (!a.integrationInstalled)
        missing.push('integration not installed');
    if (!a.binOnPath)
        missing.push(`'${a.bin}' not found`);
    else if (a.binRunnable === false)
        missing.push(`'${a.bin}' installed but not runnable`);
    if (missing.length === 0) {
        return { kind: 'ok', text: a.hint ? `available · ${a.hint}` : 'available' };
    }
    return { kind: 'error', text: missing.join(' · ') };
}
export function resolveOnPath(bin, env = process.env, platform = process.platform) {
    const pathVar = env.PATH ?? env.Path ?? '';
    if (pathVar.length === 0)
        return null;
    const dirs = pathVar.split(delimiter).filter(Boolean);
    const exts = platform === 'win32'
        ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
        : [''];
    for (const dir of dirs) {
        for (const ext of exts) {
            const p = join(dir, bin + ext);
            if (existsSync(p))
                return p;
            if (platform === 'win32') {
                const lower = join(dir, bin + ext.toLowerCase());
                if (existsSync(lower))
                    return lower;
            }
        }
    }
    return null;
}
export function commandOnPath(bin, env = process.env, platform = process.platform) {
    return resolveOnPath(bin, env, platform) !== null;
}
const runnableCache = new Map();
export function clearRunnableCache() {
    runnableCache.clear();
}
function probeArgv(binPath, platform) {
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(binPath)) {
        return ['cmd', ['/c', binPath, '--version']];
    }
    return [binPath, ['--version']];
}
function probeRunnable(binPath, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
            if (!settled) {
                settled = true;
                resolve(ok);
            }
        };
        const [cmd, args] = probeArgv(binPath, process.platform);
        let child;
        try {
            child = spawn(cmd, args, { stdio: 'ignore' });
        }
        catch {
            finish(false);
            return;
        }
        const timer = setTimeout(() => {
            try {
                child.kill();
            }
            catch {
            }
            finish(false);
        }, timeoutMs);
        child.on('error', () => {
            clearTimeout(timer);
            finish(false);
        });
        child.on('exit', (code) => {
            clearTimeout(timer);
            finish(code === 0);
        });
    });
}
function runnableFromCache(bin, env, platform) {
    const path = resolveOnPath(bin, env, platform);
    if (!path)
        return undefined;
    return runnableCache.get(path);
}
export async function warmRunnableCache(adapters, env, platform) {
    const seen = new Set();
    const probes = [];
    for (const a of adapters) {
        if (!a.binOnPath)
            continue;
        const path = resolveOnPath(a.bin, env, platform);
        if (!path || seen.has(path) || runnableCache.has(path))
            continue;
        seen.add(path);
        probes.push(probeRunnable(path).then((ok) => {
            runnableCache.set(path, ok);
        }));
    }
    await Promise.all(probes);
    return probes.length > 0;
}
export function detectRunAdapters(installedAdapters = [], env, platform) {
    const installed = new Set(installedAdapters);
    return RUN_ADAPTERS.map((spec) => {
        const binOnPath = commandOnPath(spec.bin, env, platform);
        const binRunnable = runnableFromCache(spec.bin, env, platform);
        const integrationInstalled = installed.has(spec.adapterId);
        return {
            ...spec,
            binOnPath,
            integrationInstalled,
            binRunnable,
            available: spec.disabled
                ? false
                : binOnPath && binRunnable !== false && integrationInstalled,
        };
    });
}
export function buildParamArgs(params, values) {
    const args = [];
    for (const p of params) {
        const v = (values[p.name] ?? '').trim();
        if (v.length > 0)
            args.push(`--${p.name}`, v);
    }
    return args;
}
export const MODEL_OVERRIDE_CHOICES = ['', ...MODEL_MODES];
export function modelOverrideLabel(value) {
    return value === '' ? 'workflow default' : value;
}
export function buildLaunchArgs(opts) {
    return [
        '--target',
        opts.target,
        '--workflow',
        opts.workflow,
        '--dir',
        opts.dir,
        ...opts.paramArgs,
        ...(opts.skipApprovals ? ['--skip-approvals'] : []),
        ...(opts.modelOverride ? ['--model', opts.modelOverride] : []),
    ];
}
export function buildWorkflowPrompt(workflow, paramArgs) {
    return [`/riglane-run-workflow ${workflow}`, ...paramArgs].join(' ').trim();
}
export function buildPreviewCommand(opts) {
    const { adapter, workflow, dir, paramArgs, modelOverride } = opts;
    return [
        CLI_NAME,
        'run-workflow',
        `--target=${adapter.name}`,
        `--workflow=${workflow}`,
        `--dir=${dir}`,
        ...paramArgs,
        ...(modelOverride ? [`--model=${modelOverride}`] : []),
    ].join(' ');
}
export function missingRequired(params, values) {
    return params
        .filter((p) => p.category === 'required' && (values[p.name] ?? '').trim().length === 0)
        .map((p) => p.name);
}
function projectAgentDir(projectPath) {
    return join(projectPath, PRODUCT_DIR);
}
export function readActiveRun(projectPath, workflowName) {
    const agentDir = projectAgentDir(projectPath);
    const inProgress = findRunsByWorkflow(agentDir, workflowName, 'in_progress');
    if (inProgress.length === 0)
        return null;
    const runId = inProgress[inProgress.length - 1];
    try {
        const m = JSON.parse(readFileSync(runManifestPath(agentDir, runId), 'utf-8'));
        const sup = readRunSupervisionState(dirname(runManifestPath(agentDir, runId)));
        const state = sup.ownerAlive ? 'running' : sup.openQuestions > 0 ? 'waiting' : 'stalled';
        return {
            runId: String(m.run_id ?? runId),
            startedAt: String(m.started_at ?? ''),
            state,
            currentStep: sup.currentStep ?? null,
        };
    }
    catch {
        return null;
    }
}
export function traceState(status) {
    switch (status) {
        case 'success':
        case 'completed':
            return 'completed';
        case 'in_progress':
            return 'in-progress';
        case 'failed':
            return 'failed';
        case 'manual_stop':
            return 'stopped';
        default:
            return 'unknown';
    }
}
export function listWorkflowTraces(projectPath, workflowName) {
    const agentDir = projectAgentDir(projectPath);
    const runIds = findRunsByWorkflow(agentDir, workflowName);
    const out = [];
    for (const runId of runIds) {
        try {
            const t = JSON.parse(readFileSync(runTracePath(agentDir, runId), 'utf-8'));
            const rid = String(t.run_id ?? runId);
            out.push({
                runId: rid,
                shortId: rid.split('-').pop() || rid,
                state: traceState(t.status),
                startedAt: String(t.started_at ?? ''),
                completedAt: t.completed_at == null ? null : String(t.completed_at),
                serverPath: ['', 'local', 'workflow_runs', runId, 'trace.json'].join('/'),
            });
        }
        catch {
        }
    }
    out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return out;
}
