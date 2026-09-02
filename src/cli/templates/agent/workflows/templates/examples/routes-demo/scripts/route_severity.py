#!/usr/bin/env python3
"""routes-demo routes when.script decider (severity → route id).

Contract (routes when.script):
  - the ENGINE executes this from the project root after the routing step's
    full gate pass, with $RIGLANE_RUN_DIR pointing at the per-run dir
    (.riglane/local/workflow_runs/<run_id>/) where this run's data/ lives;
  - exit 0 and print exactly one JSON object {"route": "<id>"|"proceed"} to
    stdout;
  - a non-string route, an unknown id, any non-zero exit, or malformed stdout
    is a hard error (STOP_WORKFLOW) — never guess.

Decision: route by the classified severity. The value is copied verbatim from
the {severity} run param into the classification file, so it already equals a
defined route id ("minor" | "major" | "critical").
"""
import json
import os
import sys

_run_dir = os.environ.get("RIGLANE_RUN_DIR")
if not _run_dir:
    print("route_severity: RIGLANE_RUN_DIR not set (engine must inject it)", file=sys.stderr)
    sys.exit(1)
CLASSIFICATION = os.path.join(_run_dir, "data", "classification.json")

try:
    with open(CLASSIFICATION, encoding="utf-8") as f:
        severity = str(json.load(f)["severity"])
except Exception as exc:  # noqa: BLE001 — surface everything, decide nothing
    print(f"route_severity: cannot read {CLASSIFICATION}: {exc}", file=sys.stderr)
    sys.exit(1)

print(json.dumps({"route": severity}))
