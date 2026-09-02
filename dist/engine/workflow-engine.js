import { instruction } from './instruction-files.js';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { basename as pathBasename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { autoOpenTraceViewer, inboxAskMaxHoldMs, inboxWebhookUrl } from '../config/config.js';
import { currentCallContext, elicitationAvailable, emitCallProgress, getHostBridge, } from './host-bridge.js';
import { PRODUCT_DIR } from '../config/paths.js';
import { AGENT_PREFIX, CLI_NAME, ENV_INBOX_WEBHOOK_OVERRIDE, ENV_TRACE_VIEWER_OVERRIDE, ENV_MODEL_OVERRIDE, ENV_RUN_DIR, ENV_RUN_ID, ENV_TRACE_LOCK_TIMEOUT_MS, LEGACY_ENV_RUN_DIR, WORKFLOW_STEP_AGENT, } from '../config/product.js';
import { currentLocalServerBase, ensureLocalServer, openTraceViewer } from './trace-server.js';
import { withServeToken } from './local-api.js';
import { AGENT_NOTES_VERSION, appendIndexEntry, assertSafeStepTemplate, composeNoteFile, ensureStepTemplateNotesDir, generateNoteFilename, isoDateLocal, noteFilePath, readIndex, stepTemplateNotesDir, } from './agent-notes.js';
import { parse as parseYamlString } from 'yaml';
import { isModelMode, MODEL_MODES, resolvePlanningRestrictions } from '../types/workflow.js';
import { formatAjvErrors, tryValidateWorkflow } from '../types/validators.js';
import { copyStructsToDynamicRuntime, dynamicChildWorkflowName, dynamicRuntimeDir, writeDynamicWorkflow, } from './dynamic-runs.js';
import { resolveActiveWorkflow } from './active-workflow.js';
import { lintWorkflow, structHasFieldContainer, structUnknownTopLevelKeys } from './workflow-lint.js';
import { clearCurrentRunId, getCurrentRunId, setCurrentRunId } from './run-context.js';
import { generateRunId, isValidRunId } from './run-id.js';
import { appendRunEvent, findRunsByWorkflow, runDir } from './runs.js';
import { freezeStepTools, profileIdForItem, stepBranchProfiles, stepDeniedCapabilities, } from './step-tool-rights.js';
import { detectOrchestratorModel, getEngineClientName, getEngineClientVersion, getEngineHost, } from './host-context.js';
import { composeDomainsEcho, composeSpecGuidance } from './spec-tools.js';
import { loadYaml, validateFile } from './schema-validate.js';
import { toIsoLocal } from './iso-time.js';
import { acquireFileLockSync, isProcessAlive, lockedJsonReadModifyWriteSync, releaseFileLock, } from './file-lock.js';
import { claimSpooledEvents } from './run-resolve.js';
import { collectAllSteps, findStepConfig } from './workflow-tree.js';
import { STRUCTURAL_GATE_DISABLED_DETAIL, ledgerForStep, humanGateConfig, isExternalChannel, recomputeAggregate, resolveHumanChannel, resolveStructuralGate, stepGateFlag, upsertBranch, } from './gate-ledger.js';
import { clearUserActiveScope as scopeClearUserActiveScope, getScopeHint as scopeGetScopeHint, readUserActiveScope as scopeReadUserActiveScope, resolveActiveScope as scopeResolveActiveScope, scopeExists as scopeScopeExists, validateScopeId as scopeValidateScopeId, writeUserActiveScope as scopeWriteUserActiveScope, } from '../scope/scope-context.js';
export function defaultPaths(cwd) {
    const root = cwd ?? process.cwd();
    const agentDir = resolve(root, PRODUCT_DIR);
    const workflowsDir = join(agentDir, 'workflows');
    const templatesDir = join(workflowsDir, 'templates');
    return {
        agentDir,
        workflowsDir,
        templatesDir,
        predefinedDir: join(templatesDir, 'predefined'),
        myWorkflowsDir: join(templatesDir, 'my_workflows'),
        examplesDir: join(templatesDir, 'examples'),
        communityDir: join(templatesDir, 'community'),
    };
}
export function safeWriteJson(path, data) {
    const content = `${JSON.stringify(data, null, 2)}\n`;
    const tmpPath = `${path}.tmp.${process.pid}`;
    try {
        writeFileSync(tmpPath, content, 'utf-8');
        try {
            renameSync(tmpPath, path);
            return;
        }
        catch {
            for (let i = 0; i < 3; i += 1) {
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
                try {
                    renameSync(tmpPath, path);
                    return;
                }
                catch {
                }
            }
            throw new Error('rename retries exhausted');
        }
    }
    catch {
        try {
            unlinkSync(tmpPath);
        }
        catch {
        }
        try {
            writeFileSync(path, content, 'utf-8');
        }
        catch (e2) {
            const msg = e2 instanceof Error ? e2.message : String(e2);
            logEngine(`Warning: failed to write ${path}: ${msg}`);
        }
    }
}
function withTraceLock(tracePath, fn) {
    const fd = acquireTraceLockOrNull(tracePath);
    try {
        fn();
    }
    finally {
        if (fd !== null)
            releaseFileLock(fd, `${tracePath}.lock`);
    }
}
function acquireTraceLockOrNull(tracePath) {
    const envMs = Number(process.env[ENV_TRACE_LOCK_TIMEOUT_MS] ?? '');
    const timeoutMs = Number.isFinite(envMs) && envMs > 0 ? envMs : 10_000;
    const fd = acquireFileLockSync(`${tracePath}.lock`, timeoutMs);
    if (fd === null) {
        logEngine(`Warning: trace lock timeout for ${tracePath} — proceeding unlocked`);
    }
    return fd;
}
export function safeWriteText(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    const tmpPath = `${path}.tmp`;
    try {
        writeFileSync(tmpPath, content, 'utf-8');
        renameSync(tmpPath, path);
    }
    catch (e) {
        if (!(e instanceof Error) || !('code' in e))
            throw e;
        try {
            writeFileSync(path, content, 'utf-8');
        }
        catch (e2) {
            if (!(e2 instanceof Error) || !('code' in e2))
                throw e2;
            const msg = e2.message;
            logEngine(`Warning: failed to write ${path}: ${msg}`);
        }
    }
}
function logEngine(message) {
    // eslint-disable-next-line no-console
    console.error(`[workflow-engine] ${message}`);
}
function pythonRepr(val) {
    if (val === true)
        return 'True';
    if (val === false)
        return 'False';
    if (Array.isArray(val)) {
        return `[${val.map((x) => pythonRepr(x)).join(', ')}]`;
    }
    return String(val);
}
const workflowCache = new Map();
export function clearWorkflowCache() {
    workflowCache.clear();
}
export { collectAllSteps };
function collectAllSequences(workflow) {
    const seqs = [];
    const visit = (steps, label) => {
        seqs.push({ steps: steps ?? [], label });
        for (const s of steps ?? []) {
            const routes = s.routes;
            if (routes && Array.isArray(routes.define)) {
                for (const r of routes.define)
                    visit(r.steps, `${label} → route '${r.id ?? '<unnamed>'}'`);
            }
            const lanes = s.lanes;
            if (lanes && Array.isArray(lanes.define)) {
                for (const l of lanes.define)
                    visit(l.steps, `${label} → lane '${l.id ?? '<unnamed>'}'`);
            }
        }
    };
    visit(workflow.steps, 'main');
    return seqs;
}
function collectAllRoutes(workflow) {
    const routes = [];
    for (const s of collectAllSteps(workflow)) {
        const r = s.routes;
        if (!r || !Array.isArray(r.define))
            continue;
        const ownerStep = s.name ?? '<unnamed>';
        for (const def of r.define) {
            routes.push({
                id: def.id ?? '<unnamed>',
                steps: (def.steps ?? []),
                ownerStep,
            });
        }
    }
    return routes;
}
function resolveActiveSequence(workflow, manifest) {
    const stack = manifest.route_stack ?? [];
    const mainSteps = (workflow.steps ?? []);
    if (stack.length === 0)
        return mainSteps;
    const topId = stack[stack.length - 1]?.route_id;
    for (const r of collectAllRoutes(workflow)) {
        if (r.id === topId)
            return r.steps;
    }
    return mainSteps;
}
function computeProceedTarget(workflow, manifest, stepName) {
    const seq = resolveActiveSequence(workflow, manifest);
    const names = seq.map((s) => s.name ?? '');
    const idx = names.indexOf(stepName);
    if (idx >= 0 && idx + 1 < names.length)
        return names[idx + 1] ?? null;
    const stack = manifest.route_stack ?? [];
    if (stack.length > 0)
        return stack[stack.length - 1]?.return_to ?? null;
    return null;
}
function laneContextOf(workflow, stepName) {
    let found = null;
    const visit = (steps, ctx) => {
        for (const s of steps ?? []) {
            if (s.name === stepName && ctx)
                found = ctx;
            const routes = s.routes;
            if (routes && Array.isArray(routes.define)) {
                for (const r of routes.define)
                    visit(r.steps, ctx);
            }
            const lanes = s.lanes;
            if (lanes && Array.isArray(lanes.define)) {
                const owner = s.name ?? '<unnamed>';
                for (const l of lanes.define) {
                    visit(l.steps, {
                        forkStep: owner,
                        laneId: l.id ?? '<unnamed>',
                        laneSteps: (l.steps ?? []),
                    });
                }
            }
        }
    };
    visit(workflow.steps, null);
    return found;
}
function staticSequenceOf(workflow, stepName) {
    let found = null;
    const visit = (steps) => {
        const list = steps ?? [];
        for (const s of list) {
            if (s.name === stepName && !found)
                found = list;
            const routes = s.routes;
            if (routes && Array.isArray(routes.define))
                for (const r of routes.define)
                    visit(r.steps);
            const lanes = s.lanes;
            if (lanes && Array.isArray(lanes.define))
                for (const l of lanes.define)
                    visit(l.steps);
        }
    };
    visit(workflow.steps);
    return found ?? (workflow.steps ?? []);
}
function containerOf(workflow, stepName) {
    let found = null;
    const visit = (steps, ctx) => {
        for (const s of steps ?? []) {
            if (s.name === stepName && !found)
                found = ctx;
            const owner = s.name ?? '<unnamed>';
            const routes = s.routes;
            if (routes && Array.isArray(routes.define)) {
                for (const r of routes.define) {
                    visit(r.steps, { kind: 'route', ownerStep: owner, routeId: r.id ?? '<unnamed>' });
                }
            }
            const lanes = s.lanes;
            if (lanes && Array.isArray(lanes.define)) {
                for (const l of lanes.define) {
                    visit(l.steps, { kind: 'lane', forkStep: owner, laneId: l.id ?? '<unnamed>' });
                }
            }
        }
    };
    visit(workflow.steps, { kind: 'main' });
    return found ?? { kind: 'main' };
}
function staticNextOf(workflow, stepName) {
    const seq = staticSequenceOf(workflow, stepName);
    const names = seq.map((s) => s.name ?? '');
    const idx = names.indexOf(stepName);
    if (idx >= 0 && idx + 1 < names.length)
        return names[idx + 1] ?? null;
    return null;
}
function laneStateOf(manifest, forkStep) {
    const stepData = manifest.steps?.[forkStep];
    const ls = stepData?.lane_state;
    return ls && typeof ls === 'object' && ls.lanes ? ls : null;
}
function activeLaneOwners(manifest) {
    const raw = manifest.active_lanes;
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
}
function admissibleLaneCursors(manifest) {
    const owners = new Set(activeLaneOwners(manifest));
    const out = [];
    for (const forkStep of owners) {
        const ls = laneStateOf(manifest, forkStep);
        if (!ls)
            continue;
        for (const [laneId, entry] of Object.entries(ls.lanes)) {
            if (entry.status === 'completed')
                continue;
            if (typeof entry.cursor !== 'string' || !entry.cursor)
                continue;
            if (owners.has(entry.cursor))
                continue;
            out.push({ forkStep, laneId, cursor: entry.cursor });
        }
    }
    return out;
}
function setCursorFor(workflow, manifest, targetStep) {
    const ctx = laneContextOf(workflow, targetStep);
    if (ctx && activeLaneOwners(manifest).includes(ctx.forkStep)) {
        const ls = laneStateOf(manifest, ctx.forkStep);
        const entry = ls?.lanes[ctx.laneId];
        if (ls && entry) {
            entry.cursor = targetStep;
            return;
        }
    }
    manifest.current_step = targetStep;
}
function ruleNoBranchLiteralInParallelOutputs(workflow) {
    const errors = [];
    const steps = collectAllSteps(workflow);
    for (const step of steps) {
        if (!step.parallel)
            continue;
        const stepName = step.name ?? '<unnamed>';
        const outputs = (step.outputs ?? []);
        for (const out of outputs) {
            const opath = typeof out === 'string'
                ? out
                : out?.path ?? '';
            if (!opath)
                continue;
            if (/(^|\/)_branch_/.test(opath)) {
                errors.push(`step '${stepName}' outputs.path contains a literal '_branch_*' segment: ` +
                    `'${opath}'. The engine adds _branch_N/ automatically for parallel steps; ` +
                    `author paths must NOT include it.`);
            }
        }
    }
    return errors;
}
function ruleNoEnginePromptsNamespace(workflow) {
    const errors = [];
    const inNamespace = (p) => p === 'prompts' || p.startsWith('prompts/');
    for (const step of collectAllSteps(workflow)) {
        const stepName = step.name ?? '<unnamed>';
        for (const [kind, list] of [
            ['inputs', (step.inputs ?? [])],
            ['outputs', (step.outputs ?? [])],
        ]) {
            for (const raw of list) {
                const path = typeof raw === 'string'
                    ? raw
                    : raw?.path ?? '';
                if (path && inNamespace(path)) {
                    errors.push(`step '${stepName}' ${kind} path '${path}' is under the run-root 'prompts/' ` +
                        `directory — the engine's own namespace for composed step prompt files. ` +
                        `Author files belong under 'data/' (or another run-root directory).`);
                }
            }
        }
    }
    return errors;
}
function ruleParallelOutputPaths(workflow) {
    const errors = [];
    const validParams = new Set(['run_id', 'iteration']);
    const params = (workflow.params ?? []);
    for (const p of params) {
        if (typeof p?.name === 'string') {
            validParams.add(p.name);
            if (p.name === 'parallel_key') {
                errors.push(`workflow param 'parallel_key' is a reserved namespace — it is used by ` +
                    `{parallel_key.<field>} in parallel output paths. Rename the param.`);
            }
        }
    }
    for (const step of collectAllSteps(workflow)) {
        if (!step.parallel)
            continue;
        const stepName = step.name ?? '<unnamed>';
        const outputs = (step.outputs ?? []);
        for (const out of outputs) {
            const opath = typeof out === 'string'
                ? out
                : out?.path ?? '';
            if (!opath)
                continue;
            let hasParallelKey = false;
            for (const m of opath.matchAll(/\{([^}]*)\}/g)) {
                const token = m[1] ?? '';
                if (token === '')
                    continue;
                if (token === 'parallel_key' || token.startsWith('parallel_key.')) {
                    hasParallelKey = true;
                    continue;
                }
                if (!validParams.has(token)) {
                    errors.push(`step '${stepName}' parallel output '${opath}' uses '{${token}}', which is ` +
                        `neither a declared workflow param nor a parallel_key field. Use ` +
                        `{parallel_key.<field>} for per-branch identity, {} for a branch index, ` +
                        `or declare '${token}' as a workflow param.`);
                }
            }
            const hasGlob = /[*?[]/.test(opath);
            if (!hasParallelKey && !hasGlob) {
                errors.push(`step '${stepName}' parallel output '${opath}' is the same for every branch ` +
                    `(no {parallel_key.<field>}, no glob) → all branches would write the identical ` +
                    `file and collide at merge. Add {parallel_key.<field>} for per-branch paths, or ` +
                    `a glob basename (e.g. *.json) whose files each branch names distinctly.`);
            }
        }
    }
    return errors;
}
function ruleNonParallelOutputPaths(workflow) {
    const errors = [];
    const validParams = new Set(['run_id', 'iteration']);
    const params = (workflow.params ?? []);
    for (const p of params) {
        if (typeof p?.name === 'string')
            validParams.add(p.name);
    }
    for (const step of collectAllSteps(workflow)) {
        if (step.parallel)
            continue;
        const stepName = step.name ?? '<unnamed>';
        const outputs = (step.outputs ?? []);
        for (const out of outputs) {
            const opath = typeof out === 'string'
                ? out
                : out?.path ?? '';
            if (!opath)
                continue;
            for (const m of opath.matchAll(/\{([^}]*)\}/g)) {
                const token = m[1] ?? '';
                if (token === '') {
                    errors.push(`step '${stepName}' output '${opath}' uses '{}' (branch-index slot), which is only ` +
                        `valid in a parallel step. A non-parallel step writes one concrete path — remove it.`);
                    continue;
                }
                if (token === 'parallel_key' || token.startsWith('parallel_key.')) {
                    errors.push(`step '${stepName}' output '${opath}' uses '{${token}}' (parallel_key namespace), ` +
                        `which is only valid in a parallel step. Use a {param} or a literal path segment.`);
                    continue;
                }
                if (!validParams.has(token)) {
                    errors.push(`step '${stepName}' output '${opath}' uses '{${token}}', which is not a declared ` +
                        `workflow param. Declare '${token}' in params:, or write a literal '*' for a glob.`);
                }
            }
        }
    }
    return errors;
}
function ruleStructSchemasExist(workflow, definitionDir) {
    const structRefs = new Map();
    const recordRef = (name, location) => {
        const locs = structRefs.get(name) ?? [];
        locs.push(location);
        structRefs.set(name, locs);
    };
    const steps = collectAllSteps(workflow);
    for (const step of steps) {
        const stepName = step.name ?? '<unnamed>';
        for (const section of ['inputs', 'outputs']) {
            const items = (step[section] ?? []);
            for (const item of items) {
                if (typeof item !== 'object' || item === null)
                    continue;
                const structName = item.struct;
                if (structName)
                    recordRef(structName, `step '${stepName}' ${section}`);
            }
        }
        const profiles = stepBranchProfiles(step);
        if (profiles) {
            for (const [pid, profile] of Object.entries(profiles)) {
                if (typeof profile.struct === 'string' && profile.struct.length > 0) {
                    recordRef(profile.struct, `step '${stepName}' branch_profiles.${pid}`);
                }
            }
        }
    }
    const errors = [];
    for (const [structName, locations] of structRefs) {
        const schemaPath = `${definitionDir}/structs/${structName}.schema.yaml`;
        try {
            const st = statSync(schemaPath);
            if (!st.isFile()) {
                errors.push(`struct '${structName}' (referenced at: ${locations.join(', ')}) — exists but is not a file: ${schemaPath}`);
                continue;
            }
        }
        catch (e) {
            if (e?.code !== 'ENOENT')
                throw e;
            errors.push(`struct '${structName}' (referenced at: ${locations.join(', ')}) — expected at: ${schemaPath}`);
            continue;
        }
        let parsed;
        try {
            parsed = loadYaml(schemaPath);
        }
        catch (e) {
            errors.push(`struct '${structName}' (referenced at: ${locations.join(', ')}) — ${schemaPath} is not valid YAML: ` +
                `${e instanceof Error ? e.message : String(e)}`);
            continue;
        }
        const unknownKeys = structUnknownTopLevelKeys(parsed);
        if (unknownKeys.length > 0 && !structHasFieldContainer(parsed)) {
            const list = unknownKeys.map((k) => `'${k}'`).join(', ');
            errors.push(`struct '${structName}' (referenced at: ${locations.join(', ')}) — ${schemaPath} has ` +
                `unrecognized top-level key(s): ${list} and no recognized field container. Nothing reads ` +
                `those keys, so beyond file presence the schema validates almost nothing while looking ` +
                `alive. Field definitions belong under 'properties:' (standard style) or ` +
                `'json_schema:'/'yaml_schema:'/'frontmatter:'/'required_sections:' (custom style). ` +
                `Reference: workflow_learn(topic="struct-format").`);
        }
    }
    return errors;
}
function ruleDeciderScriptsExist(workflow, definitionDir) {
    const norm = definitionDir.replace(/\\/g, '/');
    const acpIdx = norm.indexOf('/.riglane/');
    if (acpIdx < 0)
        return [];
    const projectRoot = definitionDir.slice(0, acpIdx);
    const defnRootRel = norm.slice(acpIdx + 1);
    const SCRIPT_TOKEN = /^["']?([^"'\s]+\.(?:py|js|mjs|cjs|sh|bash|ps1|rb|pl))["']?$/i;
    const isAbs = (p) => /^([A-Za-z]:[\\/]|[\\/])/.test(p);
    const errors = [];
    const checkCommand = (cmd, where) => {
        if (typeof cmd !== 'string' || cmd.length === 0)
            return;
        for (const rawTok of cmd.split(/\s+/)) {
            const m = SCRIPT_TOKEN.exec(rawTok);
            const tok = m?.[1];
            if (!tok)
                continue;
            if (tok.includes('$') || tok.includes('%') || tok.includes('{'))
                continue;
            if (isAbs(tok))
                continue;
            if (existsSync(join(projectRoot, tok)))
                continue;
            if (existsSync(join(definitionDir, tok))) {
                errors.push(`${where}: decider script '${tok}' will NOT be found at runtime — deciders run ` +
                    `from the PROJECT ROOT, but the file lives in the workflow directory. ` +
                    `Use the full root-relative path instead: '${defnRootRel}/${tok.replace(/\\/g, '/')}'.`);
            }
            else {
                errors.push(`${where}: decider script '${tok}' not found from the project root (deciders run ` +
                    `with cwd = project root). Place the script under the workflow's scripts/ dir ` +
                    `and reference it by its full root-relative path ` +
                    `(e.g. '${defnRootRel}/scripts/<name>').`);
            }
        }
    };
    const wfHumanCfg = (workflow.gate ?? {}).human;
    if (typeof wfHumanCfg === 'object' && wfHumanCfg !== null) {
        checkCommand(wfHumanCfg.script, `workflow gate.human.script`);
    }
    for (const s of collectAllSteps(workflow)) {
        const stepName = s.name ?? '<unnamed>';
        const lb = s.loop_back;
        if (lb?.when)
            checkCommand(lb.when.script, `step '${stepName}' loop_back.when.script`);
        const rt = s.routes;
        if (rt?.when)
            checkCommand(rt.when.script, `step '${stepName}' routes.when.script`);
        const gh = (s.gate ?? {}).human;
        if (typeof gh === 'object' && gh !== null) {
            checkCommand(gh.script, `step '${stepName}' gate.human.script`);
        }
    }
    return errors;
}
function rulePlanningStepTypes(workflow, allowParallel, allowDelegation) {
    const errors = [];
    const steps = (workflow.steps ?? []);
    for (const step of steps) {
        const stepName = step.name ?? '<unnamed>';
        if (step.parallel === true && !allowParallel) {
            errors.push(`step '${stepName}' has 'parallel: true' but parent planning step has ` +
                `allow_parallel=false. Remove 'parallel: true' or split into separate substeps.`);
        }
        if ('delegate_to' in step && !allowDelegation) {
            errors.push(`step '${stepName}' has 'delegate_to: ${String(step.delegate_to)}' but parent ` +
                `planning step has allow_delegation=false. Nested delegation is forbidden ` +
                `(max-depth-1 invariant); replace with inline regular steps.`);
        }
        if (step.type === 'planning') {
            errors.push(`step '${stepName}' has 'type: planning' — nested planning steps are forbidden ` +
                `(prevents infinite planner recursion).`);
        }
        if (step.routes !== undefined) {
            errors.push(`step '${stepName}' declares a 'routes' block — conditional routing is forbidden ` +
                `in orchestrator-drafted planning children (v1). Keep generated substeps linear; ` +
                `model alternatives by re-planning (workflow_replan_dynamic) instead.`);
        }
        if (step.spec_authoring !== undefined) {
            errors.push(`step '${stepName}' declares 'spec_authoring' — spec capability flags are ` +
                `forbidden in orchestrator-drafted planning children (the generic subagent ` +
                `has no per-step tool whitelist, so the capability cannot be granted). ` +
                `Author specs from a static workflow step instead.`);
        }
        if (step.spec_check !== undefined && step.spec_check !== false) {
            errors.push(`step '${stepName}' declares 'spec_check: true' — spec capability flags are ` +
                `forbidden in orchestrator-drafted planning children (the generic subagent ` +
                `has no per-step tool whitelist, so spec_search/spec_link cannot be granted). ` +
                `Spec compliance for dynamic work is carried by the parent's semantic gate.`);
        }
    }
    return errors;
}
function ruleSubstepCount(workflow, max) {
    const count = (workflow.steps ?? []).length;
    if (count > max) {
        return [
            `generated workflow has ${count} substeps but max_substeps=${max}. ` +
                `Reduce the plan or request larger max_substeps in the parent step config.`,
        ];
    }
    if (count === 0) {
        return [`generated workflow has 0 steps — at least one substep is required.`];
    }
    return [];
}
function ruleNoForbiddenTopLevel(workflow) {
    const errors = [];
    const w = workflow;
    if (w.tools !== undefined) {
        errors.push(`generated workflow declares top-level 'tools:' — forbidden. Child inherits ` +
            `parent's tools whitelist (security boundary).`);
    }
    if (w.params !== undefined) {
        errors.push(`generated workflow declares top-level 'params:' — forbidden. Pass values via ` +
            `inherit_params on the workflow_invoke_dynamic call instead.`);
    }
    return errors;
}
function ruleStepNameUniqueness(workflow) {
    const errors = [];
    const seen = new Set();
    const steps = collectAllSteps(workflow);
    for (const step of steps) {
        const name = step?.name ?? '<unnamed>';
        if (seen.has(name)) {
            errors.push(`duplicate step name '${name}' — step names MUST be globally unique within a ` +
                `workflow, including steps nested under routes. They key manifest.steps and ` +
                `trace.steps[].name; collisions corrupt runtime state.`);
        }
        else {
            seen.add(name);
        }
    }
    return errors;
}
function rulePlanningStepNoOutputs(workflow) {
    const errors = [];
    const steps = collectAllSteps(workflow);
    for (const step of steps) {
        if (step.type !== 'planning')
            continue;
        const outputs = step.outputs;
        if (Array.isArray(outputs) && outputs.length > 0) {
            const stepName = step.name ?? '<unnamed>';
            errors.push(`planning step '${stepName}' declares 'outputs' — forbidden. Planning steps ` +
                `produce a child workflow run, not output files; declared outputs are ` +
                `silently ignored. Remove the outputs block, or convert the step to a ` +
                `regular step if you really need outputs.`);
        }
    }
    return errors;
}
function rulePlanningStepNoStepGate(workflow) {
    const errors = [];
    const steps = collectAllSteps(workflow);
    for (const step of steps) {
        if (step.type !== 'planning')
            continue;
        if (step.gate !== undefined) {
            const stepName = step.name ?? '<unnamed>';
            errors.push(`planning step '${stepName}' declares a step-level 'gate:' — forbidden, it has ` +
                `no effect. Structural has nothing to validate (planning steps produce a child ` +
                `run, not outputs); semantic/human are not evaluated at the planning step. The ` +
                `workflow-level gate applies to the generated substeps (inherited), and the ` +
                `orchestrator sets per-substep gates in the drafted workflow. Remove the ` +
                `step-level gate block.`);
        }
    }
    return errors;
}
function ruleLoopBackValid(workflow) {
    const errors = [];
    const allSteps = collectAllSteps(workflow);
    const anyLoopBack = allSteps.some((s) => s.loop_back !== undefined);
    if (anyLoopBack) {
        const declared = (workflow.params ?? []);
        if (declared.some((p) => p.name === 'iteration')) {
            errors.push(`workflow declares a param named 'iteration' but also uses loop_back — ` +
                `'iteration' is a synthetic engine-managed param for loop workflows ` +
                `(injected at init, incremented on every LOOP_BACK). Rename the user param.`);
        }
    }
    else {
        for (const s of allSteps) {
            const outputs = s.outputs;
            if (!Array.isArray(outputs))
                continue;
            const sName = s.name ?? '<unnamed>';
            for (const out of outputs) {
                if (out === null || typeof out !== 'object')
                    continue;
                const p = typeof out.path === 'string' ? out.path : '';
                if (out.per_iteration === true || p.includes('{iteration}')) {
                    errors.push(`step '${sName}' output '${p}' uses per_iteration/{iteration} but the ` +
                        `workflow has no loop_back step — the iteration counter only exists in ` +
                        `loop workflows. Remove the flag/placeholder or add the loop_back block.`);
                }
            }
        }
    }
    for (const seq of collectAllSequences(workflow)) {
        const steps = seq.steps;
        const names = steps.map((s) => s.name ?? '<unnamed>');
        const ranges = [];
        for (let i = 0; i < steps.length; i += 1) {
            const lb = steps[i]?.loop_back;
            if (!lb || typeof lb !== 'object')
                continue;
            const stepName = names[i] ?? '<unnamed>';
            const to = lb.to ?? '';
            const toIdx = names.indexOf(to);
            if (toIdx < 0) {
                errors.push(`step '${stepName}' loop_back.to references '${to}', which is not a step in the ` +
                    `same sequence (${seq.label}). loop_back may only target a step in its own ` +
                    `sequence — the main flow loops within main; a route loops within that route ` +
                    `(no cross-boundary jumps).`);
                continue;
            }
            if (toIdx > i) {
                errors.push(`step '${stepName}' loop_back.to ('${to}') is a LATER step — loop_back may ` +
                    `only point backward (or at the step itself). Forward conditional jumps are ` +
                    `not supported; model skips via step goals instead.`);
                continue;
            }
            let crossed = false;
            for (const prev of ranges) {
                const disjoint = toIdx > prev.to || i < prev.from;
                const nested = (toIdx >= prev.from && i <= prev.to) || (prev.from >= toIdx && prev.to <= i);
                if (disjoint || nested)
                    continue;
                crossed = true;
                errors.push(`step '${stepName}' loop range [${to} .. ${stepName}] partially overlaps the ` +
                    `range of '${prev.owner}' [${names[prev.from] ?? '?'} .. ${prev.owner}] in the same ` +
                    `sequence (${seq.label}). Loop ranges must be either fully nested or completely ` +
                    `separate — a partial overlap would run steps outside the loop that is mid-flight, ` +
                    `leaving no defined iteration counter. Move the target so one range contains the ` +
                    `other, or so they do not touch.`);
                break;
            }
            if (crossed)
                continue;
            ranges.push({ from: toIdx, to: i, owner: stepName });
            for (let j = toIdx; j <= i; j += 1) {
                const s = steps[j];
                const sName = names[j] ?? '<unnamed>';
                const isOwner = j === i;
                if (s?.parallel === true || 'delegate_to' in (s ?? {}) || s?.type === 'planning') {
                    errors.push(`step '${sName}' is inside the loop range [${to} .. ${stepName}] but is not a ` +
                        `plain regular step (parallel/delegation/planning) — forbidden in v1. ` +
                        `Loop ranges may contain only regular steps.`);
                }
                else if (!isOwner && s?.routes !== undefined) {
                    errors.push(`step '${sName}' is inside the loop range [${to} .. ${stepName}] and declares a ` +
                        `'routes' block — routes are allowed only on the loop-owning (last) step of the ` +
                        `range in v1 (a route entered mid-loop-body would not be reset with the range; ` +
                        `this includes the owner of a nested loop, whose routes would re-fire on every ` +
                        `outer pass).`);
                }
                else if (!isOwner && s?.lanes !== undefined) {
                    errors.push(`step '${sName}' is inside the loop range [${to} .. ${stepName}] and declares a ` +
                        `'lanes' block — lanes are allowed only on the loop-owning (last) step of the ` +
                        `range (a fork entered mid-loop-body would re-fire on every pass without its ` +
                        `lane steps being reset with the range).`);
                }
            }
        }
    }
    return errors;
}
function collectAllLanes(workflow) {
    const lanes = [];
    for (const s of collectAllSteps(workflow)) {
        const l = s.lanes;
        if (!l || !Array.isArray(l.define))
            continue;
        const ownerStep = s.name ?? '<unnamed>';
        for (const def of l.define) {
            lanes.push({
                id: def.id ?? '<unnamed>',
                steps: (def.steps ?? []),
                ownerStep,
                join: l.join ?? {},
            });
        }
    }
    return lanes;
}
function ruleLanesValid(workflow) {
    const errors = [];
    const allLanes = collectAllLanes(workflow);
    const seenId = new Map();
    for (const r of collectAllRoutes(workflow))
        seenId.set(r.id, `route in step '${r.ownerStep}'`);
    for (const l of allLanes) {
        if (l.id === 'proceed') {
            errors.push(`lane id 'proceed' (in step '${l.ownerStep}') is reserved. Rename the lane.`);
        }
        const prev = seenId.get(l.id);
        if (prev !== undefined) {
            errors.push(`duplicate lane id '${l.id}' (in step '${l.ownerStep}'; also ${prev}). Lane ids ` +
                `MUST be globally unique within a workflow and share the route-id namespace — ` +
                `both are recorded in per-step stamps and trace events.`);
        }
        else {
            seenId.set(l.id, `lane in step '${l.ownerStep}'`);
        }
    }
    for (const s of collectAllSteps(workflow)) {
        if (s.lanes !== undefined && s.routes !== undefined) {
            errors.push(`step '${String(s.name)}' declares BOTH 'routes' and 'lanes' — the two blocks move ` +
                `the cursor in incompatible ways (routes injects one chosen sequence, lanes injects ` +
                `all of them concurrently). Put the routes block on a step inside a lane, or the ` +
                `lanes block on a step inside a route, instead.`);
        }
    }
    const byOwner = new Map();
    for (const l of allLanes) {
        const list = byOwner.get(l.ownerStep) ?? [];
        list.push(l);
        byOwner.set(l.ownerStep, list);
    }
    for (const [owner, siblings] of byOwner) {
        const outputOwner = new Map();
        const paramOwner = new Map();
        for (const lane of siblings) {
            for (const s of collectAllSteps({ steps: lane.steps })) {
                const outputs = s.outputs;
                if (Array.isArray(outputs)) {
                    for (const out of outputs) {
                        const p = typeof out === 'string' ? out : typeof out?.path === 'string' ? out.path : '';
                        if (!p)
                            continue;
                        const prevLane = outputOwner.get(p);
                        if (prevLane !== undefined && prevLane !== lane.id) {
                            errors.push(`lanes '${prevLane}' and '${lane.id}' (fork step '${owner}') both declare the ` +
                                `output path '${p}'. Sibling lanes write into the SHARED run dir concurrently — ` +
                                `colliding paths mean a nondeterministic winner. Give each lane its own path.`);
                        }
                        else {
                            outputOwner.set(p, lane.id);
                        }
                    }
                }
                const bindings = s.param_bindings;
                if (bindings && typeof bindings === 'object') {
                    for (const paramName of Object.keys(bindings)) {
                        const prevLane = paramOwner.get(paramName);
                        if (prevLane !== undefined && prevLane !== lane.id) {
                            errors.push(`lanes '${prevLane}' and '${lane.id}' (fork step '${owner}') both bind the ` +
                                `workflow param '${paramName}' via param_bindings. Completion order would ` +
                                `pick the surviving value — bind distinct params, or bind on the step after ` +
                                `the join instead.`);
                        }
                        else {
                            paramOwner.set(paramName, lane.id);
                        }
                    }
                }
            }
        }
    }
    return errors;
}
function ruleRoutesValid(workflow) {
    const errors = [];
    const seenId = new Map();
    for (const r of collectAllRoutes(workflow)) {
        if (r.id === 'proceed') {
            errors.push(`route id 'proceed' (in step '${r.ownerStep}') is reserved — it is the sentinel ` +
                `for "take no route". Rename the route to something else.`);
        }
        const prevOwner = seenId.get(r.id);
        if (prevOwner !== undefined) {
            errors.push(`duplicate route id '${r.id}' (in step '${r.ownerStep}'; also in step ` +
                `'${prevOwner}'). Route ids MUST be globally unique within a workflow — they are ` +
                `returned by route_decision and recorded in route_state.`);
        }
        else {
            seenId.set(r.id, r.ownerStep);
        }
    }
    return errors;
}
function ruleSpecAuthoringValid(workflow) {
    const errors = [];
    let hasPersist = false;
    for (const s of collectAllSteps(workflow)) {
        if (s.spec_authoring === 'persist')
            hasPersist = true;
        if (s.spec_authoring === 'persist' && s.parallel === true) {
            errors.push(`step '${String(s.name)}': spec_authoring: persist cannot be combined with ` +
                `parallel: true — parallel branch isolation (_branch_N/) mangles the ` +
                `.riglane/specs auto-output paths and concurrent branches would race spec_write ` +
                `registry updates. Author drafts in the parallel step (data/ outputs) and ` +
                `commit them via spec_write in a later non-parallel step.`);
        }
    }
    if (hasPersist) {
        const params = Array.isArray(workflow.params)
            ? workflow.params
            : [];
        if (!params.some((p) => p.name === 'scope')) {
            errors.push(`a step declares spec_authoring: persist but the workflow has no 'scope' ` +
                `param — the auto-declared .riglane/specs/{scope}/**/*.md outputs would ` +
                `silently degrade to a wildcard glob. Declare the param (use ` +
                `default: "generic" for unscoped projects).`);
        }
    }
    return errors;
}
export function fullValidateWorkflow(workflow, opts = {}) {
    const errors = [];
    const schemaResult = tryValidateWorkflow(workflow);
    if (!schemaResult.ok) {
        errors.push(`schema validation failed:\n${formatAjvErrors(schemaResult.errors)}`);
    }
    errors.push(...ruleStepNameUniqueness(workflow));
    errors.push(...ruleNoBranchLiteralInParallelOutputs(workflow));
    errors.push(...ruleNoEnginePromptsNamespace(workflow));
    errors.push(...ruleParallelOutputPaths(workflow));
    errors.push(...ruleNonParallelOutputPaths(workflow));
    errors.push(...rulePlanningStepNoOutputs(workflow));
    errors.push(...rulePlanningStepNoStepGate(workflow));
    errors.push(...ruleLoopBackValid(workflow));
    errors.push(...ruleRoutesValid(workflow));
    errors.push(...ruleLanesValid(workflow));
    errors.push(...ruleSpecAuthoringValid(workflow));
    errors.push(...ruleParallelRequiresSubagent(workflow));
    errors.push(...ruleParamBindingsReservedNames(workflow));
    errors.push(...ruleFromDelegatedValid(workflow));
    errors.push(...ruleStepToolsExist(workflow));
    errors.push(...ruleBranchProfilesValid(workflow));
    errors.push(...ruleParallelKeyParses(workflow));
    errors.push(...ruleHumanChannelValid(workflow));
    if (opts.definitionDir !== undefined) {
        errors.push(...ruleStructSchemasExist(workflow, opts.definitionDir));
        errors.push(...ruleDeciderScriptsExist(workflow, opts.definitionDir));
        errors.push(...ruleNameMatchesDirectory(workflow, opts.definitionDir));
    }
    const warnings = lintWorkflow(workflow, opts.definitionDir !== undefined ? { definitionDir: opts.definitionDir } : {});
    return { ok: errors.length === 0, errors, warnings };
}
function ruleParallelRequiresSubagent(workflow) {
    const errors = [];
    for (const s of collectAllSteps(workflow)) {
        if (s.parallel === true && s.subagent === false) {
            errors.push(`step '${String(s.name)}': parallel: true cannot be combined with subagent: false — ` +
                `parallel steps run as spawned subagent branches; an inline parallel step bypasses ` +
                `the branch-failure protections and fails at validation with misleading errors. ` +
                `Remove subagent: false (parallel implies subagents). ` +
                `See workflow_learn(topic="parallel").`);
        }
    }
    return errors;
}
function ruleParamBindingsReservedNames(workflow) {
    const errors = [];
    for (const s of collectAllSteps(workflow)) {
        const bindings = (s.param_bindings ?? {});
        for (const key of Object.keys(bindings)) {
            if (key === 'run_id' || key === 'iteration') {
                errors.push(`step '${String(s.name)}': param_bindings must not bind to '${key}' — it is an ` +
                    `engine-managed synthetic param; overwriting it re-points {${key}} placeholders ` +
                    `mid-run and corrupts output paths. Bind to a differently-named param. ` +
                    `See workflow_learn(topic="param-bindings").`);
            }
        }
    }
    return errors;
}
function ruleFromDelegatedValid(workflow) {
    const errors = [];
    for (const s of collectAllSteps(workflow)) {
        const outputs = (s.outputs ?? []);
        for (const o of outputs) {
            if (typeof o !== 'object' || o === null || !('from_delegated' in o))
                continue;
            const src = o.from_delegated;
            const stepName = String(s.name);
            if (typeof src !== 'string' || src.trim() === '') {
                errors.push(`step '${stepName}': from_delegated must be a non-empty string (a path in the ` +
                    `delegated child's run dir). See workflow_learn(topic="delegation").`);
                continue;
            }
            if (!('delegate_to' in s)) {
                errors.push(`step '${stepName}': from_delegated is only valid on a delegation step ` +
                    `(delegate_to) — the source path resolves in the DELEGATED child's run dir. ` +
                    `For a regular step, declare the file as a plain output instead. ` +
                    `See workflow_learn(topic="delegation").`);
            }
            const dest = String(o.path ?? '');
            if (/[*?[]/.test(dest)) {
                errors.push(`step '${stepName}': output path '${dest}' with from_delegated must be a CONCRETE ` +
                    `parent-side destination (no globs) — the engine copies the matched child file ` +
                    `to exactly this path. Put the dynamic part in from_delegated ('${src}') instead. ` +
                    `See workflow_learn(topic="delegation").`);
            }
        }
    }
    return errors;
}
function ruleStepToolsExist(workflow) {
    const errors = [];
    const declared = new Set((Array.isArray(workflow.tools) ? workflow.tools : [])
        .map((t) => t.name)
        .filter((n) => typeof n === 'string'));
    for (const step of collectAllSteps(workflow)) {
        const filter = step.tools;
        if (!Array.isArray(filter))
            continue;
        const unknown = filter.filter((n) => typeof n === 'string' && !declared.has(n));
        if (unknown.length === 0)
            continue;
        const stepName = step.name ?? '<unnamed>';
        const declaredList = declared.size > 0 ? [...declared].join(', ') : '(none declared)';
        errors.push(`step '${stepName}': tools: references undeclared tool(s): ${unknown
            .map((n) => `'${n}'`)
            .join(', ')}. Workflow-level tools: declares: ${declaredList}. Each step-level entry ` +
            `must exactly match a declared workflow tool name — an unmatched name grants nothing ` +
            `and is almost always a typo. See workflow_learn(topic="tools").`);
    }
    return errors;
}
function ruleBranchProfilesValid(workflow) {
    const errors = [];
    for (const step of collectAllSteps(workflow)) {
        const profiles = stepBranchProfiles(step);
        if (!profiles)
            continue;
        const stepName = step.name ?? '<unnamed>';
        if (step.parallel !== true) {
            errors.push(`step '${stepName}': branch_profiles is declared but the step is not parallel — ` +
                `profiles are selected by parallel_key items, so on a non-parallel step the field ` +
                `is a silent no-op. Remove it, or make the step parallel. ` +
                `See workflow_learn(topic="parallel").`);
            continue;
        }
        const stepTools = new Set((Array.isArray(step.tools)
            ? step.tools
            : []).filter((n) => typeof n === 'string'));
        const structOutputs = (step.outputs ?? []);
        const structBearing = structOutputs.filter((o) => o !== null && typeof o === 'object' && typeof o.struct === 'string').length;
        for (const [pid, profile] of Object.entries(profiles)) {
            const outside = (profile.tools ?? []).filter((t) => typeof t === 'string' && !stepTools.has(t));
            if (outside.length > 0) {
                errors.push(`step '${stepName}' branch_profiles.${pid}: tools ${outside
                    .map((t) => `'${t}'`)
                    .join(', ')} are not in the step's own tools: list (${stepTools.size > 0 ? [...stepTools].join(', ') : 'none declared'}). A profile narrows the step grant, never widens it — the step's list is the ` +
                    `union the workflow_tools server enforces, and a tool outside it would be ` +
                    `refused at the first call. Add it to the step's tools: or drop it here.`);
            }
            if (typeof profile.struct === 'string' && profile.struct.length > 0 && structBearing !== 1) {
                errors.push(`step '${stepName}' branch_profiles.${pid}: struct override requires the step to ` +
                    `have EXACTLY ONE struct-bearing output (found ${structBearing}) — the override ` +
                    `replaces that output's schema for this profile's branches, and with ` +
                    `${structBearing === 0 ? 'none there is nothing to override' : 'several the target is ambiguous'}.`);
            }
        }
    }
    return errors;
}
function ruleParallelKeyParses(workflow) {
    const errors = [];
    for (const step of collectAllSteps(workflow)) {
        const s = step;
        if (s.parallel !== true || typeof s.parallel_key !== 'string')
            continue;
        try {
            parseParallelKey(s.parallel_key);
        }
        catch (e) {
            const stepName = s.name ?? '<unnamed>';
            errors.push(`step '${stepName}': ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return errors;
}
function ruleHumanChannelValid(workflow) {
    const errors = [];
    const wfGate = (workflow.gate ?? {});
    const wfHuman = Boolean(wfGate.human);
    const steps = collectAllSteps(workflow);
    const resolvedStepHuman = (s) => resolvesStepHuman(wfGate, s);
    if (Object.prototype.hasOwnProperty.call(wfGate, 'human_channel')) {
        const anyHuman = wfHuman || steps.some((s) => resolvedStepHuman(s));
        if (!anyHuman) {
            errors.push(`workflow gate: 'human_channel' is set but no gate in the workflow resolves ` +
                `human: true — the channel would never route anything. Enable a human gate ` +
                `or remove human_channel.`);
        }
    }
    for (const step of steps) {
        const s = step;
        const name = s.name ?? '<unnamed>';
        const g = (s.gate ?? {});
        if (Object.prototype.hasOwnProperty.call(g, 'human_channel') && !resolvedStepHuman(s)) {
            errors.push(`step '${name}' gate: 'human_channel' is set but the step's resolved human gate is ` +
                `false — it would be silently ignored. Add human: true or remove human_channel.`);
        }
        for (const [key, label] of [
            ['loop_back', 'loop_back.when'],
            ['routes', 'routes.when'],
        ]) {
            const when = (s[key] ?? {}).when;
            if (when && Object.prototype.hasOwnProperty.call(when, 'human_channel') && when.human !== true) {
                errors.push(`step '${name}' ${label}: 'human_channel' is set but 'human' is not true — the ` +
                    `channel only routes a human question that exists. Add human: true or remove it.`);
            }
        }
    }
    return errors;
}
function ruleNameMatchesDirectory(workflow, definitionDir) {
    const dirName = pathBasename(definitionDir);
    const wfName = workflow.name;
    if (typeof wfName === 'string' && wfName !== '' && dirName !== '' && wfName !== dirName) {
        return [
            `workflow name '${wfName}' does not match its directory name '${dirName}' — the engine ` +
                `resolves workflows, per-step subagents, and the active-workflow guard by DIRECTORY ` +
                `name, while generated artifacts use the YAML name; a mismatch silently degrades ` +
                `per-step agents and can hard-fail runs that declare script tools. Rename the ` +
                `directory or the \`name:\` field so they match. ` +
                `See workflow_learn(topic="workflow-fields").`,
        ];
    }
    return [];
}
function validateAuthoringConventions(workflow, workflowName, definitionDir) {
    const result = fullValidateWorkflow(workflow, { definitionDir });
    if (result.ok)
        return;
    throw new Error(`Workflow '${workflowName}' has an invalid configuration ` +
        `(${result.errors.length} issue(s)):\n` +
        result.errors.map((e) => `  - ${e}`).join('\n') +
        `\n\nORCHESTRATOR DIRECTIVE: This is a workflow authoring error, NOT a runtime ` +
        `problem. DO NOT modify workflow.yaml. DO NOT create missing struct schema files. ` +
        `DO NOT retry. Surface this entire error to the user verbatim and STOP the ` +
        `workflow.\n\n` +
        `AUTHOR REMEDIATION (for the user to act on): Fix the listed issue(s) in ` +
        `workflow.yaml or its structs/ directory. For field syntax reference, the user ` +
        `(or another agent in this session) can call ` +
        `workflow_learn(topic="step-fields"|"parallel"|"gate"|"inputs"|"outputs"|"delegation"). ` +
        `For struct schemas: workflow_learn(topic="struct-format"). Engine reads schemas ` +
        `exclusively from <workflow_dir>/structs/<name>.schema.yaml; top-level 'structs:' ` +
        `in workflow.yaml is NOT parsed.`);
}
export function validateDynamicWorkflow(rawYaml, parentDefinitionDir, restrictions) {
    let workflow;
    try {
        workflow = parseYamlString(rawYaml);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            errors: [
                `YAML parse error: ${msg}. Fix the syntax and resubmit.`,
            ],
        };
    }
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
        return {
            ok: false,
            errors: ['workflow root MUST be a YAML mapping (object).'],
        };
    }
    const errors = [
        ...ruleNoForbiddenTopLevel(workflow),
        ...ruleSubstepCount(workflow, restrictions.maxSubsteps),
        ...rulePlanningStepTypes(workflow, restrictions.allowParallel, restrictions.allowDelegation),
        ...ruleNoBranchLiteralInParallelOutputs(workflow),
        ...ruleNoEnginePromptsNamespace(workflow),
        ...ruleStructSchemasExist(workflow, parentDefinitionDir),
    ];
    return { ok: errors.length === 0, errors };
}
export function composePlanningProcedure(stepTemplateName, resolvedGoal, restrictions, attempts) {
    const remaining = Math.max(0, restrictions.maxPlanAttempts - attempts);
    const parallelClause = restrictions.allowParallel
        ? '  - parallel substeps ALLOWED (parent has allow_parallel: true)'
        : '  - NO parallel substeps (allow_parallel: false on parent)';
    const delegationClause = restrictions.allowDelegation
        ? '  - nested delegation ALLOWED (parent has allow_delegation: true)'
        : '  - NO nested delegation (allow_delegation: false on parent)';
    return instruction('engine/planning-procedure', {
        stepTemplateName,
        resolvedGoal: resolvedGoal || '(no goal provided)',
        attempts: String(attempts),
        maxPlanAttempts: String(restrictions.maxPlanAttempts),
        remaining: String(remaining),
        maxSubsteps: String(restrictions.maxSubsteps),
        parallelClause,
        delegationClause,
    });
}
export function toolWorkflowValidateDynamic(args, paths = defaultPaths()) {
    const parentWorkflow = args.parent_workflow;
    const parentStep = args.parent_step;
    const yaml = args.workflow_yaml;
    if (typeof parentWorkflow !== 'string' || !parentWorkflow) {
        return {
            error: "workflow_validate_dynamic: missing required parameter 'parent_workflow' (workflow name).",
        };
    }
    if (typeof parentStep !== 'string' || !parentStep) {
        return {
            error: "workflow_validate_dynamic: missing required parameter 'parent_step' (step name).",
        };
    }
    if (typeof yaml !== 'string') {
        return {
            error: "workflow_validate_dynamic: missing required parameter 'workflow_yaml' (raw YAML text of drafted child workflow).",
        };
    }
    let resolved;
    try {
        resolved = resolveWorkflow(parentWorkflow, paths);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `workflow_validate_dynamic: ${msg}` };
    }
    const { definitionDir: parentDefDir, workflow: parentWf } = resolved;
    const stepConfig = findStepConfig(parentWf, parentStep);
    if (!stepConfig) {
        return {
            error: `workflow_validate_dynamic: step '${parentStep}' not found in workflow '${parentWorkflow}'`,
            parent_step: parentStep,
        };
    }
    if (stepConfig.type !== 'planning') {
        return {
            error: `workflow_validate_dynamic: step '${parentStep}' is not a planning step ` +
                `(type='${stepConfig.type ?? '(none)'}'). This MCP tool ` +
                `is only valid for steps with 'type: planning'.`,
            parent_step: parentStep,
        };
    }
    const runtimeDir = resolveRunRuntimeDir(paths, parentWorkflow);
    const manifestPath = join(runtimeDir, 'manifest.json');
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            error: `workflow_validate_dynamic: cannot read manifest at '${manifestPath}' — ${msg}. ` +
                `Ensure workflow_init has been called for '${parentWorkflow}' and step_begin ` +
                `has been called for '${parentStep}'.`,
        };
    }
    const stepState = (manifest.steps?.[parentStep] ?? null);
    if (!stepState || stepState.status !== 'in_progress') {
        return {
            error: `workflow_validate_dynamic: step '${parentStep}' is not in_progress ` +
                `(current status: '${stepState?.status ?? '(none)'}'). ` +
                `Call step_begin for '${parentStep}' before validating a draft.`,
            parent_step: parentStep,
        };
    }
    const planningState = (stepState.planning ?? null);
    if (!planningState) {
        return {
            error: `workflow_validate_dynamic: step '${parentStep}' has no planning state. ` +
                `This indicates step_begin did not initialize the planning branch — ensure ` +
                `the step config has 'type: planning' and step_begin was called.`,
            parent_step: parentStep,
        };
    }
    const currentPhase = planningState.phase ?? 'planning';
    if (currentPhase === 'executing' || currentPhase === 'completed') {
        return {
            error: `workflow_validate_dynamic: step '${parentStep}' planning phase is ` +
                `'${currentPhase}'. Re-validation is not allowed after the child run ` +
                `has been committed (workflow_invoke_dynamic). Validation in this ` +
                `phase would regress engine state and break dependent wrapper calls.\n\n` +
                `ORCHESTRATOR DIRECTIVE: Stop. Do not call workflow_validate_dynamic ` +
                `again for this step. If the child run is failing, drive its substeps ` +
                `to completion via *_dynamic wrappers, then call workflow_finalize_dynamic. ` +
                `If a fundamental re-plan is needed, surface the situation to the user ` +
                `with the manifest content + tool responses verbatim, then STOP.\n\n` +
                `AUTHOR REMEDIATION (for the user): If re-planning is genuinely needed, ` +
                `finalize this run (workflow_finalize) and start a fresh workflow run.`,
            action: 'BLOCKED_PLANNING_FAILURE',
            parent_step: parentStep,
            attempts: planningState.attempts ?? 0,
        };
    }
    const restrictions = resolvePlanningRestrictions(stepConfig);
    const attemptsBefore = planningState.attempts ?? 0;
    if (attemptsBefore >= restrictions.maxPlanAttempts) {
        return {
            error: `workflow_validate_dynamic: step '${parentStep}' has exhausted plan-draft ` +
                `attempts (${attemptsBefore}/${restrictions.maxPlanAttempts}). The orchestrator ` +
                `MUST stop planning, surface this state to the user, and await manual ` +
                `intervention. Do NOT retry with another draft.\n\n` +
                `ORCHESTRATOR DIRECTIVE: Stop calling workflow_validate_dynamic for this step. ` +
                `Report failure to the user with the latest validation errors.\n\n` +
                `AUTHOR REMEDIATION (for the user): Either (a) increase max_plan_attempts on ` +
                `step '${parentStep}' in workflow.yaml if the goal is genuinely complex, or ` +
                `(b) rework the parent step's goal to be more achievable.`,
            action: 'BLOCKED_PLANNING_FAILURE',
            parent_step: parentStep,
            attempts: attemptsBefore,
        };
    }
    const result = validateDynamicWorkflow(yaml, parentDefDir, restrictions);
    const attemptsAfter = attemptsBefore + 1;
    const newPlanning = {
        ...planningState,
        attempts: attemptsAfter,
        phase: 'validating',
    };
    manifest.steps[parentStep] = { ...stepState, planning: newPlanning };
    manifest.updated_at = nowIsoLocal();
    safeWriteJson(manifestPath, manifest);
    return {
        ok: result.ok,
        errors: result.errors,
        attempts: attemptsAfter,
        attempts_remaining: Math.max(0, restrictions.maxPlanAttempts - attemptsAfter),
    };
}
export function toolWorkflowValidate(args, paths = defaultPaths()) {
    const yaml = args.workflow_yaml;
    if (typeof yaml !== 'string') {
        return {
            error: "workflow_validate: missing required parameter 'workflow_yaml' (raw YAML text of the workflow to validate).",
        };
    }
    let parsed;
    try {
        parsed = parseYamlString(yaml);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            errors: [`YAML parse error: ${msg}. Fix the syntax and re-validate.`],
        };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            ok: false,
            errors: ['workflow root MUST be a YAML mapping (object).'],
        };
    }
    const workflow = parsed;
    let definitionDir;
    const wfName = args.workflow_name;
    if (typeof wfName === 'string' && wfName.length > 0) {
        const candidates = [
            join(paths.myWorkflowsDir, wfName),
            join(paths.predefinedDir, wfName),
            join(paths.workflowsDir, wfName),
        ];
        for (const dir of candidates) {
            try {
                if (statSync(dir).isDirectory()) {
                    definitionDir = dir;
                    break;
                }
            }
            catch (e) {
                if (e?.code !== 'ENOENT')
                    throw e;
            }
        }
    }
    const result = fullValidateWorkflow(workflow, definitionDir !== undefined ? { definitionDir } : {});
    if (!result.ok)
        return result;
    return {
        ...result,
        next_steps: composeValidateNextSteps(workflow, definitionDir !== undefined),
    };
}
function composeValidateNextSteps(workflow, onDisk) {
    const lines = ['VALIDATION PASSED — next steps:'];
    const wf = workflow;
    const name = typeof wf.name === 'string' ? wf.name : '<name>';
    const allSteps = collectAllSteps(workflow);
    if (!onDisk) {
        lines.push(`1. Write the files: .riglane/workflows/templates/my_workflows/${name}/workflow.yaml ` +
            `(+ structs/, scripts/ as declared).`, `2. Re-run workflow_validate with workflow_name="${name}" — THIS draft pass could not ` +
            `verify struct schema files or decider scripts on disk; the named pass does.`);
    }
    else {
        lines.push('1. The on-disk workflow is fully validated (including struct/script files).');
    }
    const tools = (wf.tools ?? []);
    if (tools.some((t) => t.type === 'script')) {
        lines.push(`• This workflow declares script tools → the user MUST run \`riglane init-workflow ${name}\` ` +
            `(Claude Code) and RESTART the host, or the tools stay invisible to subagents. ` +
            `Tell them explicitly.`);
    }
    if (allSteps.some((s) => s.loop_back !== undefined)) {
        lines.push('• loop_back decider scripts run from the PROJECT ROOT — the when.script file must ' +
            'exist at its full root-relative path before the first run.');
    }
    if (allSteps.some((s) => typeof s.delegate_to === 'string' && s.delegate_to !== '')) {
        lines.push('• The delegate_to target runs as its own top-level workflow run, started by the ' +
            'orchestrator — make sure it is installed on the runtime machine.');
    }
    const requiredParams = (wf.params ?? [])
        .filter((p) => p.required === true && !('default' in p))
        .map((p) => `--${String(p.name)} <value>`);
    lines.push(`• Hand off the invocation: /riglane-run-workflow ${name}` +
        (requiredParams.length > 0 ? ` ${requiredParams.join(' ')}` : ''));
    return lines.join('\n');
}
export function toolDynamicWorkflowInit(args, paths = defaultPaths()) {
    const runtimeDir = dynamicRuntimeDir(paths.agentDir, args.parent_run_id, args.parent_step);
    const childName = dynamicChildWorkflowName(args.parent_workflow, args.parent_run_id, args.parent_step);
    return toolWorkflowInit({
        name: childName,
        params: args.inherit_params ?? {},
    }, paths, 
    { runtimeDir, workflowYamlPath: args.child_workflow_yaml_path });
}
export function toolWorkflowInvokeDynamic(args, paths = defaultPaths()) {
    const parentWorkflow = args.parent_workflow;
    const parentStep = args.parent_step;
    const yaml = args.workflow_yaml;
    if (typeof parentWorkflow !== 'string' || !parentWorkflow) {
        return { error: "workflow_invoke_dynamic: missing required parameter 'parent_workflow'." };
    }
    if (typeof parentStep !== 'string' || !parentStep) {
        return { error: "workflow_invoke_dynamic: missing required parameter 'parent_step'." };
    }
    if (typeof yaml !== 'string') {
        return { error: "workflow_invoke_dynamic: missing required parameter 'workflow_yaml'." };
    }
    let resolved;
    try {
        resolved = resolveWorkflow(parentWorkflow, paths);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `workflow_invoke_dynamic: ${msg}` };
    }
    const { definitionDir: parentDefDir, workflow: parentWf } = resolved;
    const stepConfig = findStepConfig(parentWf, parentStep);
    if (!stepConfig) {
        return {
            error: `workflow_invoke_dynamic: step '${parentStep}' not found in workflow '${parentWorkflow}'`,
            parent_step: parentStep,
        };
    }
    if (stepConfig.type !== 'planning') {
        return {
            error: `workflow_invoke_dynamic: step '${parentStep}' is not a planning step ` +
                `(type='${stepConfig.type ?? '(none)'}').`,
            parent_step: parentStep,
        };
    }
    const parentRuntimeDir = resolveRunRuntimeDir(paths, parentWorkflow);
    const parentManifestPath = join(parentRuntimeDir, 'manifest.json');
    let parentManifest;
    try {
        parentManifest = JSON.parse(readFileSync(parentManifestPath, 'utf-8'));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            error: `workflow_invoke_dynamic: cannot read parent manifest at '${parentManifestPath}' — ${msg}`,
        };
    }
    const stepState = (parentManifest.steps?.[parentStep] ?? null);
    if (!stepState || stepState.status !== 'in_progress') {
        return {
            error: `workflow_invoke_dynamic: parent step '${parentStep}' is not in_progress ` +
                `(status: '${stepState?.status ?? '(none)'}').`,
            parent_step: parentStep,
        };
    }
    const planningState = (stepState.planning ?? null);
    if (!planningState) {
        return {
            error: `workflow_invoke_dynamic: parent step '${parentStep}' has no planning state. ` +
                `Call step_begin first.`,
            parent_step: parentStep,
        };
    }
    if (planningState.phase !== 'validating') {
        return {
            error: `workflow_invoke_dynamic: parent step '${parentStep}' planning phase is ` +
                `'${planningState.phase ?? '(none)'}' but must be 'validating'. ` +
                `Call workflow_validate_dynamic at least once before invoking.`,
            parent_step: parentStep,
        };
    }
    const restrictions = resolvePlanningRestrictions(stepConfig);
    const validation = validateDynamicWorkflow(yaml, parentDefDir, restrictions);
    if (!validation.ok) {
        return {
            error: `workflow_invoke_dynamic: defensive re-validation failed. The submitted YAML ` +
                `differs from what was last validated, or restrictions changed. Call ` +
                `workflow_validate_dynamic again with this exact YAML to see fresh errors.`,
            validation_errors: validation.errors,
            parent_step: parentStep,
        };
    }
    let parsedDraft;
    try {
        parsedDraft = parseYamlString(yaml);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `workflow_invoke_dynamic: unexpected parse failure post-validation: ${msg}` };
    }
    const parentRunId = parentManifest.run_id ?? '';
    if (!parentRunId) {
        return {
            error: `workflow_invoke_dynamic: parent manifest has no run_id — cannot allocate dynamic dir.`,
        };
    }
    const parentGoal = resolvePlaceholders(stepConfig.goal ?? '', (parentManifest.params ?? {}));
    const origin = {
        parent_workflow: parentWorkflow,
        parent_run_id: parentRunId,
        parent_step: parentStep,
        parent_goal: parentGoal,
        generated_at: nowIsoLocal(),
        ...(typeof args.orchestrator_model_hint === 'string' && args.orchestrator_model_hint.length > 0
            ? { generated_by_orchestrator_model: args.orchestrator_model_hint }
            : {}),
    };
    let writeResult;
    try {
        writeResult = writeDynamicWorkflow(paths.agentDir, parentWorkflow, parentRunId, parentStep, parsedDraft, origin);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `workflow_invoke_dynamic: failed to write child workflow.yaml — ${msg}` };
    }
    try {
        copyStructsToDynamicRuntime(parentDefDir, writeResult.path);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logEngine(`workflow_invoke_dynamic: copy structs to child runtime failed (non-fatal): ${msg}`);
    }
    const inheritParams = args.inherit_params ?? {};
    const childInit = toolDynamicWorkflowInit({
        parent_workflow: parentWorkflow,
        parent_run_id: parentRunId,
        parent_step: parentStep,
        child_workflow_yaml_path: writeResult.path,
        inherit_params: inheritParams,
    }, paths);
    if ('error' in childInit) {
        return {
            error: `workflow_invoke_dynamic: child workflow_init failed — ${childInit.error}`,
            parent_step: parentStep,
        };
    }
    const childRuntimeDir = dynamicRuntimeDir(paths.agentDir, parentRunId, parentStep);
    const newPlanning = {
        ...planningState,
        phase: 'executing',
        child_run_id: childInit.run_id,
        child_workflow_path: writeResult.path,
    };
    parentManifest.steps[parentStep] = { ...stepState, planning: newPlanning };
    parentManifest.updated_at = nowIsoLocal();
    safeWriteJson(parentManifestPath, parentManifest);
    if (parentRunId) {
        const parentWf = resolveWorkflow(parentWorkflow, paths);
        flushTraceSnapshot(parentRuntimeDir, parentRunId, parentManifest, parentStep, parentWf.workflow);
    }
    return {
        child_run_id: childInit.run_id,
        child_workflow_path: writeResult.path,
        child_runtime_dir: childRuntimeDir,
        child_workflow_name: writeResult.childName,
        first_step: childInit.first_step,
        step_names: childInit.step_names,
        ...(childInit.next_begin !== undefined
            ? { next_begin: childInit.next_begin }
            : {}),
    };
}
export function resolveDynamicChildContext(parentWorkflow, parentStep, paths = defaultPaths()) {
    if (typeof parentWorkflow !== 'string' || !parentWorkflow) {
        return { error: "dynamic wrapper: missing required parameter 'parent_workflow'." };
    }
    if (typeof parentStep !== 'string' || !parentStep) {
        return { error: "dynamic wrapper: missing required parameter 'parent_step'." };
    }
    let parentRuntimeDir;
    try {
        parentRuntimeDir = resolveRunRuntimeDir(paths, parentWorkflow);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `dynamic wrapper: cannot resolve parent run — ${msg}` };
    }
    const parentManifestPath = join(parentRuntimeDir, 'manifest.json');
    let parentManifest;
    try {
        parentManifest = JSON.parse(readFileSync(parentManifestPath, 'utf-8'));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            error: `dynamic wrapper: cannot read parent manifest at '${parentManifestPath}' — ${msg}`,
        };
    }
    const stepState = (parentManifest.steps?.[parentStep] ?? null);
    if (!stepState) {
        return {
            error: `dynamic wrapper: parent step '${parentStep}' not found in manifest.`,
        };
    }
    const planningState = (stepState.planning ?? null);
    if (!planningState) {
        return {
            error: `dynamic wrapper: parent step '${parentStep}' has no planning state. ` +
                `This wrapper only applies to steps with 'type: planning' that have been begun.`,
        };
    }
    if (planningState.phase !== 'executing' && planningState.phase !== 'completed') {
        return {
            error: `dynamic wrapper: parent step '${parentStep}' planning phase is ` +
                `'${planningState.phase ?? '(none)'}'. Expected 'executing' ` +
                `(call workflow_invoke_dynamic first) or 'completed' (re-entering finished child).`,
        };
    }
    const childWorkflowPath = planningState.child_workflow_path ?? '';
    if (!childWorkflowPath) {
        return {
            error: `dynamic wrapper: parent step '${parentStep}' has no child_workflow_path.`,
        };
    }
    const parentRunId = parentManifest.run_id ?? '';
    if (!parentRunId) {
        return { error: `dynamic wrapper: parent manifest has no run_id.` };
    }
    const childWorkflowName = dynamicChildWorkflowName(parentWorkflow, parentRunId, parentStep);
    return { child_workflow_path: childWorkflowPath, child_workflow_name: childWorkflowName };
}
export function toolStepBeginDynamic(args, paths = defaultPaths()) {
    const parentWorkflow = args.parent_workflow;
    const parentStep = args.parent_step;
    const ctx = resolveDynamicChildContext(parentWorkflow, parentStep, paths);
    if ('error' in ctx)
        return ctx;
    const childRuntimeDir = dirname(ctx.child_workflow_path);
    const result = toolStepBegin({
        name: ctx.child_workflow_name,
        step: args.step,
    }, paths, { runtimeDir: childRuntimeDir, workflowYamlPath: ctx.child_workflow_path });
    try {
        const parentRuntimeDir = resolveRunRuntimeDir(paths, parentWorkflow);
        const parentManifestPath = join(parentRuntimeDir, 'manifest.json');
        const parentManifest = JSON.parse(readFileSync(parentManifestPath, 'utf-8'));
        const parentRunId = parentManifest.run_id ?? '';
        if (parentRunId) {
            const parentWf = resolveWorkflow(parentWorkflow, paths);
            flushTraceSnapshot(parentRuntimeDir, parentRunId, parentManifest, parentStep, parentWf.workflow);
        }
    }
    catch {
    }
    return result;
}
export function toolStepCollectResultDynamic(args, paths = defaultPaths()) {
    const parentWorkflow = args.parent_workflow;
    const ctx = resolveDynamicChildContext(parentWorkflow, args.parent_step, paths);
    if ('error' in ctx)
        return ctx;
    const childRuntimeDir = dirname(ctx.child_workflow_path);
    const collectArgs = {
        name: ctx.child_workflow_name,
        ...(args.step !== undefined ? { step: args.step } : {}),
    };
    const result = toolStepCollectResult(collectArgs, paths, {
        runtimeDir: childRuntimeDir,
        workflowYamlPath: ctx.child_workflow_path,
    });
    if (result.passed && !('error' in result)) {
        try {
            const parentWf = resolveWorkflow(parentWorkflow, paths);
            const parentGate = (parentWf.workflow.gate ?? {});
            if (parentGate.semantic === true && !result.needs_semantic_gate) {
                result.needs_semantic_gate = true;
            }
            if (Boolean(parentGate.human) && !result.needs_human_gate) {
                result.needs_human_gate = true;
            }
            if (result.needs_semantic_gate && !result.engine_instructions) {
                let stepConfigForSpec = {};
                try {
                    const childWf = loadYaml(ctx.child_workflow_path);
                    for (const s of childWf.steps ?? []) {
                        const sObj = s;
                        if (sObj.name === args.step) {
                            stepConfigForSpec = s;
                            break;
                        }
                    }
                }
                catch {
                }
                const specClause = composeSpecClauseForSemanticGate(stepConfigForSpec, resolveConsumptionDomains(paths), resolveConsumptionScopeHint(paths));
                result.engine_instructions =
                    'SEMANTIC GATE (inherited from parent workflow) — evaluate step output: ' +
                        'Read output files. Does quality match the goal? If satisfactory → proceed. ' +
                        'If imperfect but acceptable → proceed + note issues in summary. ' +
                        'If wrong/incomplete → RETRY_STEP with feedback.' +
                        specClause;
            }
            if (result.needs_human_gate &&
                !String(result.engine_instructions ?? '').includes('HUMAN GATE')) {
                result.engine_instructions = appendHumanGateInstructions(result.engine_instructions, resolveHumanChannel(parentGate, {}));
            }
        }
        catch {
        }
    }
    return result;
}
function promoteLastStepOutputs(childRuntimeDir, parentRunDir, childWorkflowPath) {
    try {
        const childWf = loadYaml(childWorkflowPath);
        const steps = (childWf.steps ?? []);
        if (steps.length === 0)
            return;
        const lastOutputs = (steps[steps.length - 1]?.outputs ?? []);
        if (lastOutputs.length === 0)
            return;
        let childParams = {};
        try {
            const m = JSON.parse(readFileSync(join(childRuntimeDir, 'manifest.json'), 'utf-8'));
            childParams = m.params ?? {};
        }
        catch {
        }
        for (const outRaw of lastOutputs) {
            const opath = outRaw !== null && typeof outRaw === 'object' && !Array.isArray(outRaw)
                ? outRaw.path ?? ''
                : String(outRaw);
            if (!opath)
                continue;
            const resolved = resolvePlaceholders(opath, childParams);
            if (isDottedRoot(resolved) || pathIsAbsolute(resolved))
                continue;
            const hasGlob = resolved.includes('*') || resolved.includes('?') || resolved.includes('[');
            const srcs = hasGlob
                ? [...globSync(join(childRuntimeDir, resolved), { windowsPathsNoEscape: true })]
                : existsSync(join(childRuntimeDir, resolved))
                    ? [join(childRuntimeDir, resolved)]
                    : [];
            for (const src of srcs) {
                const rel = relative(childRuntimeDir, src);
                const dst = join(parentRunDir, rel);
                try {
                    mkdirSync(dirname(dst), { recursive: true });
                    if (existsSync(dst)) {
                        logEngine(`output promotion: overwriting parent '${rel}' with child output`);
                    }
                    copyFileSync(src, dst);
                }
                catch (e) {
                    logEngine(`output promotion: failed to promote '${rel}': ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }
    }
    catch (e) {
        logEngine(`output promotion skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
}
export function toolWorkflowFinalizeDynamic(args, paths = defaultPaths()) {
    const parentWorkflow = args.parent_workflow;
    const parentStep = args.parent_step;
    const ctx = resolveDynamicChildContext(parentWorkflow, parentStep, paths);
    if ('error' in ctx)
        return ctx;
    const childRuntimeDir = dirname(ctx.child_workflow_path);
    const childResult = toolWorkflowFinalize({
        name: ctx.child_workflow_name,
    }, paths, { runtimeDir: childRuntimeDir, workflowYamlPath: ctx.child_workflow_path });
    if ('error' in childResult) {
        return { error: `workflow_finalize_dynamic: child finalize failed — ${childResult.error}` };
    }
    const parentRunDir = resolveRunRuntimeDir(paths, parentWorkflow);
    if (childResult.status === 'completed') {
        promoteLastStepOutputs(childRuntimeDir, parentRunDir, ctx.child_workflow_path);
    }
    const newPhase = childResult.status === 'completed' ? 'completed' : 'failed';
    const parentManifestPath = join(parentRunDir, 'manifest.json');
    let parentManifest;
    try {
        parentManifest = JSON.parse(readFileSync(parentManifestPath, 'utf-8'));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            error: `workflow_finalize_dynamic: cannot read parent manifest after child finalize — ${msg}`,
        };
    }
    const parentStepState = parentManifest.steps?.[parentStep];
    if (parentStepState && parentStepState.planning) {
        const planning = parentStepState.planning;
        parentStepState.planning = { ...planning, phase: newPhase };
        parentManifest.updated_at = nowIsoLocal();
        safeWriteJson(parentManifestPath, parentManifest);
    }
    const evalInstructions = [
        `PLANNING OUTCOME EVALUATION (procedure Step 5b) — the child run is finalized (status: ${childResult.status}).`,
        'Before completing this planning step, judge whether the GOAL was achieved:',
        '  1. Did all substeps complete successfully?',
        '  2. Read the key output files — are the results correct and complete?',
        "  3. Does the outcome match the planning step's goal?",
        '',
        `GOAL ACHIEVED → call agent_notes_write(...), then step_complete on the parent planning step ('${parentStep}').`,
        'GOAL NOT ACHIEVED (incomplete/incorrect) → call',
        `  workflow_replan_dynamic(parent_workflow='${parentWorkflow}', parent_step='${parentStep}'), then draft a`,
        '  targeted FIX workflow (back to planning Step 1). Substeps are idempotent — correct files stay untouched.',
        '',
        'Do NOT call step_complete on the planning step until you have made this judgment.',
    ].join('\n');
    return {
        child_status: childResult.status,
        child_run_id: childResult.run_id,
        parent_planning_phase: newPhase,
        engine_instructions: evalInstructions,
    };
}
export function toolWorkflowReplanDynamic(args, paths = defaultPaths()) {
    const parentWorkflow = args.parent_workflow;
    const parentStep = args.parent_step;
    if (typeof parentWorkflow !== 'string' || !parentWorkflow) {
        return { error: "workflow_replan_dynamic: missing required parameter 'parent_workflow'." };
    }
    if (typeof parentStep !== 'string' || !parentStep) {
        return { error: "workflow_replan_dynamic: missing required parameter 'parent_step'." };
    }
    const parentRuntimeDir = resolveRunRuntimeDir(paths, parentWorkflow);
    const parentManifestPath = join(parentRuntimeDir, 'manifest.json');
    let parentManifest;
    try {
        parentManifest = JSON.parse(readFileSync(parentManifestPath, 'utf-8'));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `workflow_replan_dynamic: cannot read parent manifest — ${msg}` };
    }
    const stepState = parentManifest.steps?.[parentStep];
    if (!stepState) {
        return { error: `workflow_replan_dynamic: step '${parentStep}' not found in manifest.` };
    }
    const planning = stepState.planning;
    if (!planning) {
        return { error: `workflow_replan_dynamic: step '${parentStep}' has no planning state.` };
    }
    const currentPhase = planning.phase ?? '';
    if (currentPhase !== 'completed' && currentPhase !== 'failed') {
        return {
            error: `workflow_replan_dynamic: planning phase is '${currentPhase}' but must be ` +
                `'completed' or 'failed'. Replan is only allowed after workflow_finalize_dynamic.`,
        };
    }
    const previousRuns = (planning.previous_child_runs ?? []);
    const prevChildRunId = planning.child_run_id;
    if (typeof prevChildRunId === 'string' && prevChildRunId.length > 0) {
        previousRuns.push(prevChildRunId);
    }
    const currentAttempts = planning.attempts ?? 0;
    stepState.planning = {
        ...planning,
        phase: 'planning',
        child_run_id: null,
        child_workflow_path: null,
        previous_child_runs: previousRuns,
    };
    parentManifest.updated_at = nowIsoLocal();
    safeWriteJson(parentManifestPath, parentManifest);
    return {
        phase: 'planning',
        attempt: currentAttempts,
        iteration: previousRuns.length + 1,
        previous_runs: previousRuns,
    };
}
export function toolAgentNotesWrite(args, paths = defaultPaths()) {
    const stepTemplate = args.step_template;
    const topic = args.topic;
    const runId = args.run_id;
    const body = args.body;
    if (typeof stepTemplate !== 'string' || !stepTemplate) {
        return { error: "agent_notes_write: missing required parameter 'step_template'." };
    }
    if (typeof topic !== 'string' || !topic) {
        return { error: "agent_notes_write: missing required parameter 'topic'." };
    }
    if (typeof runId !== 'string' || !runId) {
        return { error: "agent_notes_write: missing required parameter 'run_id'." };
    }
    if (typeof body !== 'string') {
        return { error: "agent_notes_write: missing required parameter 'body'." };
    }
    const status = args.status;
    const confidence = args.confidence;
    const STATUSES = ['success', 'partial', 'failed', 'experimental'];
    const CONFIDENCES = ['high', 'medium', 'low'];
    if (!STATUSES.includes(status)) {
        return {
            error: `agent_notes_write: invalid 'status' value '${status ?? '(none)'}'. ` +
                `Expected one of: ${STATUSES.join(', ')}.`,
        };
    }
    if (!CONFIDENCES.includes(confidence)) {
        return {
            error: `agent_notes_write: invalid 'confidence' value '${confidence ?? '(none)'}'. ` +
                `Expected one of: ${CONFIDENCES.join(', ')}.`,
        };
    }
    try {
        assertSafeStepTemplate(stepTemplate);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `agent_notes_write: ${msg}` };
    }
    const project = dirname(paths.agentDir);
    const date = isoDateLocal();
    const tags = (args.tags ?? []);
    const relatedRuns = (args.related_runs ?? []);
    const fm = {
        topic,
        step_template: stepTemplate,
        status: status,
        confidence: confidence,
        project,
        run_id: runId,
        ...(typeof args.generated_workflow_path === 'string' &&
            args.generated_workflow_path.length > 0
            ? { generated_workflow_path: args.generated_workflow_path }
            : {}),
        tags,
        related_runs: relatedRuns,
        date,
        version: AGENT_NOTES_VERSION,
    };
    const filename = generateNoteFilename();
    const filePath = noteFilePath(paths.agentDir, stepTemplate, filename);
    try {
        ensureStepTemplateNotesDir(paths.agentDir, stepTemplate);
        writeFileSync(filePath, composeNoteFile(fm, body), 'utf-8');
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `agent_notes_write: failed to write note file — ${msg}` };
    }
    try {
        appendIndexEntry(paths.agentDir, stepTemplate, {
            file: filename,
            topic,
            status: fm.status,
            confidence: fm.confidence,
            tags,
            date,
            project,
        });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            error: `agent_notes_write: note file written at '${filePath}' but index update failed — ${msg}. ` +
                `Search may temporarily not return this entry; re-running write or a future ` +
                `index rebuild will restore consistency.`,
        };
    }
    return { path: filePath, filename };
}
export function toolAgentNotesSearch(args, paths = defaultPaths()) {
    const stepTemplate = args.step_template;
    if (typeof stepTemplate !== 'string' || !stepTemplate) {
        return { error: "agent_notes_search: missing required parameter 'step_template'." };
    }
    try {
        assertSafeStepTemplate(stepTemplate);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `agent_notes_search: ${msg}` };
    }
    const statusFilter = (args.status ?? ['success', 'partial']);
    const confidenceFilter = (args.confidence ?? ['high', 'medium']);
    const tagsFilter = args.tags;
    const limit = args.limit ?? 5;
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
        return { error: `agent_notes_search: 'limit' must be a positive number (got ${limit}).` };
    }
    const index = readIndex(paths.agentDir, stepTemplate);
    if (!index || index.entries.length === 0) {
        return { matches: [], total_before_limit: 0 };
    }
    const filtered = index.entries.filter((e) => {
        if (!statusFilter.includes(e.status))
            return false;
        if (!confidenceFilter.includes(e.confidence))
            return false;
        if (tagsFilter && tagsFilter.length > 0) {
            const has = e.tags.some((t) => tagsFilter.includes(t));
            if (!has)
                return false;
        }
        return true;
    });
    const sorted = [...filtered].sort((a, b) => {
        if (a.date !== b.date)
            return b.date.localeCompare(a.date);
        return b.file.localeCompare(a.file);
    });
    const totalBeforeLimit = sorted.length;
    const clamped = sorted.slice(0, limit);
    const stepDir = stepTemplateNotesDir(paths.agentDir, stepTemplate);
    const matches = clamped.map((e) => ({
        file: e.file,
        path: join(stepDir, e.file),
        topic: e.topic,
        status: e.status,
        confidence: e.confidence,
        tags: e.tags,
        date: e.date,
        project: e.project,
    }));
    return { matches, total_before_limit: totalBeforeLimit };
}
function inboxWebhookUrlSafe() {
    try {
        return inboxWebhookUrl();
    }
    catch {
        return '';
    }
}
import { composeElicitation, composeTerminalPresentation, expectsAnswer, findStepMessages, flushPendingDeliveries, mapElicitationContent, messageState, postMessage as inboxPostMessage, readMessage as inboxReadMessage, respondMessage as inboxRespondMessage, } from './inbox.js';
const POST_ADVISORY_KEYS = ['channel_warning', 'delivery_warning'];
function postAdvisories(posted) {
    const out = {};
    for (const k of POST_ADVISORY_KEYS) {
        if (posted[k] !== undefined)
            out[k] = posted[k];
    }
    return out;
}
function supersededRefusal(messageId, replacement, workflowName) {
    const live = replacement ?? "the step's current question";
    return {
        error: `Message '${messageId}' was superseded by '${live}': its step asked again (the run ` +
            `continued after a stop), so this question can no longer be answered and waiting on it ` +
            `would never end.`,
        message_id: messageId,
        superseded_by: replacement ?? null,
        engine_instructions: `This is NOT a failure of the step and NOT a reason to clear or finalize the run. Work ` +
            `with the live question instead: inbox(op:'ask', name: '${workflowName}', message_id: ` +
            `'${live}'). If no live question exists for the current pass, fetch the rules with ` +
            `inbox(op:'rules') and ask afresh.`,
    };
}
function inboxPageUrl() {
    const base = currentLocalServerBase();
    return base === null ? null : withServeToken(`${base}/tools/workflow-studio.html`);
}
function inboxDeliveryOpts(manifest) {
    const runWebhook = manifest?.inbox_webhook_url;
    const webhookUrl = typeof runWebhook === 'string' && runWebhook ? runWebhook : inboxWebhookUrlSafe();
    const base = currentLocalServerBase();
    return {
        webhookUrl: webhookUrl || null,
        respondUrl: base === null ? null : `${base}/api/inbox/respond`,
    };
}
function loadManifest(runtimeDir) {
    try {
        return JSON.parse(readFileSync(join(runtimeDir, 'manifest.json'), 'utf-8'));
    }
    catch {
        return null;
    }
}
function composeInboxMessageRules(stepName) {
    return instruction('engine/inbox-message-rules', { stepName });
}
export function toolInboxRules(args, paths = defaultPaths()) {
    const workflowName = (args.name ?? args.workflow_name);
    const stepName = args.step;
    if (!workflowName || typeof workflowName !== 'string') {
        return { error: "inbox op:'rules' requires 'name' (the workflow name)" };
    }
    if (!stepName || typeof stepName !== 'string') {
        return { error: "inbox op:'rules' requires 'step' (the step the message belongs to)" };
    }
    let runtimeDir;
    try {
        runtimeDir = resolveRunRuntimeDir(paths, workflowName);
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
    const manifest = loadManifest(runtimeDir);
    if (!manifest)
        return { error: `No manifest for workflow '${workflowName}'` };
    const own = checkRunOwnership(manifest, 'inbox_rules');
    if (own)
        return own;
    if (!(manifest.steps && Object.prototype.hasOwnProperty.call(manifest.steps, stepName))) {
        return { error: `Step '${stepName}' is not part of this run` };
    }
    const stepState = manifest.steps[stepName] ?? {};
    stepState.inbox_rules_at = nowIsoLocal();
    manifest.steps[stepName] = stepState;
    manifest.updated_at = nowIsoLocal();
    safeWriteJson(join(runtimeDir, 'manifest.json'), manifest);
    return {
        status: 'unlocked',
        step: stepName,
        rules: composeInboxMessageRules(stepName),
    };
}
function resolvePostedMessageChannel(workflowName, stepName, kind, paths) {
    try {
        const { workflow } = resolveWorkflow(workflowName, paths);
        const stepCfg = (findStepConfig(workflow, stepName) ?? {});
        if (kind === 'loop_decision') {
            const when = (stepCfg.loop_back?.when ?? {});
            return when.human_channel === 'external' || when.human_channel === 'both'
                ? when.human_channel
                : 'terminal';
        }
        if (kind === 'route_decision') {
            const when = (stepCfg.routes?.when ?? {});
            return when.human_channel === 'external' || when.human_channel === 'both'
                ? when.human_channel
                : 'terminal';
        }
        return resolveHumanChannel((workflow.gate ?? {}), (stepCfg.gate ?? {}));
    }
    catch {
        return 'terminal';
    }
}
const VERIFIED_CONTEXT_MAX_CHARS = 4096;
function composeVerifiedContext(workflowName, stepName, runtimeDir, params, paths) {
    try {
        const { workflow } = resolveWorkflow(workflowName, paths);
        const stepCfg = (findStepConfig(workflow, stepName) ?? {});
        const outputs = stepCfg.outputs;
        if (!Array.isArray(outputs) || outputs.length === 0)
            return null;
        const entries = [];
        for (const raw of outputs) {
            const rawPath = typeof raw === 'string' ? raw : String(raw.path ?? '');
            if (!rawPath)
                continue;
            let concrete = rawPath;
            let resolved;
            if (stepCfg.parallel === true) {
                resolved = resolveOutputPath(rawPath, runtimeDir);
            }
            else {
                try {
                    concrete = resolveConcreteOutputPath(rawPath, params);
                    resolved = resolveOutputPath(concrete, runtimeDir);
                }
                catch {
                    resolved = resolveOutputPath(rawPath, runtimeDir);
                }
            }
            if (resolved.length === 0 && !/[*?[\]]/.test(concrete)) {
                entries.push({ path: concrete.split(sep).join('/'), exists: false });
                continue;
            }
            for (const abs of resolved) {
                const preview = readValuePreview(abs);
                let mtime;
                try {
                    mtime = toIsoLocal(statSync(abs).mtime);
                }
                catch {
                    mtime = undefined;
                }
                const clipped = typeof preview.value_preview === 'string' &&
                    preview.value_preview.length > VERIFIED_CONTEXT_MAX_CHARS;
                entries.push({
                    path: relative(runtimeDir, abs).split(sep).join('/'),
                    exists: preview.exists,
                    ...(preview.size !== undefined ? { size: preview.size } : {}),
                    ...(mtime !== undefined ? { mtime } : {}),
                    ...(preview.value_preview !== undefined
                        ? {
                            value_preview: clipped
                                ? preview.value_preview.slice(0, VERIFIED_CONTEXT_MAX_CHARS)
                                : preview.value_preview,
                        }
                        : {}),
                    ...(preview.truncated || clipped ? { truncated: true } : {}),
                    ...(preview.binary !== undefined ? { binary: preview.binary } : {}),
                });
            }
        }
        return entries.length > 0 ? entries : null;
    }
    catch {
        return null;
    }
}
export async function toolInboxPost(args, paths = defaultPaths()) {
    const workflowName = (args.name ?? args.workflow_name);
    const stepName = args.step;
    if (!workflowName || typeof workflowName !== 'string') {
        return { error: "inbox op:'post' requires 'name' (the workflow name)" };
    }
    if (!stepName || typeof stepName !== 'string') {
        return { error: "inbox op:'post' requires 'step' (the step this message belongs to)" };
    }
    if (typeof args.message !== 'object' || args.message === null) {
        return { error: "inbox op:'post' requires 'message' (title/body/request/options object)" };
    }
    let runtimeDir;
    try {
        runtimeDir = resolveRunRuntimeDir(paths, workflowName);
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
    const manifest = loadManifest(runtimeDir);
    if (!manifest)
        return { error: `No manifest for workflow '${workflowName}'` };
    const own = checkRunOwnership(manifest, 'inbox_post');
    if (own)
        return own;
    if (!(manifest.steps && Object.prototype.hasOwnProperty.call(manifest.steps, stepName))) {
        return { error: `Step '${stepName}' is not part of this run` };
    }
    {
        const stepState = (manifest.steps[stepName] ?? {});
        const rulesAt = stepState.inbox_rules_at;
        const startedAt = stepState.started_at;
        const rulesFresh = typeof rulesAt === 'string' &&
            rulesAt.length > 0 &&
            (!startedAt || Date.parse(rulesAt) >= Date.parse(startedAt));
        if (!rulesFresh) {
            return {
                error: `The inbox message rules were not requested for this pass of step '${stepName}'. ` +
                    `Call inbox(op:'rules', name: '${workflowName}', step: '${stepName}') FIRST — it ` +
                    `returns the message rules and unlocks posting — then compose and post again. This ` +
                    `applies even when your message is already valid: the rules arrive at the moment of ` +
                    `composition on purpose.`,
            };
        }
    }
    const messageKind = resolveMessageKind(args.message);
    const channel = resolvePostedMessageChannel(workflowName, stepName, messageKind, paths);
    const runWebhook = manifest.inbox_webhook_url;
    const webhookUrl = typeof runWebhook === 'string' && runWebhook ? runWebhook : inboxWebhookUrlSafe();
    let respondUrl = null;
    if (channel !== 'terminal' || webhookUrl) {
        try {
            const base = await ensureLocalServer(paths.agentDir);
            if (base)
                respondUrl = `${base}/api/inbox/respond`;
        }
        catch {
            respondUrl = null;
        }
    }
    const awaitsAnswer = expectsAnswer(messageKind);
    if (channel === 'external' && respondUrl === null && awaitsAnswer) {
        return {
            error: `Cannot post this message: the step's human gate is answered OUTSIDE the terminal ` +
                `(human_channel: external), and the local server that receives answers could not be ` +
                `started — the question would have no way back and the run would wait forever. ` +
                `NOTHING was stored.\n\n` +
                `ORCHESTRATOR DIRECTIVE: this is NOT a failure of your work and NOT a reason to ` +
                `retry the step, clear the run, or finalize it. Report to the user that the answer ` +
                `channel has no transport: starting '${CLI_NAME} serve' in this project hosts the ` +
                `same answer endpoint. Once it runs, call inbox(op:'ask') again — the step is ` +
                `untouched and the run is healthy.`,
        };
    }
    const transportWarning = respondUrl !== null
        ? null
        : channel === 'both'
            ? `The local server that receives external answers could not be started, so this ` +
                `question can be answered ONLY in the terminal for now. Relay it as instructed and ` +
                `keep polling; if the user would rather answer outside the terminal, they can start ` +
                `'${CLI_NAME} serve' in this project.`
            : channel === 'external' && !awaitsAnswer
                ? `This notice is stored, but the local server that serves the run inbox could not ` +
                    `be started — nobody outside the terminal can read it yet. Starting ` +
                    `'${CLI_NAME} serve' in this project makes it visible; nothing is owed in reply.`
                : null;
    if (webhookUrl) {
        try {
            await flushPendingDeliveries(runtimeDir, respondUrl);
        }
        catch {
        }
    }
    const verifiedContext = messageKind === 'human_gate'
        ? composeVerifiedContext(workflowName, stepName, runtimeDir, (manifest.params ?? {}), paths)
        : null;
    const posted = await inboxPostMessage(runtimeDir, {
        run_id: manifest.run_id ?? '',
        workflow: workflowName,
        step: stepName,
    }, args.message, {
        respondUrl,
        webhookUrl: webhookUrl || null,
        stepStartedAt: (manifest.steps?.[stepName]
            ?.started_at) ?? null,
        verifiedContext,
    });
    if ('errors' in posted) {
        return {
            error: `Message content rejected by the inbox schema:\n- ${posted.errors.join('\n- ')}\n` +
                "Fix the listed fields and call inbox(op:'post') again (nothing was stored or pushed).",
        };
    }
    const presentation = channel === 'both' ? composeTerminalPresentation(posted.message) : null;
    return {
        message_id: posted.message.message_id,
        status: 'pending',
        ...(presentation !== null ? { terminal_presentation: presentation } : {}),
        ...(transportWarning !== null ? { channel_warning: transportWarning } : {}),
        ...(inboxPageUrl() !== null ? { inbox_url: inboxPageUrl() } : {}),
        ...(posted.message.delivery !== undefined && posted.message.delivery.delivered_at === undefined
            ? {
                delivery_warning: `The webhook consumer at ${posted.message.delivery.url} did not accept the ` +
                    `notification (${posted.message.delivery.last_error ?? 'unknown error'}). The ` +
                    `question IS stored and answerable — the engine will retry the notification. Do ` +
                    `not re-post it.`,
            }
            : {}),
        engine_instructions: `Message '${posted.message.message_id}' is stored and visible to the user (Agent ` +
            `Messages / trace; webhook pushed when configured). ` +
            (presentation !== null
                ? `CHANNEL both — DO THIS IN ORDER, IN THIS SAME TURN: (1) FIRST relay ` +
                    `terminal_presentation in your reply NOW — verbatim, plain text, never a blocking ` +
                    `widget — so the terminal user sees the question BEFORE you start waiting; ` +
                    `(2) THEN keep polling inbox(op:'check', name, message_id) until status is ` +
                    `'responded' — use wait_ms up to 15000 and wait between calls. Do NOT end your ` +
                    `turn after relaying: while you poll, a terminal reply is recorded via ` +
                    `inbox(op:'respond') and any other channel's answer appears in the check. ` +
                    `An ended turn sees neither. `
                : `Poll inbox(op:'check', name, message_id) until status is 'responded' — use ` +
                    `wait_ms up to 15000 and wait between calls. `) +
            `Do NOT answer for the user and do NOT invent options the message lacks.`,
    };
}
const INBOX_CHECK_MAX_WAIT_MS = 15_000;
export async function toolInboxCheck(args, paths = defaultPaths()) {
    const workflowName = (args.name ?? args.workflow_name);
    const messageId = args.message_id;
    if (!workflowName || typeof workflowName !== 'string') {
        return { error: "inbox op:'check' requires 'name' (the workflow name)" };
    }
    if (!messageId || typeof messageId !== 'string') {
        return { error: "inbox op:'check' requires 'message_id'" };
    }
    let runtimeDir;
    try {
        runtimeDir = resolveRunRuntimeDir(paths, workflowName);
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
    try {
        await flushPendingDeliveries(runtimeDir, inboxDeliveryOpts(loadManifest(runtimeDir)).respondUrl);
    }
    catch {
    }
    const waitMs = Math.min(Math.max(Number(args.wait_ms) || 0, 0), INBOX_CHECK_MAX_WAIT_MS);
    const deadline = Date.now() + waitMs;
    for (;;) {
        const msg = inboxReadMessage(runtimeDir, messageId);
        if (!msg)
            return { error: `Unknown message '${messageId}'` };
        if (messageState(msg) === 'superseded') {
            return supersededRefusal(messageId, msg.superseded_by, workflowName);
        }
        if (messageState(msg) === 'answered') {
            return {
                status: 'responded',
                message_id: messageId,
                response: msg.response,
                engine_instructions: 'The question is answered — never relay or re-ask it now (a relayed ' +
                    'dead question reads as a NEW question to the user). Report the ' +
                    'recorded answer in one line, then act on it IMMEDIATELY: do the ' +
                    'step work and call step_complete — do not stop at announcing what ' +
                    'you will do.',
            };
        }
        if (Date.now() >= deadline) {
            return {
                status: 'pending',
                message_id: messageId,
                engine_instructions: "No response yet. Wait (do not busy-loop), then call inbox(op:'check') again — the run " +
                    'is durable and simply holds until the user answers. Do NOT ask the user how to ' +
                    'wait, and NEVER offer to simulate or fabricate the answer; with channel both, ' +
                    'present the SAME question in the terminal (its exact entries), nothing else. ' +
                    'If the user stays away, simply STOP and report that the run is waiting for their ' +
                    'answer — it holds and resumes when the answer arrives. NEVER abort, clear, or ' +
                    'finalize a run because an answer is pending: a waiting run is a healthy run.',
            };
        }
        await new Promise((r) => setTimeout(r, 250));
    }
}
export async function toolInboxRespond(args, paths = defaultPaths()) {
    const workflowName = (args.name ?? args.workflow_name);
    if (!workflowName || typeof workflowName !== 'string') {
        return { error: "inbox op:'respond' requires 'name' (the workflow name)" };
    }
    if (!args.message_id || typeof args.message_id !== 'string') {
        return { error: "inbox op:'respond' requires 'message_id'" };
    }
    if (!args.type || typeof args.type !== 'string') {
        return { error: "inbox op:'respond' requires 'type' (accept | reject | choice | respond | edit, or 'items' with an items map for a grouped message)" };
    }
    let runtimeDir;
    try {
        runtimeDir = resolveRunRuntimeDir(paths, workflowName);
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
    const manifest = loadManifest(runtimeDir);
    if (!manifest)
        return { error: `No manifest for workflow '${workflowName}'` };
    const own = checkRunOwnership(manifest, 'inbox_respond');
    if (own)
        return own;
    const result = await inboxRespondMessage(runtimeDir, args.message_id, {
        type: args.type,
        ...(args.text !== undefined ? { text: args.text } : {}),
        ...(args.args !== undefined ? { args: args.args } : {}),
        ...(typeof args.items === 'object' && args.items !== null && !Array.isArray(args.items)
            ? { items: args.items }
            : {}),
    }, 'terminal', 
    inboxDeliveryOpts(manifest));
    if ('error' in result)
        return { error: result.error };
    return {
        status: 'responded',
        message_id: args.message_id,
        response: result.message.response,
        engine_instructions: 'Recorded. Act on the answer IMMEDIATELY — do the step work and call ' +
            'step_complete; do not stop at announcing what you will do.',
    };
}
const INBOX_ANSWERED_ACT_NOW = instruction('engine/inbox-answered-act-now');
function resolveMessageKind(message) {
    const declared = message?.kind;
    return declared === 'loop_decision' || declared === 'route_decision' || declared === 'info'
        ? declared
        : 'human_gate';
}
function openPassQuestion(runtimeDir, step, kind) {
    if (!expectsAnswer(kind))
        return null;
    const manifest = loadManifest(runtimeDir);
    const startedAt = Date.parse(manifest?.steps?.[step]?.started_at ??
        '');
    if (Number.isNaN(startedAt))
        return null;
    const open = findStepMessages(runtimeDir, step, kind)
        .filter((m) => messageState(m) === 'open' && Date.parse(m.created_at) >= startedAt)
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return open[0] ?? null;
}
export async function toolInboxAsk(args, paths = defaultPaths()) {
    const workflowName = (args.name ?? args.workflow_name);
    if (!workflowName || typeof workflowName !== 'string') {
        return { error: "inbox op:'ask' requires 'name' (the workflow name)" };
    }
    let runtimeDir;
    try {
        runtimeDir = resolveRunRuntimeDir(paths, workflowName);
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
    let messageId;
    let postedPresentation = null;
    let advisories = {};
    if (typeof args.message_id === 'string' && args.message_id.length > 0) {
        messageId = args.message_id;
    }
    else {
        const adopted = typeof args.step === 'string' && args.step.length > 0
            ? openPassQuestion(runtimeDir, args.step, resolveMessageKind(args.message))
            : null;
        if (adopted !== null) {
            messageId = adopted.message_id;
            advisories = {
                reused_open_question: `Step '${adopted.step}' ALREADY has an unanswered question from this pass — ` +
                    `'${adopted.message_id}', asked at ${adopted.created_at}. Your new message was NOT ` +
                    `posted and nothing was lost: this ask is now holding on the existing one. After a ` +
                    `'pending' return, re-ask with message_id: '${adopted.message_id}' — a second card ` +
                    `for the same question would force the user to answer BOTH before the step can ` +
                    `complete. If you meant to ask something genuinely different, wait for this answer ` +
                    `first, or ask both together as one message with 'items'.`,
            };
        }
        else {
            const posted = await toolInboxPost(args, paths);
            if (typeof posted.error === 'string')
                return posted;
            messageId = posted.message_id;
            postedPresentation = posted.terminal_presentation ?? null;
            advisories = postAdvisories(posted);
        }
    }
    const withContext = (body) => {
        const url = inboxPageUrl();
        return { ...body, ...advisories, ...(url !== null ? { inbox_url: url } : {}) };
    };
    const msg = inboxReadMessage(runtimeDir, messageId);
    if (!msg)
        return { error: `Unknown message '${messageId}'` };
    if (messageState(msg) === 'answered') {
        return withContext({
            status: 'responded',
            message_id: messageId,
            response: msg.response,
            engine_instructions: INBOX_ANSWERED_ACT_NOW,
        });
    }
    if (messageState(msg) === 'superseded') {
        return supersededRefusal(messageId, msg.superseded_by, workflowName);
    }
    const channel = resolvePostedMessageChannel(workflowName, msg.step, msg.kind, paths);
    const bridge = getHostBridge();
    const canElicit = channel === 'both' && bridge !== null && elicitationAvailable();
    let relayPresentation = null;
    if (channel === 'both' && !canElicit) {
        const externalAlive = await (async () => {
            try {
                return Boolean(await ensureLocalServer(paths.agentDir));
            }
            catch {
                return false;
            }
        })();
        if (!externalAlive) {
            const presentation = postedPresentation ?? composeTerminalPresentation(msg);
            return withContext({
                status: 'relay_required',
                message_id: messageId,
                terminal_presentation: presentation,
                engine_instructions: `This host does not render engine dialogs (no elicitation capability), so the ` +
                    `terminal side is yours. DO THIS IN ORDER, IN THIS SAME TURN: (1) FIRST relay ` +
                    `terminal_presentation in your reply NOW — verbatim, plain text, never a blocking ` +
                    `widget; (2) THEN keep polling inbox(op:'check', name: '${workflowName}', ` +
                    `message_id: '${messageId}') until status is 'responded' — use wait_ms up to 15000 ` +
                    `and wait between calls. Do NOT end your turn after relaying: while you poll, a ` +
                    `terminal reply is recorded via inbox(op:'respond') and any other channel's answer ` +
                    `appears in the check. An ended turn sees neither.`,
            });
        }
        relayPresentation = postedPresentation ?? composeTerminalPresentation(msg);
        emitCallProgress(`HUMAN QUESTION (answer on the inbox page or via the API):\n${relayPresentation}`, 0);
    }
    const holdMs = Math.min(Math.max(inboxAskMaxHoldMsSafe(), 1000), 7200000);
    const startedHold = Date.now();
    const signal = currentCallContext().signal;
    const elicitBox = { req: null };
    let holdOver = false;
    if (canElicit && bridge) {
        void (async () => {
            let refusal = '';
            for (let attempt = 0; attempt < 3 && !holdOver; attempt++) {
                const form = composeElicitation(msg);
                const req = bridge.sendRequest('elicitation/create', {
                    message: refusal ? `${form.message}\n\n${refusal}` : form.message,
                    requestedSchema: form.requestedSchema,
                });
                elicitBox.req = req;
                let raw;
                try {
                    raw = await req.result;
                }
                catch {
                    return;
                }
                elicitBox.req = null;
                const res = raw;
                if (res?.action !== 'accept')
                    return;
                const mapped = mapElicitationContent(msg, res.content ?? {});
                if ('error' in mapped) {
                    refusal = `Your previous submission was not usable: ${mapped.error}`;
                    continue;
                }
                await inboxRespondMessage(runtimeDir, messageId, mapped.response, 'terminal', inboxDeliveryOpts(loadManifest(runtimeDir)));
                return;
            }
        })();
    }
    const pollMs = 400;
    const progressEveryMs = 10000;
    let lastProgressAt = 0;
    try {
        for (;;) {
            const cur = inboxReadMessage(runtimeDir, messageId);
            if (cur !== null && messageState(cur) === 'answered') {
                return withContext({
                    status: 'responded',
                    message_id: messageId,
                    response: cur.response,
                    engine_instructions: INBOX_ANSWERED_ACT_NOW,
                });
            }
            if (cur !== null && messageState(cur) === 'superseded') {
                return supersededRefusal(messageId, cur.superseded_by, workflowName);
            }
            if (signal?.aborted)
                return withContext({ status: 'cancelled', message_id: messageId });
            const elapsed = Date.now() - startedHold;
            if (elapsed >= holdMs) {
                return withContext({
                    status: 'pending',
                    message_id: messageId,
                    ...(relayPresentation !== null ? { terminal_presentation: relayPresentation } : {}),
                    engine_instructions: `Still unanswered after ${Math.round(elapsed / 1000)}s of holding. Call ` +
                        `inbox(op:'ask', name: '${workflowName}', message_id: '${messageId}') again ` +
                        `IMMEDIATELY to keep holding — the question stays delivered on every channel ` +
                        `and the run is durable. NEVER abort, clear, or finalize a run because an ` +
                        `answer is pending: a waiting run is a healthy run.`,
                });
            }
            if (elapsed - lastProgressAt >= progressEveryMs) {
                lastProgressAt = elapsed;
                emitCallProgress(`Waiting for the human answer to '${msg.title}' (${Math.round(elapsed / 1000)}s)`, Math.round(elapsed / 1000));
            }
            await new Promise((r) => setTimeout(r, pollMs));
        }
    }
    finally {
        holdOver = true;
        elicitBox.req?.cancel();
    }
}
function inboxAskMaxHoldMsSafe() {
    try {
        return inboxAskMaxHoldMs();
    }
    catch {
        return 1800000;
    }
}
export async function toolInbox(args, paths = defaultPaths()) {
    switch (args.op) {
        case 'rules':
            return toolInboxRules(args, paths);
        case 'ask':
            return toolInboxAsk(args, paths);
        case 'post':
            return toolInboxPost(args, paths);
        case 'check':
            return toolInboxCheck(args, paths);
        case 'respond':
            return toolInboxRespond(args, paths);
        default:
            return {
                error: `inbox requires 'op' — one of: rules (fetch the message rules; unlocks posting), ` +
                    `ask (store the message, deliver it on every channel, HOLD this call until the ` +
                    `answer arrives, and return it — the preferred way to ask), post (store a ` +
                    `validated message), check (poll for the answer), respond (record a ` +
                    `terminal answer). Got: ${args.op === undefined ? 'nothing' : `'${String(args.op)}'`}.`,
            };
    }
}
export function toolStepCompleteDynamic(args, paths = defaultPaths()) {
    const parentWorkflow = args.parent_workflow;
    const parentStep = args.parent_step;
    const ctx = resolveDynamicChildContext(parentWorkflow, parentStep, paths);
    if ('error' in ctx)
        return ctx;
    const childRuntimeDir = dirname(ctx.child_workflow_path);
    const result = toolStepComplete({
        name: ctx.child_workflow_name,
        step: args.step,
        summary: args.summary,
    }, paths, { runtimeDir: childRuntimeDir, workflowYamlPath: ctx.child_workflow_path });
    try {
        const parentRuntimeDir = resolveRunRuntimeDir(paths, parentWorkflow);
        const parentManifestPath = join(parentRuntimeDir, 'manifest.json');
        const parentManifest = JSON.parse(readFileSync(parentManifestPath, 'utf-8'));
        const parentRunId = parentManifest.run_id ?? '';
        if (parentRunId) {
            const parentWf = resolveWorkflow(parentWorkflow, paths);
            flushTraceSnapshot(parentRuntimeDir, parentRunId, parentManifest, parentStep, parentWf.workflow);
        }
    }
    catch {
    }
    return result;
}
export function resolveWorkflow(name, paths = defaultPaths()) {
    const cached = workflowCache.get(name);
    if (cached) {
        const cachedPath = join(cached.definitionDir, 'workflow.yaml');
        try {
            const currentMtime = statSync(cachedPath).mtimeMs;
            if (currentMtime === cached.mtime) {
                return { definitionDir: cached.definitionDir, workflow: cached.workflow };
            }
        }
        catch {
        }
    }
    const searchPaths = [
        join(paths.myWorkflowsDir, name, 'workflow.yaml'),
        join(paths.predefinedDir, name, 'workflow.yaml'),
        join(paths.examplesDir, name, 'workflow.yaml'),
        join(paths.communityDir, name, 'workflow.yaml'),
        join(paths.workflowsDir, name, 'workflow.yaml'),
    ];
    const communityYamlPath = join(paths.communityDir, name, 'workflow.yaml');
    for (const path of searchPaths) {
        let st;
        try {
            st = statSync(path);
        }
        catch {
            continue;
        }
        if (!st.isFile())
            continue;
        const definitionDir = dirname(path);
        if (path === communityYamlPath) {
            const verdict = checkCommunityTrust(paths.agentDir, name, definitionDir);
            if (!verdict.ok)
                throw new Error(verdict.message);
        }
        const workflow = loadYaml(path);
        validateAuthoringConventions(workflow, name, definitionDir);
        normalizePerIterationOutputs(workflow);
        injectSpecAuthoringOutputs(workflow);
        workflowCache.set(name, { definitionDir, workflow, mtime: st.mtimeMs });
        return { definitionDir, workflow };
    }
    const _err = new Error(`Workflow '${name}' not found. Searched: ${searchPaths.join(', ')}`);
    _err.code = 'ENOENT';
    throw _err;
}
import { checkCommunityTrust } from '../catalog/trust.js';
import { resolvePlaceholders } from './placeholders.js';
export { resolvePlaceholders };
import { BranchPathError, assertBranchPathsUnique, resolveBranchPath, } from './branch-paths.js';
import { OutputPathError, resolveConcreteOutputPath } from './output-paths.js';
function resetSpawnThrottleState(runtimeDir, stepName) {
    const safeStep = stepName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
    const tsFile = join(runtimeDir, 'data', '.spawn-timestamps', `${safeStep}.json`);
    try {
        unlinkSync(tsFile);
    }
    catch (e) {
        if (e?.code !== 'ENOENT') {
        }
    }
    const lockFile = `${tsFile}.lock`;
    try {
        unlinkSync(lockFile);
    }
    catch {
    }
}
export function isPurePlaceholderSegment(segment) {
    return (segment.startsWith('{') &&
        segment.endsWith('}') &&
        (segment.match(/\{/g) ?? []).length === 1 &&
        (segment.match(/\}/g) ?? []).length === 1);
}
export function readJsonField(data, fieldPath) {
    let value = data;
    for (const key of fieldPath.split('.')) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const obj = value;
            if (!(key in obj)) {
                throw new Error(`Cannot navigate '${key}' — key missing`);
            }
            value = obj[key];
        }
        else {
            const t = value === null ? 'null' : Array.isArray(value) ? 'list' : typeof value;
            throw new Error(`Cannot navigate '${key}' in non-dict: ${t}`);
        }
    }
    return value;
}
export function parseParallelKey(parallelKey) {
    const bare = parallelKey.endsWith('[*]') ? parallelKey.slice(0, -3) : parallelKey;
    const m = /^([^.]+)\.(.+?)(?:\[(\w+)=(\w+)\])?$/.exec(bare);
    const guidance = `Expected '<struct>.<field.path>' with an optional terminal '[*]' (all items) ` +
        `or '[key=value]' (filter). See workflow_learn(topic="parallel").`;
    if (!m) {
        throw new Error(`Cannot parse parallel_key '${parallelKey}'. ${guidance}`);
    }
    const structName = m[1] ?? '';
    const fieldPath = m[2] ?? '';
    if (/[[\]]/.test(structName) || /[[\]]/.test(fieldPath)) {
        throw new Error(`Cannot parse parallel_key '${parallelKey}': brackets are reserved for a terminal ` +
            `'[*]' or '[key=value]' — index access and JSONPath spellings are not supported, ` +
            `navigation is dots-only. ${guidance}`);
    }
    return m[3] !== undefined && m[4] !== undefined
        ? { structName, fieldPath, filterKey: m[3], filterVal: m[4] }
        : { structName, fieldPath };
}
export function resolveParallelBranches(parallelKey, runtimeDir, workflow, params) {
    const { structName, fieldPath, filterKey, filterVal } = parseParallelKey(parallelKey);
    let dataFile = null;
    if (workflow && Array.isArray(workflow.steps)) {
        const steps = [...workflow.steps].reverse();
        outer: for (const step of steps) {
            const stepOutputs = step.outputs ?? [];
            for (const out of stepOutputs) {
                if (!out || typeof out !== 'object' || Array.isArray(out))
                    continue;
                const outRec = out;
                if (outRec.struct !== structName)
                    continue;
                const declaredPath = outRec.path;
                if (!declaredPath)
                    continue;
                const resolvedPath = resolvePlaceholders(declaredPath, params ?? {});
                if (!resolvedPath)
                    continue;
                const candidate = pathIsAbsolute(resolvedPath) || isDottedRoot(resolvedPath)
                    ? resolvedPath
                    : join(runtimeDir, resolvedPath);
                try {
                    if (statSync(candidate).isFile()) {
                        dataFile = candidate;
                        break outer;
                    }
                }
                catch (e) {
                    if (!(e instanceof Error) || !('code' in e))
                        throw e;
                }
            }
        }
    }
    if (dataFile === null) {
        dataFile = join(runtimeDir, 'data', `${structName}.json`);
    }
    let raw;
    try {
        raw = readFileSync(dataFile, 'utf-8');
    }
    catch {
        throw new Error(`Parallel key references struct '${structName}' but data file not found: ${dataFile}`);
    }
    const data = JSON.parse(raw);
    let items = data;
    for (const key of fieldPath.split('.')) {
        if (items !== null && typeof items === 'object' && !Array.isArray(items)) {
            const obj = items;
            if (key in obj) {
                items = obj[key];
                continue;
            }
        }
        throw new Error(`Cannot navigate '${key}' in parallel_key '${parallelKey}'`);
    }
    if (!Array.isArray(items)) {
        const t = items === null ? 'null' : typeof items;
        throw new Error(`parallel_key '${parallelKey}' resolved to ${t}, expected list`);
    }
    if (filterKey !== undefined && filterVal !== undefined) {
        return items.filter((it) => it !== null &&
            typeof it === 'object' &&
            !Array.isArray(it) &&
            String(it[filterKey]) === filterVal);
    }
    return items;
}
export function normalizeForMcp(name) {
    return (name ?? '').replace(/[^a-zA-Z0-9_]/g, '_');
}
function ccMcpName(server, registered) {
    return `mcp__${normalizeForMcp(server)}__${registered}`;
}
function platformPythonNames() {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    return { py, otherPy: py === 'python' ? 'python3' : 'python' };
}
function scriptInvokeHint(host, registered, command) {
    const isPython = /^python3?\b/.test(command.trim());
    const { py, otherPy } = platformPythonNames();
    const pyNote = isPython
        ? ` The command starts with this platform's Python (\`${py}\`); if that reports "command not found", try \`${otherPy}\`.`
        : '';
    const shellLast = `Run the fallback command shown below via the shell ONLY if the MCP tool is genuinely unavailable AFTER you retried discovery (never on a first miss) — run it EXACTLY as shown and pass each argument as \`--key=value\` (not \`--key value\`).${pyNote}`;
    const findIt = `It is an MCP tool — server \`workflow_tools\`, tool name \`${registered}\`. Find it in your tools list / search by that server + tool name and call it by the EXACT name shown there. Do NOT assume a prefix format — each host wraps MCP names its own (sometimes complex) way — and do NOT use loose keywords; a 0-result is a query mistake / lazy index, NOT absent.`;
    switch (host) {
        case 'claude-code':
            return `PRIMARY — call the MCP tool. On Claude Code it is \`${ccMcpName('workflow_tools', registered)}\`: load it first via \`ToolSearch("select:${ccMcpName('workflow_tools', registered)}")\`, then call it. Do NOT use loose keywords; a 0-result is a query mistake, NOT absent. ${shellLast}`;
        case 'cursor':
            return `PRIMARY — call the MCP tool. ${findIt} (Cursor groups tools by server and typically shows the bare tool name; you may also use \`CallMcpTool(server="workflow_tools", toolName="${registered}")\`.) ${shellLast}`;
        case 'codex':
            return `PRIMARY — call the MCP tool. ${findIt} If your search returns 0, the server may still be connecting — wait briefly and re-search, or call it directly. ${shellLast}`;
        case 'opencode':
            return `PRIMARY — call the MCP tool. On OpenCode it surfaces as \`workflow_tools_${registered}\` (server name + underscore + tool name). ${shellLast}`;
        default:
            return `PRIMARY — call the MCP tool. ${findIt} ${shellLast}`;
    }
}
export function renderToolDocsBrief(activeTools, workflowName, host = null) {
    if (activeTools.length === 0)
        return '';
    const isOc = host === 'opencode';
    const lines = ['**Available tools for this step:**'];
    for (const t of activeTools) {
        const name = t.name ?? '';
        const desc = t.description ?? '';
        const ttype = t.type ?? 'script';
        if (ttype === 'script') {
            const wfNorm = normalizeForMcp(workflowName);
            const toolNorm = normalizeForMcp(name);
            const toolId = isOc
                ? `workflow_tools_${wfNorm}__${toolNorm}`
                : `mcp__workflow_tools__${wfNorm}__${toolNorm}`;
            lines.push(`- \`${toolId}\` (${name}) — ${desc}`);
        }
        else {
            const expected = t.expected_tools ?? [];
            if (expected.length > 0) {
                const names = expected
                    .map((et) => isOc
                    ? `\`${normalizeForMcp(name)}_${normalizeForMcp(et)}\``
                    : `\`mcp__${normalizeForMcp(name)}__${normalizeForMcp(et)}\``)
                    .join(', ');
                lines.push(`- ${name} (${ttype}): ${names} — ${desc}`);
            }
            else {
                lines.push(`- ${name} (${ttype}) — ${desc}`);
            }
        }
    }
    lines.push('Prefer these MCP tools over running the underlying scripts via Bash — they provide structured tracing and schema validation.');
    lines.push('If a listed tool is not callable yet it is DEFERRED (load its schema, e.g. `ToolSearch`), NOT missing — do not fall back to Bash for a deferred tool.');
    return lines.join('\n');
}
export function renderToolDocsFull(activeTools, workflowName, host = null) {
    if (activeTools.length === 0)
        return '';
    const sections = ['## Available tools for this step', ''];
    for (const t of activeTools) {
        const name = t.name ?? '';
        const desc = t.description ?? '';
        const ttype = t.type ?? 'script';
        if (ttype === 'script') {
            const cmd = t.command ?? '';
            const schema = t.input_schema ?? {};
            const registered = `${normalizeForMcp(workflowName)}__${normalizeForMcp(name)}`;
            sections.push(`### ${name} (script tool)`);
            sections.push(desc ? `_${desc}_` : '');
            sections.push('');
            sections.push(scriptInvokeHint(host, registered, cmd));
            sections.push('');
            sections.push(`**Fallback command** (shell — use ONLY if the MCP tool is genuinely unavailable, per the note above): \`${cmd}\``);
            const props = (schema.properties ?? {});
            const required = new Set((schema.required ?? []));
            if (Object.keys(props).length > 0) {
                sections.push('**Arguments** (when run via shell, pass each as `--key=value`, NOT `--key value`):');
                for (const [pname, pdef] of Object.entries(props)) {
                    const pdesc = pdef?.description ?? '';
                    const ptype = pdef?.type ?? 'any';
                    const reqMarker = required.has(pname) ? ' _(required)_' : '';
                    sections.push(`- \`${pname}\` (${ptype})${reqMarker}: ${pdesc}`);
                }
            }
            sections.push('');
        }
        else {
            sections.push(`### ${name} (MCP tool — \`type: mcp\`)`);
            sections.push(desc ? `_${desc}_` : '');
            const expected = t.expected_tools ?? [];
            if (expected.length > 0) {
                sections.push('');
                sections.push(`**Tools — find each under the \`${name}\` MCP server and call it by the name your host shows:**`);
                for (const et of expected) {
                    const etn = normalizeForMcp(et);
                    sections.push(host === 'claude-code'
                        ? `- \`${ccMcpName(name, etn)}\``
                        : `- \`${etn}\` (server \`${normalizeForMcp(name)}\`)`);
                }
            }
            sections.push('');
            sections.push(`These are MCP tools (not scripts — do not shell). Ensure the \`${name}\` server is connected; call each by the EXACT name your host shows for that server (do NOT assume a prefix format).`);
            sections.push('');
        }
    }
    return sections.join('\n').replace(/\s+$/, '');
}
export function checkToolsAvailability(toolsConfig) {
    const available = [];
    const missing = [];
    for (const tool of toolsConfig) {
        const toolName = tool.name ?? 'unknown';
        const toolType = tool.type ?? 'script';
        if (toolType === 'script') {
            const command = tool.command ?? '';
            const parts = command.trim().split(/\s+/).filter(Boolean);
            if (parts.length === 0) {
                missing.push({
                    name: toolName,
                    type: 'script',
                    required: tool.required ?? false,
                    reason: 'Empty command',
                });
                continue;
            }
            const baseCmd = parts[0] ?? '';
            const isPython = parts.length > 1 && (baseCmd === 'python' || baseCmd === 'python3');
            if (isPython) {
                const scriptPath = parts[1] ?? '';
                let exists = false;
                try {
                    exists = statSync(scriptPath).isFile();
                }
                catch (e) {
                    if (!(e instanceof Error) || !('code' in e))
                        throw e;
                    exists = false;
                }
                if (exists) {
                    available.push({ name: toolName, type: 'script' });
                }
                else {
                    missing.push({
                        name: toolName,
                        type: 'script',
                        required: tool.required ?? false,
                        reason: `Script not found: ${scriptPath}`,
                    });
                }
            }
            else {
                available.push({ name: toolName, type: 'script' });
            }
        }
        else if (toolType === 'mcp') {
            const hasConfig = Boolean(tool.server_config);
            const entry = {
                name: toolName,
                type: 'mcp',
                required: tool.required ?? true,
                has_server_config: hasConfig,
            };
            if (hasConfig)
                entry.server_config = tool.server_config;
            entry.needs_verification = true;
            available.push(entry);
        }
    }
    return { available, missing };
}
const _mcpCallLog = [];
export function mcpCallLog() {
    return _mcpCallLog;
}
export function appendMcpCall(entry) {
    _mcpCallLog.push(entry);
}
export function clearMcpCallLog() {
    _mcpCallLog.length = 0;
}
export function toolWorkflowResolve(args, paths = defaultPaths()) {
    const name = args.name;
    const { definitionDir, workflow } = resolveWorkflow(name, paths);
    {
        const [activeWorkflow] = resolveActiveWorkflow(dirname(paths.agentDir));
        const resolvedName = String(workflow.name ?? name);
        if (activeWorkflow && activeWorkflow !== resolvedName) {
            const hasScriptTools = (workflow.tools ?? []).some((t) => (t.type ?? 'script') === 'script');
            if (hasScriptTools) {
                throw new Error(`Active workflow is '${activeWorkflow}', but you are resolving ` +
                    `'${resolvedName}', which declares script tools that were NOT registered ` +
                    `(the workflow_tools MCP server was scoped to '${activeWorkflow}' at startup).\n\n` +
                    `ORCHESTRATOR DIRECTIVE: Those script tools are unavailable in this session. ` +
                    `DO NOT retry, DO NOT run the tools via Bash, DO NOT edit the marker. Surface ` +
                    `this entire message to the user verbatim and STOP the workflow.\n\n` +
                    `USER REMEDIATION: relaunch scoped to this workflow — ` +
                    `\`riglane run-workflow --target=<target> --workflow=${resolvedName}\` — or clear ` +
                    `the active-workflow marker (${PRODUCT_DIR}/local/active-workflow) to load all tools.`);
            }
        }
    }
    const stepsInfo = [];
    for (const s of workflow.steps ?? []) {
        const info = { name: s.name };
        if ('delegate_to' in s)
            info.delegate_to = s.delegate_to;
        if (s.parallel)
            info.parallel = true;
        if (s.gate)
            info.gate_override = s.gate;
        if (s.model)
            info.model = s.model;
        stepsInfo.push(info);
    }
    const toolsConfig = workflow.tools ?? [];
    const toolsInfo = [];
    for (const t of toolsConfig) {
        const ti = {
            name: t.name,
            type: t.type ?? 'script',
        };
        if (t.description) {
            ti.description = t.description;
        }
        const _requiredVal = t.required;
        if (_requiredVal != null) {
            ti.required = _requiredVal;
        }
        toolsInfo.push(ti);
    }
    const result = {
        name: workflow.name ?? name,
        version: workflow.version ?? 1,
        description: workflow.description ?? '',
        definition_dir: definitionDir,
        params: workflow.params ?? [],
        gate: workflow.gate ?? {},
        context: workflow.context ?? {},
        steps: stepsInfo,
        step_count: stepsInfo.length,
    };
    if (toolsInfo.length > 0)
        result.tools = toolsInfo;
    return result;
}
function uuid4Full() {
    return randomUUID();
}
function resolveRunRuntimeDir(paths, workflowName) {
    let rid = getCurrentRunId();
    if (rid) {
        try {
            const held = JSON.parse(readFileSync(join(runDir(paths.agentDir, rid), 'manifest.json'), 'utf-8'));
            if (held.workflow !== workflowName || held.status !== 'in_progress')
                rid = null;
        }
        catch {
            rid = null;
        }
    }
    if (!rid) {
        const envRid = process.env[ENV_RUN_ID];
        if (typeof envRid === 'string' && isValidRunId(envRid)) {
            try {
                const m = JSON.parse(readFileSync(join(runDir(paths.agentDir, envRid), 'manifest.json'), 'utf-8'));
                if (m.status === 'in_progress' && m.workflow === workflowName) {
                    rid = envRid;
                    setCurrentRunId(rid);
                }
            }
            catch {
            }
        }
    }
    if (!rid) {
        const inProgress = findRunsByWorkflow(paths.agentDir, workflowName, 'in_progress');
        if (inProgress.length === 1) {
            rid = inProgress[0] ?? null;
            setCurrentRunId(rid);
        }
        else if (inProgress.length > 1) {
            throw new Error(`Multiple in-progress runs of workflow '${workflowName}' — ambiguous. ` +
                `Resume a specific run by run_id (run-identity: parallel same-workflow).`);
        }
    }
    if (!rid) {
        throw new Error(`No active run for workflow '${workflowName}'. Call workflow_init first ` +
            `(or workflow_resume if a run is in progress).`);
    }
    return runDir(paths.agentDir, rid);
}
let _pendingDelegation = null;
export function _resetPendingDelegation() {
    _pendingDelegation = null;
}
function resolveDelegatedRunDir(paths, delegatedName, linkedRunId, parentRunId, parentStep) {
    if (linkedRunId && isValidRunId(linkedRunId)) {
        return { dir: runDir(paths.agentDir, linkedRunId), source: 'linkage' };
    }
    const runs = findRunsByWorkflow(paths.agentDir, delegatedName);
    if (parentRunId) {
        for (let i = runs.length - 1; i >= 0; i -= 1) {
            const rid = runs[i];
            try {
                const m = JSON.parse(readFileSync(join(runDir(paths.agentDir, rid), 'manifest.json'), 'utf-8'));
                if (m.parent_run_id === parentRunId && m.parent_step === parentStep) {
                    return { dir: runDir(paths.agentDir, rid), source: 'backlink' };
                }
            }
            catch {
            }
        }
    }
    return { dir: null, source: 'unresolved', candidates: runs.length };
}
const SERVER_INSTANCE_ID = randomUUID();
function checkRunOwnership(manifest, tool) {
    const owner = manifest.owner_instance_id;
    if (!owner || owner === SERVER_INSTANCE_ID)
        return null;
    return {
        error: `Cannot call '${tool}': this workflow run is orchestrated by a different session — ` +
            `you are a spawned subagent/worker, not the orchestrator. Workers must NOT drive the ` +
            `workflow engine.` +
            `\n\nORCHESTRATOR DIRECTIVE: If you are a worker, do ONLY the single task you were given, ` +
            `write its declared output file(s), and STOP. Do NOT call workflow_engine tools ` +
            `(step_begin / step_complete / workflow_finalize / …) and do NOT continue to other steps ` +
            `or spawn agents — the orchestrator owns the workflow. If you ARE the orchestrator and your ` +
            `session restarted, call workflow_resume first to re-take ownership of this run.`,
        action: 'BLOCKED_FOREIGN_CALLER',
        tool,
    };
}
const CODEX_SPAWN_LIFECYCLE_NOTE = instruction('engine/spawn-note-codex');
const CURSOR_SPAWN_TYPE_NOTE = instruction('engine/spawn-note-cursor');
const GEMINI_SPAWN_NOTE = instruction('engine/spawn-note-gemini');
const AUTHORING_ERROR_DIRECTIVE = '\n\n' + instruction('engine/authoring-error-directive');
function deciderErrorDirective(kind) {
    return '\n\n' + instruction('engine/decider-error-directive', { kind });
}
function composeModelInstruction(mode) {
    switch (typeof mode === 'string' && mode.length > 0 ? mode : 'auto') {
        case 'inherit':
            return instruction('engine/model-mode-inherit');
        case 'auto':
            return instruction('engine/model-mode-auto');
        case 'lightest':
            return instruction('engine/model-mode-lightest');
        case 'strongest':
            return instruction('engine/model-mode-strongest');
        default:
            return null;
    }
}
function composeStepBeginEngineInstructions(useSubagent, isRebegin, stepName, model) {
    const notes = [];
    if (useSubagent && getEngineHost() === 'codex')
        notes.push(CODEX_SPAWN_LIFECYCLE_NOTE);
    if (useSubagent && getEngineHost() === 'cursor')
        notes.push(CURSOR_SPAWN_TYPE_NOTE);
    if (useSubagent && getEngineHost() === 'gemini')
        notes.push(GEMINI_SPAWN_NOTE);
    if (useSubagent) {
        const modelNote = composeModelInstruction(model);
        if (modelNote)
            notes.push(modelNote);
    }
    if (isRebegin) {
        notes.push(`NOTE — step '${stepName}' was already in progress: this step_begin is a RE-begin. ` +
            `Do NOT re-begin a step whose work is already underway/finished — continue its ` +
            `completion path instead (subagent step: call step_collect_result, then step_complete; ` +
            `inline step: call step_complete). Re-begin is correct ONLY when resuming a genuinely ` +
            `interrupted step (e.g. after a crash/restart).`);
    }
    return notes.length > 0 ? notes.join('\n\n') : null;
}
function nowIsoLocal(d = new Date()) {
    return toIsoLocal(d);
}
function normalizeRunOverrides(overrides) {
    const rd = overrides?.runtimeDir;
    const wy = overrides?.workflowYamlPath;
    return {
        runtimeDir: typeof rd === 'string' && rd.length > 0 ? rd : null,
        workflowYamlPath: typeof wy === 'string' && wy.length > 0 ? wy : null,
    };
}
export function toolWorkflowInit(args, paths = defaultPaths(), overrides) {
    const name = args.name ||
        args.workflow_name;
    let userParams = {};
    const rawParams = args.params;
    if (rawParams !== undefined && rawParams !== null) {
        if (typeof rawParams === 'string') {
            try {
                userParams = JSON.parse(rawParams);
            }
            catch {
                userParams = {};
            }
        }
        else if (typeof rawParams === 'object' && !Array.isArray(rawParams)) {
            userParams = { ...rawParams };
        }
    }
    const rawModelOverride = args.model_override ?? process.env[ENV_MODEL_OVERRIDE];
    let modelOverride;
    if (rawModelOverride !== undefined && rawModelOverride !== null && rawModelOverride !== '') {
        if (!isModelMode(rawModelOverride)) {
            return {
                error: `Invalid model override '${String(rawModelOverride)}'. ` +
                    `A model override is a selection MODE, not a model name — valid values: ` +
                    `${MODEL_MODES.join(', ')}.` +
                    `\n\nORCHESTRATOR DIRECTIVE: Do NOT retry with a guessed value and do NOT ` +
                    `edit any file. Surface this to the user verbatim and STOP.` +
                    `\n\nAUTHOR/USER REMEDIATION: pass --model with one of ${MODEL_MODES.join(' | ')} ` +
                    `(or omit it to use each step's declared model).`,
            };
        }
        modelOverride = rawModelOverride;
    }
    const rawInboxWebhook = args.inbox_webhook ??
        process.env[ENV_INBOX_WEBHOOK_OVERRIDE];
    let inboxWebhookOverride;
    if (rawInboxWebhook !== undefined && rawInboxWebhook !== null && rawInboxWebhook !== '') {
        if (typeof rawInboxWebhook !== 'string' || !/^https?:\/\//.test(rawInboxWebhook)) {
            return {
                error: `Invalid inbox webhook '${String(rawInboxWebhook)}' — it must be an http(s) URL ` +
                    `(the address the question envelopes are POSTed to).` +
                    `\n\nORCHESTRATOR DIRECTIVE: Do NOT retry with a guessed value. Surface this to ` +
                    `the user verbatim and STOP.` +
                    `\n\nAUTHOR/USER REMEDIATION: pass --inbox-webhook with a full http(s) URL, or ` +
                    `omit it (the workflow's inbox_webhook field / env / config apply).`,
            };
        }
        inboxWebhookOverride = rawInboxWebhook;
    }
    const rawTraceViewer = args.trace_viewer ?? process.env[ENV_TRACE_VIEWER_OVERRIDE];
    let traceViewerOff = false;
    if (rawTraceViewer !== undefined && rawTraceViewer !== null && rawTraceViewer !== '') {
        if (rawTraceViewer !== 'off') {
            return {
                error: `Invalid trace viewer override '${String(rawTraceViewer)}' — the only ` +
                    `defined value is 'off' (suppress auto-opening the trace viewer for this run).` +
                    `\n\nORCHESTRATOR DIRECTIVE: Do NOT retry with a guessed value. Surface this to ` +
                    `the user verbatim and STOP.` +
                    `\n\nAUTHOR/USER REMEDIATION: launch with --no-trace-viewer (or omit the ` +
                    `trace_viewer argument and unset ${ENV_TRACE_VIEWER_OVERRIDE}) — the ambient ` +
                    `engine.auto_open_trace_viewer config applies when neither is present.`,
            };
        }
        traceViewerOff = true;
    }
    const { runtimeDir: runtimeDirOverride, workflowYamlPath: yamlPathOverride } = normalizeRunOverrides(overrides);
    let workflow;
    let defnDir;
    if (yamlPathOverride !== null) {
        try {
            workflow = loadYaml(yamlPathOverride);
            normalizePerIterationOutputs(workflow);
            injectSpecAuthoringOutputs(workflow);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                error: `Failed to load workflow from path '${yamlPathOverride}': ${msg}`,
            };
        }
        defnDir = dirname(yamlPathOverride);
    }
    else {
        ({ definitionDir: defnDir, workflow } = resolveWorkflow(name, paths));
    }
    const hasRuntimeDirOverride = runtimeDirOverride !== null;
    const now = new Date();
    const envRunId = process.env[ENV_RUN_ID];
    const runId = !hasRuntimeDirOverride &&
        typeof envRunId === 'string' &&
        isValidRunId(envRunId) &&
        !existsSync(runDir(paths.agentDir, envRunId))
        ? envRunId
        : generateRunId(name, now);
    const runtimeDir = runtimeDirOverride ?? runDir(paths.agentDir, runId);
    const existingManifestPath = join(runtimeDir, 'manifest.json');
    let existingExists = false;
    try {
        existingExists = statSync(existingManifestPath).isFile();
    }
    catch (e) {
        if (!(e instanceof Error) || !('code' in e))
            throw e;
        existingExists = false;
    }
    if (existingExists) {
        try {
            const prev = JSON.parse(readFileSync(existingManifestPath, 'utf-8'));
            if (prev.status === 'in_progress') {
                return {
                    error: `Runtime dir for run_id '${prev.run_id}' already holds an in-progress run of '${name}'. Top-level runs mint a unique dir and may run in parallel; this only occurs for an explicitly reused runtime_dir (dynamic child / externally-managed run). Finalize that run or supply a fresh runtime_dir.`,
                    active_run_id: prev.run_id,
                };
            }
        }
        catch {
        }
    }
    const paramDefs = workflow.params ?? [];
    const resolvedParams = {};
    for (const pdef of paramDefs) {
        const pname = pdef.name;
        if (pname in userParams && userParams[pname] !== null && userParams[pname] !== undefined) {
            resolvedParams[pname] = userParams[pname];
        }
        else if ('default' in pdef) {
            resolvedParams[pname] = pdef.default;
        }
        else if (pdef.required) {
            return { error: `Required param '${pname}' not provided` };
        }
        else {
            resolvedParams[pname] = null;
        }
    }
    for (const [k, v] of Object.entries(userParams)) {
        if (!(k in resolvedParams))
            resolvedParams[k] = v;
    }
    const nowIso = nowIsoLocal(now);
    const runToken = uuid4Full();
    resolvedParams.run_id = runId;
    const hasLoopBack = collectAllSteps(workflow).some((s) => s.loop_back !== undefined);
    if (hasLoopBack)
        resolvedParams.iteration = 0;
    const scopeParamRaw = resolvedParams.scope;
    const scopeParam = typeof scopeParamRaw === 'string' && scopeParamRaw.length > 0 ? scopeParamRaw : null;
    const scopeManaged = scopeParam !== null;
    let preservedActiveScope = null;
    let scopeWarning = null;
    const projectRoot = dirname(paths.agentDir);
    if (scopeParam !== null) {
        try {
            scopeValidateScopeId(scopeParam);
            preservedActiveScope = scopeReadUserActiveScope(projectRoot);
            if (!scopeScopeExists(scopeParam, projectRoot)) {
                scopeWarning =
                    `scope '${scopeParam}' is not declared in ${PRODUCT_DIR}/specs/_scope-config.json ` +
                        `(and is not the implicit 'generic'). If this is a typo or the wrong ` +
                        `scope, STOP and re-run with the correct --scope. If it is intentional, ` +
                        `declare it first: riglane scope add ${scopeParam} "<label>" --hint "<coverage>". ` +
                        `Proceeding will treat '${scopeParam}' as a new scope directory.`;
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                error: `Cannot manage workflow scope '${scopeParam}': ${msg}. ` +
                    `Ensure the scope id matches /^[a-z][a-z0-9-]*$/ and that ` +
                    `${PRODUCT_DIR}/local/ is writable.`,
            };
        }
    }
    const stepNames = (workflow.steps ?? []).map((s) => s.name);
    const stepsDict = {};
    for (const sname of stepNames)
        stepsDict[sname] = { status: 'pending' };
    const manifest = {
        workflow: name,
        workflow_version: workflow.version ?? 1,
        run_id: runId,
        run_token: runToken,
        status: 'in_progress',
        current_step: stepNames[0] ?? null,
        started_at: nowIso,
        updated_at: nowIso,
        params: resolvedParams,
        steps: stepsDict,
        scope_managed: scopeManaged,
        preserved_active_scope: preservedActiveScope,
        owner_instance_id: SERVER_INSTANCE_ID,
        owner_pid: process.pid,
    };
    if (modelOverride)
        manifest.model_override = modelOverride;
    manifest.step_tools = freezeStepTools(workflow, collectAllSteps(workflow));
    {
        const wfWebhook = workflow.inbox_webhook;
        const snapshotWebhook = inboxWebhookOverride ?? (typeof wfWebhook === 'string' && wfWebhook ? wfWebhook : undefined);
        if (snapshotWebhook)
            manifest.inbox_webhook_url = snapshotWebhook;
    }
    for (const staleDir of ['data', 'context']) {
        const stalePath = join(runtimeDir, staleDir);
        if (existsSync(stalePath)) {
            try {
                rmSync(stalePath, { recursive: true, force: true });
                logEngine(`Cleaned stale ${staleDir}/ from previous run`);
            }
            catch {
            }
        }
    }
    mkdirSync(runtimeDir, { recursive: true });
    safeWriteJson(existingManifestPath, manifest);
    if (!hasRuntimeDirOverride) {
        setCurrentRunId(runId);
        appendRunEvent(paths.agentDir, { run_id: runId, workflow: name, event: 'started', at: nowIso });
    }
    if (!hasRuntimeDirOverride && _pendingDelegation && _pendingDelegation.target === name) {
        try {
            const parentManifestPath = join(_pendingDelegation.parentRuntimeDir, 'manifest.json');
            const parentManifest = JSON.parse(readFileSync(parentManifestPath, 'utf-8'));
            const pSteps = (parentManifest.steps ?? {});
            const pStep = (pSteps[_pendingDelegation.parentStep] ?? {});
            pStep.delegation = { target: name, child_run_id: runId, linked_at: nowIso };
            pSteps[_pendingDelegation.parentStep] = pStep;
            parentManifest.steps = pSteps;
            parentManifest.updated_at = nowIso;
            safeWriteJson(parentManifestPath, parentManifest);
            manifest.parent_run_id = parentManifest.run_id ?? null;
            manifest.parent_step = _pendingDelegation.parentStep;
            safeWriteJson(existingManifestPath, manifest);
            logEngine(`delegation linkage: linked child run '${runId}' to parent step ` +
                `'${_pendingDelegation.parentStep}' (${parentManifest.run_id})`);
        }
        catch (e) {
            logEngine(`delegation linkage: stamp failed (falling back to latest-by-name at ` +
                `step_complete): ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    if (scopeParam !== null) {
        try {
            scopeWriteUserActiveScope(scopeParam, projectRoot);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                error: `Failed to write workflow scope '${scopeParam}' to ` +
                    `${PRODUCT_DIR}/local/active-scope: ${msg}. Manifest at ${existingManifestPath} ` +
                    `records the preserved value for workflow_finalize; you may need ` +
                    `to restore it manually.`,
            };
        }
    }
    const wfGate = workflow.gate ?? {};
    const trace = {
        trace_version: 1,
        workflow: name,
        workflow_version: workflow.version ?? 1,
        run_id: runId,
        host: {
            id: getEngineHost(),
            client_name: getEngineClientName(),
            client_version: getEngineClientVersion(),
            orchestrator_model: detectOrchestratorModel(getEngineHost(), dirname(paths.agentDir)),
        },
        params: resolvedParams,
        gate_config: {
            structural: wfGate.structural ?? true,
            semantic: wfGate.semantic ?? false,
            human: wfGate.human ?? false,
            max_gate_retries: wfGate.max_gate_retries ?? 5,
            max_step_retries: wfGate.max_step_retries ?? 3,
        },
        started_at: nowIso,
        completed_at: null,
        status: 'in_progress',
        total_duration_ms: null,
        total_messages: 0,
        total_tool_calls: 0,
        total_modified_files: 0,
        steps: (workflow.steps ?? []).map((s, i) => {
            const su = s;
            const entry = {
                name: su.name ?? `step-${i}`,
                index: i,
                status: 'pending',
                config: {
                    spec_check: 'spec_check' in su ? su.spec_check : false,
                    ...('spec_authoring' in su ? { spec_authoring: su.spec_authoring } : {}),
                    subagent: 'subagent' in su ? su.subagent : true,
                    gate: su.gate ?? null,
                },
                goal: su.goal ?? null,
                invocations: [],
                retry_count: 0,
            };
            if ('delegate_to' in su)
                entry.delegate_to = su.delegate_to;
            return entry;
        }),
    };
    if (workflow.description)
        trace.description = workflow.description;
    if (workflow.context)
        trace.context = workflow.context;
    if (paramDefs.length > 0) {
        trace.param_defs = paramDefs.map((p) => ({
            name: p.name,
            description: p.description ?? '',
            required: p.required ?? false,
        }));
    }
    const tracePath = join(runtimeDir, 'trace.json');
    safeWriteJson(tracePath, trace);
    const toolsConfig = (workflow.tools ?? []);
    let toolsResult;
    if (toolsConfig.length > 0) {
        const toolsCheck = checkToolsAvailability(toolsConfig);
        toolsResult = {
            available: toolsCheck.available,
            missing: toolsCheck.missing,
        };
        const requiredMissing = toolsCheck.missing.filter((m) => m.required);
        if (requiredMissing.length > 0) {
            toolsResult.blocked = true;
            toolsResult.block_message = [
                'Required tools are missing. Enable them before continuing:',
                ...requiredMissing.map((m) => `  - ${m.name} (${m.type}): ${m.reason ?? 'not available'}`),
            ].join('\n');
        }
    }
    const declaresExternalChannel = workflowMayNeedExternalChannel(workflow);
    if (!hasRuntimeDirOverride && !toolsResult?.blocked && declaresExternalChannel) {
        try {
            void ensureLocalServer(paths.agentDir);
        }
        catch {
        }
    }
    if (!hasRuntimeDirOverride && !toolsResult?.blocked && !traceViewerOff) {
        try {
            if (autoOpenTraceViewer()) {
                openTraceViewer(paths.agentDir, `/local/workflow_runs/${runId}/trace.json`);
            }
        }
        catch {
        }
    }
    const result = {
        run_id: runId,
        run_token: runToken,
        runtime_dir: runtimeDir,
        first_step: stepNames[0] ?? null,
        total_steps: stepNames.length,
        step_names: stepNames,
        params: resolvedParams,
    };
    if (toolsResult)
        result.tools = toolsResult;
    if (declaresExternalChannel) {
        result.external_channel = {
            declared: true,
            discovery: join(paths.agentDir, 'local', 'serve.json'),
        };
    }
    if (scopeWarning)
        result.scope_warning = scopeWarning;
    if (modelOverride)
        result.model_override = modelOverride;
    if (traceViewerOff)
        result.trace_viewer = 'off';
    if (manifest.inbox_webhook_url)
        result.inbox_webhook = manifest.inbox_webhook_url;
    if (!toolsResult?.blocked && (stepNames[0] ?? null) !== null) {
        const firstBegin = composeNextBeginForAdvance({
            workflowName: name,
            workflow,
            defnDir,
            runtimeDir,
            manifestPath: existingManifestPath,
            nextStep: stepNames[0],
            paths,
        });
        if (firstBegin !== null) {
            result.engine_instructions =
                `next_begin below carries the FULL begin payload for the first step ` +
                    `('${stepNames[0]}') — do NOT call step_begin; compose the subagent task ` +
                    `from it and continue IMMEDIATELY.`;
            result.next_begin = firstBegin;
        }
    }
    void isAbsolute(runtimeDir);
    return result;
}
function readRunHead(paths, rid) {
    try {
        return JSON.parse(readFileSync(join(runDir(paths.agentDir, rid), 'manifest.json'), 'utf-8'));
    }
    catch {
        return null;
    }
}
function isResumable(m) {
    return m !== null && m.status === 'in_progress' && (m.stopped === undefined || m.stopped === null);
}
function resolveResumeTarget(paths, name, requested) {
    if (typeof requested === 'string' && requested.length > 0) {
        if (!isValidRunId(requested)) {
            return {
                error: `Invalid run_id '${requested}'. A run id looks like ` +
                    `'<workflow>-YYYYMMDD-HHMMSS-xxxx' — copy it from the run list or the trace.`,
            };
        }
        const m = readRunHead(paths, requested);
        if (m === null) {
            return {
                error: `No run '${requested}' in this project (its directory is missing or its ` +
                    `manifest is unreadable). Nothing was resumed.`,
            };
        }
        if (m.workflow !== name) {
            return {
                error: `Run '${requested}' belongs to workflow '${String(m.workflow)}', not '${name}'. ` +
                    `Resume it under its own workflow name.`,
            };
        }
        if (!isResumable(m)) {
            return {
                error: `Run '${requested}' is not resumable (status '${String(m.status)}'` +
                    `${m.stopped !== undefined && m.stopped !== null ? ', stopped' : ''}). A ` +
                    `failed/completed run cannot be resumed — start a fresh run with workflow_init.`,
            };
        }
        return { runId: requested, runtimeDir: runDir(paths.agentDir, requested) };
    }
    const envRid = process.env[ENV_RUN_ID];
    if (typeof envRid === 'string' && isValidRunId(envRid)) {
        const m = readRunHead(paths, envRid);
        if (m !== null && m.workflow === name && isResumable(m)) {
            return { runId: envRid, runtimeDir: runDir(paths.agentDir, envRid) };
        }
    }
    const runs = findRunsByWorkflow(paths.agentDir, name);
    let latestTerminalStatus = null;
    for (let i = runs.length - 1; i >= 0; i -= 1) {
        const rid = runs[i];
        const m = readRunHead(paths, rid);
        if (isResumable(m))
            return { runId: rid, runtimeDir: runDir(paths.agentDir, rid) };
        if (m !== null)
            latestTerminalStatus = latestTerminalStatus ?? (m.status || 'unknown');
    }
    if (latestTerminalStatus !== null) {
        return {
            error: `No resumable run for '${name}': the latest run is terminal ` +
                `(status '${latestTerminalStatus}'). A failed/completed run cannot be resumed — ` +
                `start a fresh run with workflow_init.`,
        };
    }
    return { runId: null, runtimeDir: join(paths.workflowsDir, name) };
}
export function toolWorkflowResume(args, paths = defaultPaths()) {
    const name = args.name;
    const _picked = resolveResumeTarget(paths, name, args.run_id);
    if ('error' in _picked)
        return _picked;
    const runtimeDir = _picked.runtimeDir;
    const manifestPath = join(runtimeDir, 'manifest.json');
    let exists = false;
    try {
        exists = statSync(manifestPath).isFile();
    }
    catch (e) {
        if (!(e instanceof Error) || !('code' in e))
            throw e;
        exists = false;
    }
    if (!exists) {
        return { error: `No manifest found for '${name}'. Start a new run without --resume.` };
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    {
        const _ownerId = manifest.owner_instance_id;
        const _ownerPid = manifest.owner_pid;
        if (typeof _ownerId === 'string' &&
            _ownerId.length > 0 &&
            _ownerId !== SERVER_INSTANCE_ID &&
            typeof _ownerPid === 'number' &&
            _ownerPid !== process.pid &&
            isProcessAlive(_ownerPid)) {
            return {
                error: `Cannot resume workflow '${name}': this run is owned by another LIVE ` +
                    `orchestrator session (its engine process is still running). Taking ` +
                    `ownership away from a live session is refused.` +
                    `\n\nORCHESTRATOR DIRECTIVE: If you are a spawned subagent/worker, do ONLY ` +
                    `the single task you were given, write its declared output file(s), and ` +
                    `STOP — do NOT drive the workflow engine and do NOT retry this call. If you ` +
                    `believe you ARE the restarted orchestrator: the previous engine process is ` +
                    `still alive, so another session most likely holds this run right now. ` +
                    `Surface this message to the user verbatim and STOP — releasing a run held ` +
                    `by a live session is the user's decision, not yours.`,
            };
        }
    }
    const _resumeManifest = manifest;
    if (_resumeManifest.scope_managed === true && manifest.status === 'in_progress') {
        const _resumeScope = manifest.params
            ?.scope;
        if (typeof _resumeScope === 'string' && _resumeScope.length > 0) {
            const projectRootResume = dirname(paths.agentDir);
            try {
                if (scopeReadUserActiveScope(projectRootResume) !== _resumeScope) {
                    scopeWriteUserActiveScope(_resumeScope, projectRootResume);
                }
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                // eslint-disable-next-line no-console
                console.error(`[workflow-engine] Warning: workflow_resume could not reconcile ` +
                    `active-scope (target=${_resumeScope}): ${msg}`);
            }
        }
    }
    _resumeManifest.owner_instance_id = SERVER_INSTANCE_ID;
    _resumeManifest.owner_pid = process.pid;
    if (_resumeManifest.step_tools === undefined && manifest.status === 'in_progress') {
        try {
            const { workflow: _resumeWf } = resolveWorkflow(name, paths);
            _resumeManifest.step_tools = freezeStepTools(_resumeWf, collectAllSteps(_resumeWf));
        }
        catch {
        }
    }
    _resumeManifest.updated_at = nowIsoLocal();
    safeWriteJson(manifestPath, _resumeManifest);
    setCurrentRunId(_resumeManifest.run_id ?? null);
    const _retakenChildren = [];
    const _childWarnings = [];
    for (const [_sname, _sdata] of Object.entries(manifest.steps ?? {})) {
        const _planning = _sdata.planning;
        if (!_planning || _planning.phase !== 'executing')
            continue;
        const _childYaml = _planning.child_workflow_path;
        if (typeof _childYaml !== 'string' || !_childYaml)
            continue;
        const _childManifestPath = join(dirname(_childYaml), 'manifest.json');
        let _childManifest;
        try {
            _childManifest = JSON.parse(readFileSync(_childManifestPath, 'utf-8'));
        }
        catch {
            continue;
        }
        const _cOwnerId = _childManifest.owner_instance_id;
        const _cOwnerPid = _childManifest.owner_pid;
        if (typeof _cOwnerId === 'string' &&
            _cOwnerId.length > 0 &&
            _cOwnerId !== SERVER_INSTANCE_ID &&
            typeof _cOwnerPid === 'number' &&
            _cOwnerPid !== process.pid &&
            isProcessAlive(_cOwnerPid)) {
            _childWarnings.push(`dynamic child of step '${_sname}' is owned by another LIVE orchestrator ` +
                `session — not re-taken (same policy as the parent guard).`);
            continue;
        }
        _childManifest.owner_instance_id = SERVER_INSTANCE_ID;
        _childManifest.owner_pid = process.pid;
        _childManifest.updated_at = nowIsoLocal();
        safeWriteJson(_childManifestPath, _childManifest);
        _retakenChildren.push({
            parent_step: _sname,
            child_run_id: _childManifest.run_id ?? null,
        });
    }
    const currentStep = manifest.current_step ?? null;
    const stepData = currentStep ? (manifest.steps[currentStep] ?? {}) : {};
    const completedSummaries = {};
    for (const [sname, sdata] of Object.entries(manifest.steps ?? {})) {
        if (sdata.status === 'completed') {
            const summaryPath = join(runtimeDir, 'context', `${sname}.summary.md`);
            try {
                const st = statSync(summaryPath);
                if (st.isFile()) {
                    completedSummaries[sname] = readFileSync(summaryPath, 'utf-8');
                }
            }
            catch {
            }
        }
    }
    const wfStatus = manifest.status;
    const result = {
        run_id: manifest.run_id,
        run_token: manifest.run_token,
        runtime_dir: runtimeDir,
        status: wfStatus,
        current_step: currentStep,
        current_step_status: stepData.status ?? null,
        params: manifest.params ?? {},
        completed_summaries: completedSummaries,
        steps: manifest.steps ?? {},
    };
    if (wfStatus === 'completed') {
        result.warning =
            'Workflow is already completed. Starting a new run without --resume may be more appropriate.';
    }
    const _resumeLaneCursors = admissibleLaneCursors(manifest);
    if (_resumeLaneCursors.length > 0) {
        result.active_lanes = _resumeLaneCursors.map((c) => ({
            lane_id: c.laneId,
            fork_step: c.forkStep,
            next_step: c.cursor,
        }));
        result.engine_instructions =
            `Parallel lanes are ACTIVE in this run: ` +
                _resumeLaneCursors
                    .map((c) => `lane '${c.laneId}' (fork '${c.forkStep}') resumes at step '${c.cursor}'`)
                    .join('; ') +
                `. current_step ('${String(currentStep)}') is the parked fork sentinel — do NOT begin ` +
                `it. Resume by driving the listed lane steps (they may run concurrently); the engine ` +
                `returns the cursor past the fork when every lane reaches a terminal state.`;
    }
    try {
        if (typeof currentStep === 'string' && currentStep &&
            stepData.status === 'in_progress') {
            const _gateMsgs = findStepMessages(runtimeDir, currentStep, 'human_gate');
            const _answered = _gateMsgs.filter((m) => m.response && !m.superseded_by);
            const _pending = _gateMsgs.filter((m) => !m.response && !m.superseded_by);
            if (_answered.length > 0 || _pending.length > 0) {
                result.human_gate_messages = {
                    answered: _answered.map((m) => ({
                        message_id: m.message_id,
                        title: m.title,
                        response: m.response,
                    })),
                    pending: _pending.map((m) => ({
                        message_id: m.message_id,
                        title: m.title,
                    })),
                };
                const _gateLines = [];
                if (_answered.length > 0) {
                    const last = _answered[_answered.length - 1];
                    const r = last.response ?? {};
                    _gateLines.push(`Step '${currentStep}' ALREADY HAS a recorded human answer: message ` +
                        `'${last.message_id}' -> type '${String(r.type)}'` +
                        (r.text ? ` ("${String(r.text).slice(0, 200)}")` : '') +
                        (r.responded_at ? ` at ${r.responded_at}` : '') +
                        `. Do NOT compose a new question and do NOT re-begin the step (a re-begin ` +
                        `re-stamps the pass and orphans this answer). Interpret the recorded response ` +
                        `now: accept -> call step_complete; reject -> re-run THIS step with the ` +
                        `response text as feedback; choice/respond -> apply it, then complete.`);
                }
                if (_pending.length > 0) {
                    const ids = _pending.map((m) => `'${m.message_id}'`).join(', ');
                    _gateLines.push(`Step '${currentStep}' has ${_pending.length} still-unanswered inbox ` +
                        `question(s): ${ids}. Resume the SAME exchange with inbox(op:'ask', name, ` +
                        `message_id) — do NOT compose a new question beside it.`);
                }
                result.engine_instructions = [result.engine_instructions, ..._gateLines]
                    .filter(Boolean)
                    .join('\n\n');
            }
        }
    }
    catch {
    }
    if (_retakenChildren.length > 0)
        result.dynamic_children_retaken = _retakenChildren;
    if (_childWarnings.length > 0)
        result.dynamic_child_warnings = _childWarnings;
    return result;
}
import { extname, isAbsolute as pathIsAbsolute, posix as pathPosix, relative as pathRelative, } from 'node:path';
import { globSync } from 'glob';
import { createSnapshot, deleteSnapshot, injectSpecAuthoringOutputs, normalizePerIterationOutputs, resolveOutputPath, } from './output-validator.js';
function isDottedRoot(path) {
    return path.length > 1 && path[0] === '.' && /\p{L}/u.test(path[1] ?? '');
}
function toPosixSlashes(p) {
    return p.split('\\').join('/');
}
function relpathPosix(target, from = process.cwd()) {
    return toPosixSlashes(pathRelative(from, target));
}
function composeBranchPrompt(branch, stepName, runtimeDir, defnDir) {
    const sections = [];
    sections.push(branch.branch_index !== undefined
        ? `# Branch ${branch.branch_index} — Step: ${stepName}\n`
        : `# Step: ${stepName}\n`);
    sections.push(branch.run_token_text);
    sections.push('## Goal\n');
    sections.push(branch.goal);
    if (branch.params_text) {
        sections.push('\n## Parameters\n');
        sections.push(branch.params_text);
    }
    if (branch.inputs.length > 0) {
        sections.push('\n## Inputs\n');
        for (const inp of branch.inputs) {
            const path = inp.path;
            const inject = inp.inject ?? 'reference';
            if (inp.glob_unmatched === true) {
                sections.push(`### Input: \`${path}\` — ⚠ glob matched no files (expected input missing)\n`);
                continue;
            }
            let readPath;
            if (pathIsAbsolute(path) || isDottedRoot(path)) {
                readPath = path;
            }
            else {
                readPath = join(runtimeDir, path);
                if (defnDir && !existsSync(readPath)) {
                    readPath = join(defnDir, path);
                }
            }
            if (inject === 'file') {
                try {
                    const content = readFileSync(readPath, 'utf-8');
                    sections.push(`### Input: \`${path}\`\n`);
                    sections.push(`\`\`\`\n${content}\n\`\`\`\n`);
                }
                catch {
                    sections.push(`### Input: \`${path}\` — ⚠ file not found\n`);
                }
            }
            else if (inject === 'file_if_exists') {
                try {
                    const content = readFileSync(readPath, 'utf-8');
                    sections.push(`### Input: \`${path}\`\n`);
                    sections.push(`\`\`\`\n${content}\n\`\`\`\n`);
                }
                catch {
                }
            }
            else {
                sections.push(`- **Read this file yourself:** \`${path}\`\n`);
            }
        }
    }
    if (branch.summaries_text) {
        sections.push('\n## Previous Step Summaries\n');
        sections.push(branch.summaries_text);
    }
    if (branch.outputs_text) {
        sections.push('\n## Outputs\n');
        sections.push(branch.outputs_text);
    }
    if (branch.spec_guidance_text) {
        sections.push('\n');
        sections.push(branch.spec_guidance_text);
    }
    if (branch.constraints_text) {
        sections.push('\n## Constraints\n');
        sections.push(branch.constraints_text);
    }
    if (branch.tool_docs) {
        sections.push('\n## Available Tools\n');
        sections.push(branch.tool_docs);
    }
    return sections.join('\n');
}
function summarizeBranchData(branchData) {
    const pyStr = (v) => {
        if (v === null || v === undefined)
            return 'None';
        if (v === true)
            return 'True';
        if (v === false)
            return 'False';
        return String(v);
    };
    if (branchData !== null && typeof branchData === 'object' && !Array.isArray(branchData)) {
        const obj = branchData;
        for (const key of ['name', 'domain', 'id', 'label', 'title', 'key']) {
            if (key in obj)
                return pyStr(obj[key]);
        }
        for (const [k, v] of Object.entries(obj)) {
            if (v !== null && (typeof v === 'object' || Array.isArray(v)))
                return k;
            return `${k}: ${pyStr(v)}`;
        }
    }
    if (Array.isArray(branchData)) {
        const formatted = branchData
            .map((v) => (typeof v === 'string' ? `'${v}'` : pyStr(v)))
            .join(', ');
        return `[${formatted}]`.substring(0, 100);
    }
    return pyStr(branchData).substring(0, 100);
}
export function createStepSnapshot(stepName, stepConfig, runtimeDir, params, branches) {
    const outputs = (stepConfig.outputs ?? []);
    if (outputs.length === 0)
        return;
    try {
        const isParallel = stepConfig.parallel === true;
        const resolveForSnapshot = (p) => isParallel ? resolvePlaceholders(p, params) : resolveConcreteOutputPath(p, params);
        const resolvedOutputs = [];
        for (const out of outputs) {
            if (out !== null && typeof out === 'object' && !Array.isArray(out)) {
                const o = out;
                const entry = { ...o };
                entry.path = resolveForSnapshot(o.path ?? '');
                resolvedOutputs.push(entry);
            }
            else {
                resolvedOutputs.push({ path: resolveForSnapshot(String(out)) });
            }
        }
        createSnapshot(resolvedOutputs, runtimeDir, stepName, branches);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // eslint-disable-next-line no-console
        console.error(`[workflow-engine] WARN: snapshot creation failed for step '${stepName}': ${msg}. Proceeding without write_proof baseline.`);
    }
}
function resolveStepInputs(stepConfig, params, runtimeDir, defnDir) {
    const inputsInfo = [];
    const stepInputs = (stepConfig.inputs ?? []);
    for (const inpRaw of stepInputs) {
        let path;
        let inject;
        let struct;
        if (inpRaw !== null && typeof inpRaw === 'object' && !Array.isArray(inpRaw)) {
            const inp = inpRaw;
            path = inp.path ?? '';
            inject = inp.inject ?? 'reference';
            struct = inp.struct;
        }
        else {
            path = String(inpRaw);
            inject = 'reference';
            struct = undefined;
        }
        const resolvedPath = resolvePlaceholders(path, params);
        const hasGlob = resolvedPath.includes('*') || resolvedPath.includes('?') || resolvedPath.includes('[');
        if (hasGlob) {
            let globPattern;
            let matched;
            if (!isDottedRoot(resolvedPath) && !pathIsAbsolute(resolvedPath)) {
                globPattern = join(runtimeDir, resolvedPath);
                matched = [...globSync(globPattern, { windowsPathsNoEscape: true })].sort();
                if (matched.length === 0) {
                    globPattern = join(defnDir, resolvedPath);
                    matched = [...globSync(globPattern, { windowsPathsNoEscape: true })].sort();
                }
            }
            else {
                matched = [...globSync(resolvedPath, { windowsPathsNoEscape: true })].sort();
            }
            if (matched.length === 0 && inject === 'file_if_exists')
                continue;
            if (matched.length === 0) {
                inputsInfo.push({ path: toPosixSlashes(resolvedPath), inject, glob_unmatched: true });
                continue;
            }
            for (const matchPath of matched) {
                const mp = toPosixSlashes(matchPath);
                const entry = { path: mp, inject };
                if (struct)
                    entry.struct = struct;
                inputsInfo.push(entry);
            }
        }
        else {
            let displayPath = resolvedPath;
            if (!isDottedRoot(displayPath) && !pathIsAbsolute(displayPath)) {
                let candidate = join(runtimeDir, displayPath);
                if (!existsSync(candidate)) {
                    const defnCandidate = join(defnDir, displayPath);
                    if (existsSync(defnCandidate))
                        candidate = defnCandidate;
                }
                displayPath = relpathPosix(candidate);
            }
            const entry = { path: displayPath, inject };
            if (struct)
                entry.struct = struct;
            inputsInfo.push(entry);
        }
    }
    const seen = new Set();
    const dedupedInputs = [];
    for (const inp of inputsInfo) {
        const key = `${inp.path}\u0000${inp.inject}`;
        if (!seen.has(key)) {
            seen.add(key);
            dedupedInputs.push(inp);
        }
    }
    return dedupedInputs;
}
function validateInputStructs(entries, stepName, defnDir) {
    for (const inp of entries) {
        const structName = inp.struct;
        if (structName === undefined || structName === '')
            continue;
        if (inp.glob_unmatched === true)
            continue;
        const p = inp.path;
        if (typeof p !== 'string' || p === '' || !existsSync(p))
            continue;
        const schemaPath = join(defnDir, 'structs', `${structName}.schema.yaml`);
        if (!existsSync(schemaPath))
            continue;
        let schema;
        try {
            schema = loadYaml(schemaPath);
        }
        catch {
            continue;
        }
        const result = validateFile(p, schema);
        if (!result.passed) {
            return (`Input '${p}' of step '${stepName}' failed struct validation ('${structName}'): ` +
                `${result.details.join('; ')}` +
                `\n\nORCHESTRATOR DIRECTIVE: Do NOT spawn the subagent for this step and do NOT ` +
                `edit the input file to make it pass. The declared input does not match its ` +
                `schema — if a previous step produced it, that step's output is malformed ` +
                `(re-run it via its documented retry path); if it is an external/user file, ` +
                `surface this error to the user verbatim and STOP.` +
                `\n\nAUTHOR/DATA REMEDIATION (for the user): fix the producing step or the input ` +
                `file, or correct the struct reference. Schema: structs/${structName}.schema.yaml ` +
                `in the workflow directory. Field reference: workflow_learn(topic="inputs").`);
        }
    }
    return null;
}
function iterationForStep(workflow, manifest, stepName) {
    const steps = (manifest.steps ?? {});
    let best = null;
    for (const seq of collectAllSequences(workflow)) {
        const names = seq.steps.map((x) => x.name ?? '');
        const at = names.indexOf(stepName);
        if (at < 0)
            continue;
        for (let i = 0; i < seq.steps.length; i += 1) {
            const lb = seq.steps[i]?.loop_back;
            if (!lb || typeof lb !== 'object')
                continue;
            const from = names.indexOf(lb.to ?? '');
            if (from < 0 || from > i)
                continue;
            if (at < from || at > i)
                continue;
            const owner = names[i] ?? '';
            const st = (steps[owner] ?? {});
            const count = typeof st.loop_state?.iterations === 'number' ? st.loop_state.iterations : 0;
            const span = i - from;
            if (best === null || span < best.span)
                best = { span, count };
        }
    }
    return best === null ? null : best.count;
}
const FORMAT_MAP = {
    '.json': 'JSON',
    '.yaml': 'YAML',
    '.yml': 'YAML',
    '.md': 'Markdown',
};
function composeStepMaterial(ctx, params) {
    const { workflowName, stepName, workflow, defnDir, runtimeDir, manifest, stepConfig, activeSeq, paths, } = ctx;
    const runToken = manifest.run_token ?? '';
    const paramsParts = [];
    for (const [pname, pval] of Object.entries(params)) {
        if (pval !== null && pval !== undefined) {
            paramsParts.push(`${pname} = "${pythonRepr(pval)}"`);
        }
        else {
            paramsParts.push(`${pname} = (not specified)`);
        }
    }
    const paramsText = paramsParts.length > 0 ? `**Params:** ${paramsParts.join(', ')}` : '';
    const goal = stepConfig.goal ?? '';
    const goalResolved = resolvePlaceholders(goal, params);
    const dedupedInputs = resolveStepInputs(stepConfig, params, runtimeDir, defnDir);
    const inputStructError = validateInputStructs(dedupedInputs, stepName, defnDir);
    if (inputStructError !== null) {
        return { error: inputStructError };
    }
    const outputsParts = [];
    const schemaSections = [];
    const outputSchemas = [];
    const stepOutputs = (stepConfig.outputs ?? []);
    for (const outRaw of stepOutputs) {
        let opath;
        let ostruct;
        if (outRaw !== null && typeof outRaw === 'object' && !Array.isArray(outRaw)) {
            const out = outRaw;
            opath = out.path ?? '';
            ostruct = out.struct;
        }
        else {
            opath = String(outRaw);
            ostruct = undefined;
        }
        let opathResolved;
        if (stepConfig.parallel === true) {
            opathResolved = resolvePlaceholders(opath, params);
        }
        else {
            try {
                opathResolved = resolveConcreteOutputPath(opath, params);
            }
            catch (e) {
                if (e instanceof OutputPathError) {
                    return {
                        error: `Output path error in step '${stepName}' (output '${opath}'): ${e.message}` +
                            AUTHORING_ERROR_DIRECTIVE,
                        action: 'STOP_WORKFLOW',
                    };
                }
                throw e;
            }
        }
        let opathForAgent;
        if (!isDottedRoot(opathResolved) && !pathIsAbsolute(opathResolved)) {
            opathForAgent = toPosixSlashes(join(relpathPosix(runtimeDir), opathResolved));
        }
        else {
            opathForAgent = opathResolved;
        }
        if (ostruct) {
            const schemaPath = `${defnDir}/structs/${ostruct}.schema.yaml`;
            const ext = extname(opathResolved).toLowerCase();
            const fmt = FORMAT_MAP[ext] ?? 'JSON';
            outputsParts.push(`- \`${opathForAgent}\` — **${fmt}** file, struct: \`${ostruct}\``);
            let schemaContent = null;
            try {
                schemaContent = readFileSync(schemaPath, 'utf-8').trim();
                schemaSections.push(`**Struct \`${ostruct}\`** (output: \`${opathForAgent}\`):\n\`\`\`yaml\n${schemaContent}\n\`\`\`\nWrite as **${fmt}** matching this schema exactly.`);
            }
            catch (e) {
                if (e?.code !== 'ENOENT')
                    throw e;
                schemaSections.push(`**Struct \`${ostruct}\`**: ⚠ schema file not found at \`${schemaPath}\` — ask the user for guidance.`);
            }
            outputSchemas.push({
                path: opathForAgent,
                struct: ostruct,
                format: fmt,
                schema_path: schemaPath,
                content: schemaContent,
            });
        }
        else {
            outputsParts.push(`- \`${opathForAgent}\``);
        }
    }
    let outputsText = '';
    if (outputsParts.length > 0) {
        outputsText = `**Write outputs to:**\n${outputsParts.join('\n')}`;
        if (schemaSections.length > 0) {
            outputsText += `\n\n**Output schemas — your output MUST match these exactly:**\n\n${schemaSections.join('\n\n')}`;
        }
    }
    let summariesText = '';
    const wfCarry = (workflow.context ?? {}).carry_forward ?? 'none';
    const stepCarry = stepConfig.carry_forward;
    let shouldCarry = false;
    if (stepCarry === false)
        shouldCarry = false;
    else if (stepCarry === true)
        shouldCarry = true;
    else if (wfCarry === 'summary')
        shouldCarry = true;
    if (shouldCarry) {
        const summaryParts = [];
        for (const s of activeSeq) {
            const sname = s.name;
            if (sname === stepName)
                break;
            const sdata = manifest.steps?.[sname];
            if (sdata?.status === 'completed') {
                const summaryPath = join(runtimeDir, 'context', `${sname}.summary.md`);
                try {
                    const content = readFileSync(summaryPath, 'utf-8').trim();
                    summaryParts.push(`**Previous step '${sname}' summary:** ${content}`);
                }
                catch {
                }
            }
        }
        if (summaryParts.length > 0)
            summariesText = summaryParts.join('\n\n');
    }
    let specGuidanceText = '';
    {
        const specCheckVal = Boolean('spec_check' in stepConfig ? stepConfig.spec_check : false);
        const rawAuthoring = stepConfig.spec_authoring;
        const specAuthoringVal = rawAuthoring === 'persist' || rawAuthoring === 'validate' ? rawAuthoring : undefined;
        if (specCheckVal || specAuthoringVal) {
            try {
                const projectRootSpec = dirname(paths.agentDir);
                const specScope = scopeResolveActiveScope(params.scope ?? null, projectRootSpec)[0];
                const domains = composeDomainsEcho(specScope, projectRootSpec);
                const scopeHint = scopeGetScopeHint(specScope, projectRootSpec);
                specGuidanceText = composeSpecGuidance({ specCheck: specCheckVal, specAuthoring: specAuthoringVal }, specScope, domains, scopeHint);
            }
            catch {
            }
        }
    }
    let constraintsText = instruction('engine/constraints-base');
    const runTokenText = `<!--workflow:run_token:${runToken}--><!--workflow:step:${stepName}-->`;
    const subagentVal = 'subagent' in stepConfig ? stepConfig.subagent : true;
    const useSubagent = Boolean(subagentVal);
    if (useSubagent) {
        constraintsText += '\n' + instruction('engine/worker-role-clause');
        const deniedShell = stepDeniedCapabilities(stepConfig).includes('shell');
        if (deniedShell) {
            constraintsText += '\n' + instruction('engine/shell-denied-clause');
        }
        if (!deniedShell) {
            const { py, otherPy } = platformPythonNames();
            constraintsText +=
                '\n' +
                    instruction('engine/shell-facts-clause', {
                        nodeVersion: process.version,
                        py,
                        otherPy,
                        tmpdir: tmpdir(),
                    });
        }
    }
    let activeTools = [];
    const wfTools = (workflow.tools ?? []);
    if (wfTools.length > 0) {
        const stepToolsFilter = stepConfig.tools;
        if (Array.isArray(stepToolsFilter)) {
            activeTools = wfTools.filter((t) => t.name !== undefined && stepToolsFilter.includes(t.name));
        }
        else {
            activeTools = [];
        }
    }
    const perStepProjectRoot = dirname(paths.agentDir);
    const perStepSubagentDir = join(perStepProjectRoot, '.claude', 'agents', `${workflowName}-${stepName}`);
    const isCcPerStep = useSubagent &&
        getEngineHost() !== 'opencode' &&
        (() => {
            try {
                return statSync(join(perStepSubagentDir, 'AGENT.md')).isFile();
            }
            catch (e) {
                if (!(e instanceof Error) || !('code' in e))
                    throw e;
                return false;
            }
        })();
    const isOcPerStep = useSubagent &&
        getEngineHost() === 'opencode' &&
        (() => {
            try {
                return statSync(join(perStepProjectRoot, '.opencode', 'agents', `${AGENT_PREFIX}${workflowName}-${stepName}.md`)).isFile();
            }
            catch (e) {
                if (!(e instanceof Error) || !('code' in e))
                    throw e;
                return false;
            }
        })();
    const isCopilotPerStep = useSubagent &&
        getEngineHost() === 'copilot' &&
        (() => {
            try {
                return statSync(join(perStepProjectRoot, '.github', 'agents', `${AGENT_PREFIX}${workflowName}-${stepName}.agent.md`)).isFile();
            }
            catch (e) {
                if (!(e instanceof Error) || !('code' in e))
                    throw e;
                return false;
            }
        })();
    const isGeminiPerStep = useSubagent &&
        getEngineHost() === 'gemini' &&
        (() => {
            try {
                return statSync(join(perStepProjectRoot, '.gemini', 'agents', `${AGENT_PREFIX}${workflowName}-${stepName}.md`)).isFile();
            }
            catch (e) {
                if (!(e instanceof Error) || !('code' in e))
                    throw e;
                return false;
            }
        })();
    let toolDocsBlock = '';
    if (activeTools.length > 0) {
        toolDocsBlock =
            isCcPerStep || isOcPerStep || isCopilotPerStep || isGeminiPerStep
                ? renderToolDocsBrief(activeTools, workflowName, getEngineHost())
                : renderToolDocsFull(activeTools, workflowName, getEngineHost());
    }
    let subagentType;
    if (useSubagent) {
        subagentType = isCcPerStep
            ? `${workflowName}-${stepName}`
            : isOcPerStep || isCopilotPerStep || isGeminiPerStep
                ? `${AGENT_PREFIX}${workflowName}-${stepName}`
                : getEngineHost() === 'copilot' || getEngineHost() === 'gemini'
                    ?
                        WORKFLOW_STEP_AGENT
                    : 'workflow-step';
    }
    else {
        subagentType = null;
    }
    const profileSubagentMemo = new Map();
    const profileSubagentTypeFor = (profileId) => {
        if (!useSubagent)
            return null;
        const memoized = profileSubagentMemo.get(profileId);
        if (memoized !== undefined)
            return memoized;
        const exists = (p) => {
            try {
                return statSync(p).isFile();
            }
            catch (e) {
                if (!(e instanceof Error) || !('code' in e))
                    throw e;
                return false;
            }
        };
        const suffixed = `${workflowName}-${stepName}--${profileId}`;
        const host = getEngineHost();
        let resolved = null;
        if (host !== 'opencode' &&
            exists(join(perStepProjectRoot, '.claude', 'agents', suffixed, 'AGENT.md'))) {
            resolved = suffixed;
        }
        else if (host === 'opencode' &&
            exists(join(perStepProjectRoot, '.opencode', 'agents', `${AGENT_PREFIX}${suffixed}.md`))) {
            resolved = `${AGENT_PREFIX}${suffixed}`;
        }
        else if (host === 'copilot' &&
            exists(join(perStepProjectRoot, '.github', 'agents', `${AGENT_PREFIX}${suffixed}.agent.md`))) {
            resolved = `${AGENT_PREFIX}${suffixed}`;
        }
        else if (host === 'gemini' &&
            exists(join(perStepProjectRoot, '.gemini', 'agents', `${AGENT_PREFIX}${suffixed}.md`))) {
            resolved = `${AGENT_PREFIX}${suffixed}`;
        }
        profileSubagentMemo.set(profileId, resolved);
        return resolved;
    };
    return {
        paramsText,
        goalResolved,
        dedupedInputs,
        outputsText,
        outputSchemas,
        summariesText,
        specGuidanceText,
        constraintsText,
        runTokenText,
        runToken,
        useSubagent,
        activeTools,
        isCcPerStep,
        isOcPerStep,
        isCopilotPerStep,
        isGeminiPerStep,
        toolDocsBlock,
        subagentType,
        profileSubagentTypeFor,
    };
}
function composeStepBeginPayload(ctx) {
    const { workflowName, stepName, workflow, defnDir, runtimeDir, manifestPath, manifest, stepConfig, stepIndex, effectiveModel, existingStatus, } = ctx;
    const params = (manifest.params ?? {});
    {
        const it = iterationForStep(workflow, manifest, stepName);
        if (it !== null) {
            params.iteration = it;
            if (!manifest.params)
                manifest.params = params;
            else
                manifest.params.iteration = it;
        }
    }
    if (stepConfig.type === 'planning') {
        const goal = stepConfig.goal ?? '';
        const goalResolved = resolvePlaceholders(goal, params);
        const restrictions = resolvePlanningRestrictions(stepConfig);
        const now = nowIsoLocal();
        const stepData = (manifest.steps[stepName] ?? {});
        const prevPlanning = stepData.planning ?? null;
        const attempts = prevPlanning && typeof prevPlanning.attempts === 'number' ? prevPlanning.attempts : 0;
        stepData.status = 'in_progress';
        stepData.started_at = now;
        if (!stepData.first_started_at)
            stepData.first_started_at = now;
        {
            const priorLoopState = stepData.loop_state;
            if (priorLoopState)
                delete priorLoopState.resolved_for_pass;
        }
        stepData.planning = {
            attempts,
            phase: 'planning',
            child_run_id: prevPlanning?.child_run_id ?? null,
            child_workflow_path: prevPlanning?.child_workflow_path ?? null,
        };
        manifest.steps[stepName] = stepData;
        setCursorFor(workflow, manifest, stepName);
        manifest.updated_at = now;
        safeWriteJson(manifestPath, manifest);
        const runIdForTracePlan = manifest.run_id ?? '';
        if (runIdForTracePlan) {
            flushTraceSnapshot(runtimeDir, runIdForTracePlan, manifest, stepName, workflow);
        }
        return {
            type: 'planning',
            step_name: stepName,
            step_index: stepIndex,
            goal: goalResolved,
            restrictions: {
                max_substeps: restrictions.maxSubsteps,
                max_plan_attempts: restrictions.maxPlanAttempts,
                allow_parallel: restrictions.allowParallel,
                allow_delegation: restrictions.allowDelegation,
            },
            attempts,
            inputs: resolveStepInputs(stepConfig, params, runtimeDir, defnDir),
            engine_instructions: composePlanningProcedure(stepName, goalResolved, restrictions, attempts),
            model: stepConfig.model ?? null,
        };
    }
    if ('delegate_to' in stepConfig) {
        const delegateParams = (stepConfig.params ?? {});
        const resolved = {};
        for (const [k, v] of Object.entries(delegateParams)) {
            resolved[k] = typeof v === 'string' ? resolvePlaceholders(v, params) : v;
        }
        const now = nowIsoLocal();
        const stepData = (manifest.steps[stepName] ?? {});
        stepData.status = 'in_progress';
        stepData.started_at = now;
        const delegateTarget = String(stepConfig.delegate_to ?? '');
        stepData.delegation = { target: delegateTarget, child_run_id: null };
        manifest.steps[stepName] = stepData;
        setCursorFor(workflow, manifest, stepName);
        manifest.updated_at = now;
        safeWriteJson(manifestPath, manifest);
        _pendingDelegation = {
            parentRuntimeDir: runtimeDir,
            parentStep: stepName,
            target: delegateTarget,
        };
        try {
            const delegGateResultPath = join(runtimeDir, 'gate-result.json');
            if (existsSync(delegGateResultPath))
                unlinkSync(delegGateResultPath);
        }
        catch {
        }
        const runIdForTraceDeleg = manifest.run_id ?? '';
        if (runIdForTraceDeleg) {
            flushTraceSnapshot(runtimeDir, runIdForTraceDeleg, manifest, stepName, workflow);
        }
        return {
            type: 'delegation',
            step_name: stepName,
            step_index: stepIndex,
            delegate_to: stepConfig.delegate_to,
            resolved_params: resolved,
            goal: stepConfig.goal ?? '',
            param_bindings: (stepConfig.param_bindings ?? {}),
            model: stepConfig.model ?? null,
            engine_instructions: `Delegation protocol: (1) call workflow_init for '${delegateTarget}' with the ` +
                `resolved_params above; (2) drive that child run to workflow_finalize; (3) call ` +
                `step_complete for THIS step ('${stepName}') and include ` +
                `delegated_run_id: <the run_id returned by the child's workflow_init> — the engine ` +
                `then resolves param_bindings against exactly that child run (it also auto-links ` +
                `the child init as a fallback, so omitting it is tolerated but not preferred).`,
        };
    }
    const _mat = composeStepMaterial(ctx, params);
    if ('error' in _mat)
        return _mat;
    const { paramsText, goalResolved, dedupedInputs, outputsText, outputSchemas, summariesText, specGuidanceText, constraintsText, runTokenText, runToken, useSubagent, activeTools, isCcPerStep, isOcPerStep, isCopilotPerStep, isGeminiPerStep, toolDocsBlock, subagentType, profileSubagentTypeFor, } = _mat;
    try {
        const perStepGate = join(runtimeDir, 'gate-results', `${stepName}.json`);
        if (existsSync(perStepGate))
            unlinkSync(perStepGate);
    }
    catch {
    }
    const gateResultPath = join(runtimeDir, 'gate-result.json');
    try {
        if (existsSync(gateResultPath))
            unlinkSync(gateResultPath);
    }
    catch {
    }
    const isParallelStep = Boolean(stepConfig.parallel) && Boolean(stepConfig.parallel_key);
    if (!isParallelStep) {
        createStepSnapshot(stepName, stepConfig, runtimeDir, params);
    }
    const now = nowIsoLocal();
    const stepDataInit = (manifest.steps[stepName] ?? {});
    stepDataInit.status = 'in_progress';
    if (!('first_started_at' in stepDataInit))
        stepDataInit.first_started_at = now;
    stepDataInit.started_at = now;
    {
        const priorLoopState = stepDataInit.loop_state;
        if (priorLoopState)
            delete priorLoopState.resolved_for_pass;
    }
    if (stepConfig.spec_authoring === 'persist' || stepConfig.spec_authoring === 'validate') {
        stepDataInit.spec_authoring = stepConfig.spec_authoring;
    }
    else {
        delete stepDataInit.spec_authoring;
    }
    manifest.steps[stepName] = stepDataInit;
    setCursorFor(workflow, manifest, stepName);
    manifest.updated_at = now;
    safeWriteJson(manifestPath, manifest);
    const isParallel = Boolean(stepConfig.parallel);
    const parallelKeyRaw = stepConfig.parallel_key;
    if (isParallel && parallelKeyRaw) {
        let branchItems;
        try {
            branchItems = resolveParallelBranches(parallelKeyRaw, runtimeDir, workflow, params);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { error: `Failed to resolve parallel branches: ${msg}` };
        }
        if (branchItems.length === 0) {
            return { error: `parallel_key '${parallelKeyRaw}' resolved to 0 items` };
        }
        const branchProfilesCfg = stepBranchProfiles(stepConfig);
        const profileByBranch = [];
        if (branchProfilesCfg) {
            for (let bi = 0; bi < branchItems.length; bi += 1) {
                const pid = profileIdForItem(branchItems[bi]);
                const profile = pid !== null ? branchProfilesCfg[pid] : undefined;
                if (pid === null || profile === undefined) {
                    return {
                        error: `Step '${stepName}' declares branch_profiles, but parallel_key item ${bi} ` +
                            (pid === null
                                ? `carries neither a 'profile' nor a 'name' field to select one.`
                                : `selects '${pid}', which is not a declared profile.`) +
                            ` Declared profiles: ${Object.keys(branchProfilesCfg).join(', ')}. Every item ` +
                            `must resolve to a profile — fix the producing step's output (the item data) ` +
                            `or the step's branch_profiles.` +
                            AUTHORING_ERROR_DIRECTIVE,
                        action: 'STOP_WORKFLOW',
                    };
                }
                profileByBranch.push({ id: pid, profile });
            }
        }
        else {
            for (let bi = 0; bi < branchItems.length; bi += 1)
                profileByBranch.push(null);
        }
        const branches = [];
        const branchesForSnapshot = [];
        const rawOutputs = (stepConfig.outputs ?? []);
        const allBranchResults = [];
        const resolvedOutputsByBranch = [];
        for (let bi = 0; bi < branchItems.length; bi += 1) {
            const branchItem = branchItems[bi];
            const branchDir = `_branch_${bi}`;
            const branchProfile = profileByBranch[bi] ?? null;
            const branchOutputsParts = [];
            const branchSchemaSections = [];
            const branchOutputSchemas = [];
            const branchOutputsForSnapshot = [];
            const branchResolvedOutputs = [];
            for (const outRaw of rawOutputs) {
                let opath;
                let ostruct;
                let writeProof;
                if (outRaw !== null && typeof outRaw === 'object' && !Array.isArray(outRaw)) {
                    const out = outRaw;
                    opath = out.path ?? '';
                    ostruct = out.struct;
                    writeProof = out.write_proof;
                }
                else {
                    opath = String(outRaw);
                }
                if (ostruct && branchProfile?.profile.struct) {
                    ostruct = branchProfile.profile.struct;
                }
                let resolvedBranch;
                try {
                    resolvedBranch = resolveBranchPath(opath, params, branchItem, bi);
                }
                catch (e) {
                    if (e instanceof BranchPathError || e instanceof OutputPathError) {
                        return {
                            error: `Parallel output path error in step '${stepName}' (output '${opath}'): ${e.message}` +
                                AUTHORING_ERROR_DIRECTIVE,
                            action: 'STOP_WORKFLOW',
                        };
                    }
                    throw e;
                }
                const branchOpathResolved = resolvedBranch.workingPath;
                branchResolvedOutputs.push({
                    declared: opath,
                    working: resolvedBranch.workingPath,
                    semantic: resolvedBranch.semanticPath,
                    scaffolded: resolvedBranch.scaffolded,
                    ...(branchProfile?.profile.struct && ostruct ? { struct: ostruct } : {}),
                });
                allBranchResults.push(resolvedBranch);
                let branchOpathForAgent;
                if (!isDottedRoot(branchOpathResolved) && !pathIsAbsolute(branchOpathResolved)) {
                    branchOpathForAgent = toPosixSlashes(join(relpathPosix(runtimeDir), branchOpathResolved));
                }
                else {
                    branchOpathForAgent = branchOpathResolved;
                }
                if (ostruct) {
                    const schemaPath = `${defnDir}/structs/${ostruct}.schema.yaml`;
                    const ext = extname(branchOpathResolved).toLowerCase();
                    const fmt = FORMAT_MAP[ext] ?? 'JSON';
                    branchOutputsParts.push(`- \`${branchOpathForAgent}\` — **${fmt}** file, struct: \`${ostruct}\``);
                    try {
                        const sc = readFileSync(schemaPath, 'utf-8').trim();
                        branchSchemaSections.push(`**Struct \`${ostruct}\`** (output: \`${branchOpathForAgent}\`):\n\`\`\`yaml\n${sc}\n\`\`\`\nWrite as **${fmt}** matching this schema exactly.`);
                    }
                    catch (e) {
                        if (e?.code !== 'ENOENT')
                            throw e;
                        branchSchemaSections.push(`**Struct \`${ostruct}\`**: schema not found at \`${schemaPath}\``);
                    }
                    branchOutputSchemas.push({ path: branchOpathForAgent, struct: ostruct, format: fmt });
                }
                else {
                    branchOutputsParts.push(`- \`${branchOpathForAgent}\``);
                }
                const snapEntry = { path: branchOpathResolved };
                if (ostruct)
                    snapEntry.struct = ostruct;
                if (writeProof !== undefined)
                    snapEntry.write_proof = writeProof;
                branchOutputsForSnapshot.push(snapEntry);
            }
            resolvedOutputsByBranch.push(branchResolvedOutputs);
            let branchOutputsText = '';
            if (branchOutputsParts.length > 0) {
                branchOutputsText = `**Write outputs to:**\n${branchOutputsParts.join('\n')}`;
                if (branchSchemaSections.length > 0) {
                    branchOutputsText += `\n\n**Output schemas — your output MUST match these exactly:**\n\n${branchSchemaSections.join('\n\n')}`;
                }
            }
            const branchContext = JSON.stringify(branchItem, null, 2);
            const branchGoal = `**Your assigned parallel branch (#${bi}):**\n\`\`\`json\n${branchContext}\n\`\`\`\n\n${goalResolved}`;
            const branchRunToken = `<!--workflow:run_token:${runToken}--><!--workflow:step:${stepName}--><!--workflow:branch:${bi}-->`;
            let branchToolDocs = toolDocsBlock;
            if (branchProfile !== null) {
                const subset = new Set(branchProfile.profile.tools ?? []);
                const branchActiveTools = activeTools.filter((t) => typeof t.name === 'string' && subset.has(t.name));
                branchToolDocs =
                    branchActiveTools.length > 0
                        ? isCcPerStep || isOcPerStep || isCopilotPerStep || isGeminiPerStep
                            ? renderToolDocsBrief(branchActiveTools, workflowName, getEngineHost())
                            : renderToolDocsFull(branchActiveTools, workflowName, getEngineHost())
                        : '';
            }
            branches.push({
                branch_index: bi,
                branch_data: branchItem,
                branch_dir: branchDir,
                goal: branchGoal,
                outputs_text: branchOutputsText,
                output_schemas: branchOutputSchemas,
                tool_docs: branchToolDocs,
                params_text: paramsText,
                inputs: dedupedInputs,
                summaries_text: summariesText,
                spec_guidance_text: specGuidanceText,
                constraints_text: constraintsText,
                run_token_text: branchRunToken,
                subagent_type: branchProfile !== null
                    ? (profileSubagentTypeFor(branchProfile.id) ?? subagentType)
                    : subagentType,
                model: effectiveModel,
                ...(branchProfile !== null ? { profile: branchProfile.id } : {}),
            });
            branchesForSnapshot.push({
                branch_index: bi,
                branch_dir: branchDir,
                outputs: branchOutputsForSnapshot,
            });
        }
        try {
            assertBranchPathsUnique(allBranchResults);
        }
        catch (e) {
            if (e instanceof BranchPathError) {
                return {
                    error: `Parallel output collision in step '${stepName}': ${e.message}` +
                        AUTHORING_ERROR_DIRECTIVE,
                    action: 'STOP_WORKFLOW',
                };
            }
            throw e;
        }
        const promptsDir = join(runtimeDir, 'prompts', stepName);
        mkdirSync(promptsDir, { recursive: true });
        const promptFiles = [];
        const slimBranches = [];
        for (const branch of branches) {
            const promptContent = composeBranchPrompt(branch, stepName, runtimeDir, defnDir);
            const promptFilename = `branch_${branch.branch_index}.md`;
            const promptPath = join(promptsDir, promptFilename);
            safeWriteText(promptPath, promptContent);
            const promptRel = toPosixSlashes(pathPosix.join(relpathPosix(promptsDir), promptFilename));
            promptFiles.push(promptRel);
            const spawnPrompt = `Read \`${promptRel}\` and execute the task described in it.\n\n${branch.run_token_text}`;
            slimBranches.push({
                branch_index: branch.branch_index,
                prompt_file: promptRel,
                spawn_prompt: spawnPrompt,
                subagent_type: branch.subagent_type,
                model: branch.model,
                summary: summarizeBranchData(branch.branch_data),
                ...(branch.profile !== undefined ? { profile: branch.profile } : {}),
            });
        }
        const parallelBranches = {};
        for (let i = 0; i < branchItems.length; i += 1) {
            parallelBranches[String(i)] = {
                branch_dir: `_branch_${i}`,
                status: 'pending',
                resolved_outputs: resolvedOutputsByBranch[i] ?? [],
                ...(profileByBranch[i] !== null ? { profile: profileByBranch[i]?.id } : {}),
            };
        }
        manifest.parallel_branches = parallelBranches;
        const sd = (manifest.steps[stepName] ?? {});
        sd.prompt_files = promptFiles;
        manifest.steps[stepName] = sd;
        safeWriteJson(manifestPath, manifest);
        resetSpawnThrottleState(runtimeDir, stepName);
        createStepSnapshot(stepName, stepConfig, runtimeDir, params, branchesForSnapshot);
        const now2 = nowIsoLocal();
        const sd2 = (manifest.steps[stepName] ?? {});
        sd2.started_at = now2;
        manifest.steps[stepName] = sd2;
        manifest.updated_at = now2;
        safeWriteJson(manifestPath, manifest);
        const runIdForTrace2 = manifest.run_id ?? '';
        if (runIdForTrace2) {
            flushTraceSnapshot(runtimeDir, runIdForTrace2, manifest, stepName, workflow);
        }
        const result = {
            type: 'parallel',
            step_name: stepName,
            step_index: stepIndex,
            subagent: useSubagent,
            branch_count: slimBranches.length,
            prompt_dir: relpathPosix(promptsDir),
            branches: slimBranches,
        };
        if (activeTools.length > 0 &&
            useSubagent &&
            !isCcPerStep &&
            !isOcPerStep &&
            !isCopilotPerStep &&
            !isGeminiPerStep &&
            getEngineHost() !== 'codex') {
            result.subagent_warning =
                getEngineHost() === 'opencode'
                    ? `Per-step subagent 'riglane-${workflowName}-${stepName}' was not found in .opencode/agents/. Falling back to generic 'workflow-step', which has no per-step permission whitelist. Run riglane init-workflow ${workflowName} (then restart OpenCode) to generate it.`
                    : getEngineHost() === 'copilot'
                        ? `Per-step agent '${AGENT_PREFIX}${workflowName}-${stepName}' was not found in .github/agents/. Falling back to the generic '${WORKFLOW_STEP_AGENT}' agent, which has no whitelisted MCP tools for this step. Run ${CLI_NAME} init-workflow ${workflowName} (then restart the Copilot session) to generate it.`
                        : getEngineHost() === 'gemini'
                            ? `Per-step agent '${AGENT_PREFIX}${workflowName}-${stepName}' was not found in .gemini/agents/. Falling back to the generic '${WORKFLOW_STEP_AGENT}' agent, which has no whitelisted MCP tools for this step. Run ${CLI_NAME} init-workflow ${workflowName} (then restart the Gemini session) to generate it.`
                            : `Per-step subagent '${workflowName}-${stepName}' was not found in .claude/agents/. Falling back to generic 'workflow-step', which has no whitelisted MCP tools for this step. Run /riglane-init-workflow ${workflowName} (then restart Claude Code) to generate it.`;
        }
        if (result.subagent_warning === undefined &&
            (isCcPerStep || isOcPerStep || isCopilotPerStep || isGeminiPerStep)) {
            const missingProfiles = [
                ...new Set(profileByBranch
                    .filter((p) => p !== null)
                    .map((p) => p.id)),
            ].filter((id) => profileSubagentTypeFor(id) === null);
            if (missingProfiles.length > 0) {
                result.subagent_warning =
                    `Per-profile agent file(s) for branch profile(s) ${missingProfiles
                        .map((id) => `'${id}'`)
                        .join(', ')} of step '${stepName}' were not found. Those branches fall back to ` +
                        `the step-level agent (union tool whitelist); their prompts still document only ` +
                        `the profile subset. Run ${CLI_NAME} init-workflow ${workflowName} (then restart ` +
                        `the session) to generate them.`;
            }
        }
        {
            const _ei = composeStepBeginEngineInstructions(useSubagent, existingStatus === 'in_progress', stepName, 
            effectiveModel);
            if (_ei)
                result.engine_instructions = _ei;
        }
        return result;
    }
    const runIdForTrace = manifest.run_id ?? '';
    if (runIdForTrace) {
        flushTraceSnapshot(runtimeDir, runIdForTrace, manifest, stepName, workflow);
    }
    if (useSubagent) {
        const promptsDir = join(runtimeDir, 'prompts');
        mkdirSync(promptsDir, { recursive: true });
        const promptContent = composeBranchPrompt({
            goal: goalResolved,
            outputs_text: outputsText,
            output_schemas: outputSchemas,
            tool_docs: toolDocsBlock,
            params_text: paramsText,
            inputs: dedupedInputs,
            summaries_text: summariesText,
            spec_guidance_text: specGuidanceText,
            constraints_text: constraintsText,
            run_token_text: runTokenText,
            subagent_type: subagentType,
            model: effectiveModel,
        }, stepName, runtimeDir, defnDir);
        const promptFilename = `${stepName}.md`;
        safeWriteText(join(promptsDir, promptFilename), promptContent);
        const promptRel = toPosixSlashes(pathPosix.join(relpathPosix(promptsDir), promptFilename));
        {
            const sd = (manifest.steps[stepName] ?? {});
            sd.prompt_files = [promptRel];
            manifest.steps[stepName] = sd;
            safeWriteJson(manifestPath, manifest);
        }
        const slim = {
            type: 'regular',
            step_name: stepName,
            step_index: stepIndex,
            subagent: true,
            subagent_type: subagentType,
            model: effectiveModel,
            gate: {
                semantic: stepGateFlag((workflow.gate ?? {}), (stepConfig.gate ?? {}), 'semantic'),
                human: humanGateForBeginPayload((workflow.gate ?? {}), (stepConfig.gate ?? {})),
            },
            prompt_file: promptRel,
            spawn_prompt: `Read \`${promptRel}\` and execute the task described in it.\n\n${runTokenText}`,
        };
        if (activeTools.length > 0 &&
            !isCcPerStep &&
            !isOcPerStep &&
            !isCopilotPerStep &&
            !isGeminiPerStep &&
            getEngineHost() !== 'codex') {
            slim.subagent_warning =
                getEngineHost() === 'opencode'
                    ? `Per-step subagent 'riglane-${workflowName}-${stepName}' was not found in .opencode/agents/. Falling back to generic 'workflow-step', which has no per-step permission whitelist. Run riglane init-workflow ${workflowName} (then restart OpenCode) to generate it.`
                    : getEngineHost() === 'copilot'
                        ? `Per-step agent '${AGENT_PREFIX}${workflowName}-${stepName}' was not found in .github/agents/. Falling back to the generic '${WORKFLOW_STEP_AGENT}' agent, which has no whitelisted MCP tools for this step. Run ${CLI_NAME} init-workflow ${workflowName} (then restart the Copilot session) to generate it.`
                        : getEngineHost() === 'gemini'
                            ? `Per-step agent '${AGENT_PREFIX}${workflowName}-${stepName}' was not found in .gemini/agents/. Falling back to the generic '${WORKFLOW_STEP_AGENT}' agent, which has no whitelisted MCP tools for this step. Run ${CLI_NAME} init-workflow ${workflowName} (then restart the Gemini session) to generate it.`
                            : `Per-step subagent '${workflowName}-${stepName}' was not found in .claude/agents/. Falling back to generic 'workflow-step', which has no whitelisted MCP tools for this step. Run /riglane-init-workflow ${workflowName} (then restart Claude Code) to generate it.`;
        }
        {
            const _ei = composeStepBeginEngineInstructions(true, existingStatus === 'in_progress', stepName, effectiveModel);
            if (_ei)
                slim.engine_instructions = _ei;
        }
        return slim;
    }
    const result = {
        type: 'regular',
        step_name: stepName,
        step_index: stepIndex,
        subagent: useSubagent,
        subagent_type: subagentType,
        goal: goalResolved,
        tool_docs: toolDocsBlock,
        params_text: paramsText,
        inputs: dedupedInputs,
        outputs_text: outputsText,
        output_schemas: outputSchemas,
        summaries_text: summariesText,
        spec_guidance_text: specGuidanceText,
        constraints_text: constraintsText,
        run_token_text: runTokenText,
        is_parallel: false,
        parallel_key: null,
        model: effectiveModel,
        gate: {
            semantic: stepGateFlag((workflow.gate ?? {}), (stepConfig.gate ?? {}), 'semantic'),
            human: humanGateForBeginPayload((workflow.gate ?? {}), (stepConfig.gate ?? {})),
        },
    };
    {
        const _ei = composeStepBeginEngineInstructions(useSubagent, existingStatus === 'in_progress', stepName, effectiveModel);
        if (_ei)
            result.engine_instructions = _ei;
    }
    return result;
}
function composeNextBeginForAdvance(ctx) {
    try {
        const manifest = JSON.parse(readFileSync(ctx.manifestPath, 'utf-8'));
        if (!manifest.steps)
            manifest.steps = {};
        const stepConfig = findStepConfig(ctx.workflow, ctx.nextStep);
        if (!stepConfig)
            return null;
        const activeSeq = resolveActiveSequence(ctx.workflow, manifest);
        let stepIndex = activeSeq
            .map((s) => s.name ?? '')
            .indexOf(ctx.nextStep);
        if (stepIndex < 0)
            stepIndex = 0;
        const modelOverride = isModelMode(manifest.model_override)
            ? manifest.model_override
            : undefined;
        const effectiveModel = modelOverride ?? (stepConfig.model ?? null);
        const existingStatus = manifest.steps[ctx.nextStep]
            ?.status;
        const payload = composeStepBeginPayload({
            workflowName: ctx.workflowName,
            stepName: ctx.nextStep,
            workflow: ctx.workflow,
            defnDir: ctx.defnDir,
            runtimeDir: ctx.runtimeDir,
            manifestPath: ctx.manifestPath,
            manifest,
            stepConfig,
            activeSeq,
            stepIndex,
            effectiveModel,
            existingStatus,
            paths: ctx.paths,
        });
        if (payload.error !== undefined)
            return null;
        const stepData = (manifest.steps[ctx.nextStep] ?? {});
        stepData.composite_begun = true;
        manifest.steps[ctx.nextStep] = stepData;
        safeWriteJson(ctx.manifestPath, manifest);
        return payload;
    }
    catch {
        return null;
    }
}
function composeRetryBegin(ctx) {
    try {
        const manifestPath = join(ctx.runtimeDir, 'manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (!manifest.steps)
            manifest.steps = {};
        const stepConfig = findStepConfig(ctx.workflow, ctx.stepName);
        if (!stepConfig)
            return null;
        const activeSeq = resolveActiveSequence(ctx.workflow, manifest);
        const params = (manifest.params ?? {});
        const modelOverride = isModelMode(manifest.model_override)
            ? manifest.model_override
            : undefined;
        const effectiveModel = modelOverride ?? (stepConfig.model ?? null);
        const mat = composeStepMaterial({
            workflowName: ctx.workflowName,
            stepName: ctx.stepName,
            workflow: ctx.workflow,
            defnDir: ctx.defnDir,
            runtimeDir: ctx.runtimeDir,
            manifestPath,
            manifest,
            stepConfig,
            activeSeq,
            stepIndex: 0,
            effectiveModel,
            existingStatus: undefined,
            paths: ctx.paths,
        }, params);
        if ('error' in mat)
            return null;
        if (!mat.useSubagent)
            return null;
        const promptsDir = join(ctx.runtimeDir, 'prompts');
        mkdirSync(promptsDir, { recursive: true });
        const promptContent = composeBranchPrompt({
            goal: mat.goalResolved,
            outputs_text: mat.outputsText,
            output_schemas: mat.outputSchemas,
            tool_docs: mat.toolDocsBlock,
            params_text: mat.paramsText,
            inputs: mat.dedupedInputs,
            summaries_text: mat.summariesText,
            spec_guidance_text: mat.specGuidanceText,
            constraints_text: mat.constraintsText,
            run_token_text: mat.runTokenText,
            subagent_type: mat.subagentType,
            model: effectiveModel,
        }, ctx.stepName, ctx.runtimeDir, ctx.defnDir) +
            `\n\n## Retry Feedback — attempt ${ctx.attempt} of ${ctx.maxAttempts}\n\n` +
            `Your PREVIOUS attempt FAILED the structural gate. Fix EXACTLY the problems below ` +
            `and rewrite the declared output file(s) in full (complete files, not patches):\n` +
            ctx.details.map((d) => `- ${d}`).join('\n') +
            '\n';
        const promptFilename = `${ctx.stepName}.md`;
        safeWriteText(join(promptsDir, promptFilename), promptContent);
        const promptRel = toPosixSlashes(pathPosix.join(relpathPosix(promptsDir), promptFilename));
        return {
            prompt_file: promptRel,
            spawn_prompt: `Read \`${promptRel}\` and execute the task described in it.\n\n${mat.runTokenText}`,
            subagent_type: mat.subagentType,
            model: effectiveModel,
            gate: {
                semantic: stepGateFlag((ctx.workflow.gate ?? {}), (stepConfig.gate ?? {}), 'semantic'),
                human: humanGateForBeginPayload((ctx.workflow.gate ?? {}), (stepConfig.gate ?? {})),
            },
        };
    }
    catch {
        return null;
    }
}
export function toolStepBegin(args, paths = defaultPaths(), overrides) {
    const workflowName = args.name ||
        args.workflow_name;
    const stepName = args.step ||
        args.step_name;
    if (typeof workflowName !== 'string' || !workflowName) {
        return {
            error: "step_begin: missing required parameter 'name' (workflow name). " +
                "Pass `name: \"<workflow>\"` (or alias `workflow_name`).",
        };
    }
    if (typeof stepName !== 'string' || !stepName) {
        return {
            error: "step_begin: missing required parameter 'step' (step name). " +
                "Pass `step: \"<step>\"` (or alias `step_name`).",
        };
    }
    const { runtimeDir: runtimeDirOverride, workflowYamlPath: yamlPathOverride } = normalizeRunOverrides(overrides);
    let defnDir;
    let workflow;
    if (yamlPathOverride !== null) {
        try {
            workflow = loadYaml(yamlPathOverride);
            normalizePerIterationOutputs(workflow);
            injectSpecAuthoringOutputs(workflow);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { error: `step_begin: failed to load workflow from '${yamlPathOverride}': ${msg}` };
        }
        defnDir = dirname(yamlPathOverride);
    }
    else {
        ({ definitionDir: defnDir, workflow } = resolveWorkflow(workflowName, paths));
    }
    const runtimeDir = runtimeDirOverride ?? resolveRunRuntimeDir(paths, workflowName);
    const manifestPath = join(runtimeDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (!manifest.steps)
        manifest.steps = {};
    const _ownBegin = checkRunOwnership(manifest, 'step_begin');
    if (_ownBegin)
        return _ownBegin;
    const stepConfig = findStepConfig(workflow, stepName);
    const activeSeq = resolveActiveSequence(workflow, manifest);
    const activeNames = activeSeq.map((s) => s.name ?? '');
    let stepIndex = activeNames.indexOf(stepName);
    if (stepIndex < 0)
        stepIndex = 0;
    if (!stepConfig) {
        return { error: `Step '${stepName}' not found in workflow '${workflowName}'` };
    }
    const modelOverride = isModelMode(manifest.model_override)
        ? manifest.model_override
        : undefined;
    const effectiveModel = modelOverride ?? (stepConfig.model ?? null);
    const _laneCursors = admissibleLaneCursors(manifest);
    if (_laneCursors.length > 0) {
        const hit = _laneCursors.find((c) => c.cursor === stepName);
        if (!hit) {
            const liveList = _laneCursors
                .map((c) => `lane '${c.laneId}' (fork '${c.forkStep}') → next step '${c.cursor}'`)
                .join('; ');
            return {
                error: `Cannot begin step '${stepName}': parallel lanes are ACTIVE and it is not any ` +
                    `live lane's next step. Live lanes: ${liveList}. The workflow continues past the ` +
                    `fork only after EVERY lane reaches a terminal state (the engine then returns ` +
                    `the cursor itself).` +
                    `\n\nORCHESTRATOR DIRECTIVE: Do NOT retry this call. Drive the live lanes — ` +
                    `begin any of the listed lane steps (they may run concurrently; spawn ` +
                    `independent lane subagents in one message).`,
                action: 'BLOCKED_LANES_ACTIVE',
                step: stepName,
                requested_step: stepName,
                live_lanes: _laneCursors.map((c) => ({
                    lane_id: c.laneId,
                    fork_step: c.forkStep,
                    next_step: c.cursor,
                })),
            };
        }
        const hitEntry = laneStateOf(manifest, hit.forkStep)?.lanes[hit.laneId];
        if (hitEntry && hitEntry.status === 'failed')
            hitEntry.status = 'running';
    }
    const cursorStep = manifest.current_step ?? '';
    if (_laneCursors.length === 0 && cursorStep && cursorStep !== stepName) {
        const cursorIdx = activeNames.indexOf(cursorStep);
        const reqIdx = activeNames.indexOf(stepName);
        if (cursorIdx < 0) {
            // eslint-disable-next-line no-console
            console.error(`[workflow-engine] Warning: manifest cursor '${cursorStep}' not found in the ` +
                `active sequence — skipping step-order enforcement`);
        }
        else if (reqIdx > cursorIdx) {
            const _bug077PrevConfig = activeSeq[cursorIdx] ?? null;
            const _bug077Gr = readGateResultForStep(runtimeDir, cursorStep);
            if (_bug077Gr !== null) {
                const _check = checkStepFailureBlocked(_bug077Gr, _bug077PrevConfig, workflow, manifest);
                if (_check.blocked) {
                    return {
                        error: `Cannot begin step '${stepName}': previous step '${cursorStep}' ` +
                            `has unresolved failures (reason: ${_check.reason}). Resolve the ` +
                            `previous step via re-spawn/retry first, or abort the run.`,
                        action: 'BLOCKED_PARTIAL_FAILURE',
                        step: stepName,
                        previous_step: cursorStep,
                        blocked_reason: _check.reason,
                        failed_branches: _check.failedBranches,
                    };
                }
            }
            const _cursorData = manifest.steps?.[cursorStep];
            const cursorStatus = _cursorData?.status ?? 'pending';
            const directive = cursorStatus === 'pending' || _cursorData?.composite_begun === true
                ? `Call step_begin for '${cursorStep}' instead — it has not been executed yet. Steps cannot be skipped.`
                : `If step '${cursorStep}' has finished its work, call step_complete for '${cursorStep}' FIRST — it validates outputs, applies param_bindings, and advances the cursor. Then begin the step it returns in 'next_step'.`;
            return {
                error: `Cannot begin step '${stepName}': the workflow cursor is at step ` +
                    `'${cursorStep}' (status: ${cursorStatus}). Steps run only in ` +
                    `engine-approved order; skipping steps or step_complete silently ` +
                    `loses validations and param_bindings.` +
                    `\n\nORCHESTRATOR DIRECTIVE: Do NOT retry this call as-is. ${directive}`,
                action: 'BLOCKED_OUT_OF_ORDER',
                step: stepName,
                requested_step: stepName,
                expected_step: cursorStep,
                previous_step: cursorStep,
            };
        }
        else if (reqIdx < 0) {
            return {
                error: `Cannot begin step '${stepName}': it is not the current step and not part of the ` +
                    `active sequence (the cursor is at '${cursorStep}'). The engine admits only the ` +
                    `cursor step — route steps become available only after the engine selects their ` +
                    `route (ENTER_ROUTE).` +
                    `\n\nORCHESTRATOR DIRECTIVE: Do NOT retry. Begin '${cursorStep}' (or call ` +
                    `step_complete for it). Routing/repetition is engine-owned control flow.`,
                action: 'BLOCKED_OUT_OF_ORDER',
                step: stepName,
                requested_step: stepName,
                expected_step: cursorStep,
            };
        }
        else {
            return {
                error: `Cannot begin step '${stepName}': it is BEFORE the workflow cursor ` +
                    `('${cursorStep}'). Re-running earlier steps on orchestrator ` +
                    `initiative is not permitted — repetition is engine-owned control flow.` +
                    `\n\nORCHESTRATOR DIRECTIVE: Do NOT retry this call. Continue with ` +
                    `step '${cursorStep}'. If earlier work must be redone, STOP and ` +
                    `report to the user; a fresh run can be started with workflow_init.`,
                action: 'BLOCKED_OUT_OF_ORDER',
                step: stepName,
                requested_step: stepName,
                expected_step: cursorStep,
            };
        }
    }
    const existingStatus = manifest.steps?.[stepName]?.status;
    if (existingStatus === 'completed') {
        return {
            error: `Cannot begin step '${stepName}': it is already completed. Re-running ` +
                `completed steps in place is not permitted.` +
                `\n\nORCHESTRATOR DIRECTIVE: If all steps are done, call ` +
                `workflow_finalize. For a fresh run, call workflow_init.`,
            action: 'BLOCKED_OUT_OF_ORDER',
            step: stepName,
            requested_step: stepName,
            expected_step: cursorStep || stepName,
        };
    }
    let existingStatusForNote = existingStatus;
    {
        const _sd = manifest.steps[stepName];
        if (_sd && _sd.composite_begun === true) {
            delete _sd.composite_begun;
            delete _sd.started_at;
            delete _sd.first_started_at;
            deleteSnapshot(runtimeDir, stepName);
            existingStatusForNote = undefined;
        }
    }
    return composeStepBeginPayload({
        workflowName,
        stepName,
        workflow,
        defnDir,
        runtimeDir,
        manifestPath,
        manifest,
        stepConfig,
        activeSeq,
        stepIndex,
        effectiveModel,
        existingStatus: existingStatusForNote,
        paths,
    });
}
function recordLoopTraceEvent(runtimeDir, _runId, stepOrder, toIdx, fromIdx, event) {
    const tracePath = join(runtimeDir, 'trace.json');
    withTraceLock(tracePath, () => {
        try {
            const trace = JSON.parse(readFileSync(tracePath, 'utf-8'));
            const rangeNames = new Set();
            for (let j = Math.max(0, toIdx); j <= fromIdx; j += 1) {
                const n = stepOrder[j];
                if (n)
                    rangeNames.add(n);
            }
            for (const s of trace.steps ?? []) {
                if (!rangeNames.has(s.name) || s.loop_archived === true)
                    continue;
                s.loop_phase = event.phase;
                if (event.kind === 'loop_back')
                    s.loop_archived = true;
            }
            if (!Array.isArray(trace.loop_events))
                trace.loop_events = [];
            trace.loop_events.push({
                ...event,
                to_index: toIdx,
                from_index: fromIdx,
                range: [...rangeNames],
                at: nowIsoLocal(),
            });
            safeWriteJson(tracePath, trace);
        }
        catch {
        }
    });
}
function recordRouteTraceEvent(runtimeDir, _runId, event) {
    const tracePath = join(runtimeDir, 'trace.json');
    withTraceLock(tracePath, () => {
        try {
            const trace = JSON.parse(readFileSync(tracePath, 'utf-8'));
            if (!Array.isArray(trace.route_events))
                trace.route_events = [];
            trace.route_events.push({ ...event, at: nowIsoLocal() });
            safeWriteJson(tracePath, trace);
        }
        catch {
        }
    });
}
function recordLaneTraceEvent(runtimeDir, _runId, event) {
    const tracePath = join(runtimeDir, 'trace.json');
    withTraceLock(tracePath, () => {
        try {
            const trace = JSON.parse(readFileSync(tracePath, 'utf-8'));
            if (!Array.isArray(trace.lane_events))
                trace.lane_events = [];
            trace.lane_events.push({ ...event, at: nowIsoLocal() });
            safeWriteJson(tracePath, trace);
        }
        catch {
        }
    });
}
function flushTraceSnapshot(runtimeDir, _runId, manifest, stepName, workflow) {
    const tracePath = join(runtimeDir, 'trace.json');
    const traceLockFd = acquireTraceLockOrNull(tracePath);
    try {
        let trace;
        try {
            trace = JSON.parse(readFileSync(tracePath, 'utf-8'));
        }
        catch (readErr) {
            const reason = readErr instanceof Error ? readErr.message : String(readErr);
            logEngine(`trace.json unreadable (${reason}) — rebuilding a recovery skeleton`);
            trace = {
                trace_version: 1,
                workflow: manifest.workflow ?? null,
                run_id: _runId,
                steps: [],
                trace_recovered: { at: nowIsoLocal(), reason },
            };
        }
        if (!Array.isArray(trace.steps))
            trace.steps = [];
        let stepEntry = trace.steps.find((s) => s.name === stepName && s.loop_archived !== true);
        if (!stepEntry) {
            const wfSteps = (workflow.steps ?? []);
            let stepIndex = -1;
            for (let i = 0; i < wfSteps.length; i++) {
                if (wfSteps[i].name === stepName) {
                    stepIndex = i;
                    break;
                }
            }
            let stepConfig = stepIndex >= 0 ? (wfSteps[stepIndex] ?? {}) : {};
            if (stepIndex < 0) {
                for (const s of collectAllSteps(workflow)) {
                    if (s.name === stepName) {
                        stepConfig = s;
                        break;
                    }
                }
                const mstepAll = (manifest.steps ??
                    {})[stepName];
                const mstepRoute = mstepAll?.route;
                const mstepLane = mstepAll?.lane;
                if (mstepRoute?.owner_step !== undefined || mstepLane?.fork_step === undefined) {
                    const ownerName = mstepRoute?.owner_step;
                    const ownerCard = ownerName ? trace.steps.find((s) => s.name === ownerName) : undefined;
                    const ownerIdx = typeof ownerCard?.index === 'number' ? ownerCard.index : trace.steps.length;
                    const siblings = trace.steps.filter((s) => typeof s.index === 'number' && s.index > ownerIdx && s.index < ownerIdx + 1).length;
                    stepIndex = ownerIdx + 0.001 * (siblings + 1);
                }
                else {
                    const forkCard = trace.steps.find((s) => s.name === mstepLane.fork_step);
                    const forkIdx = typeof forkCard?.index === 'number' ? forkCard.index : trace.steps.length;
                    stepIndex = forkIdx + 0.001 * ((mstepLane.lane_no ?? 0) + 1) + 0.00001 * ((mstepLane.pos ?? 0) + 1);
                }
            }
            stepEntry = {
                name: stepName,
                index: stepIndex,
                status: 'in_progress',
                config: {
                    spec_check: 'spec_check' in stepConfig ? stepConfig.spec_check : false,
                    ...('spec_authoring' in stepConfig
                        ? { spec_authoring: stepConfig.spec_authoring }
                        : {}),
                    subagent: 'subagent' in stepConfig ? stepConfig.subagent : true,
                    gate: stepConfig.gate ?? null,
                },
                goal: stepConfig.goal ?? null,
                invocations: [],
                retry_count: 0,
            };
            if ('delegate_to' in stepConfig) {
                stepEntry.delegate_to = stepConfig.delegate_to;
            }
            trace.steps.push(stepEntry);
        }
        const mstep = (manifest.steps ??
            {})[stepName] ?? {};
        if (mstep.status)
            stepEntry.status = mstep.status;
        if (stepEntry.awaiting_human && mstep.status && mstep.status !== 'in_progress') {
            delete stepEntry.awaiting_human;
        }
        if (mstep.started_at)
            stepEntry.started_at = mstep.started_at;
        if (mstep.completed_at)
            stepEntry.completed_at = mstep.completed_at;
        if (mstep.duration_ms != null)
            stepEntry.duration_ms = mstep.duration_ms;
        if (mstep.summary)
            stepEntry.summary = mstep.summary;
        if (mstep.tool_warnings)
            stepEntry.tool_warnings = mstep.tool_warnings;
        if (mstep.route)
            stepEntry.route = mstep.route;
        if (mstep.lane)
            stepEntry.lane = mstep.lane;
        if (mstep.planning) {
            stepEntry.planning = { ...mstep.planning };
            const planning = mstep.planning;
            const childWfPath = planning.child_workflow_path;
            const childRunId = planning.child_run_id;
            if (typeof childWfPath === 'string' && childWfPath.length > 0 &&
                typeof childRunId === 'string' && childRunId.length > 0) {
                const childTracePath = join(dirname(childWfPath), 'trace.json');
                stepEntry.child_trace_path = childTracePath;
                try {
                    const childTrace = JSON.parse(readFileSync(childTracePath, 'utf-8'));
                    stepEntry._embedded_child_trace = childTrace;
                }
                catch {
                }
            }
        }
        if (mstep.delegation) {
            stepEntry.delegation = { ...mstep.delegation };
            const delegChildRunId = mstep.delegation.child_run_id;
            if (typeof delegChildRunId === 'string' && delegChildRunId.length > 0) {
                const childTracePath = join(dirname(runtimeDir), delegChildRunId, 'trace.json');
                stepEntry.child_trace_path = childTracePath;
                try {
                    const childTrace = JSON.parse(readFileSync(childTracePath, 'utf-8'));
                    stepEntry._embedded_child_trace = childTrace;
                }
                catch {
                }
            }
        }
        let totalMsgs = 0;
        let totalTools = 0;
        const allFiles = new Set();
        let totalStepDuration = 0;
        for (const s of trace.steps) {
            const invs = (s.invocations ?? []);
            for (const inv of invs) {
                totalMsgs += inv.message_count ?? 0;
                totalTools += inv.tool_call_count ?? 0;
                for (const fp of inv.modified_files ?? [])
                    allFiles.add(fp);
            }
            totalStepDuration += s.duration_ms ?? 0;
        }
        trace.total_messages = totalMsgs;
        trace.total_tool_calls = totalTools;
        trace.total_modified_files = allFiles.size;
        trace.total_step_duration_ms = totalStepDuration;
        if (manifest.params)
            trace.params = manifest.params;
        trace.steps.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
        safeWriteJson(tracePath, trace);
        const bridgeParentRunId = manifest.parent_run_id;
        const bridgeParentStep = manifest.parent_step;
        if (typeof bridgeParentRunId === 'string' &&
            bridgeParentRunId.length > 0 &&
            typeof bridgeParentStep === 'string' &&
            bridgeParentStep.length > 0) {
            try {
                const parentTracePath = join(dirname(runtimeDir), bridgeParentRunId, 'trace.json');
                withTraceLock(parentTracePath, () => {
                    const parentTrace = JSON.parse(readFileSync(parentTracePath, 'utf-8'));
                    const card = (parentTrace.steps ?? []).find((s) => s.name === bridgeParentStep && s.loop_archived !== true);
                    if (card) {
                        card._embedded_child_trace = trace;
                        safeWriteJson(parentTracePath, parentTrace);
                    }
                });
            }
            catch {
            }
        }
    }
    catch (e) {
        logEngine(`flushTraceSnapshot failed for step '${stepName}': ${e instanceof Error ? e.message : String(e)}`);
    }
    finally {
        if (traceLockFd !== null)
            releaseFileLock(traceLockFd, `${tracePath}.lock`);
    }
}
function composeSpecClauseForSemanticGate(stepConfig, domains = [], scopeHint) {
    const specCheckVal = 'spec_check' in stepConfig ? stepConfig.spec_check : false;
    if (!specCheckVal)
        return '';
    const domainHint = domains.length > 0
        ? ` Recorded domains (reuse one; spec_search(domain:<name>) returns its complete set): ${domains.map((d) => d.name).join(', ')}.`
        : '';
    const hint = typeof scopeHint === 'string' && scopeHint.trim() ? scopeHint.trim() : null;
    const coverageHint = hint ? ` Active scope coverage: ${hint} — keep the check within it.` : '';
    return `\n\nADDITIONALLY (spec_check enabled): cross-check the changes against behavioral specs. Identify specs relevant to the AREA changed via spec_search — the domain filter is the reliable path (exact/prefix); applies_to and ${PRODUCT_DIR}/specs/<scope>/_registry.json are hints, not the only channel.${domainHint}${coverageHint} Read the relevant specs and verify the modified files honor each spec's Rule Statement. If any compliance violation is found → RETRY_STEP with the violation details so the implementer can fix them.`;
}
function resolveConsumptionDomains(paths) {
    try {
        const root = dirname(paths.agentDir);
        return composeDomainsEcho(scopeResolveActiveScope(null, root)[0], root);
    }
    catch {
        return [];
    }
}
function resolveConsumptionScopeHint(paths) {
    try {
        const root = dirname(paths.agentDir);
        return scopeGetScopeHint(scopeResolveActiveScope(null, root)[0], root);
    }
    catch {
        return null;
    }
}
const HUMAN_GATE_INSTRUCTIONS = instruction('engine/gate-human');
const INBOX_GATE_INSTRUCTIONS = instruction('engine/gate-inbox');
const BOTH_CHANNELS_NOTE = instruction('engine/gate-both-channels-note');
function resolvesStepHuman(wfGate, step) {
    const g = (step.gate ?? {});
    return Object.prototype.hasOwnProperty.call(g, 'human')
        ? Boolean(g.human)
        : Boolean(wfGate.human);
}
export function workflowMayNeedExternalChannel(workflow) {
    const wfGate = (workflow.gate ?? {});
    for (const step of collectAllSteps(workflow)) {
        const gate = (step.gate ?? {});
        if (resolveHumanChannel(wfGate, gate) !== 'terminal' && resolvesStepHuman(wfGate, step))
            return true;
        for (const key of ['loop_back', 'routes']) {
            const when = (step[key]?.when ?? {});
            if (when.human === true && isExternalChannel(when.human_channel))
                return true;
        }
    }
    return false;
}
function evaluateHumanGate(wfGate, stepGate, stepName, runtimeDir) {
    const cfg = humanGateConfig(wfGate, stepGate);
    if (typeof cfg === 'boolean')
        return { required: cfg };
    const manifestPath = join(runtimeDir, 'manifest.json');
    let manifest = null;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    }
    catch {
        manifest = null;
    }
    const steps = (manifest?.steps ?? {});
    const recorded = steps[stepName]?.human_gate_verdict;
    if (recorded && typeof recorded.required === 'boolean') {
        return { required: recorded.required };
    }
    const proc = spawnSync(cfg.script, {
        shell: true,
        encoding: 'utf-8',
        timeout: 60_000,
        env: deciderEnv(runtimeDir),
    });
    if (proc.error || proc.status !== 0) {
        const detail = proc.error
            ? proc.error.message
            : `exit code ${proc.status}; stderr: ${(proc.stderr ?? '').slice(0, 500)}`;
        return {
            error: `gate.human script failed (${detail}). The script must exit 0 and print {"human": true|false} to stdout.`,
        };
    }
    let required;
    try {
        const parsed = JSON.parse((proc.stdout ?? '').trim());
        if (typeof parsed.human !== 'boolean')
            throw new Error('missing boolean "human" field');
        required = parsed.human;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            error: `gate.human script printed invalid output (${msg}). Expected JSON {"human": true|false} on stdout; got: ${(proc.stdout ?? '').slice(0, 200)}`,
        };
    }
    if (manifest) {
        const stepsObj = (manifest.steps ?? {});
        const entry = stepsObj[stepName] ?? {};
        entry.human_gate_verdict = {
            required,
            decided_by: 'script',
            evaluated_at: new Date().toISOString(),
        };
        stepsObj[stepName] = entry;
        manifest.steps = stepsObj;
        try {
            safeWriteJson(manifestPath, manifest);
        }
        catch {
        }
    }
    return { required };
}
function humanGateForBeginPayload(wfGate, stepGate) {
    const cfg = humanGateConfig(wfGate, stepGate);
    return typeof cfg === 'boolean' ? cfg : 'conditional';
}
function appendHumanGateInstructions(existing, channel = 'terminal') {
    const block = channel === 'terminal'
        ? HUMAN_GATE_INSTRUCTIONS
        : channel === 'both'
            ? `${INBOX_GATE_INSTRUCTIONS}\n\n${BOTH_CHANNELS_NOTE}`
            : INBOX_GATE_INSTRUCTIONS;
    return typeof existing === 'string' && existing.length > 0 ? `${existing}\n\n${block}` : block;
}
import { branchOutputsFromResolved, loadSnapshot as loadStepSnapshot, narrowOutputsForBranch, validateOutputs as validateStepOutputs } from './output-validator.js';
function autoFailBudgetExhaustedRun(workflowName, stepName, manifestPath, details, 
finalizeOverrides, paths) {
    try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        manifest.stopped = {
            step: stepName,
            reason: 'step_budget_exhausted',
            details,
            at: nowIsoLocal(),
        };
        manifest.updated_at = nowIsoLocal();
        safeWriteJson(manifestPath, manifest);
    }
    catch {
    }
    try {
        toolWorkflowFinalize({ name: workflowName }, paths, finalizeOverrides);
    }
    catch {
    }
}
function runInlineGateValidation(workflowName, stepName, runtimeDir, manifestPath, resultPath, yamlPathOverride, paths, finalizeOverrides = {}) {
    let workflow;
    let definitionDir;
    try {
        if (typeof yamlPathOverride === 'string' && yamlPathOverride.length > 0) {
            workflow = loadYaml(yamlPathOverride);
            normalizePerIterationOutputs(workflow);
            injectSpecAuthoringOutputs(workflow);
            definitionDir = dirname(yamlPathOverride);
        }
        else {
            const resolved = resolveWorkflow(workflowName, paths);
            workflow = resolved.workflow;
            definitionDir = resolved.definitionDir;
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            error: `inline gate: failed to resolve workflow '${workflowName}': ${msg}`,
            action: 'STOP_WORKFLOW',
        };
    }
    const stepConfig = findStepConfig(workflow, stepName);
    if (!stepConfig) {
        return {
            error: `inline gate: step '${stepName}' not found in workflow '${workflowName}'.`,
            action: 'STOP_WORKFLOW',
        };
    }
    let manifest = {};
    let stepStartedAt = null;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const steps = (manifest.steps ?? {});
        const stepData = steps[stepName] ?? {};
        stepStartedAt =
            stepData.first_started_at ??
                stepData.started_at ??
                null;
    }
    catch {
    }
    const snapshot = loadStepSnapshot(runtimeDir, stepName);
    const outputs = (stepConfig.outputs ?? []);
    const parallelBranches = manifest.parallel_branches;
    let result;
    let gateResultExtra = {};
    const structuralEnabled = resolveStructuralGate(workflow.gate, stepConfig.gate);
    if (!structuralEnabled) {
        if (parallelBranches && Object.keys(parallelBranches).length > 0) {
            const branchResults = [];
            for (const biStr of Object.keys(parallelBranches)) {
                const bi = Number.parseInt(biStr, 10);
                if (!Number.isFinite(bi))
                    continue;
                branchResults.push({
                    branch_index: bi,
                    passed: true,
                    checks: 0,
                    failures: 0,
                    details: [STRUCTURAL_GATE_DISABLED_DETAIL],
                });
            }
            result = { passed: true, checks: 0, failures: 0, details: [STRUCTURAL_GATE_DISABLED_DETAIL] };
            gateResultExtra = { branch_results: branchResults };
        }
        else {
            result = { passed: true, checks: 0, failures: 0, details: [STRUCTURAL_GATE_DISABLED_DETAIL] };
        }
    }
    else if (parallelBranches && Object.keys(parallelBranches).length > 0) {
        const branchResults = [];
        let totalChecks = 0;
        let totalFailures = 0;
        const allDetails = [];
        const sortedKeys = Object.keys(parallelBranches).sort((a, b) => {
            const na = Number.parseInt(a, 10);
            const nb = Number.parseInt(b, 10);
            if (Number.isFinite(na) && Number.isFinite(nb))
                return na - nb;
            return a.localeCompare(b);
        });
        for (const biStr of sortedKeys) {
            const bi = Number.parseInt(biStr, 10);
            const branchResolved = parallelBranches[biStr]?.resolved_outputs;
            const narrowed = branchResolved && branchResolved.length > 0
                ? branchOutputsFromResolved(outputs, branchResolved)
                : narrowOutputsForBranch(outputs, bi);
            const r = validateStepOutputs(narrowed, definitionDir, runtimeDir, {
                snapshot,
                stepStartedAt,
                branchFilter: { branch_index: bi, branch_dir: `_branch_${bi}` },
                params: (manifest.params ?? null),
            });
            branchResults.push({
                branch_index: bi,
                passed: r.passed,
                checks: r.checks,
                failures: r.failures,
                details: [...r.details],
            });
            totalChecks += r.checks;
            totalFailures += r.failures;
            for (const d of r.details)
                allDetails.push(`[branch ${bi}] ${d}`);
        }
        const failedBranches = branchResults
            .filter((br) => !br.passed)
            .map((br) => br.branch_index);
        let aggPassed;
        if (failedBranches.length === 0)
            aggPassed = true;
        else if (failedBranches.length === branchResults.length)
            aggPassed = false;
        else
            aggPassed = true;
        result = { passed: aggPassed, checks: totalChecks, failures: totalFailures, details: allDetails };
        gateResultExtra = { branch_results: branchResults };
        if (failedBranches.length > 0)
            gateResultExtra.failed_branches = failedBranches;
    }
    else {
        result = validateStepOutputs(outputs, definitionDir, runtimeDir, {
            snapshot,
            stepStartedAt,
            params: (manifest.params ?? null),
        });
    }
    const runToken = manifest.run_token ?? '';
    const validatedAt = nowIsoLocal();
    const branchResultsForLedger = gateResultExtra.branch_results;
    try {
        mkdirSync(dirname(resultPath), { recursive: true });
        lockedJsonReadModifyWriteSync(resultPath, (prev) => {
            const ledger = ledgerForStep(prev, stepName, runToken);
            if (branchResultsForLedger && branchResultsForLedger.length > 0) {
                for (const br of branchResultsForLedger) {
                    const existing = ledger.branches[String(br.branch_index)];
                    upsertBranch(ledger, {
                        branchIndex: br.branch_index,
                        passed: br.passed,
                        checks: br.checks,
                        failures: br.failures,
                        details: br.details,
                        loopCount: existing?.loop_count ?? 0,
                        validatedAt,
                        source: 'engine-inline',
                    });
                }
                recomputeAggregate(ledger);
            }
            else {
                const prevLedger = prev;
                const prevTop = prevLedger?.step === stepName ? (prevLedger?.loop_count ?? 0) : 0;
                ledger.branches = {};
                ledger.passed = result.passed;
                ledger.checks = result.checks;
                ledger.failures = result.failures;
                ledger.details = [...result.details];
                ledger.loop_count = prevTop;
                delete ledger.branch_results;
            }
            ledger.source = 'engine-inline';
            return ledger;
        });
    }
    catch {
    }
    const wfGate = (workflow.gate ?? {});
    const stepGateLookup = (stepConfig.gate ?? {});
    if (result.passed) {
        const semantic = stepGateFlag(wfGate, stepGateLookup, 'semantic');
        const humanEval = evaluateHumanGate(wfGate, stepGateLookup, stepName, runtimeDir);
        if ('error' in humanEval) {
            return {
                error: humanEval.error,
                action: 'STOP_WORKFLOW',
            };
        }
        const human = humanEval.required;
        const inlineResult = {
            passed: true,
            step: stepName,
            action: 'PROCEED',
            checks: result.checks,
            details: [...result.details],
            needs_semantic_gate: semantic,
            needs_human_gate: human,
            source: 'engine-inline',
            ...gateResultExtra,
        };
        if (semantic) {
            const isPlanning = stepConfig && stepConfig.type === 'planning';
            const baseInstr = isPlanning
                ? 'SEMANTIC GATE — evaluate planning step: Did all substeps complete? Is the goal fully achieved? If yes → step_complete. If approach could improve → step_complete + agent_notes. If goal NOT achieved → call workflow_replan_dynamic(parent_workflow, parent_step) to reset phase, then draft a fix workflow targeting the gaps (Steps 1-5 again). Substeps are idempotent.'
                : 'SEMANTIC GATE — evaluate step output: Read output files. Does quality match the goal? If satisfactory → step_complete. If imperfect but acceptable → step_complete + note issues in summary. If wrong/incomplete → RETRY_STEP with feedback.';
            const specClause = composeSpecClauseForSemanticGate(stepConfig, resolveConsumptionDomains(paths), resolveConsumptionScopeHint(paths));
            inlineResult.engine_instructions = baseInstr + specClause;
        }
        if (human) {
            inlineResult.engine_instructions = appendHumanGateInstructions(inlineResult.engine_instructions, resolveHumanChannel(wfGate, stepGateLookup));
        }
        return inlineResult;
    }
    const maxStepRetries = (() => {
        if (Object.prototype.hasOwnProperty.call(stepGateLookup, 'max_step_retries')) {
            return Number(stepGateLookup.max_step_retries) || 3;
        }
        if (Object.prototype.hasOwnProperty.call(wfGate, 'max_step_retries')) {
            return Number(wfGate.max_step_retries) || 3;
        }
        return 3;
    })();
    let stepRetryCount = 0;
    try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const steps = (manifest.steps ?? {});
        const stepData = steps[stepName] ?? {};
        stepRetryCount = (stepData.step_retry_count ?? 0) + 1;
        stepData.step_retry_count = stepRetryCount;
        manifest.updated_at = nowIsoLocal();
        safeWriteJson(manifestPath, manifest);
    }
    catch {
    }
    if (stepRetryCount > maxStepRetries) {
        autoFailBudgetExhaustedRun(workflowName, stepName, manifestPath, `Step '${stepName}' exhausted retry budget (${stepRetryCount}/${maxStepRetries}).`, finalizeOverrides, paths);
        return {
            passed: false,
            step: stepName,
            action: 'STOP_WORKFLOW',
            checks: result.checks,
            failures: result.failures,
            details: [...result.details],
            loop_count: 0,
            max_step_retries: maxStepRetries,
            step_retry_count: stepRetryCount,
            source: 'engine-inline',
            run_failed: true,
            error: `Step '${stepName}' exhausted retry budget (${stepRetryCount}/${maxStepRetries}). ` +
                `The engine has already finalized this run as FAILED (manifest carries a ` +
                `'stopped' block) — do NOT call workflow_finalize and do NOT retry. ` +
                `Surface this to the user; recovery is a fresh run.`,
        };
    }
    const retryBegin = composeRetryBegin({
        workflowName,
        workflow,
        defnDir: definitionDir,
        runtimeDir,
        stepName,
        paths,
        details: result.details,
        attempt: stepRetryCount,
        maxAttempts: maxStepRetries,
    });
    return {
        passed: false,
        step: stepName,
        action: 'RETRY_STEP',
        checks: result.checks,
        failures: result.failures,
        details: [...result.details],
        loop_count: 0,
        max_step_retries: maxStepRetries,
        step_retry_count: stepRetryCount,
        source: 'engine-inline',
        ...(getEngineHost() === 'opencode'
            ? {
                engine_instructions: `RETRY (${stepRetryCount}/${maxStepRetries}): re-invoke the task tool with ` +
                    `subagent_type '${opencodeSubagentTypeFor(workflowName, stepName, dirname(paths.agentDir))}' AND the ` +
                    `SAME task_id from the previous task result so the subagent resumes with its ` +
                    `context; relay the validation failures above to it. This consumes the step ` +
                    `retry budget (the gate hook did not run for this attempt, so there is no ` +
                    `in-session gate counter).` +
                    (retryBegin !== null
                        ? ` If the previous task session is gone, spawn a FRESH task from retry_begin's ` +
                            `spawn_prompt verbatim (its prompt file already ends with the retry feedback).`
                        : ''),
            }
            : getEngineHost() === 'gemini'
                ? {
                    engine_instructions: `RETRY (${stepRetryCount}/${maxStepRetries}): re-invoke the invoke_agent tool ` +
                        `with agent_name '${geminiSubagentTypeFor(workflowName, stepName, dirname(paths.agentDir))}' ` +
                        (retryBegin !== null
                            ? `using retry_begin's spawn_prompt VERBATIM as the prompt (its file already ` +
                                `ends with the retry feedback — do not reassemble the task yourself). `
                            : `and the validation failures above in the prompt (fresh spawn — subagent sessions ` +
                                `cannot be resumed on this host). `) +
                        `This consumes the step retry budget (the gate ` +
                        `hook did not run for this attempt, so there is no gate counter).`,
                }
                : retryBegin !== null
                    ? {
                        engine_instructions: `RETRY (${stepRetryCount}/${maxStepRetries}): spawn a FRESH subagent from ` +
                            `retry_begin's spawn_prompt VERBATIM — the prompt file is regenerated and ` +
                            `already ends with a Retry Feedback section; do not reassemble the task or ` +
                            `relay the failures yourself. This consumes the step retry budget.`,
                    }
                    : {}),
        ...(retryBegin !== null ? { retry_begin: retryBegin } : {}),
    };
}
function opencodeSubagentTypeFor(workflowName, stepName, projectRoot) {
    try {
        if (statSync(join(projectRoot, '.opencode', 'agents', `riglane-${workflowName}-${stepName}.md`)).isFile()) {
            return `riglane-${workflowName}-${stepName}`;
        }
    }
    catch (e) {
        if (!(e instanceof Error) || !('code' in e))
            throw e;
    }
    return 'workflow-step';
}
function geminiSubagentTypeFor(workflowName, stepName, projectRoot) {
    try {
        if (statSync(join(projectRoot, '.gemini', 'agents', `riglane-${workflowName}-${stepName}.md`)).isFile()) {
            return `riglane-${workflowName}-${stepName}`;
        }
    }
    catch (e) {
        if (!(e instanceof Error) || !('code' in e))
            throw e;
    }
    return 'riglane-workflow-step';
}
export function toolStepCollectResult(args, paths = defaultPaths(), overrides) {
    const workflowName = args.name ||
        args.workflow_name;
    const stepName = (args.step ||
        args.step_name ||
        '');
    const { runtimeDir: runtimeDirOverride, workflowYamlPath: yamlPathOverride } = normalizeRunOverrides(overrides);
    const runtimeDir = runtimeDirOverride ?? resolveRunRuntimeDir(paths, workflowName);
    const _legacyResultPath = join(runtimeDir, 'gate-result.json');
    const _perStepResultPath = stepName
        ? join(runtimeDir, 'gate-results', `${stepName}.json`)
        : null;
    const resultPath = _perStepResultPath !== null && existsSync(_perStepResultPath)
        ? _perStepResultPath
        : _legacyResultPath;
    const inlineWritePath = _perStepResultPath ?? _legacyResultPath;
    const manifestPath = join(runtimeDir, 'manifest.json');
    let ownerManifest = null;
    try {
        ownerManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    }
    catch {
        ownerManifest = null;
    }
    if (ownerManifest !== null) {
        const _ownEntry = checkRunOwnership(ownerManifest, 'step_collect_result');
        if (_ownEntry)
            return _ownEntry;
    }
    if (stepName) {
        let wfCheck;
        if (yamlPathOverride !== null) {
            try {
                wfCheck = loadYaml(yamlPathOverride);
            }
            catch {
                wfCheck = { steps: [] };
            }
        }
        else {
            ({ workflow: wfCheck } = resolveWorkflow(workflowName, paths));
        }
        const sObj = findStepConfig(wfCheck, stepName);
        if (sObj !== null && sObj.subagent === false) {
            return {
                warning: `Step '${stepName}' has subagent: false — no gate hook fires for inline steps. Skip step_collect_result and proceed to step_complete.`,
                action: 'PROCEED',
                passed: true,
                needs_semantic_gate: false,
                needs_human_gate: false,
            };
        }
    }
    let resultExists = false;
    try {
        resultExists = statSync(resultPath).isFile();
    }
    catch (e) {
        if (!(e instanceof Error) || !('code' in e))
            throw e;
        resultExists = false;
    }
    if (!resultExists) {
        return runInlineGateValidation(workflowName, stepName, runtimeDir, manifestPath, inlineWritePath, yamlPathOverride, paths, overrides ?? {});
    }
    const gateResult = JSON.parse(readFileSync(resultPath, 'utf-8'));
    const manifest = ownerManifest ?? JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (gateResult.source === 'engine-inline' && !gateResult.passed) {
        return runInlineGateValidation(workflowName, stepName, runtimeDir, manifestPath, inlineWritePath, yamlPathOverride, paths, overrides ?? {});
    }
    const manifestToken = manifest.run_token ?? '';
    const resultToken = gateResult.run_token ?? '';
    if (manifestToken && resultToken && resultToken !== manifestToken) {
        return {
            warning: `gate-result.json has run_token '${resultToken.substring(0, 8)}...' but current run is '${manifestToken.substring(0, 8)}...'. The result is stale (from a previous run or session). Proceed to step_complete — its safety net will validate outputs directly.`,
            action: 'PROCEED',
            passed: true,
            stale: true,
            needs_semantic_gate: true,
            needs_human_gate: false,
        };
    }
    const resultStep = gateResult.step ?? '';
    if (stepName && resultStep !== stepName) {
        return runInlineGateValidation(workflowName, stepName, runtimeDir, manifestPath, inlineWritePath, yamlPathOverride, paths, overrides ?? {});
    }
    let wf2;
    let wf2DefnDir;
    if (yamlPathOverride !== null) {
        wf2 = loadYaml(yamlPathOverride);
        wf2DefnDir = dirname(yamlPathOverride);
    }
    else {
        ({ workflow: wf2, definitionDir: wf2DefnDir } = resolveWorkflow(workflowName, paths));
    }
    const wfGateLookup = (wf2.gate ?? {});
    const _collectStepConfig = findStepConfig(wf2, stepName || resultStep);
    const stepGateLookup = _collectStepConfig?.gate ?? {};
    const passed = Boolean(gateResult.passed);
    if (passed) {
        const semantic = stepGateFlag(wfGateLookup, stepGateLookup, 'semantic');
        const humanEval = evaluateHumanGate(wfGateLookup, stepGateLookup, stepName || resultStep, runtimeDir);
        if ('error' in humanEval) {
            return {
                error: humanEval.error,
                action: 'STOP_WORKFLOW',
            };
        }
        const human = humanEval.required;
        const result = {
            passed: true,
            step: resultStep,
            action: 'PROCEED',
            checks: gateResult.checks ?? 0,
            details: gateResult.details ?? [],
            needs_semantic_gate: semantic,
            needs_human_gate: human,
        };
        if ('branches' in gateResult)
            result.branches = gateResult.branches;
        if ('branch_results' in gateResult)
            result.branch_results = gateResult.branch_results;
        if ('failed_branches' in gateResult)
            result.failed_branches = gateResult.failed_branches;
        if (semantic) {
            const isPlanning = _collectStepConfig?.type === 'planning';
            const stepConfigForSpec = _collectStepConfig ?? {};
            const specClause = composeSpecClauseForSemanticGate(stepConfigForSpec, resolveConsumptionDomains(paths), resolveConsumptionScopeHint(paths));
            if (isPlanning) {
                result.engine_instructions = instruction('engine/semantic-gate-planning') + specClause;
            }
            else {
                result.engine_instructions = instruction('engine/semantic-gate-step') + specClause;
            }
        }
        if (human) {
            result.engine_instructions = appendHumanGateInstructions(result.engine_instructions, resolveHumanChannel(wfGateLookup, stepGateLookup));
        }
        return result;
    }
    const maxStepRetries = (() => {
        if (Object.prototype.hasOwnProperty.call(stepGateLookup, 'max_step_retries')) {
            return Number(stepGateLookup.max_step_retries) || 3;
        }
        if (Object.prototype.hasOwnProperty.call(wfGateLookup, 'max_step_retries')) {
            return Number(wfGateLookup.max_step_retries) || 3;
        }
        return 3;
    })();
    const failedBranchesForRetry = gateResult.failed_branches ?? [];
    const parallelFail = failedBranchesForRetry.length > 0;
    const failedIdxList = failedBranchesForRetry.join(', ');
    if (hostToolCaps(getEngineHost()).gateRetryModel === 'fresh-spawn-gate-budget') {
        const maxGateRetries = (() => {
            if (Object.prototype.hasOwnProperty.call(stepGateLookup, 'max_gate_retries')) {
                return Number(stepGateLookup.max_gate_retries) || 5;
            }
            if (Object.prototype.hasOwnProperty.call(wfGateLookup, 'max_gate_retries')) {
                return Number(wfGateLookup.max_gate_retries) || 5;
            }
            return 5;
        })();
        const gateLoopCount = gateResult.loop_count ?? 0;
        if (gateLoopCount < maxGateRetries) {
            return {
                passed: false,
                step: stepName || resultStep,
                action: 'RETRY_STEP',
                checks: gateResult.checks ?? 0,
                failures: gateResult.failures ?? 0,
                details: gateResult.details ?? [],
                loop_count: gateLoopCount,
                max_gate_retries: maxGateRetries,
                max_step_retries: maxStepRetries,
                retry_mode: 'in_session',
                engine_instructions: getEngineHost() === 'gemini'
                    ? parallelFail
                        ? `GATE RETRY (${gateLoopCount + 1}/${maxGateRetries}) — PARALLEL: ` +
                            `${failedBranchesForRetry.length} branch(es) failed (indices [${failedIdxList}]). ` +
                            `Re-invoke the invoke_agent tool ONCE PER FAILED BRANCH with agent_name ` +
                            `'${geminiSubagentTypeFor(workflowName, stepName || resultStep, dirname(paths.agentDir))}' ` +
                            `and a NEW prompt carrying THAT branch's gate feedback (subagent sessions cannot ` +
                            `be resumed on this host — a fresh spawn with the feedback in its prompt IS the ` +
                            `retry). Do NOT re-run branches that already passed, and do NOT fix outputs ` +
                            `yourself. This does not consume the step retry budget.`
                        : `GATE RETRY (${gateLoopCount + 1}/${maxGateRetries}): re-invoke the invoke_agent ` +
                            `tool with agent_name '${geminiSubagentTypeFor(workflowName, stepName || resultStep, dirname(paths.agentDir))}' and a NEW prompt carrying the gate feedback (the block reason you received, ` +
                            `else the failure details in THIS result). Subagent sessions cannot be resumed ` +
                            `on this host — a fresh spawn with the feedback in its prompt IS the retry path; ` +
                            `the previous session never sees it. Do NOT fix the outputs yourself. This does ` +
                            `not consume the step retry budget.`
                    : parallelFail
                        ? `IN-SESSION GATE RETRY (${gateLoopCount + 1}/${maxGateRetries}) — PARALLEL: ` +
                            `${failedBranchesForRetry.length} branch(es) failed (indices [${failedIdxList}]). ` +
                            `Re-invoke the task tool ONCE PER FAILED BRANCH with subagent_type ` +
                            `'${opencodeSubagentTypeFor(workflowName, stepName || resultStep, dirname(paths.agentDir))}' ` +
                            `AND, for each, the SAME task_id from THAT branch's previous task result — BOTH ` +
                            `parameters are required per branch; a task call without its task_id starts a FRESH ` +
                            `session and wastes that branch's gate attempt. Pass each branch's gate feedback as ` +
                            `its new prompt. Do NOT re-run branches that already passed, and do NOT fix outputs ` +
                            `yourself. This does not consume the step retry budget.`
                        : `IN-SESSION GATE RETRY (${gateLoopCount + 1}/${maxGateRetries}): re-invoke the ` +
                            `task tool with subagent_type '${opencodeSubagentTypeFor(workflowName, stepName || resultStep, dirname(paths.agentDir))}' AND the SAME task_id from the previous task result — BOTH parameters are ` +
                            `required; a task call without task_id starts a FRESH session, discards the ` +
                            `subagent's context, and wastes this gate attempt. Pass the gate feedback as the ` +
                            `new prompt (the [Riglane STRUCTURAL GATE] block from the task output if present, ` +
                            `else the failure details in THIS result) — the resumed session has NOT seen ` +
                            `it. Do NOT fix the outputs yourself. This does not consume the step retry ` +
                            `budget.`,
            };
        }
    }
    let stepRetryCount = 0;
    try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const steps = (manifest.steps ?? {});
        const stepData = steps[stepName || resultStep] ?? {};
        stepRetryCount = (stepData.step_retry_count ?? 0) + 1;
        stepData.step_retry_count = stepRetryCount;
        manifest.updated_at = nowIsoLocal();
        safeWriteJson(manifestPath, manifest);
    }
    catch {
    }
    if (stepRetryCount > maxStepRetries) {
        autoFailBudgetExhaustedRun(workflowName, stepName || resultStep, manifestPath, `Step '${stepName || resultStep}' exhausted retry budget ` +
            `(${stepRetryCount}/${maxStepRetries}).`, overrides ?? {}, paths);
        return {
            passed: false,
            step: stepName || resultStep,
            action: 'STOP_WORKFLOW',
            checks: gateResult.checks ?? 0,
            failures: gateResult.failures ?? 0,
            details: gateResult.details ?? [],
            loop_count: gateResult.loop_count ?? 0,
            max_step_retries: maxStepRetries,
            step_retry_count: stepRetryCount,
            run_failed: true,
            error: `Step '${stepName || resultStep}' exhausted retry budget ` +
                `(${stepRetryCount}/${maxStepRetries}). The engine has already finalized this run ` +
                `as FAILED (manifest carries a 'stopped' block) — do NOT call workflow_finalize ` +
                `and do NOT retry. STOP and surface to user; recovery is a fresh run.`,
        };
    }
    const stepRetryBegin = parallelFail
        ? null
        : composeRetryBegin({
            workflowName,
            workflow: wf2,
            defnDir: wf2DefnDir,
            runtimeDir,
            stepName: stepName || resultStep,
            paths,
            details: gateResult.details ?? [],
            attempt: stepRetryCount,
            maxAttempts: maxStepRetries,
        });
    return {
        passed: false,
        step: stepName || resultStep,
        action: 'RETRY_STEP',
        checks: gateResult.checks ?? 0,
        failures: gateResult.failures ?? 0,
        details: gateResult.details ?? [],
        loop_count: gateResult.loop_count ?? 0,
        max_step_retries: maxStepRetries,
        step_retry_count: stepRetryCount,
        ...(getEngineHost() === 'opencode'
            ? {
                retry_mode: 'fresh_spawn',
                engine_instructions: parallelFail
                    ? `STEP RETRY (${stepRetryCount}/${maxStepRetries}) — PARALLEL: the in-session gate ` +
                        `budget is exhausted. Spawn a FRESH task PER FAILED BRANCH (indices [${failedIdxList}]) ` +
                        `with subagent_type ` +
                        `'${opencodeSubagentTypeFor(workflowName, stepName || resultStep, dirname(paths.agentDir))}' ` +
                        `and do NOT pass task_id — each failed session could not self-correct; a clean context ` +
                        `per branch with the failure feedback in the prompt is the point. Do NOT re-run ` +
                        `branches that already passed.`
                    : `STEP RETRY (${stepRetryCount}/${maxStepRetries}): the in-session gate budget ` +
                        `for this step is exhausted. Spawn a FRESH task with subagent_type ` +
                        `'${opencodeSubagentTypeFor(workflowName, stepName || resultStep, dirname(paths.agentDir))}' and do NOT ` +
                        `pass task_id — the failed session could not self-correct; a clean context is ` +
                        `the point of a step retry.` +
                        (stepRetryBegin !== null
                            ? ` Use retry_begin's spawn_prompt VERBATIM as the prompt — its file is ` +
                                `regenerated and already ends with the retry feedback.`
                            : ''),
            }
            : getEngineHost() === 'gemini'
                ? {
                    retry_mode: 'fresh_spawn',
                    engine_instructions: parallelFail
                        ? `STEP RETRY (${stepRetryCount}/${maxStepRetries}) — PARALLEL: the gate budget is ` +
                            `exhausted; this retry consumes the STEP budget. Re-invoke invoke_agent PER FAILED ` +
                            `BRANCH (indices [${failedIdxList}]) with agent_name ` +
                            `'${geminiSubagentTypeFor(workflowName, stepName || resultStep, dirname(paths.agentDir))}' ` +
                            `and that branch's failure feedback in the prompt. Do NOT re-run branches that ` +
                            `already passed.`
                        : `STEP RETRY (${stepRetryCount}/${maxStepRetries}): the gate budget for this step ` +
                            `is exhausted; this retry consumes the STEP budget. Re-invoke invoke_agent with ` +
                            `agent_name '${geminiSubagentTypeFor(workflowName, stepName || resultStep, dirname(paths.agentDir))}' ` +
                            (stepRetryBegin !== null
                                ? `using retry_begin's spawn_prompt VERBATIM as the prompt (its file already ` +
                                    `ends with the retry feedback).`
                                : `and the failure feedback in the prompt.`),
                }
                : stepRetryBegin !== null
                    ? {
                        retry_mode: 'fresh_spawn',
                        engine_instructions: `STEP RETRY (${stepRetryCount}/${maxStepRetries}): the in-session gate budget ` +
                            `is exhausted — spawn a FRESH subagent from retry_begin's spawn_prompt ` +
                            `VERBATIM (subagent_type from retry_begin; its prompt file is regenerated and ` +
                            `already ends with a Retry Feedback section). Do not reassemble the task or ` +
                            `relay the failures yourself.`,
                    }
                    : {}),
        ...(stepRetryBegin !== null ? { retry_begin: stepRetryBegin } : {}),
    };
}
import { readdirSync, renameSync as renameSync2 } from 'node:fs';
import { loadSnapshot, validateOutputs } from './output-validator.js';
function moveTreeContents(src, dst) {
    let entries;
    try {
        entries = readdirSync(src, { withFileTypes: true });
    }
    catch {
        return;
    }
    mkdirSync(dst, { recursive: true });
    for (const entry of entries) {
        const srcPath = join(src, entry.name);
        const dstPath = join(dst, entry.name);
        if (entry.isDirectory()) {
            moveTreeContents(srcPath, dstPath);
        }
        else {
            try {
                renameSync2(srcPath, dstPath);
            }
            catch {
            }
        }
    }
}
function checkStepFailureBlocked(gateResult, stepConfig, workflow, manifest) {
    const isParallel = Boolean(stepConfig?.parallel);
    const wfGate = (workflow.gate ?? {});
    const stepGate = (stepConfig?.gate ?? {});
    const stepHas = Object.prototype.hasOwnProperty.call(stepGate, 'allow_partial_step_complete');
    const wfHas = Object.prototype.hasOwnProperty.call(wfGate, 'allow_partial_step_complete');
    const allowPartialRaw = stepHas
        ? stepGate.allow_partial_step_complete
        : wfHas
            ? wfGate.allow_partial_step_complete
            : false;
    const allowPartial = Boolean(allowPartialRaw);
    if (isParallel) {
        const branchesMap = (gateResult.branches ?? null);
        let reportedKeys;
        let failedBranches;
        if (branchesMap && typeof branchesMap === 'object') {
            reportedKeys = new Set(Object.keys(branchesMap));
            failedBranches = Object.keys(branchesMap)
                .filter((k) => !branchesMap[k]?.passed)
                .map((k) => Number.parseInt(k, 10));
        }
        else {
            const branchResults = (gateResult.branch_results ?? []);
            reportedKeys = new Set();
            for (const r of branchResults) {
                const idx = r.branch_index;
                if (idx !== undefined && idx !== null)
                    reportedKeys.add(String(idx));
            }
            failedBranches = [...(gateResult.failed_branches ?? [])];
        }
        const reportedCount = reportedKeys.size;
        if (reportedCount > 0 && failedBranches.length === reportedCount) {
            return { blocked: true, reason: 'all_branches_failed', failedBranches };
        }
        const parallelBranches = (manifest?.parallel_branches ?? {});
        if (Object.keys(parallelBranches).length > 0) {
            const missing = [];
            for (const k of Object.keys(parallelBranches)) {
                if (!reportedKeys.has(k))
                    missing.push(k);
            }
            missing.sort();
            if (missing.length > 0 && !allowPartial) {
                return { blocked: true, reason: 'missing_branches', failedBranches: missing };
            }
        }
        if (failedBranches.length > 0 && !allowPartial) {
            return { blocked: true, reason: 'partial_branches_failed', failedBranches };
        }
        return { blocked: false, reason: '', failedBranches: [] };
    }
    if (gateResult.passed === false) {
        return { blocked: true, reason: 'non_parallel_failed', failedBranches: [] };
    }
    return { blocked: false, reason: '', failedBranches: [] };
}
function readGateResultForStep(runtimeDir, stepName) {
    for (const gateResultPath of [
        join(runtimeDir, 'gate-results', `${stepName}.json`),
        join(runtimeDir, 'gate-result.json'),
    ]) {
        let exists = false;
        try {
            exists = statSync(gateResultPath).isFile();
        }
        catch (e) {
            if (!(e instanceof Error) || !('code' in e))
                throw e;
            exists = false;
        }
        if (!exists)
            continue;
        try {
            const gr = JSON.parse(readFileSync(gateResultPath, 'utf-8'));
            if (gr.step !== stepName)
                continue;
            return gr;
        }
        catch {
            continue;
        }
    }
    return null;
}
function deciderEnv(runDir) {
    return {
        ...process.env,
        [ENV_RUN_DIR]: runDir,
        [LEGACY_ENV_RUN_DIR]: runDir,
    };
}
function evaluateLoopBack(loopBack, loopState, args, runDir) {
    const iterations = typeof loopState.iterations === 'number' ? loopState.iterations : 0;
    if (iterations >= loopBack.max_iterations) {
        return {
            kind: 'proceed',
            decidedBy: 'budget_exhausted',
            rationale: `max_iterations (${loopBack.max_iterations}) reached`,
        };
    }
    if (typeof loopBack.when.script === 'string' && loopBack.when.script.length > 0) {
        let scriptSaysLoop;
        const cached = loopState.pending?.script_says_loop;
        if (typeof cached === 'boolean') {
            scriptSaysLoop = cached;
        }
        else {
            const proc = spawnSync(loopBack.when.script, {
                shell: true,
                encoding: 'utf-8',
                timeout: 60_000,
                env: deciderEnv(runDir),
            });
            if (proc.error || proc.status !== 0) {
                const detail = proc.error
                    ? proc.error.message
                    : `exit code ${proc.status}; stderr: ${(proc.stderr ?? '').slice(0, 500)}`;
                return {
                    kind: 'error',
                    message: `loop_back when.script failed (${detail}). The script must exit 0 and print {"loop": true|false} to stdout.`,
                };
            }
            try {
                const parsed = JSON.parse((proc.stdout ?? '').trim());
                if (typeof parsed.loop !== 'boolean')
                    throw new Error('missing boolean "loop" field');
                scriptSaysLoop = parsed.loop;
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return {
                    kind: 'error',
                    message: `loop_back when.script printed invalid output (${msg}). Expected JSON {"loop": true|false} on stdout; got: ${(proc.stdout ?? '').slice(0, 200)}`,
                };
            }
        }
        if (!scriptSaysLoop) {
            return { kind: 'proceed', decidedBy: 'script', rationale: 'when.script returned loop=false' };
        }
        if (!loopBack.when.semantic && loopBack.when.human !== true) {
            return { kind: 'loop', decidedBy: 'script', rationale: 'when.script returned loop=true' };
        }
        if (typeof args.loop_decision !== 'string') {
            return { kind: 'awaiting', scriptSaysLoop: true };
        }
    }
    const needsOrchestrator = (typeof loopBack.when.semantic === 'string' && loopBack.when.semantic.length > 0) ||
        loopBack.when.human === true;
    if (needsOrchestrator) {
        if (typeof args.loop_decision !== 'string') {
            return { kind: 'awaiting' };
        }
        if (args.loop_decision !== 'loop' && args.loop_decision !== 'proceed') {
            return {
                kind: 'error',
                message: `invalid loop_decision '${args.loop_decision}' — must be 'loop' or 'proceed'.`,
            };
        }
        return {
            kind: args.loop_decision,
            decidedBy: 'orchestrator',
            ...(typeof args.loop_rationale === 'string' ? { rationale: args.loop_rationale } : {}),
        };
    }
    return { kind: 'loop', decidedBy: 'script', rationale: 'when.script returned loop=true' };
}
function composeLoopDecisionInstructions(stepName, loopBack, iteration, scriptSaysLoop) {
    const parts = [];
    parts.push(`LOOP DECISION REQUIRED for step '${stepName}' (loop_back → '${loopBack.to}', ` +
        `iteration ${iteration + 1} would follow).`);
    if (scriptSaysLoop === true) {
        parts.push(`The deterministic when.script already voted: loop=true.`);
    }
    if (typeof loopBack.when.semantic === 'string' && loopBack.when.semantic.length > 0) {
        parts.push(`EVALUATE this condition against the step's actual outputs (read the files): ` +
            `"${loopBack.when.semantic}". Your evaluation answers: should the workflow loop back?`);
    }
    if (loopBack.when.human === true) {
        const ch = loopBack.when.human_channel;
        if (ch === 'external' || ch === 'both') {
            parts.push(`ASK THE USER through the run inbox: first call inbox(op:'rules', name, step: ` +
                `'${stepName}') (unlocks posting), then inbox(op:'post', name, step: '${stepName}', ` +
                `message: { kind: "loop_decision", title: "Loop back to '${loopBack.to}'?", body: ` +
                `<markdown context>, request: { action: "loop decision", choices: ["loop", ` +
                `"proceed"] } }), then poll inbox(op:'check') until responded — the choice text IS ` +
                `the user's decision.` +
                (ch === 'both'
                    ? ` Also present the SAME question (same entries, nothing added) in the terminal; ` +
                        `record a terminal answer via inbox(op:'respond') before proceeding.`
                    : ''));
        }
        else {
            parts.push(`ASK THE USER: should the workflow loop back to step '${loopBack.to}' for another ` +
                `iteration? Relay their answer — do not decide for them.`);
        }
    }
    parts.push(`All deciders must agree to loop; any 'proceed' wins. Then call step_complete AGAIN ` +
        `for step '${stepName}' with the same summary plus loop_decision: "loop" | "proceed" ` +
        `and a short loop_rationale. Do NOT call step_begin until the engine returns its ` +
        `decision (the cursor has not moved).`);
    return parts.join('\n');
}
function evaluateRoutes(routes, routeState, args, runDir) {
    const validIds = new Set(routes.define.map((r) => r.id));
    const isValidChoice = (v) => v === 'proceed' || validIds.has(v);
    const idList = [...validIds].map((i) => `'${i}'`).join(', ');
    let scriptRoute;
    if (typeof routes.when.script === 'string' && routes.when.script.length > 0) {
        const cached = routeState.pending?.script_route;
        if (typeof cached === 'string') {
            scriptRoute = cached;
        }
        else {
            const proc = spawnSync(routes.when.script, {
                shell: true,
                encoding: 'utf-8',
                timeout: 60_000,
                env: deciderEnv(runDir),
            });
            if (proc.error || proc.status !== 0) {
                const detail = proc.error
                    ? proc.error.message
                    : `exit code ${proc.status}; stderr: ${(proc.stderr ?? '').slice(0, 500)}`;
                return {
                    kind: 'error',
                    message: `routes when.script failed (${detail}). The script must exit 0 and print {"route": "<route-id>"|"proceed"} to stdout.`,
                };
            }
            try {
                const parsed = JSON.parse((proc.stdout ?? '').trim());
                if (typeof parsed.route !== 'string')
                    throw new Error('missing string "route" field');
                scriptRoute = parsed.route;
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return {
                    kind: 'error',
                    message: `routes when.script printed invalid output (${msg}). Expected JSON {"route": "<id>"|"proceed"} on stdout; got: ${(proc.stdout ?? '').slice(0, 200)}`,
                };
            }
            if (!isValidChoice(scriptRoute)) {
                return {
                    kind: 'error',
                    message: `routes when.script returned '${scriptRoute}', which is neither a defined route id (${idList}) nor 'proceed'.`,
                };
            }
        }
    }
    const hasSemantic = typeof routes.when.semantic === 'string' && routes.when.semantic.length > 0;
    const hasHuman = routes.when.human === true;
    if (!hasSemantic && !hasHuman) {
        if (scriptRoute === undefined) {
            return { kind: 'proceed', decidedBy: 'script', rationale: 'no routing condition configured' };
        }
        return scriptRoute === 'proceed'
            ? { kind: 'proceed', decidedBy: 'script', rationale: "when.script returned 'proceed'" }
            : { kind: 'route', routeId: scriptRoute, decidedBy: 'script', rationale: `when.script selected '${scriptRoute}'` };
    }
    if (typeof args.route_decision !== 'string') {
        return { kind: 'awaiting', ...(scriptRoute !== undefined ? { scriptRoute } : {}) };
    }
    const choice = args.route_decision;
    if (!isValidChoice(choice)) {
        return {
            kind: 'error',
            message: `invalid route_decision '${choice}' — must be a defined route id (${idList}) or 'proceed'.`,
        };
    }
    if (!hasHuman && scriptRoute !== undefined && choice !== scriptRoute) {
        return {
            kind: 'proceed',
            decidedBy: 'orchestrator',
            rationale: `script ('${scriptRoute}') and semantic ('${choice}') disagreed`,
            note: `Routing deciders disagreed for this step — the script chose '${scriptRoute}' but the ` +
                `semantic evaluation chose '${choice}'. No route was taken; the workflow continues to ` +
                `the next step. (Add a 'human' decider to the routes block if a tie-breaker is needed.)`,
        };
    }
    return choice === 'proceed'
        ? {
            kind: 'proceed',
            decidedBy: 'orchestrator',
            ...(typeof args.route_rationale === 'string' ? { rationale: args.route_rationale } : {}),
        }
        : {
            kind: 'route',
            routeId: choice,
            decidedBy: 'orchestrator',
            ...(typeof args.route_rationale === 'string' ? { rationale: args.route_rationale } : {}),
        };
}
function composeRouteDecisionInstructions(stepName, routes, scriptRoute) {
    const ids = routes.define.map((r) => `'${r.id}'`).join(', ');
    const hasScript = typeof routes.when.script === 'string' && routes.when.script.length > 0;
    const hasSemantic = typeof routes.when.semantic === 'string' && routes.when.semantic.length > 0;
    const hasHuman = routes.when.human === true;
    const parts = [];
    parts.push(`ROUTE DECISION REQUIRED for step '${stepName}'. Choose one of: ${ids}, or 'proceed' ` +
        `(take no route and continue to the next step).`);
    if (typeof scriptRoute === 'string') {
        parts.push(`The deterministic when.script already voted: '${scriptRoute}'.`);
    }
    if (hasSemantic) {
        parts.push(`EVALUATE this condition against the step's actual outputs (read the files): ` +
            `"${routes.when.semantic}". Your evaluation answers which route to take (a route id) ` +
            `or 'proceed'.`);
    }
    if (hasHuman) {
        const ch = routes.when.human_channel;
        if (ch === 'external' || ch === 'both') {
            const advice = hasScript || hasSemantic
                ? ` Include the script vote and/or your semantic judgment in the body as ADVICE — ` +
                    `the user is the final authority.`
                : '';
            parts.push(`ASK THE USER through the run inbox: first call inbox(op:'rules', name, step: ` +
                `'${stepName}') (unlocks posting), then inbox(op:'post', name, step: '${stepName}', ` +
                `message: { kind: "route_decision", title: "Which route?", body: <markdown ` +
                `context>${advice.length > 0 ? ' + the advice' : ''}, request: { action: ` +
                `"route decision", choices: [${ids}, 'proceed'] } }), then poll inbox(op:'check') ` +
                `until responded — the choice text IS the user's pick.${advice}` +
                (ch === 'both'
                    ? ` Also present the SAME question (same entries, nothing added) in the terminal; ` +
                        `record a terminal answer via inbox(op:'respond') before proceeding.`
                    : ''));
        }
        else {
            parts.push(`ASK THE USER which route to take (${ids} or 'proceed'). ` +
                (hasScript || hasSemantic
                    ? `Relay the script vote and/or your semantic judgment as ADVICE; the user is the ` +
                        `final authority and may override them. `
                    : '') +
                `Relay their answer — do not decide for them.`);
        }
    }
    if (!hasHuman && hasScript && hasSemantic) {
        parts.push(`Without a human decider, the script and your semantic evaluation must AGREE on the same ` +
            `value; if they differ the engine takes NO route and continues.`);
    }
    parts.push(`Then call step_complete AGAIN for step '${stepName}' with the same summary plus ` +
        `route_decision: "<route-id>" | "proceed" and a short route_rationale. Do NOT call ` +
        `step_begin until the engine returns its decision (the cursor has not moved).`);
    return parts.join('\n');
}
function unattributedLedgerToolNames(runtimeDir) {
    const names = new Set();
    let raw;
    try {
        raw = readFileSync(join(runtimeDir, 'tool-events.jsonl'), 'utf-8');
    }
    catch {
        return names;
    }
    for (const line of raw.split('\n')) {
        if (!line.trim())
            continue;
        try {
            const rec = JSON.parse(line);
            if (rec.step !== null && rec.step !== undefined)
                continue;
            const full = rec.tool || '';
            const short = rec.tool_short || (full ? (full.split('__').pop() ?? '') : '');
            if (full)
                names.add(full);
            if (short)
                names.add(short);
            const wfTool = rec.wf_tool;
            if (wfTool)
                names.add(wfTool);
            const server = rec.server;
            if (server && rec.kind === 'mcp')
                names.add(`mcp-server:${server}`);
        }
        catch {
        }
    }
    return names;
}
function consumeToolEvents(runtimeDir, manifest, stepName) {
    const ledgerPath = join(runtimeDir, 'tool-events.jsonl');
    let raw;
    try {
        if (!statSync(ledgerPath).isFile())
            return [];
        raw = readFileSync(ledgerPath, 'utf-8');
    }
    catch {
        return [];
    }
    const lastNl = raw.lastIndexOf('\n');
    if (lastNl < 0)
        return [];
    const lines = raw.slice(0, lastNl).split('\n').filter((l) => l.trim());
    const offset = typeof manifest.tool_events_offset === 'number' ? manifest.tool_events_offset : 0;
    if (lines.length <= offset)
        return [];
    const wfNameForAttribution = manifest.workflow ?? '';
    const manifestStepsForAttribution = (manifest.steps ?? {});
    const attributeStep = (rec) => {
        if (rec.step !== null && rec.step !== undefined)
            return;
        const at = typeof rec.agent_type === 'string' ? rec.agent_type : '';
        if (at && wfNameForAttribution && at.startsWith(`${wfNameForAttribution}-`)) {
            let cand = at.slice(wfNameForAttribution.length + 1);
            const dd = cand.indexOf('--');
            if (dd > 0)
                cand = cand.slice(0, dd);
            if (cand && cand in manifestStepsForAttribution) {
                rec.step = cand;
                return;
            }
        }
        if (stepName !== null)
            rec.step = stepName;
    };
    const fresh = [];
    for (let i = offset; i < lines.length; i++) {
        try {
            const rec = JSON.parse(lines[i]);
            attributeStep(rec);
            fresh.push(rec);
        }
        catch {
        }
    }
    manifest.tool_events_offset = lines.length;
    try {
        const agentDir = dirname(dirname(dirname(runtimeDir)));
        const claimed = claimSpooledEvents(agentDir, manifest.run_id ?? '', manifest.run_token ?? null);
        for (const rec of claimed) {
            attributeStep(rec);
            fresh.push(rec);
        }
    }
    catch {
    }
    return fresh;
}
function appendToolCallsToTrace(runtimeDir, fresh) {
    if (fresh.length === 0)
        return;
    const tracePath = join(runtimeDir, 'trace.json');
    withTraceLock(tracePath, () => {
        try {
            const trace = JSON.parse(readFileSync(tracePath, 'utf-8'));
            const existing = Array.isArray(trace.tool_calls) ? trace.tool_calls : [];
            const merged = [...existing, ...fresh];
            trace.tool_calls = merged;
            trace.total_tool_calls_proxy = merged.length;
            safeWriteJson(tracePath, trace);
        }
        catch (e) {
            logEngine(`appendToolCallsToTrace skipped ${fresh.length} event(s): ${e instanceof Error ? e.message : String(e)}`);
        }
    });
}
const HOST_TOOL_CAPS = {
    'claude-code': { scriptReliable: true, mcpReliable: true, mcpPrefixed: true, gateRetryModel: 'host-bounce' },
    codex: { scriptReliable: true, mcpReliable: true, mcpPrefixed: true, gateRetryModel: 'host-bounce' },
    cursor: { scriptReliable: true, mcpReliable: true, mcpPrefixed: false, gateRetryModel: 'host-bounce' },
    opencode: { scriptReliable: true, mcpReliable: true, mcpPrefixed: false, gateRetryModel: 'fresh-spawn-gate-budget' },
    copilot: { scriptReliable: true, mcpReliable: true, mcpPrefixed: false, gateRetryModel: 'host-bounce' },
    gemini: { scriptReliable: true, mcpReliable: true, mcpPrefixed: false, gateRetryModel: 'fresh-spawn-gate-budget' },
};
const CC_FALLBACK_CAPS = { scriptReliable: true, mcpReliable: true, mcpPrefixed: true, gateRetryModel: 'host-bounce' };
function hostToolCaps(host) {
    return host === null ? CC_FALLBACK_CAPS : HOST_TOOL_CAPS[host];
}
function reclassifyScriptTools(events, workflow, workflowName) {
    if (events.length === 0)
        return;
    const wfTools = (workflow.tools ?? []);
    const wfNorm = normalizeForMcp(workflow.name ?? workflowName);
    const registered = new Map();
    for (const t of wfTools) {
        if ((t.type ?? 'script') !== 'script')
            continue;
        const name = t.name;
        if (name)
            registered.set(`${wfNorm}__${normalizeForMcp(name)}`, name);
    }
    if (registered.size === 0)
        return;
    for (const e of events) {
        if (e.kind === 'script')
            continue;
        const clean = registered.get(e.tool ?? '');
        if (clean) {
            e.kind = 'script';
            e.tool_short = clean;
            if (e.server === undefined || e.server === null)
                e.server = 'workflow_tools';
        }
    }
}
function reclassifyMcpTools(events, workflow) {
    if (events.length === 0)
        return;
    const wfTools = (workflow.tools ?? []);
    const expected = new Map();
    for (const t of wfTools) {
        if (t.type !== 'mcp')
            continue;
        const name = t.name;
        const et = t.expected_tools;
        if (!name || !Array.isArray(et))
            continue;
        for (const tool of et) {
            if (typeof tool !== 'string')
                continue;
            expected.set(normalizeForMcp(tool), name);
            expected.set(normalizeForMcp(`${name}_${tool}`), name);
            expected.set(normalizeForMcp(`mcp_${name}_${tool}`), name);
        }
    }
    if (expected.size === 0)
        return;
    for (const e of events) {
        if (e.kind !== 'other')
            continue;
        const server = expected.get(normalizeForMcp(e.tool ?? ''));
        if (server) {
            e.kind = 'mcp';
            e.server = server;
        }
    }
}
const SCRIPT_FILE_EXT = /\.(py|js|mjs|cjs|ts|sh|bash|rb|pl|php|ps1|bat|cmd)$/i;
function scriptCommandNeedle(command) {
    const stripped = command.replace(/\{[^}]*\}/g, ' ');
    for (const tok of stripped.split(/\s+/)) {
        if (!tok)
            continue;
        const norm = tok.replace(/\\/g, '/');
        if (SCRIPT_FILE_EXT.test(norm)) {
            const base = norm.split('/').pop() ?? '';
            if (base)
                return base.toLowerCase();
        }
    }
    return '';
}
function shellEventCommand(e) {
    const args = e.args;
    if (args && typeof args === 'object') {
        const a = args;
        if (typeof a.command === 'string')
            return a.command;
        if (typeof a.preview === 'string')
            return a.preview;
    }
    return '';
}
function reclassifyBashRunScriptTools(events, workflow) {
    if (events.length === 0)
        return;
    const wfTools = (workflow.tools ?? []);
    const needles = [];
    for (const t of wfTools) {
        if ((t.type ?? 'script') !== 'script')
            continue;
        const name = t.name;
        const command = t.command;
        if (!name || !command)
            continue;
        const needle = scriptCommandNeedle(command);
        if (needle)
            needles.push({ needle, name });
    }
    if (needles.length === 0)
        return;
    for (const e of events) {
        if (e.kind !== 'shell' || e.wf_tool)
            continue;
        const cmd = shellEventCommand(e);
        if (!cmd)
            continue;
        const hay = cmd.replace(/\\/g, '/').toLowerCase();
        for (const { needle, name } of needles) {
            if (hay.includes(needle)) {
                e.wf_tool = name;
                break;
            }
        }
    }
}
const MAX_IO_PREVIEW_BYTES = 16384;
const MAX_IO_PREVIEW_LINES = 200;
function readValuePreview(absPath) {
    const display = relpathPosix(absPath);
    let size;
    try {
        const st = statSync(absPath);
        if (!st.isFile())
            return { path: display, exists: false };
        size = st.size;
    }
    catch {
        return { path: display, exists: false };
    }
    let bytesRead = 0;
    const buf = Buffer.alloc(MAX_IO_PREVIEW_BYTES + 1);
    try {
        const fd = openSync(absPath, 'r');
        try {
            bytesRead = readSync(fd, buf, 0, MAX_IO_PREVIEW_BYTES + 1, 0);
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
        return { path: display, exists: true, size };
    }
    const slice = buf.subarray(0, bytesRead);
    if (slice.includes(0))
        return { path: display, exists: true, size, binary: true, value_preview: null };
    let text = slice.toString('utf-8');
    let truncated = bytesRead > MAX_IO_PREVIEW_BYTES || size > bytesRead;
    if (truncated)
        text = slice.subarray(0, MAX_IO_PREVIEW_BYTES).toString('utf-8');
    const lines = text.split('\n');
    if (lines.length > MAX_IO_PREVIEW_LINES) {
        text = lines.slice(0, MAX_IO_PREVIEW_LINES).join('\n');
        truncated = true;
    }
    return { path: display, exists: true, size, binary: false, value_preview: text, truncated };
}
function resolveInputAbsPaths(rawPath, params, runtimeDir, defnDir) {
    const resolved = resolvePlaceholders(rawPath, params);
    if (!resolved)
        return [];
    const hasGlob = resolved.includes('*') || resolved.includes('?') || resolved.includes('[');
    if (isDottedRoot(resolved) || pathIsAbsolute(resolved)) {
        if (hasGlob)
            return [...globSync(resolved, { windowsPathsNoEscape: true })].sort();
        return existsSync(resolved) ? [resolved] : [];
    }
    for (const dir of [runtimeDir, defnDir]) {
        const full = join(dir, resolved);
        if (hasGlob) {
            const m = [...globSync(full, { windowsPathsNoEscape: true })].sort();
            if (m.length > 0)
                return m;
        }
        else if (existsSync(full)) {
            return [full];
        }
    }
    return [];
}
function enrichStepIO(runtimeDir, stepName, stepConfig, params, defnDir, bindingsApplied, paramBindings) {
    const normStr = (v) => (typeof v === 'string' ? v : '');
    const inputsOut = (stepConfig.inputs ?? []).map((raw) => {
        const isObj = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
        const inp = (isObj ? raw : {});
        const rawPath = isObj ? normStr(inp.path) : String(raw);
        const entry = { path: rawPath, inject: normStr(inp.inject) || 'reference' };
        if (inp.struct)
            entry.struct = inp.struct;
        entry.resolved = resolveInputAbsPaths(rawPath, params, runtimeDir, defnDir).map(readValuePreview);
        return entry;
    });
    const outputsOut = (stepConfig.outputs ?? []).map((raw) => {
        const isObj = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
        const out = (isObj ? raw : {});
        const rawPath = isObj ? normStr(out.path) : String(raw);
        const entry = { path: rawPath };
        if (out.struct)
            entry.struct = out.struct;
        if (out.write_proof)
            entry.write_proof = out.write_proof;
        if (out.optional)
            entry.optional = out.optional;
        if (out.from_delegated)
            entry.from_delegated = out.from_delegated;
        let outResolved;
        if (stepConfig.parallel === true) {
            outResolved = resolveOutputPath(rawPath, runtimeDir);
        }
        else {
            try {
                outResolved = resolveOutputPath(resolveConcreteOutputPath(rawPath, params), runtimeDir);
            }
            catch {
                outResolved = resolveOutputPath(rawPath, runtimeDir);
            }
        }
        entry.resolved = outResolved.map(readValuePreview);
        return entry;
    });
    const bindings = {};
    if (paramBindings) {
        for (const [name, expr] of Object.entries(paramBindings)) {
            bindings[name] = { expr, value: bindingsApplied[name] };
        }
    }
    const tracePath = join(runtimeDir, 'trace.json');
    withTraceLock(tracePath, () => {
        try {
            const trace = JSON.parse(readFileSync(tracePath, 'utf-8'));
            const entry = (trace.steps ?? []).find((s) => s.name === stepName && s.loop_archived !== true);
            if (!entry)
                return;
            entry.inputs = inputsOut;
            entry.outputs = outputsOut;
            if (Object.keys(bindings).length > 0)
                entry.param_bindings = bindings;
            safeWriteJson(tracePath, trace);
        }
        catch {
        }
    });
}
export function toolStepComplete(args, paths = defaultPaths(), overrides) {
    const workflowName = args.name ||
        args.workflow_name;
    const stepName = args.step ||
        args.step_name;
    const summary = args.summary ?? '';
    const { runtimeDir: runtimeDirOverride, workflowYamlPath: yamlPathOverride } = normalizeRunOverrides(overrides);
    let defnDir;
    let workflow;
    if (yamlPathOverride !== null) {
        try {
            workflow = loadYaml(yamlPathOverride);
            normalizePerIterationOutputs(workflow);
            injectSpecAuthoringOutputs(workflow);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                error: `step_complete: failed to load workflow from '${yamlPathOverride}': ${msg}`,
            };
        }
        defnDir = dirname(yamlPathOverride);
    }
    else {
        ({ definitionDir: defnDir, workflow } = resolveWorkflow(workflowName, paths));
    }
    const runtimeDir = runtimeDirOverride ?? resolveRunRuntimeDir(paths, workflowName);
    const manifestPath = join(runtimeDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (!manifest.steps)
        manifest.steps = {};
    const _ownComplete = checkRunOwnership(manifest, 'step_complete');
    if (_ownComplete)
        return _ownComplete;
    const stepConfig = findStepConfig(workflow, stepName);
    const _bug077Gr = readGateResultForStep(runtimeDir, stepName);
    if (_bug077Gr !== null) {
        const _check = checkStepFailureBlocked(_bug077Gr, stepConfig, workflow, manifest);
        if (_check.blocked) {
            let _msg;
            if (_check.reason === 'all_branches_failed') {
                _msg =
                    `Cannot complete step '${stepName}': all ${_check.failedBranches.length} ` +
                        `parallel branches failed (catastrophic). Workflow cannot proceed. ` +
                        `Either retry the step (spawn fresh subagents) or abort the run. ` +
                        `This rule is not overridable.`;
            }
            else if (_check.reason === 'missing_branches') {
                _msg =
                    `Cannot complete step '${stepName}': ${_check.failedBranches.length} ` +
                        `parallel branch(es) never reported (indices [${_check.failedBranches.join(', ')}]). ` +
                        `This typically means the orchestrator's Task-tool spawn failed for ` +
                        `those branches (transient API error like "Tool failed; this may be ` +
                        `temporary") AND the orchestrator did not re-spawn them. Re-spawn ` +
                        `the missing branches and retry, or set ` +
                        `\`gate.allow_partial_step_complete: true\` in workflow.yaml if ` +
                        `partial completion is intentional.`;
            }
            else if (_check.reason === 'partial_branches_failed') {
                _msg =
                    `Cannot complete step '${stepName}': ${_check.failedBranches.length} ` +
                        `parallel branch(es) failed (indices [${_check.failedBranches.join(', ')}]). ` +
                        `Re-spawn the failed branches and retry, or set ` +
                        `\`gate.allow_partial_step_complete: true\` in workflow.yaml if ` +
                        `partial completion is intentional.`;
            }
            else {
                _msg =
                    `Cannot complete step '${stepName}': the latest gate-check failed ` +
                        `and the step has not been retried to success. Either retry the step ` +
                        `(spawn a fresh subagent) or abort the run. This rule is not overridable.`;
            }
            return {
                error: _msg,
                action: 'BLOCKED_PARTIAL_FAILURE',
                step: stepName,
                blocked_reason: _check.reason,
                failed_branches: _check.failedBranches,
            };
        }
    }
    {
        const wfGateEnf = (workflow.gate ?? {});
        const stepGateEnf = (stepConfig?.gate ?? {});
        const humanEnfEval = evaluateHumanGate(wfGateEnf, stepGateEnf, stepName, runtimeDir);
        if ('error' in humanEnfEval) {
            return { error: humanEnfEval.error, action: 'STOP_WORKFLOW' };
        }
        const humanEnf = humanEnfEval.required;
        const channelEnf = resolveHumanChannel(wfGateEnf, stepGateEnf);
        if (humanEnf && channelEnf !== 'terminal') {
            const startedAtRaw = manifest.steps?.[stepName]
                ?.started_at;
            const startedAt = startedAtRaw ? Date.parse(startedAtRaw) : Number.NaN;
            const allMsgs = findStepMessages(runtimeDir, stepName, 'human_gate');
            const passMsgs = Number.isNaN(startedAt)
                ? allMsgs
                : allMsgs.filter((m) => Date.parse(m.created_at) >= startedAt);
            const unanswered = passMsgs.filter((m) => !m.response);
            if (passMsgs.length === 0 || unanswered.length > 0) {
                const pendingIds = unanswered.map((m) => `'${m.message_id}'`).join(', ');
                return {
                    error: `Cannot complete step '${stepName}': its human gate uses the external channel ` +
                        `('${channelEnf}') and ` +
                        (passMsgs.length === 0
                            ? `no message was posted to the run inbox during the current pass.`
                            : `${unanswered.length} of its ${passMsgs.length} message(s) from the current pass ` +
                                `still lack a user response (${pendingIds}).`),
                    action: 'AWAITING_HUMAN_RESPONSE',
                    step: stepName,
                    ...(unanswered.length > 0
                        ? { message_id: unanswered[0].message_id }
                        : {}),
                    engine_instructions: passMsgs.length === 0
                        ? `No inbox message exists for step '${stepName}' in the current pass. Call ` +
                            `inbox(op:'rules', name: '${workflowName}', step: '${stepName}') for the message ` +
                            `rules, then ask via inbox(op:'ask') — it holds until the answer arrives and ` +
                            `returns it — then call step_complete again.`
                        : `Message(s) ${pendingIds} have no response for the current pass.` +
                            (inboxPageUrl() !== null
                                ? ` The user can answer at ${inboxPageUrl()} — relay that address if they are ` +
                                    `not watching a UI already.`
                                : '') +
                            ` Resume the ` +
                            `hold with inbox(op:'ask', name: '${workflowName}', message_id: <id>) for each ` +
                            `until responded (under relay_required, poll inbox(op:'check') instead and ` +
                            `record a terminal answer via inbox(op:'respond')). Then interpret ` +
                            `the responses and call step_complete again.`,
                };
            }
            const rejected = passMsgs.find((m) => !Array.isArray(m.items) &&
                m.response?.type === 'reject');
            if (rejected) {
                const feedback = String(rejected.response?.text ?? '').slice(0, 300);
                return {
                    error: `Cannot complete step '${stepName}': the user REJECTED message ` +
                        `'${rejected.message_id}' in the current pass` +
                        (feedback ? ` — their feedback: "${feedback}"` : '') +
                        `. A fresh reject never completes the pass.`,
                    action: 'USER_REJECTED',
                    step: stepName,
                    message_id: rejected.message_id,
                    engine_instructions: `The user refused. Re-run step '${stepName}' applying their feedback` +
                        (feedback ? ` ("${feedback}")` : '') +
                        ` — the cursor has not moved. The new pass re-stamps started_at: fetch ` +
                        `inbox(op:'rules') again, post the new question, and only a fresh answer can ` +
                        `complete the step. Do NOT move on to the next step, and do NOT edit outputs ` +
                        `to dodge the refusal.`,
                };
            }
        }
    }
    const isDelegationStep = Boolean(stepConfig && 'delegate_to' in stepConfig);
    const stepParamBindings = stepConfig?.param_bindings;
    const handoffEntries = (stepConfig?.outputs ?? []).filter((o) => typeof o === 'object' && o !== null && typeof o.from_delegated === 'string');
    let delegatedBaseDir = null;
    let delegationWarning = null;
    let resolvedChildRunId = null;
    const handoffApplied = [];
    if (isDelegationStep && stepConfig && (stepParamBindings || handoffEntries.length > 0)) {
        const delegatedName = String(stepConfig.delegate_to);
        const explicitId = args.delegated_run_id;
        let linkedId = null;
        if (explicitId) {
            try {
                const em = JSON.parse(readFileSync(join(runDir(paths.agentDir, explicitId), 'manifest.json'), 'utf-8'));
                if (em.workflow === delegatedName) {
                    linkedId = explicitId;
                }
                else {
                    delegationWarning =
                        `delegated_run_id '${explicitId}' is a run of workflow '${String(em.workflow)}', ` +
                            `not '${delegatedName}' — ignored; falling back to the engine's own linkage.`;
                }
            }
            catch {
                delegationWarning =
                    `delegated_run_id '${explicitId}' does not resolve to a readable run — ignored; ` +
                        `falling back to the engine's own linkage.`;
            }
        }
        if (!linkedId) {
            const stampedId = manifest.steps[stepName]?.delegation?.child_run_id;
            if (typeof stampedId === 'string' && stampedId.length > 0)
                linkedId = stampedId;
        }
        const resolvedChild = resolveDelegatedRunDir(paths, delegatedName, linkedId, manifest.run_id ?? null, stepName);
        if (resolvedChild.source === 'unresolved') {
            const refusal = resolvedChild.candidates > 0
                ? `Cannot resolve the delegated child run of '${delegatedName}' for step ` +
                    `'${stepName}': no forward stamp and none of the ${resolvedChild.candidates} ` +
                    `existing '${delegatedName}' run(s) backlink to THIS run+step. Refusing to ` +
                    `guess by recency — a foreign or stale run must never be served as this ` +
                    `step's child result. If a child run genuinely completed for this step, pass ` +
                    `its id explicitly: step_complete(..., delegated_run_id: "<child run id>"). ` +
                    `Otherwise run the delegated workflow first.`
                : `No run of delegated workflow '${delegatedName}' found — the child was never ` +
                    `initialized (or its run dir was purged). Run the delegated workflow, then ` +
                    `retry step_complete with delegated_run_id.`;
            delegationWarning = refusal;
            logEngine(`delegation resolution refused: ${refusal}`);
        }
        else {
            delegatedBaseDir = resolvedChild.dir;
            resolvedChildRunId = linkedId ?? pathBasename(resolvedChild.dir);
            if (resolvedChild.source === 'backlink') {
                logEngine(`delegation resolution: child for step '${stepName}' resolved via reverse linkage ` +
                    `(backlink scan) → ${resolvedChildRunId}.`);
            }
            try {
                const cm = JSON.parse(readFileSync(join(delegatedBaseDir, 'manifest.json'), 'utf-8'));
                if (cm.status && cm.status !== 'completed') {
                    const stoppedNote = cm.stopped
                        ? ` (stopped at step '${cm.stopped.step ?? '?'}': ${cm.stopped.reason ?? 'unknown'})`
                        : '';
                    const statusNote = `Delegated child run '${resolvedChildRunId}' is '${cm.status}'${stoppedNote} — ` +
                        `its deliverables are not a completed result.`;
                    delegationWarning = delegationWarning
                        ? `${delegationWarning} ${statusNote}`
                        : statusNote;
                }
            }
            catch {
            }
        }
        if (delegatedBaseDir === null) {
            return {
                error: `Delegation resolution failed for step '${stepName}': ` +
                    (delegationWarning ?? 'delegated child run not resolved'),
                action: 'FIX_AND_RETRY',
                step: stepName,
                validation_errors: [delegationWarning ?? 'delegated child run not resolved'],
            };
        }
        if (handoffEntries.length > 0) {
            if (delegatedBaseDir === null) {
                return {
                    error: `Delegation artifact handoff failed for step '${stepName}': ` +
                        (delegationWarning ?? 'delegated child run not resolved'),
                    action: 'FIX_AND_RETRY',
                    step: stepName,
                    validation_errors: [delegationWarning ?? 'delegated child run not resolved'],
                };
            }
            let childParams = {};
            try {
                const cm = JSON.parse(readFileSync(join(delegatedBaseDir, 'manifest.json'), 'utf-8'));
                childParams = (cm.params ?? {});
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return {
                    error: `Delegation artifact handoff failed for step '${stepName}': the delegated ` +
                        `child's manifest is unreadable (${msg}). Did the child run complete?`,
                    action: 'FIX_AND_RETRY',
                    step: stepName,
                    validation_errors: [msg],
                };
            }
            const handoffErrors = [];
            for (const entry of handoffEntries) {
                const src = String(entry.from_delegated);
                let srcResolved;
                try {
                    srcResolved = resolveConcreteOutputPath(src, childParams);
                }
                catch (e) {
                    if (e instanceof OutputPathError) {
                        handoffErrors.push(`from_delegated '${src}': ${e.message}`);
                        continue;
                    }
                    throw e;
                }
                const matches = resolveOutputPath(srcResolved, delegatedBaseDir);
                if (matches.length === 0) {
                    if (entry.optional) {
                        logEngine(`delegation handoff: optional from_delegated '${srcResolved}' not found in child run ` +
                            `'${resolvedChildRunId ?? delegatedName}' — skipped.`);
                        continue;
                    }
                    handoffErrors.push(`from_delegated '${srcResolved}' matched no file in the delegated child's run dir ` +
                        `(${delegatedBaseDir}). The child did not produce it — check the child workflow's ` +
                        `outputs or mark this handoff entry optional.`);
                    continue;
                }
                if (matches.length > 1) {
                    handoffErrors.push(`from_delegated '${srcResolved}' matched ${matches.length} files (need exactly 1): ` +
                        matches.map((m) => toPosixSlashes(relative(delegatedBaseDir, m))).join(', ') +
                        `. Narrow the pattern.`);
                    continue;
                }
                let destRel;
                try {
                    destRel = resolveConcreteOutputPath(String(entry.path ?? ''), (manifest.params ?? {}));
                }
                catch (e) {
                    if (e instanceof OutputPathError) {
                        handoffErrors.push(`output path '${String(entry.path)}': ${e.message}`);
                        continue;
                    }
                    throw e;
                }
                const destAbs = isAbsolute(destRel) || isDottedRoot(destRel) ? destRel : join(runtimeDir, destRel);
                try {
                    mkdirSync(dirname(destAbs), { recursive: true });
                    copyFileSync(matches[0], destAbs);
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    handoffErrors.push(`copy '${srcResolved}' → '${destRel}' failed: ${msg}`);
                    continue;
                }
                handoffApplied.push({
                    path: destRel,
                    from: toPosixSlashes(relative(delegatedBaseDir, matches[0])),
                });
            }
            if (handoffErrors.length > 0) {
                return {
                    error: `Delegation artifact handoff failed for step '${stepName}': ` +
                        handoffErrors.join('; ') +
                        (delegationWarning ? ` ${delegationWarning}` : ''),
                    action: 'FIX_AND_RETRY',
                    step: stepName,
                    validation_errors: handoffErrors,
                    ...(delegationWarning ? { delegation_warning: delegationWarning } : {}),
                };
            }
        }
    }
    if (stepConfig &&
        Array.isArray(stepConfig.outputs) &&
        stepConfig.outputs.length > 0 &&
        resolveStructuralGate(workflow.gate, stepConfig.gate)) {
        const _perStepGatePath = join(runtimeDir, 'gate-results', `${stepName}.json`);
        const gateResultPath = existsSync(_perStepGatePath)
            ? _perStepGatePath
            : join(runtimeDir, 'gate-result.json');
        let gateAlreadyRan = false;
        let gateResultExists = false;
        try {
            gateResultExists = statSync(gateResultPath).isFile();
        }
        catch (e) {
            if (!(e instanceof Error) || !('code' in e))
                throw e;
            gateResultExists = false;
        }
        if (gateResultExists) {
            try {
                const gr = JSON.parse(readFileSync(gateResultPath, 'utf-8'));
                if (gr.step === stepName && gr.passed === true)
                    gateAlreadyRan = true;
            }
            catch {
            }
        }
        if (!gateAlreadyRan) {
            const snap = loadSnapshot(runtimeDir, stepName);
            const stepData = (manifest.steps[stepName] ?? {});
            const startedAt = stepData.first_started_at ??
                stepData.started_at ??
                null;
            const validation = validateOutputs(stepConfig.outputs, defnDir, runtimeDir, { snapshot: snap, stepStartedAt: startedAt, params: manifest.params });
            if (!validation.passed) {
                return {
                    error: `Output validation failed for step '${stepName}': ${validation.details.join('; ')}`,
                    action: 'FIX_AND_RETRY',
                    step: stepName,
                    validation_errors: [...validation.details],
                };
            }
        }
        else {
            const isParallelStep = Boolean(stepConfig.parallel) || Boolean(manifest.parallel_branches);
            const optionalOutputs = stepConfig.outputs.filter((o) => typeof o === 'object' && o !== null && Boolean(o.optional));
            if (!isParallelStep && optionalOutputs.length > 0) {
                const snap = loadSnapshot(runtimeDir, stepName);
                const stepData = (manifest.steps[stepName] ?? {});
                const startedAt = stepData.first_started_at ??
                    stepData.started_at ??
                    null;
                const validation = validateOutputs(optionalOutputs, defnDir, runtimeDir, { snapshot: snap, stepStartedAt: startedAt, params: manifest.params });
                if (!validation.passed) {
                    return {
                        error: `Late-flushed optional output failed validation for step '${stepName}' ` +
                            `(the file was absent when the gate ran and appeared afterwards): ` +
                            validation.details.join('; '),
                        action: 'FIX_AND_RETRY',
                        step: stepName,
                        validation_errors: [...validation.details],
                    };
                }
            }
        }
    }
    let branchMergeInfo = null;
    if (manifest.parallel_branches && stepConfig?.parallel) {
        const branchCount = Object.keys(manifest.parallel_branches).length;
        const mergeSrcs = new Set();
        const moveScaffold = (branchSrc, destDir) => {
            let isDir = false;
            try {
                isDir = statSync(branchSrc).isDirectory();
            }
            catch (e) {
                if (!(e instanceof Error) || !('code' in e))
                    throw e;
                isDir = false;
            }
            if (!isDir)
                return;
            mergeSrcs.add(branchSrc);
            moveTreeContents(branchSrc, destDir);
            try {
                rmSync(branchSrc, { recursive: true, force: true });
            }
            catch {
            }
        };
        const rawOutputs = (stepConfig.outputs ?? []);
        const mergePass = () => {
            for (const [branchKey, branchInfoRaw] of Object.entries(manifest.parallel_branches ?? {})) {
                const branchInfo = branchInfoRaw;
                const scaffold = `_branch_${branchKey}`;
                const resolved = branchInfo.resolved_outputs;
                if (resolved && resolved.length > 0) {
                    for (const ro of resolved) {
                        if (!ro.scaffolded || !ro.working)
                            continue;
                        const wsegs = ro.working.split('/');
                        const idx = wsegs.indexOf(scaffold);
                        if (idx < 0)
                            continue;
                        moveScaffold(join(runtimeDir, ...wsegs.slice(0, idx + 1)), idx > 0 ? join(runtimeDir, ...wsegs.slice(0, idx)) : runtimeDir);
                    }
                }
                else {
                    for (const out of rawOutputs) {
                        const opath = out !== null && typeof out === 'object' && !Array.isArray(out)
                            ? (out.path ?? '')
                            : String(out);
                        const opathResolved = resolvePlaceholders(opath, manifest.params ?? {});
                        const baseParts = [];
                        for (const p of opathResolved.split('/')) {
                            if (p.includes('{') || p.includes('*'))
                                break;
                            baseParts.push(p);
                        }
                        const baseDir = baseParts.length > 0 ? join(runtimeDir, ...baseParts) : runtimeDir;
                        moveScaffold(join(baseDir, scaffold), baseDir);
                    }
                }
            }
        };
        mergePass();
        let leftovers = [...mergeSrcs].filter((s) => existsSync(s));
        if (leftovers.length > 0) {
            try {
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
            }
            catch {
            }
            mergePass();
            leftovers = [...mergeSrcs].filter((s) => existsSync(s));
        }
        branchMergeInfo = {
            branches: branchCount,
            ...(leftovers.length > 0
                ? {
                    incomplete: leftovers.map((s) => s.startsWith(runtimeDir) ? s.slice(runtimeDir.length + 1).replace(/\\/g, '/') : s),
                }
                : {}),
        };
        if (leftovers.length > 0) {
            // eslint-disable-next-line no-console
            console.error(`[workflow-engine] Warning: parallel branch merge INCOMPLETE for step ` +
                `'${stepName}' — still present after retry: ${branchMergeInfo.incomplete?.join(', ')}`);
        }
        // biome-ignore lint/performance/noDelete: required for exactOptionalPropertyTypes
        delete manifest.parallel_branches;
    }
    if (stepConfig) {
        const seqSteps = resolveActiveSequence(workflow, manifest);
        const stepNames = seqSteps.map((s) => s.name);
        const stepIdx = stepNames.indexOf(stepName);
        if (stepIdx >= 0 && stepIdx + 1 < stepNames.length) {
            const nextStepConfig = seqSteps[stepIdx + 1] ?? {};
            const pk = nextStepConfig.parallel_key ?? '';
            const pkMatch = pk ? /^([^.]+)\.(.+?)(?:\[(\w+)=(\w+)\])?$/.exec(pk) : null;
            if (pkMatch?.[3] && pkMatch[4]) {
                const structName = pkMatch[1] ?? '';
                const fieldPath = pkMatch[2] ?? '';
                const filterKey = pkMatch[3];
                const filterVal = pkMatch[4];
                const dataFile = join(runtimeDir, 'data', `${structName}.json`);
                let dataExists = false;
                try {
                    dataExists = statSync(dataFile).isFile();
                }
                catch (e) {
                    if (!(e instanceof Error) || !('code' in e))
                        throw e;
                    dataExists = false;
                }
                if (dataExists) {
                    try {
                        const data = JSON.parse(readFileSync(dataFile, 'utf-8'));
                        let items = data;
                        for (const key of fieldPath.split('.')) {
                            if (items !== null && typeof items === 'object' && !Array.isArray(items)) {
                                const obj = items;
                                if (key in obj) {
                                    items = obj[key];
                                    continue;
                                }
                            }
                            items = null;
                            break;
                        }
                        if (Array.isArray(items)) {
                            let fixed = 0;
                            for (const item of items) {
                                if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                                    const itemObj = item;
                                    if (!(filterKey in itemObj)) {
                                        itemObj[filterKey] = filterVal;
                                        fixed += 1;
                                    }
                                }
                            }
                            if (fixed > 0) {
                                safeWriteJson(dataFile, data);
                                logEngine(`Normalized ${fixed} items: ${filterKey}->${filterVal} in ${dataFile}`);
                            }
                        }
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        logEngine(`Warning: failed to normalize parallel_key data: ${msg}`);
                    }
                }
            }
        }
    }
    const now = nowIsoLocal();
    if (!(stepName in manifest.steps))
        manifest.steps[stepName] = {};
    const stepRecord = manifest.steps[stepName];
    stepRecord.status = 'completed';
    stepRecord.completed_at = now;
    stepRecord.summary = summary;
    manifest.updated_at = now;
    const stepStarted = stepRecord.started_at;
    if (stepStarted) {
        try {
            const startMs = Date.parse(stepStarted);
            const endMs = Date.parse(now);
            if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
                stepRecord.duration_ms = Math.floor(endMs - startMs);
            }
        }
        catch {
        }
    }
    const freshToolEvents = consumeToolEvents(runtimeDir, manifest, stepName);
    reclassifyScriptTools(freshToolEvents, workflow, workflowName);
    reclassifyBashRunScriptTools(freshToolEvents, workflow);
    reclassifyMcpTools(freshToolEvents, workflow);
    {
        const msteps = (manifest.steps ?? {});
        for (const c of freshToolEvents) {
            const owner = typeof c.step === 'string' ? c.step : '';
            if (!owner || owner === stepName || !(owner in msteps))
                continue;
            const rec = (msteps[owner] ?? {});
            const credited = new Set(Array.isArray(rec.tools_called) ? rec.tools_called : []);
            const full = c.tool || '';
            const short = c.tool_short || (full ? (full.split('__').pop() ?? '') : '');
            if (full)
                credited.add(full);
            if (short)
                credited.add(short);
            const wfTool = c.wf_tool;
            if (wfTool)
                credited.add(wfTool);
            rec.tools_called = [...credited];
            if (c.kind === 'mcp') {
                const servers = new Set(Array.isArray(rec.mcp_servers_called) ? rec.mcp_servers_called : []);
                const server = (typeof c.server === 'string' && c.server) ||
                    (full.startsWith('mcp__') ? (full.split('__')[1] ?? '') : '');
                if (server)
                    servers.add(server);
                rec.mcp_servers_called = [...servers];
            }
            msteps[owner] = rec;
        }
    }
    const stepToolWarnings = [];
    let toolVerificationRan = false;
    const isSubagentStep = stepConfig?.subagent !== false;
    if (stepConfig && isSubagentStep) {
        const wfTools = (workflow.tools ?? []);
        const stepToolsFilter = stepConfig.tools;
        if (wfTools.length > 0 && stepToolsFilter && stepToolsFilter.length > 0) {
            for (const t of wfTools) {
                if (t.name === undefined) {
                    logEngine(`Warning: workflow.tools entry missing 'name' — skipped`);
                }
            }
            const expectedTools = wfTools.filter((t) => t.name !== undefined && stepToolsFilter.includes(t.name));
            if (expectedTools.length > 0) {
                toolVerificationRan = true;
                const stepCalls = freshToolEvents;
                const unattributed = unattributedLedgerToolNames(runtimeDir);
                const calledTools = new Set(Array.isArray(stepRecord.tools_called) ? stepRecord.tools_called : []);
                for (const c of stepCalls) {
                    const full = c.tool || '';
                    const short = c.tool_short || (full ? (full.split('__').pop() ?? '') : '');
                    if (full)
                        calledTools.add(full);
                    if (short)
                        calledTools.add(short);
                    const wfTool = c.wf_tool;
                    if (wfTool)
                        calledTools.add(wfTool);
                }
                stepRecord.tools_called = [...calledTools];
                const mcpSeen = new Set(Array.isArray(stepRecord.mcp_servers_called)
                    ? stepRecord.mcp_servers_called
                    : []);
                const engineHost = getEngineHost();
                const caps = hostToolCaps(engineHost);
                for (const tool of expectedTools) {
                    const tname = tool.name;
                    const ttype = tool.type ?? 'script';
                    if (ttype === 'script') {
                        const wfNameNorm = normalizeForMcp(workflow.name ?? workflowName);
                        const tnameNorm = normalizeForMcp(tname);
                        const registered = `${wfNameNorm}__${tnameNorm}`;
                        const prefixed = `mcp__workflow_tools__${registered}`;
                        if (caps.scriptReliable &&
                            !calledTools.has(tname) &&
                            !calledTools.has(prefixed) &&
                            !calledTools.has(registered) &&
                            !unattributed.has(tname) &&
                            !unattributed.has(prefixed) &&
                            !unattributed.has(registered)) {
                            stepToolWarnings.push({
                                tool: tname,
                                type: 'script',
                                warning: `Custom tool '${tname}' was declared for use in step '${stepName}' but was not called. If the step's goal requires it, make sure it is invoked.`,
                            });
                        }
                    }
                    else if (ttype === 'mcp') {
                        const mcpPrefix = `mcp__${tname}__`;
                        const mcpCalled = mcpSeen.has(tname) ||
                            stepCalls.some((c) => c.kind === 'mcp' &&
                                ((c.tool ?? '').startsWith(mcpPrefix) ||
                                    c.server === tname));
                        if (mcpCalled)
                            mcpSeen.add(tname);
                        const requiredVal = 'required' in tool ? tool.required : true;
                        const hasExpected = Array.isArray(tool.expected_tools) && tool.expected_tools.length > 0;
                        const canDetect = caps.mcpPrefixed || hasExpected;
                        const mcpEvidence = unattributed.has(`mcp-server:${tname}`) ||
                            [...unattributed].some((n) => n.startsWith(mcpPrefix));
                        if (caps.mcpReliable && canDetect && !mcpCalled && !mcpEvidence && requiredVal) {
                            stepToolWarnings.push({
                                tool: tname,
                                type: 'mcp',
                                warning: `MCP server '${tname}' was declared (required) but no tool calls detected. Server may not be running.`,
                            });
                        }
                    }
                }
                stepRecord.mcp_servers_called = [...mcpSeen];
            }
        }
    }
    if (toolVerificationRan) {
        if (stepToolWarnings.length > 0) {
            stepRecord.tool_warnings = stepToolWarnings;
            logEngine(`Tool warnings for ${stepName}: ${stepToolWarnings.length}`);
        }
        else {
            delete stepRecord.tool_warnings;
        }
    }
    const contextDir = join(runtimeDir, 'context');
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, `${stepName}.summary.md`), summary, 'utf-8');
    const bindingsApplied = {};
    const paramBindings = stepParamBindings;
    if (isDelegationStep)
        _pendingDelegation = null;
    if (paramBindings) {
        for (const [paramName, bindingExpr] of Object.entries(paramBindings)) {
            try {
                const parts = bindingExpr.split('::');
                if (parts.length !== 2) {
                    throw new Error(`Invalid binding (expected exactly one '::'): ${bindingExpr}`);
                }
                const filePath = parts[0] ?? '';
                const fieldPath = parts[1] ?? '';
                let baseDir;
                if (isDelegationStep) {
                    if (delegatedBaseDir === null) {
                        throw new Error(delegationWarning ?? 'delegated child run not resolved');
                    }
                    baseDir = delegatedBaseDir;
                }
                else {
                    baseDir = runtimeDir;
                }
                const absPath = join(baseDir, filePath);
                const data = JSON.parse(readFileSync(absPath, 'utf-8'));
                const value = readJsonField(data, fieldPath);
                if (!manifest.params)
                    manifest.params = {};
                manifest.params[paramName] = value;
                bindingsApplied[paramName] = value;
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                bindingsApplied[paramName] = { error: msg };
                logEngine(`param_binding '${paramName}' failed: ${msg}`);
            }
        }
    }
    if (stepConfig) {
        enrichStepIO(runtimeDir, stepName, stepConfig, (manifest.params ?? {}), defnDir, bindingsApplied, stepConfig.param_bindings);
    }
    const laneCtxOfStep = laneContextOf(workflow, stepName);
    const stepOrder = (laneCtxOfStep
        ? staticSequenceOf(workflow, stepName)
        : resolveActiveSequence(workflow, manifest)).map((s) => s.name);
    const loopBackCfg = stepConfig?.loop_back;
    if (loopBackCfg && typeof loopBackCfg === 'object') {
        const stepData = (manifest.steps[stepName] ?? {});
        const loopState = (stepData.loop_state ?? { iterations: 0 });
        const iterations = typeof loopState.iterations === 'number' ? loopState.iterations : 0;
        const loopResolvedThisPass = loopState.resolved_for_pass === iterations && !loopState.pending;
        const evalResult = loopResolvedThisPass
            ? { kind: 'proceed' }
            : evaluateLoopBack(loopBackCfg, loopState, args, runtimeDir);
        if (evalResult.kind === 'error') {
            return {
                error: `loop_back evaluation failed for step '${stepName}': ${evalResult.message}` +
                    deciderErrorDirective('loop'),
                action: 'STOP_WORKFLOW',
                step: stepName,
            };
        }
        if (evalResult.kind === 'awaiting') {
            loopState.pending = {
                ...(evalResult.scriptSaysLoop !== undefined
                    ? { script_says_loop: evalResult.scriptSaysLoop }
                    : (loopState.pending ?? {})),
                asked_at: nowIsoLocal(),
            };
            loopState.iterations = iterations;
            stepData.loop_state = loopState;
            manifest.steps[stepName] = stepData;
            safeWriteJson(manifestPath, manifest);
            const runIdAwait = manifest.run_id ?? '';
            if (runIdAwait)
                flushTraceSnapshot(runtimeDir, runIdAwait, manifest, stepName, workflow);
            appendToolCallsToTrace(runtimeDir, freshToolEvents);
            return {
                step: stepName,
                status: 'completed',
                action: 'AWAITING_LOOP_DECISION',
                workflow_done: false,
                loop: {
                    to: loopBackCfg.to,
                    iteration: iterations,
                    max_iterations: loopBackCfg.max_iterations,
                    ...(evalResult.scriptSaysLoop !== undefined
                        ? { script_says_loop: evalResult.scriptSaysLoop }
                        : {}),
                },
                engine_instructions: composeLoopDecisionInstructions(stepName, loopBackCfg, iterations, evalResult.scriptSaysLoop ??
                    loopState.pending.script_says_loop),
            };
        }
        if (!loopResolvedThisPass) {
            loopState.pending = null;
            loopState.last_decision = evalResult.kind;
            loopState.last_decided_by = evalResult.decidedBy;
            if (evalResult.rationale !== undefined)
                loopState.last_rationale = evalResult.rationale;
            if (evalResult.kind === 'proceed')
                loopState.resolved_for_pass = iterations;
        }
        if (evalResult.kind === 'loop') {
            loopState.iterations = iterations + 1;
            stepData.loop_state = loopState;
            manifest.steps[stepName] = stepData;
            if (!manifest.params)
                manifest.params = {};
            manifest.params.iteration = loopState.iterations;
            const toIdx = stepOrder.indexOf(loopBackCfg.to);
            const currIdx = stepOrder.indexOf(stepName);
            const runIdLoop = manifest.run_id ?? '';
            if (runIdLoop) {
                flushTraceSnapshot(runtimeDir, runIdLoop, manifest, stepName, workflow);
                recordLoopTraceEvent(runtimeDir, runIdLoop, stepOrder, toIdx, currIdx, {
                    kind: 'loop_back',
                    phase: loopState.iterations,
                    next_phase: loopState.iterations + 1,
                    to: loopBackCfg.to,
                    from: stepName,
                    decided_by: evalResult.decidedBy,
                });
            }
            for (let j = toIdx; j <= currIdx && j >= 0; j += 1) {
                const sName = stepOrder[j] ?? '';
                const sData = (manifest.steps[sName] ?? {});
                sData.status = 'pending';
                delete sData.first_started_at;
                if (j !== currIdx && sData.loop_state !== undefined)
                    delete sData.loop_state;
                manifest.steps[sName] = sData;
                deleteSnapshot(runtimeDir, sName);
            }
            setCursorFor(workflow, manifest, loopBackCfg.to);
            safeWriteJson(manifestPath, manifest);
            appendToolCallsToTrace(runtimeDir, freshToolEvents);
            const loopNextBegin = composeNextBeginForAdvance({
                workflowName,
                workflow,
                defnDir,
                runtimeDir,
                manifestPath,
                nextStep: loopBackCfg.to,
                paths,
            });
            return {
                step: stepName,
                status: 'completed',
                action: 'LOOP_BACK',
                next_step: loopBackCfg.to,
                workflow_done: false,
                loop: {
                    to: loopBackCfg.to,
                    iteration: loopState.iterations,
                    max_iterations: loopBackCfg.max_iterations,
                    decided_by: evalResult.decidedBy,
                    ...(evalResult.rationale !== undefined ? { rationale: evalResult.rationale } : {}),
                },
                params: manifest.params ?? {},
                engine_instructions: `LOOP_BACK — the engine has reset steps [${loopBackCfg.to} .. ${stepName}] to pending and ` +
                    `moved the cursor to '${loopBackCfg.to}'. ` +
                    (loopNextBegin !== null
                        ? `next_begin below carries the full begin payload for '${loopBackCfg.to}' — do NOT ` +
                            `call step_begin; compose the subagent task from it and continue IMMEDIATELY. `
                        : `Obey: call step_begin('${loopBackCfg.to}') next. `) +
                    `Do NOT call workflow_finalize and do NOT treat this as an error — repetition here is ` +
                    `engine-owned control flow (loop_back), not a failure.`,
                ...(loopNextBegin !== null ? { next_begin: loopNextBegin } : {}),
            };
        }
        stepData.loop_state = loopState;
        manifest.steps[stepName] = stepData;
        const exitIterations = typeof loopState.iterations === 'number' ? loopState.iterations : 0;
        const runIdExit = manifest.run_id ?? '';
        if (!loopResolvedThisPass && exitIterations > 0 && runIdExit) {
            recordLoopTraceEvent(runtimeDir, runIdExit, stepOrder, stepOrder.indexOf(loopBackCfg.to), stepOrder.indexOf(stepName), {
                kind: 'loop_exit',
                phase: exitIterations + 1,
                decided_by: evalResult.decidedBy,
                from: stepName,
                to: loopBackCfg.to,
            });
        }
    }
    else if (typeof args.loop_decision === 'string') {
        logEngine(`Warning: step_complete received loop_decision for step '${stepName}' which has ` +
            `no loop_back block — ignored`);
    }
    let routeProceedNote = null;
    const routesCfg = stepConfig?.routes;
    if (routesCfg && typeof routesCfg === 'object' && Array.isArray(routesCfg.define)) {
        const stepData = (manifest.steps[stepName] ?? {});
        const routeState = (stepData.route_state ?? {});
        const evalR = evaluateRoutes(routesCfg, routeState, args, runtimeDir);
        if (evalR.kind === 'error') {
            return {
                error: `routes evaluation failed for step '${stepName}': ${evalR.message}` +
                    deciderErrorDirective('route'),
                action: 'STOP_WORKFLOW',
                step: stepName,
            };
        }
        if (evalR.kind === 'awaiting') {
            routeState.pending = {
                ...(evalR.scriptRoute !== undefined
                    ? { script_route: evalR.scriptRoute }
                    : (routeState.pending ?? {})),
                asked_at: nowIsoLocal(),
            };
            stepData.route_state = routeState;
            manifest.steps[stepName] = stepData;
            safeWriteJson(manifestPath, manifest);
            const runIdAwait = manifest.run_id ?? '';
            if (runIdAwait)
                flushTraceSnapshot(runtimeDir, runIdAwait, manifest, stepName, workflow);
            appendToolCallsToTrace(runtimeDir, freshToolEvents);
            return {
                step: stepName,
                status: 'completed',
                action: 'AWAITING_ROUTE_DECISION',
                workflow_done: false,
                ...(branchMergeInfo ? { branch_merge: branchMergeInfo } : {}),
                routes: {
                    options: routesCfg.define.map((r) => r.id),
                    ...(evalR.scriptRoute !== undefined ? { script_route: evalR.scriptRoute } : {}),
                },
                engine_instructions: composeRouteDecisionInstructions(stepName, routesCfg, evalR.scriptRoute ?? routeState.pending?.script_route),
            };
        }
        routeState.pending = null;
        routeState.last_decision = evalR.kind === 'route' ? evalR.routeId : 'proceed';
        routeState.last_decided_by = evalR.decidedBy;
        if (evalR.rationale !== undefined)
            routeState.last_rationale = evalR.rationale;
        stepData.route_state = routeState;
        manifest.steps[stepName] = stepData;
        if (evalR.kind === 'route') {
            const routeId = evalR.routeId;
            const routeDef = collectAllRoutes(workflow).find((r) => r.id === routeId);
            const routeSteps = (routeDef?.steps ?? []);
            const returnTo = laneCtxOfStep
                ? staticNextOf(workflow, stepName)
                : computeProceedTarget(workflow, manifest, stepName);
            if (!laneCtxOfStep) {
                const stack = [
                    ...(manifest.route_stack ?? []),
                ];
                const activeNames = resolveActiveSequence(workflow, manifest).map((s) => s.name);
                const isLastInSeq = activeNames.indexOf(stepName) === activeNames.length - 1;
                if (stack.length > 0 && isLastInSeq)
                    stack.pop();
                stack.push({ route_id: routeId, owner_step: stepName, return_to: returnTo });
                manifest.route_stack = stack;
            }
            const ownerLaneStamp = laneCtxOfStep
                ? manifest.steps[stepName]?.lane ?? {
                    lane_id: laneCtxOfStep.laneId,
                    fork_step: laneCtxOfStep.forkStep,
                }
                : null;
            for (const rs of routeSteps) {
                const rsName = rs.name;
                const existing = (manifest.steps[rsName] ?? {});
                delete existing.first_started_at;
                delete existing.loop_state;
                manifest.steps[rsName] = {
                    ...existing,
                    status: 'pending',
                    route: { route_id: routeId, owner_step: stepName },
                    ...(ownerLaneStamp ? { lane: { ...ownerLaneStamp } } : {}),
                };
                deleteSnapshot(runtimeDir, rsName);
            }
            const firstStep = routeSteps[0]?.name ?? null;
            if (firstStep)
                setCursorFor(workflow, manifest, firstStep);
            safeWriteJson(manifestPath, manifest);
            const runIdR = manifest.run_id ?? '';
            if (runIdR) {
                flushTraceSnapshot(runtimeDir, runIdR, manifest, stepName, workflow);
                recordRouteTraceEvent(runtimeDir, runIdR, {
                    kind: 'route_enter',
                    route_id: routeId,
                    owner_step: stepName,
                    steps: routeSteps.map((s) => s.name),
                    decided_by: evalR.decidedBy ?? 'orchestrator',
                });
            }
            appendToolCallsToTrace(runtimeDir, freshToolEvents);
            const routeNextBegin = firstStep !== null
                ? composeNextBeginForAdvance({
                    workflowName,
                    workflow,
                    defnDir,
                    runtimeDir,
                    manifestPath,
                    nextStep: firstStep,
                    paths,
                })
                : null;
            return {
                step: stepName,
                status: 'completed',
                action: 'ENTER_ROUTE',
                next_step: firstStep,
                workflow_done: false,
                ...(branchMergeInfo ? { branch_merge: branchMergeInfo } : {}),
                route: {
                    id: routeId,
                    owner_step: stepName,
                    decided_by: evalR.decidedBy,
                    ...(evalR.rationale !== undefined ? { rationale: evalR.rationale } : {}),
                },
                params: manifest.params ?? {},
                engine_instructions: `ENTER_ROUTE — the engine selected route '${routeId}' and injected its steps into the ` +
                    `run as ordinary steps. ` +
                    (routeNextBegin !== null
                        ? `next_begin below carries the full begin payload for '${firstStep}' — do NOT call ` +
                            `step_begin; compose the subagent task from it and continue IMMEDIATELY, then run ` +
                            `the route's steps in order like any other steps. `
                        : `Obey: call step_begin('${firstStep}') next, then run the ` +
                            `route's steps in order like any other steps. `) +
                    `When the route's last step completes the ` +
                    `engine returns the cursor to the following step automatically. Do NOT call ` +
                    `workflow_finalize early and do NOT treat this as an error — routing is engine-owned ` +
                    `control flow.`,
                ...(routeNextBegin !== null ? { next_begin: routeNextBegin } : {}),
            };
        }
        if (evalR.note)
            routeProceedNote = evalR.note;
    }
    else if (typeof args.route_decision === 'string') {
        logEngine(`Warning: step_complete received route_decision for step '${stepName}' which has ` +
            `no routes block — ignored`);
    }
    const lanesCfg = stepConfig?.lanes;
    if (lanesCfg && Array.isArray(lanesCfg.define) && lanesCfg.define.length > 0) {
        const stepDataFork = (manifest.steps[stepName] ?? {});
        const laneEntries = {};
        const laneMap = {};
        lanesCfg.define.forEach((lane, laneNo) => {
            const laneId = lane.id;
            lane.steps.forEach((rs, pos) => {
                const rsName = rs.name;
                const existing = (manifest.steps[rsName] ?? {});
                delete existing.first_started_at;
                delete existing.loop_state;
                manifest.steps[rsName] = {
                    ...existing,
                    status: 'pending',
                    lane: { lane_id: laneId, fork_step: stepName, lane_no: laneNo, pos },
                };
                deleteSnapshot(runtimeDir, rsName);
            });
            const first = lane.steps[0]?.name ?? '';
            laneEntries[laneId] = { cursor: first, status: 'running' };
            laneMap[laneId] = first;
        });
        stepDataFork.lane_state = {
            lanes: laneEntries,
            return_to: staticNextOf(workflow, stepName),
        };
        manifest.steps[stepName] = stepDataFork;
        manifest.active_lanes = [...activeLaneOwners(manifest), stepName];
        safeWriteJson(manifestPath, manifest);
        const runIdLanes = manifest.run_id ?? '';
        if (runIdLanes) {
            flushTraceSnapshot(runtimeDir, runIdLanes, manifest, stepName, workflow);
            recordLaneTraceEvent(runtimeDir, runIdLanes, {
                kind: 'lanes_enter',
                fork_step: stepName,
                lanes: lanesCfg.define.map((l) => ({
                    lane_id: l.id,
                    steps: (l.steps ?? []).map((st) => st.name),
                })),
            });
        }
        appendToolCallsToTrace(runtimeDir, freshToolEvents);
        const lanesBegin = {};
        for (const [laneId, firstLaneStep] of Object.entries(laneMap)) {
            const p = composeNextBeginForAdvance({
                workflowName,
                workflow,
                defnDir,
                runtimeDir,
                manifestPath,
                nextStep: firstLaneStep,
                paths,
            });
            if (p !== null)
                lanesBegin[laneId] = p;
        }
        const lanesBeginCount = Object.keys(lanesBegin).length;
        return {
            step: stepName,
            status: 'completed',
            action: 'ENTER_LANES',
            next_step: null,
            workflow_done: false,
            lanes: laneMap,
            ...(branchMergeInfo ? { branch_merge: branchMergeInfo } : {}),
            params: manifest.params ?? {},
            engine_instructions: `ENTER_LANES — the engine registered ${lanesCfg.define.length} parallel lanes: ` +
                Object.entries(laneMap)
                    .map(([id, first]) => `'${id}' starts at step '${first}'`)
                    .join('; ') +
                `. Drive ALL lanes concurrently. ` +
                (lanesBeginCount === Object.keys(laneMap).length
                    ? `lanes_begin below carries the full begin payload for EVERY lane's first step — ` +
                        `do NOT call step_begin; compose each lane's subagent task from its payload and ` +
                        `spawn the independent lane subagents IN ONE MESSAGE where the host allows it. `
                    : `Each lane's next step is independently beginnable — ` +
                        (lanesBeginCount > 0
                            ? `lanes_begin below carries begin payloads for SOME lanes (compose them directly, ` +
                                `no step_begin); for the lanes absent from it call step_begin as usual. `
                            : `call step_begin for each and `) +
                        `spawn the independent lane subagents IN ONE MESSAGE where the host allows it. `) +
                `Lanes advance independently (each may loop or route ` +
                `within itself); the engine returns the cursor past the fork only after EVERY lane ` +
                `reaches a terminal state (the join barrier). Do NOT call workflow_finalize and do ` +
                `NOT treat this as an error — the fork is engine-owned control flow.`,
            ...(lanesBeginCount > 0 ? { lanes_begin: lanesBegin } : {}),
        };
    }
    let nextStep = null;
    let routeExit = null;
    let lanesExitInfo = null;
    if (laneCtxOfStep) {
        let cur = stepName;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const nxt = staticNextOf(workflow, cur);
            if (nxt) {
                nextStep = nxt;
                break;
            }
            const cont = containerOf(workflow, cur);
            if (cont.kind === 'route') {
                const contOfOwner = containerOf(workflow, cont.ownerStep);
                const toCtx = contOfOwner.kind === 'route'
                    ? `route: ${contOfOwner.routeId}`
                    : contOfOwner.kind === 'lane'
                        ? `lane: ${contOfOwner.laneId}`
                        : 'main';
                routeExit = { from: cont.routeId, to: toCtx, next_step: null };
                const runIdEx = manifest.run_id ?? '';
                if (runIdEx) {
                    recordRouteTraceEvent(runtimeDir, runIdEx, {
                        kind: 'route_exit',
                        route_id: cont.routeId,
                        owner_step: cont.ownerStep,
                        to: toCtx,
                        next_step: null,
                    });
                }
                cur = cont.ownerStep;
                continue;
            }
            if (cont.kind === 'main') {
                nextStep = null;
                break;
            }
            const forkStep = cont.forkStep;
            const ls = laneStateOf(manifest, forkStep);
            if (!ls) {
                logEngine(`Warning: lane advance for '${cur}' found no lane_state on fork '${forkStep}'`);
                nextStep = null;
                break;
            }
            const ownEntry = ls.lanes[cont.laneId];
            if (ownEntry) {
                ownEntry.cursor = null;
                ownEntry.status = 'completed';
            }
            let anyRunning = false;
            for (const entry of Object.values(ls.lanes)) {
                if (entry.status !== 'running' || !entry.cursor)
                    continue;
                const sibGr = readGateResultForStep(runtimeDir, entry.cursor);
                const sibCfg = findStepConfig(workflow, entry.cursor);
                if (sibGr !== null &&
                    sibCfg !== null &&
                    checkStepFailureBlocked(sibGr, sibCfg, workflow, manifest).blocked) {
                    entry.status = 'failed';
                    continue;
                }
                anyRunning = true;
            }
            if (anyRunning) {
                safeWriteJson(manifestPath, manifest);
                const runIdWait = manifest.run_id ?? '';
                if (runIdWait)
                    flushTraceSnapshot(runtimeDir, runIdWait, manifest, stepName, workflow);
                appendToolCallsToTrace(runtimeDir, freshToolEvents);
                const running = Object.entries(ls.lanes)
                    .filter(([, e]) => e.status === 'running' && e.cursor)
                    .map(([id, e]) => ({ lane_id: id, next_step: e.cursor }));
                return {
                    step: stepName,
                    status: 'completed',
                    action: 'LANE_WAIT',
                    next_step: null,
                    workflow_done: false,
                    lane_done: { fork_step: forkStep, lane_id: cont.laneId },
                    lanes_running: running,
                    params: manifest.params ?? {},
                    engine_instructions: `LANE_WAIT — lane '${cont.laneId}' of fork '${forkStep}' is complete, but ` +
                        `sibling lane(s) are still live: ` +
                        running.map((r) => `'${r.lane_id}' -> next step '${r.next_step}'`).join('; ') +
                        `. Keep driving them; the engine returns the cursor past the fork when every ` +
                        `lane reaches a terminal state. Do NOT call workflow_finalize and do NOT retry ` +
                        `this call — this is normal fork control flow.`,
                };
            }
            const forkCfg = findStepConfig(workflow, forkStep);
            const joinCfg = (forkCfg?.lanes?.join ?? {});
            const requirePolicy = joinCfg.require === 'any' ? 'any' : 'all';
            const verdicts = {};
            for (const [id, e] of Object.entries(ls.lanes))
                verdicts[id] = e.status;
            const failedLanes = Object.entries(ls.lanes).filter(([, e]) => e.status === 'failed');
            const completedLanes = Object.entries(ls.lanes).filter(([, e]) => e.status === 'completed');
            if (completedLanes.length === 0 || (requirePolicy === 'all' && failedLanes.length > 0)) {
                safeWriteJson(manifestPath, manifest);
                const runIdBlk = manifest.run_id ?? '';
                if (runIdBlk)
                    flushTraceSnapshot(runtimeDir, runIdBlk, manifest, stepName, workflow);
                appendToolCallsToTrace(runtimeDir, freshToolEvents);
                const failedList = failedLanes
                    .map(([id]) => {
                    const e = ls.lanes[id];
                    return `'${id}' (parked at step '${e?.cursor ?? '?'}')`;
                })
                    .join(', ');
                return {
                    step: stepName,
                    status: 'completed',
                    action: 'BLOCKED_LANES_FAILED',
                    next_step: null,
                    workflow_done: false,
                    lanes_exit: { fork_step: forkStep, require: requirePolicy, lanes: verdicts },
                    params: manifest.params ?? {},
                    error: `Join barrier of fork '${forkStep}' is blocked: require '${requirePolicy}' and ` +
                        `lane(s) ${failedList} failed ` +
                        `(${completedLanes.length}/${Object.keys(ls.lanes).length} completed).` +
                        `\n\nORCHESTRATOR DIRECTIVE: report the failed lane(s) to the user. To re-drive ` +
                        `a failed lane, call step_begin on its parked step; a successful pass ` +
                        `re-evaluates the barrier. Do NOT finalize the run.`,
                };
            }
            const joinIndex = { require: requirePolicy, lanes: {} };
            for (const lane of (forkCfg?.lanes?.define ?? [])) {
                const laneId = lane.id;
                const outs = [];
                for (const st of collectAllSteps({ steps: lane.steps })) {
                    for (const o of st.outputs ?? []) {
                        const rawPath = typeof o === 'string' ? o : typeof o?.path === 'string' ? o.path : '';
                        if (!rawPath)
                            continue;
                        const resolved = rawPath.replace(/\{([a-z][a-z0-9_.]*)\}/g, (m, key) => {
                            const v = manifest.params?.[key];
                            return typeof v === 'string' || typeof v === 'number' ? String(v) : m;
                        });
                        outs.push(resolved);
                    }
                }
                joinIndex.lanes[laneId] = {
                    verdict: verdicts[laneId] ?? 'unknown',
                    outputs: outs,
                };
            }
            mkdirSync(join(runtimeDir, 'data'), { recursive: true });
            safeWriteJson(join(runtimeDir, 'data', `${forkStep}-join.json`), joinIndex);
            manifest.active_lanes = activeLaneOwners(manifest).filter((o) => o !== forkStep);
            lanesExitInfo = { fork_step: forkStep, require: requirePolicy, lanes: verdicts };
            const runIdJoin = manifest.run_id ?? '';
            if (runIdJoin) {
                recordLaneTraceEvent(runtimeDir, runIdJoin, {
                    kind: 'lanes_join',
                    fork_step: forkStep,
                    require: requirePolicy,
                    verdicts,
                });
            }
            cur = forkStep;
        }
        if (nextStep)
            setCursorFor(workflow, manifest, nextStep);
    }
    else {
        const idxInSeq = stepOrder.indexOf(stepName);
        if (idxInSeq >= 0 && idxInSeq + 1 < stepOrder.length) {
            nextStep = stepOrder[idxInSeq + 1] ?? null;
        }
        else if (idxInSeq >= 0) {
            const stack = [
                ...(manifest.route_stack ?? []),
            ];
            if (stack.length > 0) {
                const frame = stack.pop();
                manifest.route_stack = stack;
                nextStep = frame?.return_to ?? null;
                const toCtx = stack.length > 0 ? `route: ${stack[stack.length - 1]?.route_id}` : 'main';
                routeExit = { from: frame?.route_id ?? '', to: toCtx, next_step: nextStep };
                const runIdEx = manifest.run_id ?? '';
                if (runIdEx) {
                    recordRouteTraceEvent(runtimeDir, runIdEx, {
                        kind: 'route_exit',
                        route_id: frame?.route_id ?? '',
                        owner_step: frame?.owner_step ?? '',
                        to: toCtx,
                        next_step: nextStep,
                    });
                }
            }
            else {
                nextStep = null;
            }
        }
        else {
            logEngine(`Warning: step '${stepName}' not in active sequence`);
        }
        if (nextStep)
            manifest.current_step = nextStep;
    }
    safeWriteJson(manifestPath, manifest);
    const runIdForTrace = manifest.run_id ?? '';
    if (runIdForTrace) {
        flushTraceSnapshot(runtimeDir, runIdForTrace, manifest, stepName, workflow);
    }
    appendToolCallsToTrace(runtimeDir, freshToolEvents);
    const result = {
        step: stepName,
        status: 'completed',
        next_step: nextStep,
        workflow_done: nextStep === null,
        params: manifest.params ?? {},
    };
    if (Object.keys(bindingsApplied).length > 0)
        result.param_bindings_applied = bindingsApplied;
    if (stepToolWarnings.length > 0)
        result.tool_warnings = stepToolWarnings;
    if (delegationWarning)
        result.delegation_warning = delegationWarning;
    if (resolvedChildRunId)
        result.delegated_run_id = resolvedChildRunId;
    if (handoffApplied.length > 0)
        result.delegated_outputs = handoffApplied;
    const instrParts = [];
    if (branchMergeInfo) {
        result.branch_merge = branchMergeInfo;
        if (branchMergeInfo.incomplete && branchMergeInfo.incomplete.length > 0) {
            instrParts.push(`WARNING — parallel branch merge INCOMPLETE: after a retry, files still remain under: ` +
                `${branchMergeInfo.incomplete.join(', ')} (likely a transient file lock). For ` +
                `downstream steps, read those outputs from the listed _branch_ paths directly and ` +
                `mention this in your summary. Do NOT edit or move the files yourself — the engine ` +
                `owns the layout; report instead.`);
        }
        else {
            instrParts.push(`Parallel branch isolation is RESOLVED (verified): the engine merged ` +
                `${branchMergeInfo.branches} _branch_N/ ` +
                `director${branchMergeInfo.branches === 1 ? 'y' : 'ies'} into the declared output ` +
                `locations and removed them. Downstream steps read these outputs at their DECLARED ` +
                `paths (no _branch_ segment) — do NOT add _branch_ fallback instructions to later ` +
                `subagent prompts.`);
        }
    }
    if (routeProceedNote)
        instrParts.push(routeProceedNote);
    if (lanesExitInfo) {
        result.lanes_exit = lanesExitInfo;
        const forkName = String(lanesExitInfo.fork_step ?? '');
        const verdictLine = Object.entries((lanesExitInfo.lanes ?? {}))
            .map(([id, v]) => `'${id}': ${v}`)
            .join(', ');
        instrParts.push(`JOIN — every lane of fork '${forkName}' reached a terminal state (${verdictLine}); ` +
            `the barrier passed (require: ${String(lanesExitInfo.require)}) ` +
            `and the engine returned the cursor past the fork. The collection index is at ` +
            `data/${forkName}-join.json (per-lane verdict + declared output paths) — the next ` +
            `step can read the lane outputs directly from their declared locations. This is ` +
            `normal engine-owned control flow, NOT an error.`);
    }
    const nextBegin = nextStep !== null && nextStep !== undefined
        ? composeNextBeginForAdvance({
            workflowName,
            workflow,
            defnDir,
            runtimeDir,
            manifestPath,
            nextStep,
            paths,
        })
        : null;
    if (routeExit) {
        result.route_exit = routeExit;
        instrParts.push(`Route '${routeExit.from}' is finished — the engine returned the cursor to ` +
            (nextStep ? `'${nextStep}' (${routeExit.to})` : `the ${routeExit.to} flow (no further step)`) +
            `. This is normal engine-owned control flow (the route's steps are exhausted), NOT an ` +
            `error. ` +
            (nextStep
                ? nextBegin !== null
                    ? `next_begin below carries the full begin payload for '${nextStep}' — do NOT call ` +
                        `step_begin; compose the subagent task from it and continue IMMEDIATELY.`
                    : `Obey: call step_begin('${nextStep}') next.`
                : `The workflow is done — call workflow_finalize.`));
    }
    if (!routeExit) {
        instrParts.push(nextStep
            ? nextBegin !== null
                ? `Step '${stepName}' is complete. next_begin below carries the FULL begin payload ` +
                    `for '${nextStep}' — do NOT call step_begin; compose the subagent task from it and ` +
                    `continue IMMEDIATELY (spawn now — do not stop to announce the transition; the run ` +
                    `is waiting on you, not on the user).`
                : `Step '${stepName}' is complete. Continue IMMEDIATELY: call step_begin('${nextStep}') now — ` +
                    `do not stop to announce the transition; the run is waiting on you, not on the user.`
            : `Step '${stepName}' is complete and it was the last one — call workflow_finalize now.`);
    }
    if (instrParts.length > 0)
        result.engine_instructions = instrParts.join('\n\n');
    if (nextBegin !== null)
        result.next_begin = nextBegin;
    return result;
}
export function toolWorkflowFinalize(args, paths = defaultPaths(), overrides) {
    const workflowName = args.name ||
        args.workflow_name;
    const { runtimeDir: runtimeDirOverride, workflowYamlPath: yamlPathOverride } = normalizeRunOverrides(overrides);
    const runtimeDir = runtimeDirOverride ?? resolveRunRuntimeDir(paths, workflowName);
    const manifestPath = join(runtimeDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (!manifest.steps)
        manifest.steps = {};
    const _ownFinalize = checkRunOwnership(manifest, 'workflow_finalize');
    if (_ownFinalize)
        return _ownFinalize;
    const now = nowIsoLocal();
    const allDone = Object.values(manifest.steps ?? {}).every((s) => {
        const st = s.status;
        return st === 'completed' || st === 'skipped';
    });
    const finalStatus = allDone ? 'completed' : 'failed';
    manifest.status = finalStatus;
    manifest.completed_at = now;
    manifest.updated_at = now;
    const promotedSteps = new Set();
    if (finalStatus === 'failed') {
        for (const [sname, sdata] of Object.entries(manifest.steps ?? {})) {
            const s = sdata;
            if (s.status === 'in_progress') {
                s.status = 'failed';
                s.completed_at = now;
                promotedSteps.add(sname);
            }
        }
    }
    if (manifest.scope_managed === true) {
        const projectRootFinalize = dirname(paths.agentDir);
        try {
            const preserved = manifest.preserved_active_scope;
            if (preserved === null || preserved === undefined) {
                scopeClearUserActiveScope(projectRootFinalize);
            }
            else if (typeof preserved === 'string') {
                try {
                    scopeWriteUserActiveScope(preserved, projectRootFinalize);
                }
                catch {
                    scopeClearUserActiveScope(projectRootFinalize);
                }
            }
            else {
                scopeClearUserActiveScope(projectRootFinalize);
            }
            manifest.scope_managed = false;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // eslint-disable-next-line no-console
            console.error(`[workflow-engine] Warning: workflow_finalize could not restore ` +
                `active-scope (preserved=${String(manifest.preserved_active_scope)}): ${msg}`);
        }
    }
    safeWriteJson(manifestPath, manifest);
    let workflow;
    if (yamlPathOverride !== null) {
        workflow = loadYaml(yamlPathOverride);
    }
    else {
        ({ workflow } = resolveWorkflow(workflowName, paths));
    }
    const wfSteps = (workflow.steps ?? []);
    const runId = manifest.run_id ?? '';
    const tracePath = join(runtimeDir, 'trace.json');
    let traceFinalized = false;
    let traceExists = false;
    try {
        traceExists = statSync(tracePath).isFile();
    }
    catch (e) {
        if (!(e instanceof Error) || !('code' in e))
            throw e;
        traceExists = false;
    }
    if (traceExists) {
        const traceLockFd = acquireTraceLockOrNull(tracePath);
        try {
            const trace = JSON.parse(readFileSync(tracePath, 'utf-8'));
            trace.completed_at = now;
            trace.status = finalStatus;
            const started = trace.started_at ?? now;
            const startMs = Date.parse(started);
            const endMs = Date.parse(now);
            if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
                trace.total_duration_ms = Math.floor(endMs - startMs);
            }
            let totalMsgs = 0;
            let totalTools = 0;
            const allFiles = new Set();
            for (const stepEntry of trace.steps ?? []) {
                const invs = stepEntry.invocations ?? [];
                for (const inv of invs) {
                    totalMsgs += inv.message_count ?? 0;
                    totalTools += inv.tool_call_count ?? 0;
                    const mf = inv.modified_files ?? [];
                    for (const fp of mf)
                        allFiles.add(fp);
                }
            }
            let totalStepDuration = 0;
            for (const sdata of Object.values(manifest.steps ?? {})) {
                const dur = sdata.duration_ms;
                if (typeof dur === 'number' && dur > 0)
                    totalStepDuration += dur;
            }
            trace.total_messages = totalMsgs;
            trace.total_tool_calls = totalTools;
            trace.total_modified_files = allFiles.size;
            trace.total_step_duration_ms = totalStepDuration;
            const traceStepNames = new Set((trace.steps ?? []).map((s) => s.name));
            for (let si = 0; si < wfSteps.length; si += 1) {
                const s = wfSteps[si] ?? {};
                const sname = s.name;
                if (!traceStepNames.has(sname)) {
                    const mstep = manifest.steps[sname] ?? {};
                    const mstatus = mstep.status;
                    if (mstatus === 'completed' || mstatus === 'skipped') {
                        const isDelegation = 'delegate_to' in s;
                        const note = isDelegation
                            ? `Delegation step (delegate_to: ${s.delegate_to})`
                            : 'Synthetic — no hook invocations recorded';
                        const syntheticEntry = {
                            name: sname,
                            index: si,
                            status: mstatus,
                            config: {
                                spec_check: 'spec_check' in s ? s.spec_check : false,
                                ...('spec_authoring' in s ? { spec_authoring: s.spec_authoring } : {}),
                                subagent: 'subagent' in s ? s.subagent : true,
                                gate: s.gate,
                            },
                            goal: s.goal,
                            inputs: s.inputs,
                            outputs: s.outputs,
                            started_at: mstep.started_at,
                            completed_at: mstep.completed_at,
                            duration_ms: mstep.duration_ms,
                            invocations: [],
                            retry_count: 0,
                            summary: mstep.summary,
                            tool_warnings: mstep.tool_warnings,
                            note,
                        };
                        if (isDelegation) {
                            syntheticEntry.delegate_to = s.delegate_to;
                        }
                        trace.steps.push(syntheticEntry);
                    }
                }
            }
            if (promotedSteps.size > 0) {
                for (const traceStep of trace.steps ?? []) {
                    if (traceStep.loop_archived === true)
                        continue;
                    const sname = traceStep.name;
                    if (!promotedSteps.has(sname))
                        continue;
                    traceStep.status = 'failed';
                    const mstep = (manifest.steps[sname] ?? {});
                    if (mstep.completed_at)
                        traceStep.completed_at = mstep.completed_at;
                    if (traceStep.note === undefined || traceStep.note === null) {
                        traceStep.note =
                            'Promoted at finalize — the run failed while this step was still ' +
                                'in_progress; no terminal gate verdict was observed for it.';
                    }
                }
            }
            for (const traceStep of trace.steps ?? []) {
                const sname = traceStep.name;
                const mstep = (manifest.steps[sname] ?? {});
                const tw = mstep.tool_warnings;
                if (tw && !('tool_warnings' in traceStep))
                    traceStep.tool_warnings = tw;
                const pf = mstep.prompt_files;
                if (pf) {
                    const enriched = pf.map((fp, i) => {
                        const entry = { path: fp, branch_index: i };
                        try {
                            entry.content = readFileSync(fp, 'utf-8');
                        }
                        catch {
                            entry.content = null;
                        }
                        return entry;
                    });
                    traceStep.prompt_files = enriched;
                }
                const planning = mstep.planning;
                if (planning) {
                    traceStep.planning = { ...planning };
                    const childWfPath = planning.child_workflow_path;
                    const childRunId = planning.child_run_id;
                    if (typeof childWfPath === 'string' &&
                        childWfPath.length > 0 &&
                        typeof childRunId === 'string' &&
                        childRunId.length > 0) {
                        traceStep.child_trace_path = join(dirname(childWfPath), 'trace.json');
                    }
                }
                const delegateTo = traceStep.delegate_to;
                if (typeof delegateTo === 'string' && delegateTo.length > 0) {
                    try {
                        const stampedChildId = manifest.steps?.[traceStep.name]
                            ?.delegation?.child_run_id;
                        const resolvedForEmbed = resolveDelegatedRunDir(paths, delegateTo, typeof stampedChildId === 'string' ? stampedChildId : null, manifest.run_id ?? null, traceStep.name ?? '');
                        if (resolvedForEmbed.dir === null)
                            throw new Error('unresolved child (no embed)');
                        const delegatedRunDir = resolvedForEmbed.dir;
                        const childManifestPath = join(delegatedRunDir, 'manifest.json');
                        const childManifest = JSON.parse(readFileSync(childManifestPath, 'utf-8'));
                        const childRunId = childManifest.run_id;
                        if (typeof childRunId === 'string' && childRunId.length > 0) {
                            traceStep.child_trace_path = join(delegatedRunDir, 'trace.json');
                            try {
                                traceStep._embedded_child_trace = JSON.parse(readFileSync(join(delegatedRunDir, 'trace.json'), 'utf-8'));
                            }
                            catch {
                            }
                        }
                    }
                    catch {
                    }
                }
            }
            trace.steps.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
            const matching = [];
            const remaining = [];
            for (const c of mcpCallLog()) {
                const matchesWorkflow = c.workflow === workflowName;
                const isUtilityCall = (c.tool === 'workflow_resolve' || c.tool === 'list_agent_files') &&
                    (c.workflow === workflowName || c.workflow == null);
                if (matchesWorkflow || isUtilityCall)
                    matching.push(c);
                else
                    remaining.push(c);
            }
            if (matching.length > 0) {
                trace.mcp_calls = matching;
                trace.total_mcp_calls = matching.length;
            }
            clearMcpCallLog();
            for (const c of remaining)
                appendMcpCall(c);
            const errorLog = join(paths.agentDir, 'gate-check-error.log');
            try {
                const errors = readFileSync(errorLog, 'utf-8').trim();
                if (errors && runId && errors.includes(runId)) {
                    trace.warnings = errors.split('\n').filter((line) => line.includes(runId));
                }
            }
            catch {
            }
            safeWriteJson(tracePath, trace);
            traceFinalized = true;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // eslint-disable-next-line no-console
            console.error(`[workflow-engine] Trace finalization failed: ${msg}`);
        }
        finally {
            if (traceLockFd !== null)
                releaseFileLock(traceLockFd, `${tracePath}.lock`);
        }
    }
    appendToolCallsToTrace(runtimeDir, consumeToolEvents(runtimeDir, manifest, null));
    const stepStatuses = {};
    for (const [sname, sdata] of Object.entries(manifest.steps ?? {})) {
        stepStatuses[sname] = sdata.status ?? 'unknown';
    }
    appendRunEvent(paths.agentDir, {
        run_id: runId,
        workflow: workflowName,
        event: 'finalized',
        status: finalStatus,
        at: nowIsoLocal(),
    });
    clearCurrentRunId();
    return {
        workflow: workflowName,
        status: finalStatus,
        steps: stepStatuses,
        trace_finalized: traceFinalized,
        run_id: runId,
    };
}
export function fnmatch(name, pattern) {
    const normalize = (s) => process.platform === 'win32' ? s.replace(/\\/g, '/') : s;
    const normalizedName = normalize(name);
    const normalizedPattern = normalize(pattern);
    let re = '';
    let i = 0;
    const escapeChar = (c) => /[.+^${}()|\\]/.test(c) ? `\\${c}` : c;
    while (i < normalizedPattern.length) {
        const c = normalizedPattern[i];
        if (c === '*') {
            re += '.*';
            i += 1;
        }
        else if (c === '?') {
            re += '.';
            i += 1;
        }
        else if (c === '[') {
            let j = i + 1;
            if (normalizedPattern[j] === '!')
                j += 1;
            if (normalizedPattern[j] === ']')
                j += 1;
            while (j < normalizedPattern.length && normalizedPattern[j] !== ']') {
                j += 1;
            }
            if (j >= normalizedPattern.length) {
                re += '\\[';
                i += 1;
            }
            else {
                let body = normalizedPattern.slice(i + 1, j);
                if (body.startsWith('!'))
                    body = `^${body.slice(1)}`;
                re += `[${body}]`;
                i = j + 1;
            }
        }
        else {
            re += escapeChar(c);
            i += 1;
        }
    }
    const flags = process.platform === 'win32' ? 'i' : '';
    return new RegExp(`^${re}$`, flags).test(normalizedName);
}
export function toolListAgentFiles(args) {
    const path = args.path ?? `${PRODUCT_DIR}/`;
    const pattern = args.pattern;
    let isDir = false;
    try {
        isDir = statSync(path).isDirectory();
    }
    catch (e) {
        if (!(e instanceof Error))
            throw e;
        isDir = false;
    }
    if (!isDir) {
        return { files: [], error: `Directory not found: ${path}` };
    }
    const collected = [];
    walkSkipSymlinkDirs(path, collected);
    const files = [];
    for (const full of collected) {
        let isFile = false;
        try {
            isFile = statSync(full).isFile();
        }
        catch {
        }
        if (!isFile)
            continue;
        const baseName = full.replace(/\\/g, '/').split('/').pop() ?? full;
        if (pattern && !fnmatch(baseName, pattern))
            continue;
        files.push(full.replace(/\\/g, '/'));
    }
    files.sort();
    return { files, count: files.length };
}
function walkSkipSymlinkDirs(dir, out) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf-8' });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) {
            out.push(full);
            continue;
        }
        if (entry.isDirectory()) {
            walkSkipSymlinkDirs(full, out);
            continue;
        }
        out.push(full);
    }
}
