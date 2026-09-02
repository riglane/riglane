
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { loadYaml } from '../../engine/schema-validate.js';
import { fullValidateWorkflow } from '../../engine/workflow-engine.js';
import type { Workflow } from '../../types/workflow.js';

export function runValidateWorkflowCli(argv: readonly string[]): number {
  const json = argv.includes('--json');
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) {
    process.stderr.write('Usage: riglane validate-workflow <path-to-workflow.yaml> [--json]\n');
    return 2;
  }
  const path = resolve(target);
  if (!existsSync(path)) {
    process.stderr.write(`validate-workflow: file not found: ${path}\n`);
    return 2;
  }

  let workflow: Workflow;
  try {
    workflow = loadYaml<Workflow>(path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: false, errors: [`YAML parse error: ${msg}`] })}\n`);
    } else {
      process.stderr.write(`validate-workflow: YAML parse error: ${msg}\n`);
    }
    return 1;
  }

  const { ok, errors, warnings: lintWarnings } = fullValidateWorkflow(workflow, {
    definitionDir: dirname(path),
  });
  const warnings = [...lintWarnings];
  if (ok && /[\\/]\.(claude|cursor|codex)[\\/]/.test(path)) {
    warnings.push({
      id: 'outside-templates-tree',
      message:
        `This file sits inside an adapter config tree (.claude/.cursor/.codex) — it ` +
        `validates, but the engine resolves workflows ONLY from ` +
        `.riglane/workflows/templates/; it will NEVER find this one. Move it to ` +
        `.riglane/workflows/templates/my_workflows/<name>/workflow.yaml.`,
      topic: 'workflow-fields',
    });
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok, errors, warnings })}\n`);
  } else if (ok) {
    process.stdout.write(`OK: ${target} is a valid workflow.\n`);
    if (warnings.length > 0) {
      process.stdout.write(`${warnings.length} advisory warning(s) — never blocking:\n`);
      for (const w of warnings) {
        const anchor = w.step !== undefined ? ` [step: ${w.step}]` : '';
        process.stdout.write(`  ⚠ ${w.id}${anchor}: ${w.message}\n    → workflow_learn(topic="${w.topic}")\n`);
      }
    }
  } else {
    process.stderr.write(`INVALID: ${target} — ${errors.length} issue(s):\n`);
    for (const err of errors) process.stderr.write(`  - ${err}\n`);
  }
  return ok ? 0 : 1;
}
