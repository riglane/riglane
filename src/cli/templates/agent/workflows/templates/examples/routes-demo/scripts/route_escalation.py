#!/usr/bin/env python3
"""routes-demo nested-routes when.script decider (escalation → route id).

Same contract as route_severity.py. Decides the escalation sub-route under the
`critical` path. The value is copied verbatim from the {escalation} run param
into the classification file, so it already equals a defined sub-route id
("hotfix" | "rollback").
"""
import json
import os
import sys

_run_dir = os.environ.get("RIGLANE_RUN_DIR")
if not _run_dir:
    print("route_escalation: RIGLANE_RUN_DIR not set (engine must inject it)", file=sys.stderr)
    sys.exit(1)
CLASSIFICATION = os.path.join(_run_dir, "data", "classification.json")

try:
    with open(CLASSIFICATION, encoding="utf-8") as f:
        escalation = str(json.load(f)["escalation"])
except Exception as exc:  # noqa: BLE001 — surface everything, decide nothing
    print(f"route_escalation: cannot read {CLASSIFICATION}: {exc}", file=sys.stderr)
    sys.exit(1)

print(json.dumps({"route": escalation}))
