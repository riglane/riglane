#!/usr/bin/env node
// doc-spec-extraction — reorganize route decider (routes when.script).
//
// Contract (routes when.script): the engine runs this from the project root
// AFTER the COMMIT step's full gate pass, with $RIGLANE_RUN_DIR pointing at the
// per-run dir (.riglane/local/workflow_runs/<run_id>/) where this run's data/ lives.
// Print EXACTLY one JSON object {"route":"reorganize"|"proceed"} to stdout; any
// non-zero exit, unknown id, or malformed stdout is a hard STOP_WORKFLOW error.
//
// Decision: route "reorganize" iff ANALYZE proposed >=1 redesign proposal of an
// APPLICABLE kind — one reducible to a spec_write move/rename. Content-edit kinds
// (merge_specs, update_spec) do NOT trigger the branch; they stay advisory.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APPLICABLE = new Set(['move_spec', 'split_domain', 'merge_domains', 'rename_domain']);

const runDir = process.env.RIGLANE_RUN_DIR;
if (!runDir) {
  console.error('has-applicable-moves: RIGLANE_RUN_DIR not set (engine must inject it)');
  process.exit(1);
}
const reportPath = join(runDir, 'data', 'analysis-report.json');

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf-8'));
} catch (e) {
  console.error(`has-applicable-moves: cannot read ${reportPath}: ${e.message}`);
  process.exit(1);
}

const proposals = Array.isArray(report.redesign_proposals) ? report.redesign_proposals : [];
const hasApplicable = proposals.some((p) => p && APPLICABLE.has(p.kind));

process.stdout.write(JSON.stringify({ route: hasApplicable ? 'reorganize' : 'proceed' }));
