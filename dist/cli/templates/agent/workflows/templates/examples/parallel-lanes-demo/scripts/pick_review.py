#!/usr/bin/env python
"""Route decider for the review lane of parallel-lanes-demo.

The engine runs this itself (cwd = project root, $RIGLANE_RUN_DIR injected).
Contract: exit 0 + stdout {"route": "<id>"|"proceed"}. Reads the verdict the
review step wrote — "deep" or "quick" name the two routes; anything else
proceeds (no route).
"""
import json
import os
import sys

run_dir = os.environ.get("RIGLANE_RUN_DIR", "")
if not run_dir:
    print("RIGLANE_RUN_DIR not set", file=sys.stderr)
    sys.exit(2)

path = os.path.join(run_dir, "data", "review-verdict.json")
with open(path, encoding="utf-8") as f:
    verdict = json.load(f)

value = str(verdict.get("verdict", "")).strip()
route = value if value in ("deep", "quick") else "proceed"
print(json.dumps({"route": route}))
