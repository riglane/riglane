import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, } from 'node:fs';
import { isAbsolute, join, posix } from 'node:path';
import { text as readStreamText } from 'node:stream/consumers';
import { PRODUCT_DIR } from '../config/paths.js';
import { ENV_RUN_ID } from '../config/product.js';
import { injectSpecAuthoringOutputs, normalizePerIterationOutputs } from '../engine/output-validator.js';
import { canonicalCompareForm } from '../engine/path-canon.js';
import { runManifestPath, runsRootDir } from '../engine/runs.js';
import { loadYaml } from '../engine/schema-validate.js';
import { emitPreToolUseDeny, parseHostFlag } from './host-flag.js';
import { parseRootArg, resolveProjectRoot } from '../engine/project-root.js';
export const PROTECTED_PREFIXES = [
    `${PRODUCT_DIR}/scripts/`,
    `${PRODUCT_DIR}/tools/`,
    `${PRODUCT_DIR}/mcp/`,
    `${PRODUCT_DIR}/workflows/templates/predefined/`,
    '.claude/',
    '.cursor/',
    '.opencode/',
];
function resolveOpts(opts = {}) {
    const cwd = opts.cwd ?? process.cwd();
    const argv = opts.argv ?? process.argv;
    return {
        stderr: opts.stderr ?? ((s) => void process.stderr.write(s)),
        stdout: opts.stdout ?? ((s) => void process.stdout.write(s)),
        cwd,
        projectRoot: resolveProjectRoot(cwd, opts.root ?? parseRootArg(argv)),
        env: opts.env ?? process.env,
        host: opts.host ?? parseHostFlag(argv),
    };
}
export function normalizePath(path, cwd) {
    const absIn = isAbsolute(path) ? path : join(cwd, path);
    let p = posix.normalize(canonicalCompareForm(absIn).replace(/\\/g, '/'));
    const cwdNorm = posix
        .normalize(canonicalCompareForm(cwd).replace(/\\/g, '/'))
        .replace(/\/+$/, '');
    if (p === cwdNorm)
        return '';
    if (p.startsWith(`${cwdNorm}/`)) {
        p = p.slice(cwdNorm.length + 1);
    }
    return p;
}
export function isProtected(filePath, cwd) {
    const normalized = normalizePath(filePath, cwd);
    return PROTECTED_PREFIXES.some((prefix) => normalized.startsWith(prefix) || normalized.includes(`/${prefix}`));
}
const SPECS_SEG = `${PRODUCT_DIR.replace(/\./g, '\\.')}/specs`;
export const PROTECTED_SPEC_FILE_RE = [
    new RegExp(`(^|/)${SPECS_SEG}/[^/]+/_index\\.json$`),
    new RegExp(`(^|/)${SPECS_SEG}/[^/]+/_registry\\.json$`),
];
const LOCAL_SEG = `${PRODUCT_DIR.replace(/\./g, '\\.')}/local`;
export const PROTECTED_TRUST_FILE_RE = new RegExp(`(^|/)${LOCAL_SEG}/trusted\\.json$`);
export function protectedTrustFileReason(filePath, cwd) {
    const normalized = normalizePath(filePath, cwd);
    if (!PROTECTED_TRUST_FILE_RE.test(normalized))
        return null;
    return (`BLOCKED: '${filePath}' is the community-workflow trust store — engine-owned. ` +
        `Trusting shared code is the user's decision, made through 'riglane trust <id>' ` +
        `run by the user; it is never written by hand and never by an agent.`);
}
export function protectedSpecFileReason(filePath, cwd) {
    const normalized = normalizePath(filePath, cwd);
    if (!PROTECTED_SPEC_FILE_RE.some((re) => re.test(normalized)))
        return null;
    return (`BLOCKED: '${filePath}' is an engine-owned spec index/registry file — never ` +
        `hand-edit it. Specs are maintained through the engine: use spec_write ` +
        `(_index.json is derived from the spec .md files) and spec_link (_registry.json). ` +
        `A drifted _index.json self-heals via 'riglane doctor --fix'.`);
}
const RUN_STATE_FILES = new Set(['manifest.json', 'trace.json', 'gate-result.json']);
export function protectedRunStateReason(filePath, cwd) {
    const n = normalizePath(filePath, cwd);
    const marker = `${PRODUCT_DIR}/local/workflow_runs/`;
    const idx = n.indexOf(marker);
    if (idx < 0)
        return null;
    if (idx > 0 && n[idx - 1] !== '/')
        return null;
    const segs = n.slice(idx + marker.length).split('/').filter(Boolean);
    if (segs.length === 0)
        return null;
    const base = segs[segs.length - 1] ?? '';
    const dirs = segs.slice(0, -1);
    const isSnapshot = segs.includes('.snapshots');
    const isInbox = dirs.includes('inbox') && !dirs.includes('data');
    const isRunStateFile = RUN_STATE_FILES.has(base) && !dirs.includes('data');
    if (!isSnapshot && !isRunStateFile && !isInbox)
        return null;
    return (`BLOCKED: '${filePath}' is engine-owned run state under .riglane/local/workflow_runs/ ` +
        `(manifest.json / trace.json / gate-result.json / write-proof snapshots / the inbox ` +
        `message store — use inbox(op:'post') / inbox(op:'respond') for messages) — never ` +
        `hand-edit it. The workflow engine owns run state; editing it corrupts the run ` +
        `(step status, gate verdicts, the step cursor). Let the engine manage it; write ` +
        `only your step's declared outputs under data/.`);
}
function nowIsoNaiveLocal() {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return (`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
        `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`);
}
function outputPatternToRegex(pathTemplate, params) {
    const SEG_WILD = '\u0001';
    const DEEP_WILD = '\u0002';
    let p = pathTemplate.replace(/\\/g, '/');
    p = p.replace(/\{[^}]+\}/g, (m) => {
        const key = m.slice(1, -1);
        const v = params[key];
        return typeof v === 'string' || typeof v === 'number' ? String(v) : SEG_WILD;
    });
    p = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    p = p.replace(/\*\*/g, DEEP_WILD);
    p = p.replace(/\*/g, SEG_WILD);
    p = p.replace(/\?/g, '[^/]');
    p = p.split(DEEP_WILD).join('.*');
    p = p.split(SEG_WILD).join('[^/]*');
    return new RegExp(`^${p}$`);
}
function collectStepsWithOutputs(workflow) {
    const out = [];
    const visit = (steps) => {
        for (const s of steps ?? []) {
            const outputs = Array.isArray(s.outputs)
                ? s.outputs
                    .map((o) => (typeof o.path === 'string' ? o.path : ''))
                    .filter(Boolean)
                : [];
            out.push({ name: String(s.name ?? ''), outputs });
            const routes = s.routes;
            if (routes && Array.isArray(routes.define))
                for (const r of routes.define)
                    visit(r.steps);
        }
    };
    visit(workflow.steps);
    return out;
}
function targetCandidates(filePath, cwd, runDir) {
    const norm = (s) => posix.normalize(s.replace(/\\/g, '/')).replace(/^\.\//, '');
    const cwdN = norm(canonicalCompareForm(cwd)).replace(/\/+$/, '');
    const runDirN = norm(canonicalCompareForm(runDir)).replace(/\/+$/, '');
    const p = norm(filePath);
    const cands = new Set();
    const abs = norm(canonicalCompareForm(isAbsolute(filePath) ? filePath : join(cwd, p)));
    if (abs.toLowerCase().startsWith(`${runDirN.toLowerCase()}/`)) {
        cands.add(abs.slice(runDirN.length + 1));
    }
    if (abs.toLowerCase().startsWith(`${cwdN.toLowerCase()}/`)) {
        cands.add(abs.slice(cwdN.length + 1));
    }
    if (!isAbsolute(filePath)) {
        cands.add(p);
    }
    for (const c of [...cands]) {
        const stripped = c.replace(/(^|\/)_branch_\d+\//g, '$1');
        if (stripped !== c)
            cands.add(stripped);
    }
    return [...cands];
}
export function checkOutputBoundary(filePath, projectRoot, sessionCwd, env) {
    try {
        const agentDir = join(projectRoot, PRODUCT_DIR);
        const runsRoot = runsRootDir(agentDir);
        if (!existsSync(runsRoot))
            return { kind: 'allow' };
        const readManifest = (id) => {
            try {
                const mp = runManifestPath(agentDir, id);
                if (!existsSync(mp))
                    return null;
                return JSON.parse(readFileSync(mp, 'utf-8'));
            }
            catch {
                return null;
            }
        };
        let runId = null;
        let manifest = null;
        const envId = env[ENV_RUN_ID];
        if (envId) {
            const m = readManifest(envId);
            if (m && m.status === 'in_progress') {
                runId = envId;
                manifest = m;
            }
        }
        if (!manifest) {
            const live = [];
            for (const d of readdirSync(runsRoot, { withFileTypes: true })) {
                if (!d.isDirectory())
                    continue;
                const m = readManifest(d.name);
                if (m && m.status === 'in_progress')
                    live.push([d.name, m]);
            }
            const only = live.length === 1 ? live[0] : undefined;
            if (!only)
                return { kind: 'allow' };
            runId = only[0];
            manifest = only[1];
        }
        const stepName = manifest.current_step;
        if (!stepName || !runId)
            return { kind: 'allow' };
        if (Array.isArray(manifest.active_lanes) && manifest.active_lanes.length > 0) {
            return { kind: 'allow' };
        }
        const stepData = manifest.steps?.[stepName];
        if (stepData && stepData.planning !== undefined)
            return { kind: 'allow' };
        const wfName = manifest.workflow;
        if (!wfName)
            return { kind: 'allow' };
        let workflow = null;
        for (const bucket of ['my_workflows', 'predefined', 'examples']) {
            const p = join(agentDir, 'workflows', 'templates', bucket, wfName, 'workflow.yaml');
            if (existsSync(p)) {
                workflow = loadYaml(p);
                break;
            }
        }
        if (!workflow)
            return { kind: 'allow' };
        normalizePerIterationOutputs(workflow);
        injectSpecAuthoringOutputs(workflow);
        const params = manifest.params ?? {};
        const steps = collectStepsWithOutputs(workflow);
        const own = steps.find((s) => s.name === stepName);
        if (!own)
            return { kind: 'allow' };
        const runDir = join(runsRoot, runId);
        const cands = targetCandidates(filePath, sessionCwd, runDir);
        if (cands.length === 0)
            return { kind: 'allow' };
        const matches = (patterns) => patterns.some((pat) => {
            try {
                const re = outputPatternToRegex(pat, params);
                return cands.some((c) => re.test(c));
            }
            catch {
                return false;
            }
        });
        if (matches(own.outputs))
            return { kind: 'allow' };
        for (const other of steps) {
            if (other.name === own.name)
                continue;
            if (matches(other.outputs)) {
                return {
                    kind: 'block',
                    reason: `BLOCKED: '${filePath}' is a declared output of step '${other.name}', not of the ` +
                        `current step '${stepName}'. Do NOT modify another step's artifacts — they are ` +
                        `validated by gates and humans. Report the problem in YOUR step's output/summary ` +
                        `instead; the orchestrator decides the fix (retry of '${other.name}' or an explicit ` +
                        `approved correction).`,
                };
            }
        }
        const runDirN = posix
            .normalize(canonicalCompareForm(runDir).replace(/\\/g, '/'))
            .replace(/\/+$/, '')
            .toLowerCase();
        const targetAbs = posix
            .normalize(canonicalCompareForm(isAbsolute(filePath) ? filePath : join(sessionCwd, filePath)).replace(/\\/g, '/'))
            .toLowerCase();
        const inRunDir = targetAbs.startsWith(`${runDirN}/`);
        if (inRunDir) {
            return {
                kind: 'warn',
                runId,
                message: `[file-guard] run=${runId} step=${stepName}: write outside declared outputs: ` +
                    `'${filePath}' (no declared output of '${stepName}' matches; scratch is legal but ` +
                    `audited — declare the output or report instead)`,
            };
        }
        return { kind: 'allow' };
    }
    catch {
        return { kind: 'allow' };
    }
}
function appendBoundaryWarning(projectRoot, message) {
    try {
        const agentDir = join(projectRoot, PRODUCT_DIR);
        mkdirSync(agentDir, { recursive: true });
        const fd = openSync(join(agentDir, 'gate-check-error.log'), 'a');
        try {
            writeFileSync(fd, `${nowIsoNaiveLocal()} | ${message}\n`, 'utf-8');
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
    }
}
const READ_ONLY_TOOLS = new Set([
    'read',
    'grep',
    'glob',
    'ls',
    'list_dir',
    'codebase_search',
    'search',
    'view',
    'rg',
    'read_file',
    'read_many_files',
    'list_directory',
    'grep_search',
    'search_file_content',
    'google_web_search',
    'web_fetch',
]);
export function parseApplyPatchTargets(command) {
    const out = [];
    const fileRe = /^\*\*\*\s+(?:Add|Update|Delete) File:\s*(.+?)\s*$/gm;
    const moveRe = /^\*\*\*\s+Move to:\s*(.+?)\s*$/gm;
    let m;
    while ((m = fileRe.exec(command)) !== null)
        if (m[1])
            out.push(m[1]);
    while ((m = moveRe.exec(command)) !== null)
        if (m[1])
            out.push(m[1]);
    return out;
}
export function extractWriteTargets(hookInput) {
    const toolName = typeof hookInput.tool_name === 'string'
        ? hookInput.tool_name
        : typeof hookInput.toolName === 'string'
            ? hookInput.toolName
            : '';
    let toolInput = hookInput.tool_input !== undefined ? hookInput.tool_input : hookInput.toolArgs;
    if (typeof toolInput === 'string') {
        try {
            toolInput = JSON.parse(toolInput);
        }
        catch {
            toolInput = {};
        }
    }
    const ti = toolInput !== null && typeof toolInput === 'object' && !Array.isArray(toolInput)
        ? toolInput
        : {};
    if (toolName && READ_ONLY_TOOLS.has(toolName.toLowerCase()))
        return [];
    if (toolName === 'apply_patch') {
        const cmd = typeof ti.command === 'string'
            ? ti.command
            : typeof ti.patchText === 'string'
                ? ti.patchText
                : '';
        return cmd ? parseApplyPatchTargets(cmd) : [];
    }
    const fp = typeof ti.file_path === 'string'
        ? ti.file_path
        : typeof ti.filePath === 'string'
            ? ti.filePath
            : typeof ti.notebook_path === 'string'
                ? ti.notebook_path
                : typeof ti.path === 'string'
                    ? ti.path
                    : '';
    return fp ? [fp] : [];
}
export async function runFileGuard(opts = {}) {
    const r = resolveOpts(opts);
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
    if (raw.charCodeAt(0) === 0xfeff) {
        raw = raw.slice(1);
    }
    let hookInput;
    try {
        hookInput = raw.trim() ? JSON.parse(raw) : {};
    }
    catch {
        return 0;
    }
    if (hookInput === null || typeof hookInput !== 'object' || Array.isArray(hookInput)) {
        return 0;
    }
    const targets = extractWriteTargets(hookInput);
    if (targets.length === 0) {
        return 0;
    }
    for (const filePath of targets) {
        if (isProtected(filePath, r.cwd)) {
            return emitPreToolUseDeny(r.host, `BLOCKED: Cannot modify '${filePath}' — engine infrastructure file. Workflow steps must only write to their designated output paths.`, r);
        }
        const specReason = protectedSpecFileReason(filePath, r.cwd);
        if (specReason) {
            return emitPreToolUseDeny(r.host, specReason, r);
        }
        const trustReason = protectedTrustFileReason(filePath, r.cwd);
        if (trustReason) {
            return emitPreToolUseDeny(r.host, trustReason, r);
        }
        const runStateReason = protectedRunStateReason(filePath, r.cwd);
        if (runStateReason) {
            return emitPreToolUseDeny(r.host, runStateReason, r);
        }
        const boundaryRoot = r.projectRoot ?? r.cwd;
        const verdict = checkOutputBoundary(filePath, boundaryRoot, r.cwd, r.env);
        if (verdict.kind === 'block') {
            return emitPreToolUseDeny(r.host, verdict.reason, r);
        }
        if (verdict.kind === 'warn') {
            appendBoundaryWarning(boundaryRoot, verdict.message);
        }
    }
    return 0;
}
