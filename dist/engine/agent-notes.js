import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, } from 'node:fs';
import { join } from 'node:path';
export const AGENT_NOTES_VERSION = 1;
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
export function assertSafeStepTemplate(stepTemplate) {
    if (typeof stepTemplate !== 'string' || stepTemplate.length === 0) {
        throw new Error('agent-notes: step_template must be a non-empty string');
    }
    if (stepTemplate === '.' || stepTemplate === '..') {
        throw new Error("agent-notes: step_template cannot be '.' or '..'");
    }
    if (!SEGMENT_RE.test(stepTemplate)) {
        throw new Error(`agent-notes: step_template contains unsafe characters: '${stepTemplate}'. ` +
            `Allowed: [A-Za-z0-9._-].`);
    }
}
export function agentNotesRoot(agentDir) {
    return join(agentDir, 'agent_notes');
}
export function stepTemplateNotesDir(agentDir, stepTemplate) {
    assertSafeStepTemplate(stepTemplate);
    return join(agentNotesRoot(agentDir), stepTemplate);
}
export function noteFilePath(agentDir, stepTemplate, filename) {
    return join(stepTemplateNotesDir(agentDir, stepTemplate), filename);
}
export function indexJsonPath(agentDir, stepTemplate) {
    return join(stepTemplateNotesDir(agentDir, stepTemplate), '_index.json');
}
export function ensureStepTemplateNotesDir(agentDir, stepTemplate) {
    const dir = stepTemplateNotesDir(agentDir, stepTemplate);
    mkdirSync(dir, { recursive: true });
    return dir;
}
export function isoDateLocal(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function shortId() {
    return Math.random().toString(36).slice(2, 8);
}
export function generateNoteFilename(date = new Date()) {
    return `${isoDateLocal(date)}-${shortId()}.md`;
}
export function serializeFrontmatter(fm) {
    const lines = ['---'];
    lines.push(`topic: ${quoteIfNeeded(fm.topic)}`);
    lines.push(`step_template: ${quoteIfNeeded(fm.step_template)}`);
    lines.push(`status: ${fm.status}`);
    lines.push(`confidence: ${fm.confidence}`);
    lines.push(`project: ${quoteIfNeeded(fm.project)}`);
    lines.push(`run_id: ${quoteIfNeeded(fm.run_id)}`);
    if (fm.generated_workflow_path !== undefined && fm.generated_workflow_path.length > 0) {
        lines.push(`generated_workflow_path: ${quoteIfNeeded(fm.generated_workflow_path)}`);
    }
    lines.push(`tags: ${serializeList(fm.tags)}`);
    lines.push(`related_runs: ${serializeList(fm.related_runs)}`);
    lines.push(`date: ${fm.date}`);
    lines.push(`version: ${fm.version}`);
    lines.push('---');
    return lines.join('\n');
}
function quoteIfNeeded(s) {
    if (/[:#&*!|>'"%@`{}[\],?\s]/.test(s) || s.length === 0) {
        return JSON.stringify(s);
    }
    return s;
}
function serializeList(items) {
    if (items.length === 0)
        return '[]';
    return `[${items.map((t) => quoteIfNeeded(t)).join(', ')}]`;
}
export function composeNoteFile(fm, body) {
    const fmBlock = serializeFrontmatter(fm);
    const normalizedBody = body.replace(/^\s*\n+/, '');
    const trailing = normalizedBody.endsWith('\n') ? '' : '\n';
    return `${fmBlock}\n\n${normalizedBody}${trailing}`;
}
export function readIndex(agentDir, stepTemplate) {
    const path = indexJsonPath(agentDir, stepTemplate);
    let raw;
    try {
        raw = readFileSync(path, 'utf-8');
    }
    catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed &&
            typeof parsed.version === 'number' &&
            typeof parsed.step_template === 'string' &&
            Array.isArray(parsed.entries)) {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
export function writeIndex(agentDir, stepTemplate, index) {
    ensureStepTemplateNotesDir(agentDir, stepTemplate);
    const path = indexJsonPath(agentDir, stepTemplate);
    writeFileSync(path, JSON.stringify(index, null, 2) + '\n', 'utf-8');
}
export function appendIndexEntry(agentDir, stepTemplate, entry) {
    const existing = readIndex(agentDir, stepTemplate);
    const baseline = existing ?? {
        version: AGENT_NOTES_VERSION,
        step_template: stepTemplate,
        entries: [],
    };
    const filtered = baseline.entries.filter((e) => e.file !== entry.file);
    const next = {
        version: AGENT_NOTES_VERSION,
        step_template: stepTemplate,
        entries: [...filtered, entry],
    };
    writeIndex(agentDir, stepTemplate, next);
    return next;
}
export function listNoteFiles(agentDir, stepTemplate) {
    const dir = stepTemplateNotesDir(agentDir, stepTemplate);
    try {
        if (!statSync(dir).isDirectory())
            return [];
    }
    catch {
        return [];
    }
    return readdirSync(dir).filter((f) => f.endsWith('.md'));
}
export function stepTemplateNotesDirExists(agentDir, stepTemplate) {
    return existsSync(stepTemplateNotesDir(agentDir, stepTemplate));
}
