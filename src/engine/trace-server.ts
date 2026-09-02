
import { spawn } from 'node:child_process';
import { appendFileSync, createReadStream, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { PRODUCT_DIR } from '../config/paths.js';
import { list as listRegisteredProjects } from '../registry/registry.js';
import { parse as parseYamlText } from 'yaml';
import { fullValidateWorkflow } from './workflow-engine.js';
import { getServeToken, handleLocalApi, requireServeToken, withServeToken } from './local-api.js';


let server: Server | null = null;
let serverRoot = '';
let serverBase: string | null = null;
let starting: { root: string; promise: Promise<string | null> } | null = null;
let startOverride: ((root: string) => Promise<string | null>) | null = null;

export function _setLocalServerStartForTests(
  fn: ((root: string) => Promise<string | null>) | null,
): void {
  startOverride = fn;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}


function serveFile(
  rootDir: string,
  pathname: string,
  res: ServerResponse,
  method = 'GET',
): void {
  const resolved = resolve(rootDir, `.${pathname}`);
  if (resolved !== rootDir && !resolved.startsWith(rootDir + sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let isFile = false;
  let mtimeMs = 0;
  try {
    const st = statSync(resolved);
    isFile = st.isFile();
    mtimeMs = st.mtimeMs;
  } catch {
    isFile = false;
  }
  if (!isFile) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': mimeFor(resolved),
    'Cache-Control': 'no-cache, no-store',
    ...(mtimeMs > 0 ? { 'Last-Modified': new Date(mtimeMs).toUTCString() } : {}),
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(resolved).pipe(res);
}

function projectEntries(currentRoot: string): { slug: string; base: string }[] {
  let entries: { slug: string; path: string }[] = [];
  try {
    entries = listRegisteredProjects();
  } catch {
    entries = [];
  }
  const out: { slug: string; base: string }[] = [];
  for (const e of entries) {
    const mounted = resolve(e.path, PRODUCT_DIR);
    let ok = false;
    try {
      ok = statSync(mounted).isDirectory();
    } catch {
      ok = false;
    }
    if (!ok) continue;
    out.push({ slug: e.slug, base: mounted === currentRoot ? '' : `/p/${encodeURIComponent(e.slug)}` });
  }
  if (basename(currentRoot) === PRODUCT_DIR && !out.some((o) => o.base === '')) {
    out.unshift({ slug: basename(dirname(currentRoot)), base: '' });
  }
  return out;
}

function workflowEntries(root: string): { name: string; category: string; path: string; mtime: number }[] {
  const out: { name: string; category: string; path: string; mtime: number }[] = [];
  const base = resolve(root, 'workflows', 'templates');
  for (const category of ['my_workflows', 'predefined', 'examples', 'community']) {
    const catDir = resolve(base, category);
    let dirs: string[] = [];
    try {
      dirs = readdirSync(catDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const name of dirs.sort()) {
      const wf = resolve(catDir, name, 'workflow.yaml');
      try {
        const st = statSync(wf);
        if (!st.isFile()) continue;
        out.push({
          name,
          category,
          path: `/workflows/templates/${category}/${name}/workflow.yaml`,
          mtime: st.mtimeMs,
        });
      } catch {
        continue;
      }
    }
  }
  return out;
}

function scopeEntries(root: string): { id: string; hasIndex: boolean }[] {
  const base = resolve(root, 'specs');
  const out: { id: string; hasIndex: boolean }[] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => !n.startsWith('_'));
  } catch {
    dirs = [];
  }
  for (const id of dirs.sort()) {
    let hasIndex = false;
    try {
      hasIndex = statSync(resolve(base, id, '_index.json')).isFile();
    } catch {
      hasIndex = false;
    }
    out.push({ id, hasIndex });
  }
  if (!out.some((s) => s.id === 'generic')) out.unshift({ id: 'generic', hasIndex: false });
  return out;
}

const adhocMounts = new Map<string, string>();

function mountRoot(slug: string): string | null {
  const adhoc = adhocMounts.get(slug);
  if (adhoc) {
    try {
      return statSync(adhoc).isDirectory() ? adhoc : null;
    } catch {
      return null;
    }
  }
  try {
    const entry = listRegisteredProjects().find((e) => e.slug === slug);
    if (!entry) return null;
    const mounted = resolve(entry.path, PRODUCT_DIR);
    return statSync(mounted).isDirectory() ? mounted : null;
  } catch {
    return null;
  }
}

const MAX_WRITE_BYTES = 4 * 1024 * 1024;

function handleOpenProject(root: string, req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (!requireServeToken(req, url, res)) return;
  const respond = (code: number, payload: unknown): void => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => { if (chunks.length < 64) chunks.push(c); });
  req.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') as { path?: unknown };
      const raw = typeof body.path === 'string' ? body.path.trim() : '';
      if (!raw) { respond(400, { ok: false, error: 'Missing path' }); return; }
      const abs = resolve(raw);
      const mounted = basename(abs) === PRODUCT_DIR ? abs : resolve(abs, PRODUCT_DIR);
      let ok = false;
      try { ok = statSync(mounted).isDirectory(); } catch { ok = false; }
      if (!ok) {
        respond(404, {
          ok: false,
          error: `No ${PRODUCT_DIR}/ directory found under '${abs}' — not a Riglane project ` +
            `(run 'riglane init' there first).`,
        });
        return;
      }
      if (mounted === root) {
        respond(200, { ok: true, slug: basename(dirname(mounted)), base: '' });
        return;
      }
      let slug = '';
      for (const [k, v] of adhocMounts) { if (v === mounted) { slug = k; break; } }
      if (!slug) {
        const stem = `~${basename(dirname(mounted))}`;
        slug = stem;
        let n = 2;
        while (adhocMounts.has(slug) && adhocMounts.get(slug) !== mounted) slug = `${stem}-${n++}`;
        adhocMounts.set(slug, mounted);
      }
      respond(200, { ok: true, slug, base: `/p/${encodeURIComponent(slug)}` });
    } catch {
      respond(400, { ok: false, error: 'Invalid request body' });
    }
  });
}

function handleWrite(root: string, req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (!requireServeToken(req, url, res)) return;
  const reject = (code: number, msg: string): void => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: msg })); };
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c: Buffer) => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_WRITE_BYTES) { aborted = true; reject(413, 'Payload too large'); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    let body: { path?: unknown; content?: unknown };
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch { return reject(400, 'Invalid JSON body'); }
    const relPath = typeof body.path === 'string' ? body.path : '';
    const content = typeof body.content === 'string' ? body.content : null;
    if (!relPath || content === null) return reject(400, 'Body must be { path, content }');
    const ext = extname(relPath).toLowerCase();
    if (ext !== '.yaml' && ext !== '.yml') return reject(403, 'Only .yaml/.yml files may be written');
    const templatesRootDir = resolve(root, 'workflows', 'templates');
    const clean = relPath.replace(/^\/+/, '').replace(/^workflows\/templates\//, '');
    const target = resolve(templatesRootDir, clean);
    if (target !== templatesRootDir && !target.startsWith(templatesRootDir + sep)) return reject(403, 'Path escapes workflows/templates/');
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, written: target }));
    } catch (e) {
      reject(500, `Write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  req.on('error', () => { if (!aborted) reject(400, 'Request error'); });
}

function handleValidate(root: string, req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (!requireServeToken(req, url, res)) return;
  const reject = (code: number, msg: string): void => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: msg })); };
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c: Buffer) => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_WRITE_BYTES) { aborted = true; reject(413, 'Payload too large'); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    let body: { content?: unknown; path?: unknown };
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch { return reject(400, 'Invalid JSON body'); }
    const content = typeof body.content === 'string' ? body.content : null;
    if (content === null) return reject(400, 'Body must be { content, path? }');

    let workflow: unknown;
    try { workflow = parseYamlText(content); } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, scope: 'parse', errors: [`YAML could not be parsed: ${e instanceof Error ? e.message : String(e)}`], warnings: [] }));
      return;
    }
    if (workflow === null || typeof workflow !== 'object' || Array.isArray(workflow)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, scope: 'parse', errors: ['Not a YAML mapping — a workflow file starts with name:'], warnings: [] }));
      return;
    }

    let definitionDir: string | undefined;
    const relPath = typeof body.path === 'string' ? body.path : '';
    if (relPath) {
      const templatesRootDir = resolve(root, 'workflows', 'templates');
      const clean = relPath.replace(/^\/+/, '').replace(/^workflows\/templates\//, '').replace(/\/workflow\.ya?ml$/, '');
      const target = resolve(templatesRootDir, clean);
      if (target === templatesRootDir || target.startsWith(templatesRootDir + sep)) {
        try { if (statSync(target).isDirectory()) definitionDir = target; } catch { }
      }
    }

    try {
      const r = fullValidateWorkflow(workflow as Parameters<typeof fullValidateWorkflow>[0],
        definitionDir !== undefined ? { definitionDir } : {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: r.ok,
        scope: definitionDir !== undefined ? 'full' : 'no-dir',
        errors: r.errors,
        warnings: r.warnings,
      }));
    } catch (e) {
      reject(500, `Validation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  req.on('error', () => { if (!aborted) reject(400, 'Request error'); });
}

export function isLoopbackHost(hostHeader: string | undefined): boolean {
  const hostname = (hostHeader ?? '')
    .trim()
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function handleRequest(root: string, req: IncomingMessage, res: ServerResponse): void {
  try {
    if (!isLoopbackHost(req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: non-loopback Host');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/tools/trace-viewer.html';

    if (handleLocalApi(root, req, res, pathname, url)) return;
    {
      const amount = /^\/p\/([^/]+)(\/api\/.+)$/.exec(pathname);
      if (amount) {
        const target = mountRoot(amount[1] ?? '');
        if (target && handleLocalApi(target, req, res, amount[2] ?? '', url)) return;
      }
    }

    if (req.method === 'POST') {
      if (pathname === '/api/write') { handleWrite(root, req, res, url); return; }
      if (pathname === '/api/validate') { handleValidate(root, req, res, url); return; }
      if (pathname === '/api/open-project') { handleOpenProject(root, req, res, url); return; }
      const wmount = /^\/p\/([^/]+)\/api\/(write|validate)$/.exec(pathname);
      if (wmount) {
        const target = mountRoot(wmount[1] ?? '');
        if (!target) { res.writeHead(404); res.end('Unknown project'); return; }
        if (wmount[2] === 'validate') handleValidate(target, req, res, url);
        else handleWrite(target, req, res, url);
        return;
      }
      res.writeHead(405); res.end('Method not allowed'); return;
    }

    const sendJson = (payload: unknown): void => {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
      });
      res.end(JSON.stringify(payload));
    };

    if (pathname === '/api/projects.json') {
      sendJson(projectEntries(root));
      return;
    }

    if (pathname === '/api/workflows.json') {
      sendJson(workflowEntries(root));
      return;
    }

    if (pathname === '/api/scopes.json') {
      sendJson(scopeEntries(root));
      return;
    }

    const mount = /^\/p\/([^/]+)(\/.*)?$/.exec(pathname);
    if (mount) {
      const target = mountRoot(mount[1] ?? '');
      if (!target) {
        res.writeHead(404);
        res.end('Unknown project');
        return;
      }
      const sub = mount[2] || '/';
      if (sub === '/api/workflows.json') {
        sendJson(workflowEntries(target));
        return;
      }
      if (sub === '/api/scopes.json') {
        sendJson(scopeEntries(target));
        return;
      }
      serveFile(target, sub, res, req.method ?? 'GET');
      return;
    }

    serveFile(root, pathname, res, req.method ?? 'GET');
  } catch {
    try {
      res.writeHead(500);
      res.end('Server error');
    } catch {
    }
  }
}


export function ensureLocalServer(root: string): Promise<string | null> {
  if (startOverride) return startOverride(resolve(root));
  const absRoot = resolve(root);
  if (server && serverRoot === absRoot && serverBase) {
    return Promise.resolve(serverBase);
  }
  if (starting && starting.root === absRoot) return starting.promise;
  if (server && serverRoot !== absRoot) {
    try {
      server.close();
    } catch {
    }
    server = null;
    serverBase = null;
  }

  const promise = new Promise<string | null>((res) => {
    const srv = createServer((rq, rs) => handleRequest(absRoot, rq, rs));
    srv.on('error', () => {
      server = null;
      serverBase = null;
      res(null);
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      if (!port) {
        res(null);
        return;
      }
      server = srv;
      serverRoot = absRoot;
      serverBase = `http://127.0.0.1:${port}`;
      writeServeDiscovery(absRoot, serverBase);
      srv.unref();
      res(serverBase);
    });
  });
  starting = { root: absRoot, promise };
  const clear = (): void => {
    if (starting?.promise === promise) starting = null;
  };
  void promise.then(clear, clear);
  return promise;
}


function serveDiscoveryPath(root: string): string {
  return join(root, 'local', 'serve.json');
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === 'EPERM';
  }
}

function writeServeDiscovery(root: string, base: string): void {
  try {
    const prior = JSON.parse(readFileSync(serveDiscoveryPath(root), 'utf-8')) as { pid?: number };
    if (typeof prior.pid === 'number' && prior.pid !== process.pid && pidAlive(prior.pid)) return;
  } catch {
  }
  try {
    mkdirSync(join(root, 'local'), { recursive: true });
    writeFileSync(
      serveDiscoveryPath(root),
      `${JSON.stringify(
        {
          base,
          port: Number(new URL(base).port),
          token: getServeToken(),
          pid: process.pid,
          started_at: new Date().toISOString(),
        },
        null,
        2,
      )}
`,
      'utf-8',
    );
  } catch {
  }
}

function removeServeDiscovery(root: string | null): void {
  if (!root) return;
  try {
    const p = serveDiscoveryPath(root);
    const current = JSON.parse(readFileSync(p, 'utf-8')) as { pid?: number };
    if (current.pid === process.pid) unlinkSync(p);
  } catch {
  }
}


function canOpenBrowser(): boolean {
  if (process.env.CI) return false;
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return false;
  if (process.platform === 'win32' || process.platform === 'darwin') return true;
  if (isWSL()) return true;
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return true;
  return false;
}

function isWSL(): boolean {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  if (process.platform === 'linux') {
    try {
      return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf-8'));
    } catch {
      return false;
    }
  }
  return false;
}

function traceOpenLog(agentDir: string, msg: string): void {
  try {
    const dir = join(agentDir, 'local');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'trace-open.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
  }
}

function browserCommands(url: string): Array<[string, string[]]> {
  if (process.platform === 'win32') return [['cmd', ['/c', 'start', '', url]]];
  if (process.platform === 'darwin') return [['open', [url]]];
  if (isWSL()) {
    return [
      ['wslview', [url]],
      ['cmd.exe', ['/c', 'start', '', url]],
      ['powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`]],
      ['xdg-open', [url]],
    ];
  }
  return [['xdg-open', [url]]];
}

function openBrowser(url: string, agentDir?: string): void {
  const candidates = browserCommands(url);
  const tryNext = (i: number): void => {
    if (i >= candidates.length) {
      if (agentDir) traceOpenLog(agentDir, `openBrowser: all openers failed — url=${url}`);
      process.stderr.write(`[riglane] open this URL to view the trace: ${url}\n`);
      return;
    }
    const [cmd, args] = candidates[i]!;
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => {
        if (agentDir) traceOpenLog(agentDir, `openBrowser: '${cmd}' errored — trying next`);
        tryNext(i + 1);
      });
      child.on('spawn', () => {
        if (agentDir) traceOpenLog(agentDir, `openBrowser: '${cmd}' spawned ok`);
      });
      child.unref();
    } catch {
      tryNext(i + 1);
    }
  };
  tryNext(0);
}


export async function openToolViewer(
  toolsParent: string,
  relPath: string,
): Promise<string | null> {
  try {
    const base = await ensureLocalServer(toolsParent);
    if (!base) return null;
    const url = withServeToken(`${base}/${relPath.replace(/^\/+/, '')}`);
    if (canOpenBrowser()) openBrowser(url);
    return url;
  } catch {
    return null;
  }
}

export function openTraceViewer(agentDir: string, traceServerPath: string): void {
  try {
    const can = canOpenBrowser();
    traceOpenLog(
      agentDir,
      `openTraceViewer: canOpenBrowser=${can} platform=${process.platform} isWSL=${isWSL()} ` +
        `CI=${process.env.CI ? '1' : ''} DISPLAY=${process.env.DISPLAY ?? ''} ` +
        `WSL_INTEROP=${process.env.WSL_INTEROP ? '1' : ''} NODE_ENV=${process.env.NODE_ENV ?? ''}`,
    );
    if (!can) return;
    void ensureLocalServer(agentDir).then((base) => {
      traceOpenLog(agentDir, `ensureLocalServer base=${base ?? 'null'}`);
      if (!base) return;
      const url = withServeToken(`${base}/tools/trace-viewer.html?trace=${encodeURI(traceServerPath)}`);
      openBrowser(url, agentDir);
    });
  } catch (e) {
    traceOpenLog(agentDir, `openTraceViewer error: ${String(e)}`);
  }
}

export function currentLocalServerBase(): string | null {
  return serverBase;
}

export function refTraceServer(): void {
  try {
    server?.ref();
  } catch {
  }
}

export function stopTraceServer(): void {
  if (server) {
    try {
      server.close();
    } catch {
    }
  }
  removeServeDiscovery(serverRoot || null);
  server = null;
  serverRoot = '';
  serverBase = null;
}
