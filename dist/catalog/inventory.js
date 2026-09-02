import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectAllSteps } from '../engine/workflow-engine.js';
import { isLocalWebhookUrl } from '../engine/workflow-lint.js';
export class InventoryError extends Error {
}
const EXCLUDED_ROOT_FILES = new Set(['workflow.yaml', 'entry.yaml', 'entry.lock.yaml']);
const CONTENT_SCAN_CAP = 512 * 1024;
export const INBOX_WEBHOOK_WHERE = 'workflow.inbox_webhook';
const LANGUAGE_BY_EXT = {
    py: 'python',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    mts: 'typescript',
    sh: 'shell',
    bash: 'shell',
    ps1: 'powershell',
    psm1: 'powershell',
    rb: 'ruby',
    pl: 'perl',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    md: 'markdown',
    txt: 'text',
};
const KNOWN_INTERPRETERS = new Set([
    'python',
    'python3',
    'node',
    'bash',
    'sh',
    'pwsh',
    'powershell',
    'ruby',
    'perl',
    'deno',
    'bun',
]);
const SANCTIONED_ENV = new Set([
    'RIGLANE_RUN_DIR',
    'ACP_RUN_DIR',
    'RIGLANE_RUN_ID',
    'RIGLANE_ACTIVE_WORKFLOW',
    'WORKFLOW_TOOL_ARGS',
    'WORKFLOW_TOOL_NAME',
    'WORKFLOW_TOOL_WORKFLOW',
    'PATH',
]);
const NETWORK_PATTERNS = [
    'http://',
    'https://',
    'curl ',
    'curl.exe',
    'wget ',
    'Invoke-WebRequest',
    'Invoke-RestMethod',
    'urllib',
    'requests.',
    'http.client',
    'axios',
    'fetch(',
    'net.createConnection',
    'net.connect',
    'XMLHttpRequest',
    'WebSocket',
];
const WRITE_OUTSIDE_PATTERNS = [
    '~/.ssh',
    '~/',
    '$HOME',
    '%USERPROFILE%',
    '%APPDATA%',
    '/etc/',
    '.bashrc',
    '.zshrc',
    '$PROFILE',
];
const INDIRECTION_PATTERNS = ['| sh', '| bash', '|sh ', '|bash ', 'base64', 'eval ', 'Invoke-Expression', ' iex '];
const ENV_READ_REGEXES = [
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[\s*['"]([^'"]+)['"]/g,
    /os\.environ(?:\.get)?\s*[[(]\s*['"]([^'"]+)['"]/g,
    /\bgetenv\s*\(\s*['"]([^'"]+)['"]/g,
    /\$env:([A-Za-z_][A-Za-z0-9_]*)/g,
    /\$\{?([A-Z][A-Z0-9_]{2,})\}?/g,
];
export function buildWorkflowInventory(workflowDir, workflow) {
    const wf = workflow;
    const allSteps = collectAllSteps(workflow);
    const bundledRaw = walkBundledFiles(workflowDir);
    const tools = Array.isArray(wf.tools) ? wf.tools : [];
    const bundledPaths = bundledRaw.map((b) => b.path);
    const scriptTools = tools
        .filter((t) => t.type === 'script')
        .map((t) => {
        const command = String(t.command ?? '');
        return {
            name: String(t.name ?? ''),
            description: typeof t.description === 'string' ? t.description : null,
            command,
            interpreter: detectInterpreter(command),
            references: commandReferences(command, bundledPaths),
        };
    });
    const mcpDependencies = tools
        .filter((t) => t.type === 'mcp')
        .map((t) => ({
        name: String(t.name ?? ''),
        required: t.required !== false && t.required !== null,
        expected_tools: Array.isArray(t.expected_tools) ? t.expected_tools.map(String) : [],
    }));
    const deciders = [];
    const wfGateHuman = (wf.gate ?? {}).human;
    if (typeof wfGateHuman === 'object' &&
        wfGateHuman !== null &&
        typeof wfGateHuman.script === 'string' &&
        wfGateHuman.script.length > 0) {
        deciders.push({ field: 'gate.human.script', at: '<workflow-gate>', command: wfGateHuman.script });
    }
    const loopBacks = [];
    const routesList = [];
    const lanesList = [];
    for (const s of allSteps) {
        const name = String(s.name ?? '');
        const stepGateHuman = (s.gate ?? {}).human;
        if (typeof stepGateHuman === 'object' &&
            stepGateHuman !== null &&
            typeof stepGateHuman.script === 'string' &&
            stepGateHuman.script.length > 0) {
            deciders.push({ field: 'gate.human.script', at: name, command: stepGateHuman.script });
        }
        const lb = s.loop_back;
        if (lb && typeof lb === 'object') {
            const when = (lb.when ?? {});
            if (typeof when.script === 'string' && when.script.length > 0) {
                deciders.push({ field: 'loop_back.when.script', at: name, command: when.script });
            }
            loopBacks.push({
                step: name,
                to: String(lb.to ?? ''),
                max_iterations: Number(lb.max_iterations ?? 0),
                when: deciderKinds(when),
            });
        }
        const rt = s.routes;
        if (rt && typeof rt === 'object') {
            const when = (rt.when ?? {});
            if (typeof when.script === 'string' && when.script.length > 0) {
                deciders.push({ field: 'routes.when.script', at: name, command: when.script });
            }
            const define = Array.isArray(rt.define) ? rt.define : [];
            routesList.push({
                step: name,
                route_ids: define.map((r) => String(r.id ?? '')),
                when: deciderKinds(when),
            });
        }
        const ln = s.lanes;
        if (ln && typeof ln === 'object') {
            const define = Array.isArray(ln.define) ? ln.define : [];
            const joinCfg = (ln.join ?? {});
            lanesList.push({
                step: name,
                lane_ids: define.map((l) => String(l.id ?? '')),
                require: joinCfg.require === 'any' ? 'any' : 'all',
            });
        }
    }
    const allCommands = [...scriptTools.map((t) => t.command), ...deciders.map((d) => d.command)];
    const bundled = bundledRaw.map((b) => ({
        ...b,
        role: fileRole(b.path, allCommands),
    }));
    const items = allSteps.map((s) => {
        const item = {
            name: String(s.name ?? ''),
            subagent: s.subagent !== false,
            ...(s.parallel === true ? { parallel: true } : {}),
            ...(typeof s.parallel_key === 'string' ? { parallel_key: s.parallel_key } : {}),
            ...(typeof s.type === 'string' ? { type: s.type } : {}),
            ...(typeof s.delegate_to === 'string' && s.delegate_to.length > 0 ? { delegate_to: s.delegate_to } : {}),
            ...(s.spec_check === true ? { spec_check: true } : {}),
            ...(typeof s.spec_authoring === 'string' ? { spec_authoring: s.spec_authoring } : {}),
            ...(Array.isArray(s.deny) && s.deny.length > 0
                ? { deny: s.deny.filter((d) => typeof d === 'string') }
                : {}),
        };
        return item;
    });
    const wfGate = (wf.gate ?? {});
    const gates = {
        structural: wfGate.structural !== false && wfGate.structural !== null,
        semantic: wfGate.semantic === true,
        human: wfGate.human === true,
        max_gate_retries: typeof wfGate.max_gate_retries === 'number' ? wfGate.max_gate_retries : 5,
        max_step_retries: typeof wfGate.max_step_retries === 'number' ? wfGate.max_step_retries : 3,
        step_overrides: allSteps
            .filter((s) => s.gate !== undefined && s.gate !== null)
            .map((s) => String(s.name ?? '')),
    };
    const delegatesTo = [
        ...new Set(allSteps
            .map((s) => s.delegate_to)
            .filter((d) => typeof d === 'string' && d.length > 0)),
    ].sort();
    const params = (Array.isArray(wf.params) ? wf.params : []).map((p) => ({
        name: String(p.name ?? ''),
        required: p.required === true,
        ...('default' in p ? { default: p.default } : {}),
    }));
    const structNames = new Set();
    for (const s of allSteps) {
        for (const key of ['inputs', 'outputs']) {
            const entries = Array.isArray(s[key]) ? s[key] : [];
            for (const e of entries) {
                if (typeof e === 'object' && e !== null && typeof e.struct === 'string')
                    structNames.add(e.struct);
            }
        }
    }
    const capabilities = scanCapabilities(workflowDir, scriptTools, deciders, tools, bundled, wf.inbox_webhook);
    return {
        workflow: String(wf.name ?? ''),
        workflow_version: typeof wf.version === 'number' ? wf.version : 0,
        workflow_sha256: sha256Hex(readFileSync(join(workflowDir, 'workflow.yaml'))),
        steps: {
            count: items.length,
            items,
            gates,
            control_flow: { loop_back: loopBacks, routes: routesList, lanes: lanesList },
            delegates_to: delegatesTo,
        },
        params,
        structs: [...structNames].sort(),
        script_tools: scriptTools,
        mcp_dependencies: mcpDependencies,
        deciders,
        bundled_files: bundled,
        capabilities,
    };
}
function sha256Hex(buf) {
    return createHash('sha256').update(buf).digest('hex');
}
function walkBundledFiles(workflowDir) {
    const out = [];
    const visit = (rel) => {
        const abs = rel === '' ? workflowDir : join(workflowDir, rel);
        const entries = readdirSync(abs, { withFileTypes: true });
        for (const e of entries) {
            const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
            if (e.isSymbolicLink()) {
                throw new InventoryError(`symbolic link found at '${childRel}' — links are not supported in shared workflows ` +
                    `(a link can point outside the workflow directory, defeating the content inventory).`);
            }
            if (e.isDirectory()) {
                visit(childRel);
                continue;
            }
            if (!e.isFile())
                continue;
            if (rel === '' && EXCLUDED_ROOT_FILES.has(e.name))
                continue;
            const buf = readFileSync(join(abs, e.name));
            out.push({
                path: childRel,
                bytes: buf.length,
                sha256: sha256Hex(buf),
                language: languageOf(e.name),
            });
        }
    };
    visit('');
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return out;
}
function languageOf(filename) {
    const dot = filename.lastIndexOf('.');
    if (dot < 0)
        return null;
    return LANGUAGE_BY_EXT[filename.slice(dot + 1).toLowerCase()] ?? null;
}
function detectInterpreter(command) {
    const first = command.trim().split(/\s+/)[0] ?? '';
    if (first === '')
        return null;
    const base = (first.split(/[\\/]/).pop() ?? first).toLowerCase().replace(/\.exe$/, '');
    return KNOWN_INTERPRETERS.has(base) ? base : base;
}
function commandReferences(command, bundledPaths) {
    const tokens = command
        .split(/\s+/)
        .map((t) => t.replace(/^["']|["']$/g, '').replace(/\\/g, '/'))
        .filter((t) => t.length > 0);
    const refs = new Set();
    for (const rel of bundledPaths) {
        for (const tok of tokens) {
            if (tok === rel || tok.endsWith(`/${rel}`)) {
                refs.add(rel);
                break;
            }
        }
    }
    return [...refs].sort();
}
function deciderKinds(when) {
    const kinds = [];
    if (typeof when.script === 'string' && when.script.length > 0)
        kinds.push('script');
    if (typeof when.semantic === 'string' && when.semantic.length > 0)
        kinds.push('semantic');
    if (when.human === true)
        kinds.push('human');
    return kinds;
}
function fileRole(relPath, commands) {
    if (relPath.startsWith('structs/'))
        return 'struct';
    if (relPath.startsWith('mcp/'))
        return 'mcp-server';
    if (relPath.startsWith('scripts/'))
        return 'script';
    for (const cmd of commands) {
        const norm = cmd.replace(/\\/g, '/');
        if (norm.includes(`/${relPath}`) || norm.includes(` ${relPath}`) || norm.endsWith(relPath))
            return 'script';
    }
    return 'other';
}
function scanCapabilities(workflowDir, scriptTools, deciders, tools, bundled, inboxWebhook) {
    const flags = [];
    const surfaces = [
        ...scriptTools.map((t) => ({ where: `tools[${t.name}].command`, text: t.command })),
        ...deciders.map((d) => ({ where: `${d.field} at step '${d.at}'`, text: d.command })),
    ];
    for (const b of bundled) {
        if (b.role === 'struct')
            continue;
        const buf = readFileSync(join(workflowDir, b.path));
        if (buf.includes(0))
            continue;
        surfaces.push({ where: `file ${b.path}`, text: buf.toString('utf-8', 0, CONTENT_SCAN_CAP) });
    }
    for (const { where, text } of surfaces) {
        for (const p of NETWORK_PATTERNS) {
            if (text.includes(p))
                flags.push({ flag: 'network', where, match: p.trim() });
        }
        for (const p of WRITE_OUTSIDE_PATTERNS) {
            if (text.includes(p))
                flags.push({ flag: 'writes-outside-project', where, match: p });
        }
        for (const p of INDIRECTION_PATTERNS) {
            if (text.includes(p))
                flags.push({ flag: 'shell-indirection', where, match: p.trim() });
        }
        for (const re of ENV_READ_REGEXES) {
            re.lastIndex = 0;
            for (const m of text.matchAll(re)) {
                const varName = m[1] ?? '';
                if (varName === '' || SANCTIONED_ENV.has(varName))
                    continue;
                flags.push({ flag: 'reads-env', where, match: varName });
            }
        }
    }
    for (const b of bundled) {
        if (b.role === 'mcp-server')
            flags.push({ flag: 'spawns-mcp-server', where: `file ${b.path}`, match: b.path });
    }
    for (const t of tools) {
        if (t.server_config !== undefined && t.server_config !== null) {
            flags.push({ flag: 'spawns-mcp-server', where: `tools[${String(t.name ?? '')}].server_config`, match: 'server_config' });
        }
    }
    if (typeof inboxWebhook === 'string' && inboxWebhook && !isLocalWebhookUrl(inboxWebhook)) {
        flags.push({ flag: 'network', where: INBOX_WEBHOOK_WHERE, match: inboxWebhook });
    }
    const seen = new Set();
    const unique = flags.filter((f) => {
        const key = JSON.stringify([f.flag, f.where, f.match]);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    unique.sort((a, b) => {
        const ka = JSON.stringify([a.where, a.flag, a.match]);
        const kb = JSON.stringify([b.where, b.flag, b.match]);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return {
        network: unique.some((f) => f.flag === 'network'),
        reads_env: unique.some((f) => f.flag === 'reads-env'),
        writes_outside_project: unique.some((f) => f.flag === 'writes-outside-project'),
        spawns_mcp_server: unique.some((f) => f.flag === 'spawns-mcp-server'),
        flags: unique,
    };
}
