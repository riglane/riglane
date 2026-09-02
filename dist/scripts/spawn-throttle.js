import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { PRODUCT_DIR } from '../config/paths.js';
import { resolveProjectRoot } from '../engine/project-root.js';
import { findStepConfig } from '../engine/workflow-tree.js';
import { loadYaml } from '../engine/schema-validate.js';
function logStderr(msg) {
    process.stderr.write(`[spawn-throttle] ${msg}\n`);
}
function findWorkflowRuntimeDir() {
    const runsDir = join(resolveProjectRoot() ?? '.', PRODUCT_DIR, 'local', 'workflow_runs');
    if (!existsSync(runsDir))
        return null;
    try {
        if (!statSync(runsDir).isDirectory())
            return null;
    }
    catch {
        return null;
    }
    let bestDir = null;
    let bestTime = '';
    let entries;
    try {
        entries = readdirSync(runsDir);
    }
    catch {
        return null;
    }
    for (const runId of entries) {
        if (runId === 'index.jsonl')
            continue;
        const manifestPath = join(runsDir, runId, 'manifest.json');
        if (!existsSync(manifestPath))
            continue;
        try {
            const fst = statSync(manifestPath);
            if (!fst.isFile())
                continue;
        }
        catch {
            continue;
        }
        let data;
        try {
            data = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        }
        catch {
            continue;
        }
        const status = data.status;
        if (status !== 'in_progress' && status !== 'paused')
            continue;
        const updated = typeof data.updated_at === 'string' ? data.updated_at : '';
        if (updated > bestTime) {
            bestTime = updated;
            bestDir = join(runsDir, runId);
        }
    }
    return bestDir;
}
function findWorkflowYaml(workflowName) {
    const root = resolveProjectRoot() ?? '.';
    const candidates = [
        join(root, PRODUCT_DIR, 'workflows', 'templates', 'my_workflows', workflowName, 'workflow.yaml'),
        join(root, PRODUCT_DIR, 'workflows', 'templates', 'predefined', workflowName, 'workflow.yaml'),
        join(root, PRODUCT_DIR, 'workflows', 'templates', 'examples', workflowName, 'workflow.yaml'),
        join(root, PRODUCT_DIR, 'workflows', 'templates', 'community', workflowName, 'workflow.yaml'),
        join(root, PRODUCT_DIR, 'workflows', workflowName, 'workflow.yaml'),
    ];
    for (const c of candidates) {
        if (existsSync(c)) {
            try {
                if (statSync(c).isFile())
                    return c;
            }
            catch {
            }
        }
    }
    return null;
}
function loadStepConfig(runtimeDir) {
    const manifestPath = join(runtimeDir, 'manifest.json');
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    }
    catch {
        return null;
    }
    let stepName = manifest.current_step;
    const activeLanes = Array.isArray(manifest.active_lanes)
        ? manifest.active_lanes
        : [];
    if (activeLanes.length > 0) {
        const stepsMap = (manifest.steps ?? {});
        const laneCursors = [];
        for (const fork of activeLanes) {
            const lanes = stepsMap[fork]?.lane_state?.lanes ?? {};
            for (const entry of Object.values(lanes)) {
                if (entry.status === 'completed')
                    continue;
                if (typeof entry.cursor === 'string' && entry.cursor && !activeLanes.includes(entry.cursor)) {
                    laneCursors.push(entry.cursor);
                }
            }
        }
        if (laneCursors.length > 0)
            stepName = laneCursors[0];
        if (laneCursors.length > 1) {
            const workflowNamePeek = manifest.workflow ?? '';
            const yamlPeek = findWorkflowYaml(workflowNamePeek);
            if (yamlPeek !== null) {
                try {
                    const wfPeek = loadYaml(yamlPeek);
                    if (wfPeek !== null && typeof wfPeek === 'object' && !Array.isArray(wfPeek)) {
                        for (const cur of laneCursors) {
                            const sc = findStepConfig(wfPeek, cur);
                            if (sc !== null && sc.parallel === true) {
                                stepName = cur;
                                break;
                            }
                        }
                    }
                }
                catch {
                }
            }
        }
    }
    if (typeof stepName !== 'string' || !stepName)
        return null;
    const workflowName = manifest.workflow ?? '';
    const yamlPath = findWorkflowYaml(workflowName);
    if (yamlPath === null)
        return null;
    let wf;
    try {
        wf = loadYaml(yamlPath);
    }
    catch {
        return null;
    }
    if (wf === null || typeof wf !== 'object' || Array.isArray(wf))
        return null;
    const wfDict = wf;
    const stepConfig = findStepConfig(wfDict, stepName);
    if (stepConfig === null)
        return null;
    return { wfConfig: wfDict, stepConfig };
}
function resolveDelayMs(wfConfig, stepConfig) {
    if (!stepConfig.parallel)
        return 0;
    const stepVal = stepConfig.parallel_spawn_delay_ms;
    if (typeof stepVal === 'number' && Number.isInteger(stepVal) && stepVal >= 0) {
        return stepVal;
    }
    const wfVal = wfConfig.parallel_spawn_delay_ms;
    if (typeof wfVal === 'number' && Number.isInteger(wfVal) && wfVal >= 0) {
        return wfVal;
    }
    return 0;
}
function safeStepFilename(stepName) {
    return stepName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}
function stateFilePath(runtimeDir, stepName) {
    return join(runtimeDir, 'data', '.spawn-timestamps', `${safeStepFilename(stepName)}.json`);
}
function readState(path) {
    if (!existsSync(path))
        return {};
    try {
        if (!statSync(path).isFile())
            return {};
    }
    catch {
        return {};
    }
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return {};
    }
}
function writeState(path, data) {
    try {
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp.${process.pid}`;
        writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
        try {
            renameSync(tmp, path);
        }
        catch (e) {
            if (!(e instanceof Error) || !('code' in e))
                throw e;
            writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
            try {
                unlinkSync(tmp);
            }
            catch (e2) {
                if (!(e2 instanceof Error) || !('code' in e2))
                    throw e2;
            }
        }
        return true;
    }
    catch (e) {
        if (!(e instanceof Error) || !('code' in e))
            throw e;
        return false;
    }
}
function sleepMs(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
function drainStdin() {
    return new Promise((resolve) => {
        const stdin = process.stdin;
        if (stdin.isTTY) {
            resolve();
            return;
        }
        const onData = () => {
        };
        const onEnd = () => {
            stdin.off('data', onData);
            stdin.off('end', onEnd);
            stdin.off('error', onError);
            resolve();
        };
        const onError = () => {
            stdin.off('data', onData);
            stdin.off('end', onEnd);
            stdin.off('error', onError);
            resolve();
        };
        stdin.on('data', onData);
        stdin.on('end', onEnd);
        stdin.on('error', onError);
        setTimeout(() => {
            stdin.off('data', onData);
            stdin.off('end', onEnd);
            stdin.off('error', onError);
            resolve();
        }, 100);
    });
}
export async function runSpawnThrottle(
drain = drainStdin) {
    try {
        await drain();
        const runtimeDir = findWorkflowRuntimeDir();
        if (runtimeDir === null)
            return 0;
        const loaded = loadStepConfig(runtimeDir);
        if (loaded === null)
            return 0;
        const { wfConfig, stepConfig } = loaded;
        const delayMs = resolveDelayMs(wfConfig, stepConfig);
        if (delayMs <= 0)
            return 0;
        const manifestPath = join(runtimeDir, 'manifest.json');
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        }
        catch {
            return 0;
        }
        const stepName = manifest.current_step;
        if (typeof stepName !== 'string' || !stepName)
            return 0;
        const tsFile = stateFilePath(runtimeDir, stepName);
        let state = readState(tsFile);
        if (state === null)
            state = {};
        const firstSpawn = state.first_spawn_time;
        if (firstSpawn === undefined || firstSpawn === null) {
            writeState(tsFile, { first_spawn_time: Date.now() / 1000 });
            return 0;
        }
        const elapsedSeconds = Date.now() / 1000 - Number(firstSpawn);
        const delaySeconds = delayMs / 1000;
        if (elapsedSeconds < delaySeconds) {
            await sleepMs((delaySeconds - elapsedSeconds) * 1000);
        }
        return 0;
    }
    catch (e) {
        const name = e instanceof Error ? e.constructor.name : 'Error';
        const msg = e instanceof Error ? e.message : String(e);
        logStderr(`unexpected error: ${name}: ${msg}`);
        return 0;
    }
}
