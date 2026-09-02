#!/usr/bin/env python3
"""full-mechanics-demo — `decide` routes when.script decider (mode → route id).

Contract (routes when.script):
  - the engine runs this from the project root after the routing step's full
    gate pass, with $RIGLANE_RUN_DIR pointing at the per-run dir
    (.riglane/local/workflow_runs/<run_id>/) where this run's data/ lives;
  - exit 0 and print exactly one JSON object {"route": "<id>"|"proceed"} to
    stdout;
  - an unknown id, non-string route, any non-zero exit, or malformed stdout is
    a hard error (STOP_WORKFLOW) — never guess.

Decision: route by the {mode} param, copied verbatim into triage.json. Valid
values are the defined route ids ("deep" | "fail") or "proceed" (skip routes,
continue to the main report step).
"""
import json
import os
import sys

_run_dir = os.environ.get("RIGLANE_RUN_DIR")
if not _run_dir:
    print("route_mode: RIGLANE_RUN_DIR not set (engine must inject it)", file=sys.stderr)
    sys.exit(1)
TRIAGE = os.path.join(_run_dir, "data", "triage.json")
VALID = {"deep", "fail", "proceed"}

try:
    with open(TRIAGE, encoding="utf-8") as f:
        mode = str(json.load(f)["mode"])
except Exception as exc:  # noqa: BLE001 — surface everything, decide nothing
    print(f"route_mode: cannot read {TRIAGE}: {exc}", file=sys.stderr)
    sys.exit(1)

if mode not in VALID:
    print(f"route_mode: unknown mode '{mode}' (expected one of {sorted(VALID)})", file=sys.stderr)
    sys.exit(1)

print(json.dumps({"route": mode}))
