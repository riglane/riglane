
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';

import { buildWorkflowInventory, type WorkflowInventory } from '../../catalog/inventory.js';
import { composeLockDocument } from '../../catalog/lock.js';
import { loadYaml } from '../../engine/schema-validate.js';
import { fullValidateWorkflow } from '../../engine/workflow-engine.js';
import type { Workflow } from '../../types/workflow.js';


function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', timeout: 30_000 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
}

export interface GitFacts {
  readonly isRepo: boolean;
  readonly headSha: string;
  readonly clean: boolean;
  readonly remoteUrl: string;
  readonly headPushed: 'yes' | 'no' | 'unknown';
}

export function gitFacts(dir: string): GitFacts {
  const top = git(dir, 'rev-parse', '--show-toplevel');
  if (!top.ok) return { isRepo: false, headSha: '', clean: false, remoteUrl: '', headPushed: 'unknown' };
  const headSha = git(dir, 'rev-parse', 'HEAD').out;
  const clean = git(dir, 'status', '--porcelain', '--', '.').out === '';
  const remoteUrl = git(dir, 'remote', 'get-url', 'origin').out;
  let headPushed: GitFacts['headPushed'] = 'unknown';
  if (remoteUrl !== '' && headSha !== '') {
    const ls = git(dir, 'ls-remote', 'origin');
    if (ls.ok) {
      const remoteShas = ls.out
        .split('\n')
        .map((l) => l.split('\t')[0] ?? '')
        .filter((s) => s.length === 40);
      headPushed = remoteShas.some(
        (s) => s === headSha || git(dir, 'merge-base', '--is-ancestor', headSha, s).ok,
      )
        ? 'yes'
        : 'no';
    }
  }
  return { isRepo: true, headSha, clean, remoteUrl, headPushed };
}


export interface PreflightRow {
  readonly label: string;
  readonly status: 'ok' | 'fail' | 'warn';
  readonly detail: string;
  readonly blocking: boolean;
}

export interface PreflightReport {
  readonly rows: PreflightRow[];
  readonly blocked: boolean;
  readonly id: string;
  readonly git: GitFacts;
  readonly licenseName: string;
}

export function detectLicense(repoRoot: string): string {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    const p = join(repoRoot, name);
    if (!existsSync(p)) continue;
    const first = (readFileSync(p, 'utf-8').split('\n')[0] ?? '').trim().toLowerCase();
    if (first.includes('mit')) return 'MIT';
    if (first.includes('apache')) return 'Apache-2.0';
    if (first.includes('bsd')) return 'BSD';
    return 'see LICENSE';
  }
  return '';
}

export function runPreflight(workflowDir: string): PreflightReport {
  const rows: PreflightRow[] = [];
  const dir = resolve(workflowDir);
  const id = basename(dir);
  const push = (label: string, status: PreflightRow['status'], detail: string, blocking = status === 'fail'): void => {
    rows.push({ label, status, detail, blocking });
  };

  const yamlPath = join(dir, 'workflow.yaml');
  let workflow: Workflow | null = null;
  if (!existsSync(yamlPath)) {
    push('workflow.yaml present', 'fail', `no workflow.yaml in ${dir}`);
  } else {
    try {
      workflow = loadYaml<Workflow>(yamlPath);
      push('workflow.yaml parses', 'ok', '');
    } catch (e) {
      push('workflow.yaml parses', 'fail', e instanceof Error ? e.message : String(e));
    }
  }
  if (workflow !== null) {
    const name = (workflow as { name?: unknown }).name;
    if (name === id) push('one identity (name = directory)', 'ok', id);
    else push('one identity (name = directory)', 'fail', `workflow is named '${String(name)}', directory is '${id}'`);
    const v = fullValidateWorkflow(workflow, { definitionDir: dir });
    if (v.ok) push('engine validator', 'ok', `${v.warnings.length} advisory warning(s)`);
    else push('engine validator', 'fail', v.errors.slice(0, 3).join(' · '));
    const raw = readFileSync(yamlPath, 'utf-8');
    if (raw.includes('templates/my_workflows/')) {
      push(
        'script paths are install-form',
        'fail',
        "commands point at the authoring location (templates/my_workflows/) — publish the promoted copy, whose paths say templates/community/",
      );
    } else {
      push('script paths are install-form', 'ok', '');
    }
  }

  const g = gitFacts(dir);
  if (!g.isRepo) push('inside a git repository', 'fail', 'the pin (a commit SHA) must come from a git checkout');
  else {
    push('inside a git repository', 'ok', g.headSha.slice(0, 12));
    if (g.clean) push('workflow tree clean', 'ok', 'the tree you pack is the tree you pin');
    else
      push(
        'workflow tree clean',
        'fail',
        'uncommitted changes inside the workflow directory — the lock would describe a tree no commit holds',
      );
    if (g.remoteUrl === '') push('public remote (origin)', 'fail', 'no origin remote — the catalog fetches from a public URL');
    else if (/^https:\/\//.test(g.remoteUrl)) push('public remote (origin)', 'ok', g.remoteUrl);
    else push('public remote (origin)', 'warn', `${g.remoteUrl} — the entry needs an https URL a stranger can fetch`, false);
    if (g.headPushed === 'yes') push('HEAD pushed to the remote', 'ok', 'the pinned SHA exists in the public history');
    else if (g.headPushed === 'no') push('HEAD pushed to the remote', 'fail', 'push first — a SHA the remote does not hold fails every fetch');
    else push('HEAD pushed to the remote', 'warn', 'could not verify (ls-remote failed)', false);
  }

  const repoRoot = g.isRepo ? git(dir, 'rev-parse', '--show-toplevel').out : dir;
  const licenseName = detectLicense(repoRoot);
  if (licenseName === '') push('LICENSE at the repo root', 'fail', 'the entry requires a license field, and the code must carry one');
  else push('LICENSE at the repo root', 'ok', licenseName);

  return { rows, blocked: rows.some((r) => r.status === 'fail' && r.blocking), id, git: g, licenseName };
}


export interface PackResult {
  readonly lockText: string;
  readonly summary: string;
  readonly level: 'verified' | 'community';
  readonly fromCommit: boolean;
}

function packTree(workflowDir: string): Omit<PackResult, 'fromCommit'> {
  const workflow = loadYaml<Workflow>(join(workflowDir, 'workflow.yaml'));
  const inv: WorkflowInventory = buildWorkflowInventory(resolve(workflowDir), workflow);
  const lockText = composeLockDocument(inv);
  const shell = inv.script_tools.length + inv.deciders.length;
  return {
    lockText,
    summary:
      `${inv.steps.count} step(s), ${inv.script_tools.length} script tool(s), ` +
      `${inv.deciders.length} decider script(s), ${inv.bundled_files.length} bundled file(s)`,
    level: shell === 0 ? 'verified' : 'community',
  };
}

export function packLock(workflowDir: string): PackResult {
  const dir = resolve(workflowDir);
  const id = basename(dir);
  const scratch = mkdtempSync(join(tmpdir(), 'riglane-publish-'));
  try {
    const ar = spawnSync('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar', 'HEAD', '--', '.'], {
      cwd: dir,
      maxBuffer: 256 * 1024 * 1024,
      timeout: 60_000,
    });
    if (ar.status === 0 && ar.stdout !== null) {
      writeFileSync(join(scratch, 'wf.tar'), ar.stdout);
      const tree = join(scratch, id);
      mkdirSync(tree);
      const untar = spawnSync('tar', ['-xf', 'wf.tar', '-C', id], { cwd: scratch, timeout: 60_000 });
      if (untar.status === 0) return { ...packTree(tree), fromCommit: true };
    }
    return { ...packTree(dir), fromCommit: false };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}


export interface EntryPin {
  readonly repo: string;
  readonly path: string;
  readonly sha: string;
}

export function repinEntryText(raw: string, pin: EntryPin): string {
  const lines = raw.split('\n');
  let start = 0;
  while (start < lines.length && (/^\s*#/.test(lines[start] ?? '') || (lines[start] ?? '').trim() === '')) start++;
  const body = lines.slice(start);
  const out: string[] = [];
  let i = 0;
  let repinned = false;
  while (i < body.length) {
    const line = body[i] ?? '';
    if (/^source:\s*$/.test(line)) {
      out.push('source:');
      out.push(`  repo: ${pin.repo}`);
      out.push(`  path: ${pin.path}`);
      out.push(`  sha: ${pin.sha}`);
      i++;
      while (i < body.length && /^\s+\S/.test(body[i] ?? '')) i++;
      repinned = true;
      continue;
    }
    out.push(line);
    i++;
  }
  if (!repinned) throw new Error('entry.yaml has no source: block to re-pin');
  return out.join('\n');
}

export interface ScaffoldFields {
  readonly id: string;
  readonly summary: string;
  readonly author: string;
  readonly license: string;
  readonly pin: EntryPin;
}

export function scaffoldEntryText(f: ScaffoldFields): string {
  return [
    `id: ${f.id}`,
    '',
    `summary: >-`,
    `  ${f.summary}`,
    '',
    'description: >',
    '  TODO: longer prose — what it does, when to use it.',
    '',
    `author: ${f.author}`,
    `license: ${f.license}`,
    '',
    'source:',
    `  repo: ${f.pin.repo}`,
    `  path: ${f.pin.path}`,
    `  sha: ${f.pin.sha}`,
    '',
  ].join('\n');
}

export function writeEntryFiles(entryDir: string, entryText: string, lockText: string): void {
  writeFileSync(join(entryDir, 'entry.yaml'), entryText, 'utf-8');
  writeFileSync(join(entryDir, 'entry.lock.yaml'), lockText, 'utf-8');
}

export function sanitizeOutput(raw: string): string[] {
  return raw
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trimEnd())
    .filter((l) => l.trim() !== '');
}

export function validateCatalogCheckout(catalogRoot: string): { ran: boolean; ok: boolean; output: string } {
  const script = join(catalogRoot, 'scripts', 'validate-entries.mjs');
  if (!existsSync(script)) return { ran: false, ok: true, output: 'no scripts/validate-entries.mjs in the checkout' };
  const env = { ...process.env };
  if (env.RIGLANE_CLI === undefined) {
    const selfCli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
    if (existsSync(selfCli)) env.RIGLANE_CLI = selfCli;
  }
  const r = spawnSync(process.execPath, [script], { cwd: catalogRoot, encoding: 'utf-8', env, timeout: 300_000 });
  const output = sanitizeOutput(`${r.stdout ?? ''}\n${r.stderr ?? ''}`).join('\n');
  return { ran: true, ok: r.status === 0, output };
}

export function pathInsideRepo(workflowDir: string): string {
  const top = git(resolve(workflowDir), 'rev-parse', '--show-toplevel');
  if (!top.ok) return '';
  const root = resolve(top.out);
  const dir = resolve(workflowDir);
  if (dir === root) return '';
  const rel = dir.slice(root.length + 1).split('\\').join('/');
  return rel;
}
