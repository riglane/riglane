import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findInProgressRuns, findRunsByWorkflow, runDir } from './runs.js';
export function normalizeName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
export function makeToolName(workflowName, toolName) {
    return `${normalizeName(workflowName)}__${normalizeName(toolName)}`;
}
export function mcpServerToolName(serverName, toolName) {
    return `mcp__${normalizeName(serverName)}__${normalizeName(toolName)}`;
}
export const DENY_CAPABILITIES = ['shell'];
export const DENY_SPELLINGS = {
    shell: {
        claude: ['Bash', 'PowerShell'],
        opencode: ['bash'],
        copilot: ['execute'],
        gemini: ['run_shell_command'],
    },
};
export function stepDeniedCapabilities(step) {
    const raw = step.deny;
    if (!Array.isArray(raw))
        return [];
    return raw.filter((c) => typeof c === 'string' && DENY_CAPABILITIES.includes(c));
}
export const SPEC_ENGINE_TOOLS = ['spec_write', 'spec_search', 'spec_link'];
export function stepAuthorsSpecs(step) {
    return step.spec_authoring === 'persist' || step.spec_authoring === 'validate';
}
export function resolveStepToolEntries(workflow, step) {
    const wfTools = Array.isArray(workflow.tools)
        ? workflow.tools
        : [];
    const stepToolsFilter = step.tools;
    const active = Array.isArray(stepToolsFilter)
        ? wfTools.filter((t) => stepToolsFilter.includes(t.name ?? ''))
        : [];
    const entries = [];
    for (const toolDef of active) {
        const ttype = toolDef.type;
        const tname = toolDef.name;
        if (!tname)
            continue;
        if (ttype === 'script') {
            entries.push({ kind: 'script', tool: tname });
        }
        else if (ttype === 'mcp') {
            const expected = Array.isArray(toolDef.expected_tools)
                ? toolDef.expected_tools
                : [];
            for (const subTool of expected) {
                entries.push({ kind: 'mcp', tool: subTool, server: tname });
            }
        }
    }
    const specTools = new Set();
    if (step.spec_check === true) {
        specTools.add('spec_search');
        specTools.add('spec_link');
    }
    if (stepAuthorsSpecs(step)) {
        for (const t of SPEC_ENGINE_TOOLS)
            specTools.add(t);
    }
    for (const t of SPEC_ENGINE_TOOLS) {
        if (specTools.has(t))
            entries.push({ kind: 'spec', tool: t });
    }
    return entries;
}
export function stepBranchProfiles(step) {
    const raw = step.branch_profiles;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const entries = Object.entries(raw).filter(([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v));
    if (entries.length === 0)
        return null;
    return Object.fromEntries(entries);
}
export function profileIdForItem(item) {
    if (item === null || typeof item !== 'object')
        return null;
    const o = item;
    if (typeof o.profile === 'string' && o.profile.length > 0)
        return o.profile;
    if (typeof o.name === 'string' && o.name.length > 0)
        return o.name;
    return null;
}
export function profileFreezeKey(stepName, profileId) {
    return `${stepName}::${profileId}`;
}
export function profileNarrowedStep(step, profile) {
    return { ...step, tools: [...(profile.tools ?? [])] };
}
export function freezeStepTools(workflow, allSteps) {
    const wfName = workflow.name ?? '';
    const toFrozen = (e) => {
        if (e.kind === 'script')
            return { kind: 'script', name: makeToolName(wfName, e.tool) };
        if (e.kind === 'mcp')
            return { kind: 'mcp', name: e.tool, server: e.server ?? '' };
        return { kind: 'spec', name: e.tool };
    };
    const out = {};
    for (const step of allSteps) {
        const stepName = step.name ?? '';
        if (!stepName)
            continue;
        out[stepName] = resolveStepToolEntries(workflow, step).map(toFrozen);
        const profiles = stepBranchProfiles(step);
        if (profiles) {
            for (const [pid, profile] of Object.entries(profiles)) {
                out[profileFreezeKey(stepName, pid)] = resolveStepToolEntries(workflow, profileNarrowedStep(step, profile)).map(toFrozen);
            }
        }
    }
    return out;
}
export function composeUndeclaredToolRefusal(prefix, toolLabel, scopeClause) {
    return (`${prefix}: '${toolLabel}' is NOT declared ${scopeClause} and will not run.\n` +
        `Do not call it. Reach the step's goal with the tools it declares; if that is impossible, ` +
        `stop and report why.\n` +
        `Do NOT edit workflow.yaml and do NOT retry — which tools a step may use is an ` +
        `authoring decision, not yours.\n`);
}
function readRunManifest(agentDir, runId) {
    try {
        return JSON.parse(readFileSync(join(runDir(agentDir, runId), 'manifest.json'), 'utf-8'));
    }
    catch {
        return null;
    }
}
function activeStepsOf(m) {
    const owners = Array.isArray(m.active_lanes)
        ? m.active_lanes.filter((x) => typeof x === 'string')
        : [];
    if (owners.length === 0) {
        return typeof m.current_step === 'string' && m.current_step ? [m.current_step] : [];
    }
    const ownerSet = new Set(owners);
    const out = [];
    for (const fork of owners) {
        const lanes = m.steps?.[fork]?.lane_state?.lanes ?? {};
        for (const entry of Object.values(lanes)) {
            if (entry.status === 'completed')
                continue;
            const cur = entry.cursor;
            if (typeof cur !== 'string' || !cur)
                continue;
            if (ownerSet.has(cur))
                continue;
            out.push(cur);
        }
    }
    return out;
}
function setContainsScript(set, calledName) {
    return (set ?? []).some((e) => e.kind === 'script' && e.name === calledName);
}
function setContainsMcp(set, calledFullName) {
    return (set ?? []).some((e) => e.kind === 'mcp' && mcpServerToolName(e.server ?? '', e.name) === calledFullName);
}
function frozenVerdictForStepBy(agentDir, workflowName, stepName, contains, profileId) {
    const runs = findRunsByWorkflow(agentDir, workflowName, 'in_progress');
    let sawFreezeForStep = false;
    for (const runId of runs) {
        const m = readRunManifest(agentDir, runId);
        const set = (profileId !== undefined
            ? m?.step_tools?.[profileFreezeKey(stepName, profileId)]
            : undefined) ?? m?.step_tools?.[stepName];
        if (set === undefined)
            continue;
        sawFreezeForStep = true;
        if (contains(set))
            return 'declared';
    }
    return sawFreezeForStep ? 'undeclared' : 'no-freeze';
}
export function frozenVerdictForStep(agentDir, workflowName, stepName, calledName, profileId) {
    return frozenVerdictForStepBy(agentDir, workflowName, stepName, (set) => setContainsScript(set, calledName), profileId);
}
export function frozenMcpVerdictForStep(agentDir, workflowName, stepName, calledFullName, profileId) {
    return frozenVerdictForStepBy(agentDir, workflowName, stepName, (set) => setContainsMcp(set, calledFullName), profileId);
}
export function guardScriptToolCall(agentDir, workflowName, calledName) {
    const runsOfW = findRunsByWorkflow(agentDir, workflowName, 'in_progress');
    if (runsOfW.length === 0) {
        if (findInProgressRuns(agentDir).length === 0) {
            return { allowed: true, reason: 'zero-runs' };
        }
        return {
            allowed: false,
            reason: 'no-run-of-workflow',
            refusal: composeUndeclaredToolRefusal('workflow_tools', calledName, `for any active step (no run of workflow '${workflowName}' is in progress)`),
        };
    }
    const currentSteps = [];
    let sawFreeze = false;
    for (const runId of runsOfW) {
        const m = readRunManifest(agentDir, runId);
        if (m === null)
            continue;
        if (m.step_tools === undefined) {
            return { allowed: true, reason: 'no-freeze' };
        }
        sawFreeze = true;
        for (const cur of activeStepsOf(m)) {
            currentSteps.push(cur);
            if (setContainsScript(m.step_tools[cur], calledName)) {
                return { allowed: true, reason: 'declared' };
            }
        }
    }
    if (!sawFreeze) {
        return { allowed: true, reason: 'no-freeze' };
    }
    const curLabel = currentSteps.length > 0 ? currentSteps.join("', '") : '<none>';
    return {
        allowed: false,
        reason: 'undeclared',
        refusal: composeUndeclaredToolRefusal('workflow_tools', calledName, `for the current step of any in-progress run of workflow '${workflowName}' ` +
            `(current step: '${curLabel}')`),
    };
}
