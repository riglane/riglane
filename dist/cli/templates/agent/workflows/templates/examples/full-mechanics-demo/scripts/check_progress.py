#!/usr/bin/env python3
"""full-mechanics-demo — refine→record loop_back when.script decider.

Contract (loop_back when.script):
  - the engine runs this from the project root after the owning step's full
    gate pass, with $RIGLANE_RUN_DIR pointing at the per-run dir
    (.riglane/local/workflow_runs/<run_id>/) where this run's data/ lives;
  - exit 0 and print exactly one JSON object {"loop": true|false} to stdout;
  - any non-zero exit or malformed stdout is a hard error (STOP_WORKFLOW) —
    a broken progress file must surface, never loop silently.

Decision: loop while the refinement progress registry still has passes left.
The loop_back max_iterations in workflow.yaml is the independent hard ceiling.
"""
import json
import os
import sys

_run_dir = os.environ.get("RIGLANE_RUN_DIR")
if not _run_dir:
    print("check_progress: RIGLANE_RUN_DIR not set (engine must inject it)", file=sys.stderr)
    sys.exit(1)
PROGRESS = os.path.join(_run_dir, "data", "refine-progress.json")

try:
    with open(PROGRESS, encoding="utf-8") as f:
        remaining = int(json.load(f)["passes_remaining"])
except Exception as exc:  # noqa: BLE001 — surface everything, decide nothing
    print(f"check_progress: cannot read {PROGRESS}: {exc}", file=sys.stderr)
    sys.exit(1)

print(json.dumps({"loop": remaining > 0}))
