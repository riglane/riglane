---
name: riglane-update-workflows
description: "Sync per-step subagent files for ALL workflows in this project. Use after install or after editing multiple workflows."
allowed-tools: Bash
disable-model-invocation: true
---

# /riglane-update-workflows

Synchronize per-step subagent files for **every** workflow in `.riglane/workflows/templates/`.

## Usage

```
/riglane-update-workflows
```

## What this does

Scans every `workflow.yaml` under `.riglane/workflows/templates/` and runs the same generation logic as `/riglane-init-workflow` for each one. For each workflow:

- Generates missing per-step subagent files
- Updates existing ones whose content has drifted from `workflow.yaml`
- Deletes orphan files (steps removed from a workflow since the last sync)

This is useful after:

- Initial install (`riglane init`)
- Bulk editing of workflows
- Pulling updates from a shared workflow repository
- Periodic sync after suspecting drift

## How to invoke

Execute the update script directly via Bash:

```bash
riglane update-workflows
```

If the user wants a preview without writing anything:

```bash
riglane update-workflows --dry-run
```

After the script completes, report:

1. Global counts (created, updated, unchanged, deleted)
2. Any failed workflows (with their error messages)
3. **If anything changed → tell the user to restart Claude Code**

## NEVER

- **Never** write or edit AGENT.md files manually.
- **Never** skip the restart reminder when files changed.
- **Never** rely on the LLM to generate AGENT.md content — only the `riglane init-workflow` generator is authoritative.
