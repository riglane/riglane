#!/usr/bin/env node
// doc-spec-extraction — extract-branch route decider (routes when.script).
//
// Contract (routes when.script): the engine runs this from the project root
// AFTER the ANALYZE human gate passes, with $RIGLANE_RUN_DIR pointing at the per-run
// dir (.riglane/local/workflow_runs/<run_id>/) where this run's data/ lives. Print
// EXACTLY one JSON object {"route":"extract"|"proceed"} to stdout; any non-zero
// exit, unknown id, or malformed stdout is a hard STOP_WORKFLOW error.
//
// Decision: route "extract" iff there is ≥1 domain to draft — a domain with
// status "pending" AND a non-empty requirements list. This is the EXACT set the
// EXTRACT parallel step keys on (analysis-report.domains[status=pending]), so
// "route taken" ⇔ "EXTRACT has ≥1 branch" — no 0-items failure is possible.
// Otherwise "proceed": the run skips the create pipeline and goes to
// reorganize-gate (which may still apply approved moves).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const runDir = process.env.RIGLANE_RUN_DIR;
if (!runDir) {
  console.error('has-draftable: RIGLANE_RUN_DIR not set (engine must inject it)');
  process.exit(1);
}
const reportPath = join(runDir, 'data', 'analysis-report.json');

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf-8'));
} catch (e) {
  console.error(`has-draftable: cannot read ${reportPath}: ${e.message}`);
  process.exit(1);
}

const domains = Array.isArray(report.domains) ? report.domains : [];
const draftable = domains.some(
  (d) => d && d.status === 'pending' && Array.isArray(d.requirements) && d.requirements.length > 0,
);

process.stdout.write(JSON.stringify({ route: draftable ? 'extract' : 'proceed' }));
