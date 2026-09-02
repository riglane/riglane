
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { configDir } from '../../config/config.js';

export interface WorkflowRunState {
  params: Record<string, string>;
  target?: string;
  modelOverride?: string;
}

type Store = Record<string, Record<string, WorkflowRunState>>;

export function workflowParamsPath(): string {
  return join(configDir(), 'workflow-params.json');
}

function readStore(): Store {
  try {
    const path = workflowParamsPath();
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    const path = workflowParamsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  } catch {
  }
}

export function loadWorkflowState(projectKey: string, workflow: string): WorkflowRunState {
  const store = readStore();
  const entry = store[projectKey]?.[workflow];
  if (!entry || typeof entry !== 'object') return { params: {} };
  const params =
    typeof entry.params === 'object' && entry.params !== null && !Array.isArray(entry.params)
      ? { ...(entry.params as Record<string, string>) }
      : {};
  const state: WorkflowRunState = { params };
  if (typeof entry.target === 'string') state.target = entry.target;
  if (typeof entry.modelOverride === 'string') state.modelOverride = entry.modelOverride;
  return state;
}

function mutate(
  projectKey: string,
  workflow: string,
  fn: (state: WorkflowRunState) => WorkflowRunState,
): void {
  const store = readStore();
  const project = store[projectKey] ?? {};
  const current = project[workflow] ?? { params: {} };
  const base: WorkflowRunState = { params: { ...current.params } };
  if (current.target !== undefined) base.target = current.target;
  if (current.modelOverride !== undefined) base.modelOverride = current.modelOverride;
  project[workflow] = fn(base);
  store[projectKey] = project;
  writeStore(store);
}

export function saveWorkflowParam(
  projectKey: string,
  workflow: string,
  name: string,
  value: string,
): void {
  mutate(projectKey, workflow, (state) => {
    if (value.length === 0) {
      delete state.params[name];
    } else {
      state.params[name] = value;
    }
    return state;
  });
}

export function saveWorkflowTarget(projectKey: string, workflow: string, target: string): void {
  mutate(projectKey, workflow, (state) => ({ ...state, target }));
}

export function saveWorkflowModelOverride(
  projectKey: string,
  workflow: string,
  modelOverride: string,
): void {
  mutate(projectKey, workflow, (state) => {
    if (modelOverride.length === 0) {
      delete state.modelOverride;
      return state;
    }
    return { ...state, modelOverride };
  });
}
