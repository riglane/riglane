import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configDir } from '../../config/config.js';
export function workflowParamsPath() {
    return join(configDir(), 'workflow-params.json');
}
function readStore() {
    try {
        const path = workflowParamsPath();
        if (!existsSync(path))
            return {};
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return {};
        return parsed;
    }
    catch {
        return {};
    }
}
function writeStore(store) {
    try {
        const path = workflowParamsPath();
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
    }
    catch {
    }
}
export function loadWorkflowState(projectKey, workflow) {
    const store = readStore();
    const entry = store[projectKey]?.[workflow];
    if (!entry || typeof entry !== 'object')
        return { params: {} };
    const params = typeof entry.params === 'object' && entry.params !== null && !Array.isArray(entry.params)
        ? { ...entry.params }
        : {};
    const state = { params };
    if (typeof entry.target === 'string')
        state.target = entry.target;
    if (typeof entry.modelOverride === 'string')
        state.modelOverride = entry.modelOverride;
    return state;
}
function mutate(projectKey, workflow, fn) {
    const store = readStore();
    const project = store[projectKey] ?? {};
    const current = project[workflow] ?? { params: {} };
    const base = { params: { ...current.params } };
    if (current.target !== undefined)
        base.target = current.target;
    if (current.modelOverride !== undefined)
        base.modelOverride = current.modelOverride;
    project[workflow] = fn(base);
    store[projectKey] = project;
    writeStore(store);
}
export function saveWorkflowParam(projectKey, workflow, name, value) {
    mutate(projectKey, workflow, (state) => {
        if (value.length === 0) {
            delete state.params[name];
        }
        else {
            state.params[name] = value;
        }
        return state;
    });
}
export function saveWorkflowTarget(projectKey, workflow, target) {
    mutate(projectKey, workflow, (state) => ({ ...state, target }));
}
export function saveWorkflowModelOverride(projectKey, workflow, modelOverride) {
    mutate(projectKey, workflow, (state) => {
        if (modelOverride.length === 0) {
            delete state.modelOverride;
            return state;
        }
        return { ...state, modelOverride };
    });
}
