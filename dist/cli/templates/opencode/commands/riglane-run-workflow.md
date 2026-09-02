---
description: Run a declarative multi-phase Riglane workflow by name (orchestrated via the MCP workflow engine with structural gates, trace, and parallel execution).
---

Load the `riglane-run-workflow` skill (via the skill tool) and follow it exactly to run this workflow:

$ARGUMENTS

The first token is the workflow name; the rest are `--param value` arguments (plus the reserved `--model <mode>` and `--resume [<run-id>]` flags, handled per the skill).
