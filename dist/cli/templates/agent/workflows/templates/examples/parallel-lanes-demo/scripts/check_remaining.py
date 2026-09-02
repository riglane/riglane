#!/usr/bin/env python
"""Loop decider for the research lane of parallel-lanes-demo.

The engine runs this itself (cwd = project root, $RIGLANE_RUN_DIR injected).
Contract: exit 0 + stdout {"loop": true|false}. Loop while the research
registry still has pending topics.
"""
import json
import os
import sys

run_dir = os.environ.get("RIGLANE_RUN_DIR", "")
if not run_dir:
    print("RIGLANE_RUN_DIR not set", file=sys.stderr)
    sys.exit(2)

path = os.path.join(run_dir, "data", "research-progress.json")
with open(path, encoding="utf-8") as f:
    progress = json.load(f)

remaining = int(progress.get("remaining", 0))
print(json.dumps({"loop": remaining > 0}))
