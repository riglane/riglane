import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeProjectStatus } from '../cli/commands/status.js';
import { readRunSupervisionState } from '../cli/commands/run-workflow.js';
import { isValidRunId } from './run-id.js';
import { listMessages, publicMessage, readMessage, respondMessage } from './inbox.js';
import { MAX_UI_PREFS_BYTES, readUiPrefs, writeUiPrefs } from './ui-prefs.js';
let serveToken = null;
export function getServeToken() {
    if (!serveToken)
        serveToken = randomBytes(16).toString('hex');
    return serveToken;
}
export function withServeToken(url) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}rl_token=${getServeToken()}`;
}
function requestFromOwnPage(req) {
    const raw = req.headers.origin;
    const origin = typeof raw === 'string' ? raw : '';
    if (!origin)
        return false;
    let o;
    try {
        o = new URL(origin);
    }
    catch {
        return false;
    }
    const host = o.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    const ownPort = String(req.socket?.localPort ?? '');
    return o.protocol === 'http:' && loopback && o.port === ownPort && ownPort.length > 0;
}
function suppliedToken(req, url) {
    const header = req.headers['x-riglane-token'];
    const fromHeader = typeof header === 'string' ? header : Array.isArray(header) ? header[0] : undefined;
    return fromHeader ?? url.searchParams.get('rl_token') ?? '';
}
function tokenOk(req, url) {
    if (requestFromOwnPage(req))
        return true;
    const supplied = suppliedToken(req, url);
    return supplied.length > 0 && supplied === getServeToken();
}
export function requireServeToken(req, url, res) {
    if (tokenOk(req, url))
        return true;
    sendJson(res, 403, { ok: false, error: 'Missing or invalid X-Riglane-Token' });
    return false;
}
const MAX_BODY_BYTES = 64 * 1024;
function sendJson(res, code, payload) {
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
    });
    res.end(JSON.stringify(payload));
}
function readJsonBody(req, res, onBody) {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
        if (aborted)
            return;
        size += c.length;
        if (size > MAX_BODY_BYTES) {
            aborted = true;
            sendJson(res, 413, { ok: false, error: 'Payload too large' });
            req.destroy();
            return;
        }
        chunks.push(c);
    });
    req.on('end', () => {
        if (aborted)
            return;
        let body;
        try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        }
        catch {
            sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
            return;
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            sendJson(res, 400, { ok: false, error: 'Body must be a JSON object' });
            return;
        }
        onBody(body);
    });
}
let spawner = (argv, cwd) => {
    if (process.platform === 'win32') {
        const child = spawn('cmd', ['/c', 'start', '', ...argv], {
            cwd,
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
        });
        child.unref();
    }
    else {
        const child = spawn(argv[0], argv.slice(1), {
            cwd,
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
    }
};
export function _setSpawnerForTests(fn) {
    const prev = spawner;
    spawner = fn;
    return prev;
}
const WORKFLOW_NAME_RE = /^[a-z][a-z0-9_-]*$/;
const TARGET_RE = /^[a-z][a-z0-9-]*$/;
const PARAM_KEY_RE = /^[a-z][a-z0-9_]*$/;
const MODEL_MODES = new Set(['inherit', 'auto', 'lightest', 'strongest']);
function cliEntryPath() {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'index.js');
}
function handleRun(root, req, res, url) {
    if (!tokenOk(req, url)) {
        sendJson(res, 403, { ok: false, error: 'Missing or invalid X-Riglane-Token' });
        return;
    }
    readJsonBody(req, res, (body) => {
        const workflow = typeof body.workflow === 'string' ? body.workflow : '';
        if (!WORKFLOW_NAME_RE.test(workflow)) {
            sendJson(res, 400, { ok: false, error: 'Body must carry a valid workflow name' });
            return;
        }
        const target = body.target === undefined ? null : String(body.target);
        if (target !== null && !TARGET_RE.test(target)) {
            sendJson(res, 400, { ok: false, error: `Invalid target '${target}'` });
            return;
        }
        const model = body.model === undefined ? null : String(body.model);
        if (model !== null && !MODEL_MODES.has(model)) {
            sendJson(res, 400, { ok: false, error: `Invalid model mode '${model}' — one of: inherit, auto, lightest, strongest` });
            return;
        }
        const inboxWebhook = body.inbox_webhook === undefined ? null : String(body.inbox_webhook);
        if (inboxWebhook !== null && !/^https?:\/\//.test(inboxWebhook)) {
            sendJson(res, 400, { ok: false, error: `Invalid inbox_webhook '${inboxWebhook}' — must be an http(s) URL` });
            return;
        }
        const traceViewer = body.trace_viewer === undefined ? null : String(body.trace_viewer);
        if (traceViewer !== null && traceViewer !== 'off') {
            sendJson(res, 400, { ok: false, error: `Invalid trace_viewer '${traceViewer}' — the only defined value is 'off'` });
            return;
        }
        const paramsRaw = body.params === undefined ? {} : body.params;
        if (typeof paramsRaw !== 'object' || paramsRaw === null || Array.isArray(paramsRaw)) {
            sendJson(res, 400, { ok: false, error: 'params must be an object of scalar values' });
            return;
        }
        const paramArgs = [];
        for (const [k, v] of Object.entries(paramsRaw)) {
            if (!PARAM_KEY_RE.test(k)) {
                sendJson(res, 400, { ok: false, error: `Invalid param name '${k}'` });
                return;
            }
            if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
                sendJson(res, 400, { ok: false, error: `Param '${k}' must be a scalar` });
                return;
            }
            paramArgs.push(`${k}=${String(v)}`);
        }
        const projectRoot = dirname(root);
        const argv = [
            process.execPath,
            cliEntryPath(),
            'run-workflow',
            '--dir',
            projectRoot,
            '--workflow',
            workflow,
            ...(target !== null ? ['--target', target] : []),
            ...(model !== null ? ['--model', model] : []),
            ...(inboxWebhook !== null ? ['--inbox-webhook', inboxWebhook] : []),
            ...(traceViewer === 'off' ? ['--no-trace-viewer'] : []),
            ...paramArgs,
        ];
        try {
            spawner(argv, projectRoot);
        }
        catch (e) {
            sendJson(res, 500, { ok: false, error: `Spawn failed: ${e instanceof Error ? e.message : String(e)}` });
            return;
        }
        sendJson(res, 200, { ok: true, spawned: true, argv: argv.slice(1) });
    });
}
function handleStatus(root, res) {
    const projectRoot = dirname(root);
    try {
        sendJson(res, 200, computeProjectStatus(projectRoot));
    }
    catch (e) {
        sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
}
function handleRunsList(root, res) {
    const runsRoot = join(root, 'local', 'workflow_runs');
    let ids = [];
    try {
        ids = readdirSync(runsRoot, { withFileTypes: true })
            .filter((d) => d.isDirectory() && isValidRunId(d.name))
            .map((d) => d.name)
            .sort()
            .reverse();
    }
    catch {
        ids = [];
    }
    const runs = ids.flatMap((id) => {
        const st = readRunSupervisionState(join(runsRoot, id));
        if (!st.exists)
            return [];
        const state = st.terminal
            ? (st.status ?? 'completed')
            : st.openQuestions > 0
                ? 'waiting'
                : st.ownerAlive
                    ? 'running'
                    : 'stalled';
        return [
            {
                run_id: id,
                workflow: st.workflow ?? null,
                status: st.status ?? null,
                current_step: st.currentStep ?? null,
                updated_at: st.updatedAt ?? null,
                owner_alive: st.ownerAlive,
                open_questions: st.openQuestions,
                state,
            },
        ];
    });
    sendJson(res, 200, runs);
}
function runDirFor(root, runId) {
    if (!isValidRunId(runId))
        return null;
    return join(root, 'local', 'workflow_runs', runId);
}
function handleInboxList(root, res, url) {
    const runParam = url.searchParams.get('run');
    if (runParam !== null) {
        const dir = runDirFor(root, runParam);
        if (!dir) {
            sendJson(res, 400, { ok: false, error: 'Query must carry a valid ?run=<run_id>' });
            return;
        }
        sendJson(res, 200, listMessages(dir).map(publicMessage));
        return;
    }
    const runsRoot = join(root, 'local', 'workflow_runs');
    let ids = [];
    try {
        ids = readdirSync(runsRoot, { withFileTypes: true })
            .filter((d) => d.isDirectory() && isValidRunId(d.name))
            .map((d) => d.name)
            .sort();
    }
    catch {
        ids = [];
    }
    const all = [];
    for (const id of ids)
        all.push(...listMessages(join(runsRoot, id)).map(publicMessage));
    sendJson(res, 200, all);
}
function runWebhookUrl(runDir) {
    try {
        const m = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf-8'));
        return typeof m.inbox_webhook_url === 'string' && m.inbox_webhook_url
            ? m.inbox_webhook_url
            : null;
    }
    catch {
        return null;
    }
}
function handleInboxRespond(root, req, res, url) {
    readJsonBody(req, res, (body) => {
        const runId = typeof body.run === 'string' ? body.run : '';
        const dir = runDirFor(root, runId);
        if (!dir) {
            sendJson(res, 400, { ok: false, error: 'Body must carry a valid run id' });
            return;
        }
        const messageId = typeof body.message_id === 'string' ? body.message_id : '';
        const type = typeof body.type === 'string' ? body.type : '';
        if (!messageId || !type) {
            sendJson(res, 400, { ok: false, error: 'Body must carry message_id and type' });
            return;
        }
        let via = 'web';
        if (!tokenOk(req, url)) {
            const supplied = suppliedToken(req, url);
            const msg = readMessage(dir, messageId);
            const messageTokenOk = supplied.length > 0 && msg !== null && supplied === msg.respond_token;
            if (!messageTokenOk) {
                sendJson(res, 403, { ok: false, error: 'Missing or invalid X-Riglane-Token' });
                return;
            }
            via = 'api';
        }
        void respondMessage(dir, messageId, {
            type,
            ...(typeof body.text === 'string' ? { text: body.text } : {}),
            ...(typeof body.args === 'object' && body.args !== null && !Array.isArray(body.args)
                ? { args: body.args }
                : {}),
            ...(typeof body.items === 'object' && body.items !== null && !Array.isArray(body.items)
                ? {
                    items: body.items,
                }
                : {}),
        }, via, 
        { webhookUrl: runWebhookUrl(dir) }).then((result) => {
            if ('error' in result) {
                sendJson(res, 409, { ok: false, error: result.error });
                return;
            }
            sendJson(res, 200, { ok: true, message: publicMessage(result.message) });
        });
    });
}
export function handleLocalApi(root, req, res, pathname, url) {
    if (req.method === 'POST' && pathname === '/api/run') {
        handleRun(root, req, res, url);
        return true;
    }
    if (req.method === 'POST' && pathname === '/api/inbox/respond') {
        handleInboxRespond(root, req, res, url);
        return true;
    }
    if (req.method === 'GET' && pathname === '/api/status.json') {
        handleStatus(root, res);
        return true;
    }
    if (req.method === 'GET' && pathname === '/api/runs.json') {
        handleRunsList(root, res);
        return true;
    }
    if (req.method === 'GET' && pathname === '/api/inbox.json') {
        handleInboxList(root, res, url);
        return true;
    }
    if (req.method === 'GET' && pathname === '/api/ui-prefs.json') {
        sendJson(res, 200, readUiPrefs());
        return true;
    }
    if (req.method === 'POST' && pathname === '/api/ui-prefs') {
        handleUiPrefsWrite(req, res, url);
        return true;
    }
    return false;
}
function handleUiPrefsWrite(req, res, url) {
    if (!requireServeToken(req, url, res))
        return;
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
        if (aborted)
            return;
        size += c.length;
        if (size > MAX_UI_PREFS_BYTES) {
            aborted = true;
            sendJson(res, 413, { ok: false, error: 'Payload too large' });
            req.destroy();
            return;
        }
        chunks.push(c);
    });
    req.on('end', () => {
        if (aborted)
            return;
        let body;
        try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        }
        catch {
            sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
            return;
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            sendJson(res, 400, { ok: false, error: 'Body must be a JSON object of preferences' });
            return;
        }
        const merged = writeUiPrefs(body);
        sendJson(res, 200, { ok: merged !== null, prefs: merged ?? readUiPrefs() });
    });
    req.on('error', () => {
        if (!aborted)
            sendJson(res, 400, { ok: false, error: 'Request error' });
    });
}
