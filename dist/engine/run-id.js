import { randomUUID } from 'node:crypto';
export function runIdTimestamp(d = new Date()) {
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return (`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`);
}
export function generateRunId(workflowName, now = new Date()) {
    const hex4 = randomUUID().replace(/-/g, '').substring(0, 4);
    return `${workflowName}-${runIdTimestamp(now)}-${hex4}`;
}
export function isValidRunId(s) {
    if (s.includes('/') || s.includes('\\') || s.includes('..'))
        return false;
    return /^[A-Za-z0-9._-]+-\d{8}-\d{6}-[0-9a-f]{4}$/.test(s);
}
export function workflowFromRunId(runId) {
    if (!isValidRunId(runId))
        return null;
    return runId.replace(/-\d{8}-\d{6}-[0-9a-f]{4}$/, '');
}
