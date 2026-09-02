
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { PRODUCT_DIR } from '../../config/paths.js';
import { findInProgressRuns } from '../../engine/runs.js';
import { driftLabel, probe } from '../../registry/probe.js';
import type { ProbeResult } from '../../registry/probe.js';
import * as registry from '../../registry/registry.js';
import type { Entry } from '../../registry/registry.js';

const USAGE = [
  'usage: riglane projects [list] [--json]',
  '       riglane projects forget <path>',
  '       riglane projects forget --temp [--gone] [--delete] [--force] [--dry-run]',
  '',
  '  list        Every registered project: state, whether it is temporary, runs still in progress.',
  '  forget      Remove entries from the registry. Files are left intact unless --delete.',
  '    <path>      one project, by path',
  '    --temp      every project under the OS temp directory',
  '    --gone      every project whose directory no longer exists',
  '    --delete    also remove the directory — temporary projects only, never anything else',
  '    --force     delete even when a run there is still in progress',
  '    --dry-run   say what would happen and change nothing',
].join('\n');

export interface ProjectReport {
  readonly slug: string;
  readonly path: string;
  readonly adapters: readonly string[];
  readonly drift: ProbeResult['drift'];
  readonly temporary: boolean;
  readonly path_exists: boolean;
  readonly in_progress_runs: readonly string[];
}

export function reportFor(entry: Entry): ProjectReport {
  const p = probe(entry);
  let runs: readonly string[] = [];
  if (p.pathExists) {
    try {
      runs = findInProgressRuns(join(entry.path, PRODUCT_DIR));
    } catch {
      runs = [];
    }
  }
  return {
    slug: entry.slug,
    path: entry.path,
    adapters: entry.adapters,
    drift: p.drift,
    temporary: p.temporary,
    path_exists: p.pathExists,
    in_progress_runs: runs,
  };
}

export function listReports(): ProjectReport[] {
  return registry.list().map(reportFor);
}

export interface ForgetOptions {
  readonly temp: boolean;
  readonly gone: boolean;
  readonly del: boolean;
  readonly force: boolean;
  readonly dryRun: boolean;
}

export interface ForgetOutcome {
  readonly path: string;
  readonly action: 'forgotten' | 'deleted' | 'kept';
  readonly reason: string;
}

export function selectForForget(reports: readonly ProjectReport[], opts: Pick<ForgetOptions, 'temp' | 'gone'>): ProjectReport[] {
  return reports.filter((r) => (opts.temp && r.temporary) || (opts.gone && !r.path_exists));
}

export function forgetProjects(selected: readonly ProjectReport[], opts: ForgetOptions): ForgetOutcome[] {
  const out: ForgetOutcome[] = [];
  for (const r of selected) {
    const wantsDelete = opts.del && r.temporary && r.path_exists;
    if (wantsDelete && r.in_progress_runs.length > 0 && !opts.force) {
      out.push({
        path: r.path,
        action: 'kept',
        reason: `${r.in_progress_runs.length} run(s) still in progress — pass --force to delete anyway`,
      });
      continue;
    }
    if (opts.dryRun) {
      out.push({ path: r.path, action: wantsDelete ? 'deleted' : 'forgotten', reason: '' });
      continue;
    }
    if (wantsDelete) {
      try {
        rmSync(r.path, { recursive: true, force: true });
      } catch (e) {
        out.push({ path: r.path, action: 'kept', reason: `could not delete: ${e instanceof Error ? e.message : String(e)}` });
        continue;
      }
      if (existsSync(r.path)) {
        out.push({ path: r.path, action: 'kept', reason: 'could not delete: the directory is still there (a process may hold it open)' });
        continue;
      }
    }
    registry.unregister(r.path);
    out.push({ path: r.path, action: wantsDelete ? 'deleted' : 'forgotten', reason: '' });
  }
  return out;
}

function printTable(reports: readonly ProjectReport[]): void {
  if (reports.length === 0) {
    process.stdout.write('No projects registered.\n');
    return;
  }
  const w = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
  process.stdout.write(`${w('state', 14)}${w('where', 6)}${w('live', 5)}path\n`);
  for (const r of reports) {
    process.stdout.write(
      `${w(driftLabel(r.drift), 14)}${w(r.temporary ? 'temp' : '', 6)}${w(r.in_progress_runs.length ? String(r.in_progress_runs.length) : '', 5)}${r.path}\n`,
    );
  }
  const temp = reports.filter((r) => r.temporary).length;
  const gone = reports.filter((r) => !r.path_exists).length;
  const notes: string[] = [];
  if (temp) notes.push(`${temp} temporary (under the OS temp directory)`);
  if (gone) notes.push(`${gone} gone (directory no longer exists)`);
  if (notes.length) {
    process.stdout.write(`\n${reports.length} registered · ${notes.join(' · ')}\n`);
    process.stdout.write('Tidy up with: riglane projects forget --temp --gone   (add --delete to remove temporary directories)\n');
  } else {
    process.stdout.write(`\n${reports.length} registered.\n`);
  }
}

export async function runProjects(args: string[]): Promise<number> {
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const words = args.filter((a) => !a.startsWith('--'));
  const sub = words[0] ?? 'list';

  if (sub === 'list') {
    const reports = listReports();
    if (flags.has('--json')) {
      process.stdout.write(`${JSON.stringify({ version: registry.load().version, projects: reports })}\n`);
    } else {
      printTable(reports);
    }
    return 0;
  }

  if (sub === 'forget') {
    const opts: ForgetOptions = {
      temp: flags.has('--temp'),
      gone: flags.has('--gone'),
      del: flags.has('--delete'),
      force: flags.has('--force'),
      dryRun: flags.has('--dry-run'),
    };
    const explicit = words.slice(1);
    let selected: ProjectReport[];
    if (explicit.length > 0) {
      if (opts.temp || opts.gone) {
        process.stderr.write('[riglane] projects forget: give either a path or --temp/--gone, not both.\n');
        return 2;
      }
      const reports = listReports();
      selected = [];
      for (const raw of explicit) {
        const canon = registry.canonicalize(raw);
        const hit = reports.find((r) => r.path === canon);
        if (!hit) {
          process.stderr.write(`[riglane] projects forget: '${raw}' is not a registered project.\n`);
          return 1;
        }
        selected.push(hit);
      }
      if (opts.del && selected.some((r) => !r.temporary)) {
        process.stderr.write('[riglane] projects forget: --delete removes temporary projects only; this one is not under the OS temp directory.\n');
        return 2;
      }
    } else if (opts.temp || opts.gone) {
      selected = selectForForget(listReports(), opts);
    } else {
      process.stderr.write(`[riglane] projects forget: say which — a <path>, --temp, or --gone.\n\n${USAGE}\n`);
      return 2;
    }

    if (selected.length === 0) {
      process.stdout.write('Nothing to forget.\n');
      return 0;
    }
    const outcomes = forgetProjects(selected, opts);
    const prefix = opts.dryRun ? 'would ' : '';
    for (const o of outcomes) {
      const verb = o.action === 'kept' ? 'kept     ' : o.action === 'deleted' ? `${prefix}delete ` : `${prefix}forget `;
      process.stdout.write(`  ${verb} ${o.path}${o.reason ? `  — ${o.reason}` : ''}\n`);
    }
    const n = (a: ForgetOutcome['action']): number => outcomes.filter((o) => o.action === a).length;
    const parts: string[] = [];
    if (n('forgotten')) parts.push(`${n('forgotten')} ${prefix}forgotten (files left intact)`);
    if (n('deleted')) parts.push(`${n('deleted')} ${prefix}deleted`);
    if (n('kept')) parts.push(`${n('kept')} kept`);
    process.stdout.write(`${parts.join(' · ')}${opts.dryRun ? '   (dry run — nothing changed)' : ''}\n`);
    return n('kept') > 0 && !opts.dryRun ? 1 : 0;
  }

  process.stderr.write(`[riglane] projects: unknown subcommand '${sub}'.\n\n${USAGE}\n`);
  return 2;
}
