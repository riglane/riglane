# Riglane Context (Gemini CLI)

This project uses Riglane (Workflow Engine + Spec Guard).
Format reference lives in the engine — call `workflow_learn` (topics for
workflow + spec authoring). There is no `.riglane/docs/` directory.

## CRITICAL: workflow execution protocol

**When the user invokes `/riglane:run-workflow` (or you need to execute a workflow):**

1. **Follow the command's procedure exactly** — it is the mandatory protocol.
2. **Engine MCP tools on this host surface as `mcp_workflow_engine_<tool>`**
   (single underscores, e.g. `mcp_workflow_engine_workflow_resolve`); script
   tools as `mcp_workflow_tools_<wf>__<tool>`. If a listed tool is not
   immediately callable it is DEFERRED, not absent — re-check by full name
   before any fallback. Probe with `workflow_resolve` and decide from the CALL
   RESPONSE; never infer MCP absence from resource listings, `riglane doctor`, or
   shell-run `riglane` commands (separate processes). Do NOT bypass the engine via
   shell — that skips trace recording and gate validation.
3. **Spawn subagents via `invoke_agent(agent_name=<subagent_type>, prompt=<composed prompt VERBATIM>)`.**
   Pass the engine-returned `subagent_type` verbatim; never substitute a
   built-in agent (our `riglane-*` agents carry the tool whitelists). If the gate
   blocks a result, re-invoke the SAME agent_name with a NEW prompt carrying
   the block reason (sessions cannot be resumed on this host).
4. **Engine config errors → STOP, surface verbatim, do NOT self-fix.** Errors
   mentioning "ORCHESTRATOR DIRECTIVE", "STOP_WORKFLOW", "BLOCKED_*", missing
   struct schemas, or `_branch_*` target the workflow AUTHOR — never create
   missing files, edit workflow.yaml, or retry around them.
5. **`engine_instructions` → follow verbatim when present** (for
   `type: planning` steps it carries the complete procedure and replaces the
   normal step flow).
6. **Never edit** `manifest.json`, `trace.json`, `gate-result.json`, or
   `context/` summaries by hand — the engine is their only writer.

## Conventions

- `workflow.yaml` + `structs/` define steps and I/O contracts; user workflows
  live in `.riglane/workflows/templates/my_workflows/`, predefined ones in
  `.riglane/workflows/templates/predefined/` (do not modify).
- Behavioral specs live at `.riglane/specs/{scope}/{domain}/{spec_id}.md` — one
  requirement per file; `spec_id` is engine-minted. `_index.json` /
  `_registry.json` are engine-owned — NEVER hand-edit. Work with specs via the
  engine MCP tools (`spec_write` / `spec_search` / `spec_link`) or the
  `/riglane:spec-author` and `/riglane:spec-check` commands.
- Riglane commands on this host: `/riglane:run-workflow`, `/riglane:create-workflow`,
  `/riglane:spec-author`, `/riglane:spec-check`, `/riglane:scope-show|set|unset|list|add`.
