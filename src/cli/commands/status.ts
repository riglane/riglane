
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { PRODUCT_DIR } from '../../config/paths.js';
import { LEGACY_DIRS, VERSION_MARKER } from '../../config/product.js';
import { computeTemplatesHash } from '../../registry/templateHash.js';
import { ADAPTERS, mcpConfigProbe } from '../../adapters/index.js';
import { probeWorkflowEngineMcp } from '../mcpProbe.js';

export type TemplatesState = 'ok' | 'drift' | 'legacy' | 'absent';

export interface AdapterReadiness {
  readonly id: string;
  readonly skills_installed: boolean;
  readonly mcp_configured: boolean;
  readonly ready: boolean;
}

export interface ProjectStatus {
  readonly installed: boolean;
  readonly mcp_configured: boolean;
  readonly templates: TemplatesState;
  readonly up_to_date: boolean;
  readonly action: 'init' | 'update' | 'migrate' | 'none';
  readonly adapters: readonly AdapterReadiness[];
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function computeProjectStatus(target: string): ProjectStatus {
  const abs = resolve(target);
  const installed = isDir(join(abs, PRODUCT_DIR, 'workflows'));

  const adapters: AdapterReadiness[] = Object.entries(ADAPTERS).map(([id, d]) => {
    const probe = mcpConfigProbe(d);
    const p = join(abs, probe.path);
    let mcpOk = false;
    if (isFile(p)) {
      try {
        mcpOk = probeWorkflowEngineMcp(readFileSync(p, 'utf-8'), probe.kind).ok;
      } catch {
        mcpOk = false;
      }
    }
    const skillsOk = d.skills
      ? isDir(join(abs, d.skills.dstDir))
      : isDir(join(abs, d.projectDir));
    return { id, skills_installed: skillsOk, mcp_configured: mcpOk, ready: skillsOk && mcpOk };
  });
  const mcpConfigured = adapters.some((a) => a.mcp_configured);

  let templates: TemplatesState;
  const marker = join(abs, PRODUCT_DIR, VERSION_MARKER);
  if (!installed || !isFile(marker)) {
    templates = 'absent';
  } else {
    let raw = '';
    try {
      raw = readFileSync(marker, 'utf-8').trim();
    } catch {
      raw = '';
    }
    if (raw.startsWith('{')) {
      try {
        const obj = JSON.parse(raw) as { templateHash?: string };
        templates =
          typeof obj.templateHash === 'string'
            ? obj.templateHash === computeTemplatesHash()
              ? 'ok'
              : 'drift'
            : 'legacy';
      } catch {
        templates = 'legacy';
      }
    } else {
      templates = 'legacy';
    }
  }

  const up_to_date = installed && templates === 'ok';
  const hasLegacyDir = !installed && LEGACY_DIRS.some((d) => isDir(join(abs, d, 'workflows')));
  const action: ProjectStatus['action'] = !installed
    ? hasLegacyDir
      ? 'migrate'
      : 'init'
    : templates === 'ok'
      ? 'none'
      : 'update';

  return { installed, mcp_configured: mcpConfigured, templates, up_to_date, action, adapters };
}

export async function runStatus(args: string[]): Promise<number> {
  const json = args.includes('--json');
  const target = args.find((a) => !a.startsWith('--')) ?? '.';
  const st = computeProjectStatus(target);
  if (json) {
    process.stdout.write(`${JSON.stringify(st)}\n`);
  } else {
    process.stdout.write(
      `installed=${st.installed} mcp=${st.mcp_configured} templates=${st.templates} ` +
        `action=${st.action} ready=${st.adapters.filter((a) => a.ready).map((a) => a.id).join(',') || 'none'}\n`,
    );
  }
  return 0;
}
