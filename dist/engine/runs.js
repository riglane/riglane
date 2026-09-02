import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isValidRunId } from './run-id.js';
export function runsRootDir(agentDir) {
    return join(agentDir, 'local', 'workflow_runs');
}
export function runDir(agentDir, runId) {
    if (!isValidRunId(runId)) {
        throw new Error(`Invalid run_id (unsafe as a path segment): ${JSON.stringify(runId)}`);
    }
    return join(runsRootDir(agentDir), runId);
}
export function runManifestPath(agentDir, runId) {
    return join(runDir(agentDir, runId), 'manifest.json');
}
export function runTracePath(agentDir, runId) {
    return join(runDir(agentDir, runId), 'trace.json');
}
export function runDataDir(agentDir, runId) {
    return join(runDir(agentDir, runId), 'data');
}
export function runToolEventsPath(agentDir, runId) {
    return join(runDir(agentDir, runId), 'tool-events.jsonl');
}
export function ensureRunDir(agentDir, runId) {
    const dir = runDir(agentDir, runId);
    mkdirSync(runDataDir(agentDir, runId), { recursive: true });
    return dir;
}
export function runIndexPath(agentDir) {
    return join(runsRootDir(agentDir), 'index.jsonl');
}
export function appendRunEvent(agentDir, evt) {
    try {
        mkdirSync(runsRootDir(agentDir), { recursive: true });
        appendFileSync(runIndexPath(agentDir), `${JSON.stringify(evt)}\n`, { encoding: 'utf-8' });
    }
    catch {
    }
}
export function findRunsByWorkflow(agentDir, workflowName, status) {
    const root = runsRootDir(agentDir);
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const out = [];
    for (const e of entries) {
        if (!e.isDirectory())
            continue;
        try {
            const m = JSON.parse(readFileSync(join(root, e.name, 'manifest.json'), 'utf-8'));
            if (m.workflow !== workflowName)
                continue;
            if (status !== undefined && m.status !== status)
                continue;
            out.push(e.name);
        }
        catch {
        }
    }
    return out.sort();
}
export function findInProgressRuns(agentDir) {
    const root = runsRootDir(agentDir);
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const out = [];
    for (const e of entries) {
        if (!e.isDirectory())
            continue;
        try {
            const m = JSON.parse(readFileSync(join(root, e.name, 'manifest.json'), 'utf-8'));
            if (m.status === 'in_progress')
                out.push(e.name);
        }
        catch {
        }
    }
    return out.sort();
}
export function readRunIndex(agentDir) {
    const path = runIndexPath(agentDir);
    let raw;
    try {
        if (!statSync(path).isFile())
            return [];
        raw = readFileSync(path, 'utf-8');
    }
    catch {
        return [];
    }
    const out = [];
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t)
            continue;
        try {
            out.push(JSON.parse(t));
        }
        catch {
        }
    }
    return out;
}
