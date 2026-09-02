#!/usr/bin/env python3
"""routes-demo loop_back when.script decider (major route: loop once).

Contract (loop_back when.script): exit 0 + stdout {"loop": true|false}; any
error is a hard STOP_WORKFLOW.

Decision: loop the `analyze → apply-fix → verify` cycle exactly once, to
demonstrate a route-scoped loop_back. A counter file in the run's data dir
tracks how many passes have happened (it survives the loop range reset, since
it is not a declared output; each run gets a fresh per-run data/ dir under
$RIGLANE_RUN_DIR = .riglane/local/workflow_runs/<run_id>/, injected by the engine).
"""
import json
import os
import sys

_run_dir = os.environ.get("RIGLANE_RUN_DIR")
if not _run_dir:
    print("loop_fixes: RIGLANE_RUN_DIR not set (engine must inject it)", file=sys.stderr)
    sys.exit(1)
COUNTER = os.path.join(_run_dir, "data", ".fix_attempts")
MAX_LOOPS = 1  # loop this many times, then proceed

try:
    n = 0
    if os.path.exists(COUNTER):
        with open(COUNTER, encoding="utf-8") as f:
            n = int((f.read() or "0").strip() or "0")
    with open(COUNTER, "w", encoding="utf-8") as f:
        f.write(str(n + 1))
except Exception as exc:  # noqa: BLE001 — surface everything, decide nothing
    print(f"loop_fixes: counter error: {exc}", file=sys.stderr)
    sys.exit(1)

print(json.dumps({"loop": n < MAX_LOOPS}))
