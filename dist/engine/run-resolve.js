import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, } from 'node:fs';
import { dirname, join } from 'node:path';
import * as fileLock from './file-lock.js';
import { runsRootDir } from './runs.js';
function isSafeSegment(name) {
    return name.length > 0 && !/[\\/]/.test(name) && name !== '.' && name !== '..';
}
function manifestPathFor(agentDir, runId) {
    return join(runsRootDir(agentDir), runId, 'manifest.json');
}
export function ledgerPathFor(agentDir, runId) {
    return join(runsRootDir(agentDir), runId, 'tool-events.jsonl');
}
export function runDirFor(agentDir, runId) {
    return join(runsRootDir(agentDir), runId);
}
export const RUN_TOKEN_RE = /<!--workflow:run_token:([0-9a-fA-F-]+)-->/;
export const CHILD_SESSION_RE = /<task id="([A-Za-z0-9_.-]+)"/;
export function sessionMapPath(agentDir) {
    return join(agentDir, 'local', 'session-map.jsonl');
}
export function spoolPath(agentDir) {
    return join(agentDir, 'local', 'tool-events-unattributed.jsonl');
}
export function extractRunToken(text) {
    if (!text)
        return null;
    const m = RUN_TOKEN_RE.exec(text);
    return m ? (m[1] ?? null) : null;
}
export function extractChildSessionId(text) {
    if (!text)
        return null;
    const m = CHILD_SESSION_RE.exec(text);
    return m ? (m[1] ?? null) : null;
}
const RUN_REF_RE = /workflow_runs[\\/]+([A-Za-z0-9._-]+)/g;
export function extractRunIdRef(agentDir, text) {
    if (!text)
        return null;
    const seen = new Set();
    for (const m of text.matchAll(RUN_REF_RE)) {
        const seg = m[1];
        if (seg && isSafeSegment(seg))
            seen.add(seg);
    }
    if (seen.size === 0)
        return null;
    const live = new Set(listLiveRuns(agentDir).map((r) => r.runId));
    const hits = [...seen].filter((id) => live.has(id));
    return hits.length === 1 ? (hits[0] ?? null) : null;
}
export function listLiveRuns(agentDir) {
    const root = runsRootDir(agentDir);
    let entries;
    try {
        entries = readdirSync(root);
    }
    catch {
        return [];
    }
    const out = [];
    for (const name of entries) {
        if (!isSafeSegment(name))
            continue;
        try {
            const m = JSON.parse(readFileSync(manifestPathFor(agentDir, name), 'utf-8'));
            if (m.status !== 'in_progress')
                continue;
            if (m.stopped !== undefined && m.stopped !== null)
                continue;
            out.push({ runId: name, runToken: typeof m.run_token === 'string' ? m.run_token : null });
        }
        catch {
        }
    }
    return out;
}
export function resolveRunByToken(agentDir, token) {
    if (!token)
        return null;
    for (const r of listLiveRuns(agentDir)) {
        if (r.runToken === token)
            return r.runId;
    }
    return null;
}
const SESSION_MAP_MAX_BYTES = 1_048_576;
const SESSION_MAP_KEEP_LINES = 2_000;
export function appendSessionMapEntry(agentDir, key, runId) {
    if (!key || !runId)
        return;
    try {
        if (lookupSessionMap(agentDir, key) === runId)
            return;
        const p = sessionMapPath(agentDir);
        mkdirSync(dirname(p), { recursive: true });
        appendFileSync(p, `${JSON.stringify({ k: key, run: runId, ts: new Date().toISOString() })}\n`, {
            encoding: 'utf-8',
        });
        try {
            if (statSync(p).size > SESSION_MAP_MAX_BYTES) {
                const lines = readFileSync(p, 'utf-8').split('\n').filter((l) => l.trim());
                writeFileSync(p, `${lines.slice(-SESSION_MAP_KEEP_LINES).join('\n')}\n`, 'utf-8');
            }
        }
        catch {
        }
    }
    catch {
    }
}
export function lookupSessionMap(agentDir, key) {
    if (!key)
        return null;
    let raw;
    try {
        raw = readFileSync(sessionMapPath(agentDir), 'utf-8');
    }
    catch {
        return null;
    }
    let found = null;
    for (const line of raw.split('\n')) {
        if (!line.trim())
            continue;
        try {
            const rec = JSON.parse(line);
            if (rec.k === key && typeof rec.run === 'string')
                found = rec.run;
        }
        catch {
        }
    }
    if (found && (!isSafeSegment(found) || !existsSync(manifestPathFor(agentDir, found)))) {
        return null;
    }
    return found;
}
export function claimSpooledEvents(agentDir, runId, runToken) {
    const p = spoolPath(agentDir);
    if (!existsSync(p))
        return [];
    const lockPath = `${p}.lock`;
    const { acquireFileLockSync, releaseFileLock } = fileLock;
    const fd = acquireFileLockSync(lockPath, 5_000);
    try {
        let raw;
        try {
            raw = readFileSync(p, 'utf-8');
        }
        catch {
            return [];
        }
        const keep = [];
        const claimed = [];
        for (const line of raw.split('\n')) {
            if (!line.trim())
                continue;
            let entry = null;
            try {
                entry = JSON.parse(line);
            }
            catch {
                keep.push(line);
                continue;
            }
            const ev = entry?.event;
            const evToken = ev?.run_token;
            const evRef = ev?.run_ref;
            const evCorr = ev?.corr;
            const belongs = ev !== undefined &&
                ((runToken !== null && evToken === runToken) ||
                    evRef === runId ||
                    (typeof evCorr === 'string' && lookupSessionMap(agentDir, evCorr) === runId));
            if (belongs && ev)
                claimed.push(ev);
            else
                keep.push(line);
        }
        if (claimed.length > 0) {
            writeFileSync(p, keep.length > 0 ? `${keep.join('\n')}\n` : '', 'utf-8');
        }
        return claimed;
    }
    catch {
        return [];
    }
    finally {
        if (fd !== null)
            releaseFileLock(fd, lockPath);
    }
}
export function appendSpool(agentDir, record, reason) {
    try {
        const p = spoolPath(agentDir);
        mkdirSync(dirname(p), { recursive: true });
        appendFileSync(p, `${JSON.stringify({ reason, at: new Date().toISOString(), event: record })}\n`, {
            encoding: 'utf-8',
        });
    }
    catch {
    }
}
