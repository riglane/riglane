#!/usr/bin/env python3
"""loop-demo SECOND loop decider (the polish cycle).

The demo carries two loops in ONE sequence, with DISJOINT ranges:

    prepare-plan
    run-scenario ─┐
    record-result ─┘  loop 1: [run-scenario .. record-result]
    summarize
    polish ───────┐
    polish-check ─┘   loop 2: [polish .. polish-check]

Disjoint ranges never interact: the engine's reset is index-bounded and each
owner keeps its own loop_state, so this cycle starts from iteration 0 no matter
how many times the first cycle repeated. That is exactly what the demo proves —
the polish notes are numbered polish-note_0, polish-note_1, NOT continuing the
first loop's count.

Contract (same as check_remaining.py): exit 0 and print {"loop": true|false}.
Decision: keep polishing while fewer than 2 polish notes exist, so the cycle
takes exactly two passes and exits through the script (not the budget).
"""
import glob
import json
import os
import sys

_run_dir = os.environ.get("RIGLANE_RUN_DIR")
if not _run_dir:
    print("check_polish: RIGLANE_RUN_DIR not set (engine must inject it)", file=sys.stderr)
    sys.exit(1)

notes = glob.glob(os.path.join(_run_dir, "data", "polish-note_*.md"))
print(json.dumps({"loop": len(notes) < 2}))
