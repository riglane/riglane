import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { toIsoLocal } from '../engine/iso-time.js';
export class TrustDigestError extends Error {
}
export const TRUST_FILENAME = 'trusted.json';
export function trustStorePath(agentDir) {
    return join(agentDir, 'local', TRUST_FILENAME);
}
const EMPTY_STORE = { version: 1, workflows: {} };
export function readTrustStore(agentDir) {
    try {
        const raw = JSON.parse(readFileSync(trustStorePath(agentDir), 'utf-8'));
        if (raw === null || typeof raw !== 'object')
            return EMPTY_STORE;
        if (raw.version !== 1 || raw.workflows === null || typeof raw.workflows !== 'object')
            return EMPTY_STORE;
        return raw;
    }
    catch {
        return EMPTY_STORE;
    }
}
export function writeTrustEntry(agentDir, workflowId, treeSha256) {
    const store = readTrustStore(agentDir);
    const entry = { tree_sha256: treeSha256, trusted_at: toIsoLocal(new Date()) };
    const next = {
        version: 1,
        workflows: { ...store.workflows, [workflowId]: entry },
    };
    const path = trustStorePath(agentDir);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    renameSync(tmp, path);
    return entry;
}
export function removeTrustEntry(agentDir, workflowId) {
    const store = readTrustStore(agentDir);
    if (!(workflowId in store.workflows))
        return;
    const workflows = { ...store.workflows };
    delete workflows[workflowId];
    const path = trustStorePath(agentDir);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, workflows }, null, 2)}\n`, 'utf-8');
    renameSync(tmp, path);
}
export function computeTreeDigest(workflowDir) {
    const records = [];
    const visit = (rel) => {
        const abs = rel === '' ? workflowDir : join(workflowDir, rel);
        for (const e of readdirSync(abs, { withFileTypes: true })) {
            const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
            if (e.isSymbolicLink()) {
                throw new TrustDigestError(`symbolic link found at '${childRel}' — links are not supported in shared workflows.`);
            }
            if (e.isDirectory()) {
                visit(childRel);
                continue;
            }
            if (!e.isFile())
                continue;
            if (rel === '' && e.name === 'entry.lock.yaml')
                continue;
            const fileHash = createHash('sha256').update(readFileSync(join(abs, e.name))).digest('hex');
            records.push(`${childRel}\n${fileHash}\n`);
        }
    };
    visit('');
    records.sort();
    return createHash('sha256').update(records.join('')).digest('hex');
}
export function checkCommunityTrust(agentDir, workflowId, workflowDir) {
    const entry = readTrustStore(agentDir).workflows[workflowId];
    if (entry === undefined) {
        return {
            ok: false,
            reason: 'untrusted',
            message: `Workflow '${workflowId}' is installed from the catalog (community/) and has NOT been ` +
                `trusted on this machine — community workflows arrive switched off.` +
                `\n\nORCHESTRATOR DIRECTIVE: Do NOT retry, do NOT edit ` +
                `.riglane/local/${TRUST_FILENAME}, and do NOT run the trust command yourself — ` +
                `enabling shared code is the user's decision. Surface this message verbatim and STOP.` +
                `\n\nUSER ACTION: review what the workflow can execute, then enable it with:` +
                `\n  riglane trust ${workflowId}`,
        };
    }
    let currentDigest;
    try {
        currentDigest = computeTreeDigest(workflowDir);
    }
    catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            reason: 'changed',
            message: `Workflow '${workflowId}' (community/) cannot be verified against its trust record: ${detail}` +
                `\n\nORCHESTRATOR DIRECTIVE: Do NOT retry and do NOT modify the workflow files. ` +
                `Surface this message verbatim and STOP.` +
                `\n\nUSER ACTION: reinstall the workflow, then re-run: riglane trust ${workflowId}`,
        };
    }
    if (currentDigest !== entry.tree_sha256) {
        return {
            ok: false,
            reason: 'changed',
            message: `Workflow '${workflowId}' (community/) has CHANGED since it was trusted on ` +
                `${entry.trusted_at} — the installed files no longer match the content the trust ` +
                `grant was given for, so it is switched off again.` +
                `\n\nORCHESTRATOR DIRECTIVE: Do NOT retry, do NOT edit the workflow files or ` +
                `.riglane/local/${TRUST_FILENAME}, and do NOT run the trust command yourself. ` +
                `Surface this message verbatim and STOP.` +
                `\n\nUSER ACTION: review what changed, then re-enable with:` +
                `\n  riglane trust ${workflowId}`,
        };
    }
    return { ok: true };
}
