---
paths:
  - ".riglane/workflows/**/*"
  - ".riglane/specs/**/*"
---

# Riglane Context

You are working with Riglane files (Workflow Engine + Spec Guard).

Format reference lives in the engine — call `workflow_learn` (workflow + spec authoring). There is no `.riglane/docs/` directory.

## CRITICAL: /riglane-run-workflow Protocol

**When the user invokes `/riglane-run-workflow` (or you need to execute a workflow), you MUST:**

1. **Read the skill file FIRST** — `.claude/skills/riglane-run-workflow/SKILL.md` — before doing anything else. This file contains the mandatory protocol, anti-patterns, and error handling.
2. **Verify MCP tools — wrapper discovery FIRST, engine call SECOND.** Procedure:
   - **(a) Search your direct tools list for the prefix `mcp__` (Claude Code, double underscore), `mcp_<server>_` (Cursor direct, single underscore), or the string `CallMcpTool` (Cursor wrapper).** Found any → you have MCP. Found none → wait ~20s and re-check, then apply the Fallback below (it recognizes any naming form by core tool name) BEFORE concluding MCP is unavailable. When MCP is genuinely absent, STOP and tell the user to reconnect MCP (Cursor Settings → MCP / Reload Window), then re-run — NEVER self-call `riglane run-workflow`, `riglane mcp-server`, `riglane mcp-tools`, or `riglane doctor`, do NOT grep the Riglane source, do NOT bypass via shell (`riglane run-workflow` is an external launcher that spawns a NEW agent; you are already inside one). Do **not** search for the bare name `workflow_resolve` / `step_begin` — bare names are never standalone; they appear prefixed (`mcp__<server>__<tool>` on Claude Code, `mcp_<server>_<tool>` on Cursor).
   - **(b) Call `workflow_resolve` through the wrapper.** In Claude Code call directly: `mcp__workflow_engine__workflow_resolve({"name":"..."})`.
   - **(c) Decide based on the CALL RESPONSE.** ✅ metadata payload → MCP path; 🟡 wrapper returns "tool not found"/"server unavailable" → **STOP and surface the error verbatim** — never hand-write `manifest.json`/trace or drive the workflow yourself (the engine owns run state; if a prior run is stuck in-progress, `riglane workflow-clear <name>` releases the lock). **Never** decide based on the absence of unprefixed `workflow_resolve` from your direct tools list — that absence is the expected state.
   - See `.claude/skills/riglane-run-workflow/SKILL.md` Step 0/1/2 for the full protocol + anti-patterns.

**Fallback — if the discovery above found nothing for your host.** The discovery above targets specific hosts; if your environment surfaces MCP tools differently (a different agent is reading this file, or the host changed its naming), do NOT give up and do NOT fall back to Bash. Locate the engine tools by SEMANTICS: (1) scan your available tools for ANY name CONTAINING a core engine tool name (`workflow_resolve`, `workflow_init`, `step_begin`, ...) or the server name `workflow_engine`, ignoring the prefix — known forms are `mcp__workflow_engine__workflow_resolve` (double underscore) and `mcp_workflow_engine_workflow_resolve` (single underscore); call whichever exists directly by its full name. (2) If you only have a generic MCP wrapper (e.g. `CallMcpTool`), call the engine through it: `CallMcpTool(server="workflow_engine", toolName="workflow_resolve", arguments={...})`. (3) Found nothing either way → the MCP server may still be connecting; wait ~20 seconds and re-check. (4) Still absent after the retry → STOP and tell the user the `workflow_engine` MCP server is unavailable; do NOT run scripts via Bash/shell (it bypasses the engine, trace, and gate).

3. **NEVER orchestrate manually** when MCP tools are available. NEVER call per-step agent types directly (e.g., `doc-spec-extraction-analyze`). NEVER write `manifest.json` by hand.
4. **Engine config errors → STOP, surface, do NOT self-fix.** If the engine returns errors containing phrases like "references struct schema(s) that do not exist", "contains a literal '_branch_*' segment", "has an invalid configuration", "STOP_WORKFLOW", "BLOCKED_PARTIAL_FAILURE", "BLOCKED_PLANNING_FAILURE", or any message labelled "ORCHESTRATOR DIRECTIVE" — these errors target the **workflow author**, not you. Print the error verbatim to the user and STOP. Do NOT create missing files, edit `workflow.yaml`, populate `structs/`, generate schemas, or retry. The author must decide the correct fix; you cannot do so without knowing their intent.
5. **`engine_instructions` → follow when present.** Any `step_begin` response may include an `engine_instructions` field with contextual directives (summary guidance, retry strategies, or for planning steps the complete execution procedure). Read and follow it verbatim. For `type: "planning"` steps, `engine_instructions` contains the full Step 0-6 procedure — it replaces the normal step flow entirely. Do NOT paraphrase, summarize, or skip steps. Do NOT search this rules file or SKILL.md for the procedure — it lives ONLY in the engine response.
6. **Tool execution infrastructure errors → report, do NOT bypass MCP.** If an MCP script tool call returns errors like "command not found", "permission denied", "execution failed", or "timed out" — these indicate a system configuration problem, not a workflow logic issue. Report the error verbatim to the user and STOP. Do NOT attempt to run the script directly via Bash/shell as a workaround — that bypasses trace recording and gate validation, producing invisible operations that corrupt workflow state.

Skipping this protocol results in: no trace file, no gate validation, no audit history, corrupted workflow state.

## Workflow Engine Conventions

- `workflow.yaml` defines steps, inputs, outputs, and gate config
- Struct schemas in `structs/` define expected I/O formats
- `manifest.json` is auto-generated — **never edit it manually**
- `context/` contains auto-generated step summaries — **never edit manually**
- Use `/riglane-run-workflow` to execute a workflow
- Use `/riglane-create-workflow` to create new workflows
- Predefined workflows live in `.riglane/workflows/templates/predefined/` — **do not modify** (engine distribution)
- User workflows live in `.riglane/workflows/templates/my_workflows/`

## Spec Guard Conventions

- Behavioral specs live at `.riglane/specs/{scope}/{domain}/{spec_id}.md` — ONE requirement per file.
- `spec_id` is engine-minted `<domain>-<NNN>` (e.g. `auth-001`) — the agent never supplies the serial.
- Frontmatter: `spec_id`, `domain`, `title`, `applies_to`, `scope` (single), `related_specs`, `source_sections`
  (+ `domain_description` when introducing a NEW domain). NO `severity` / `component` / `status` — every spec is a
  MUST; specs are deleted, not deprecated.
- `_index.json` and `_registry.json` are **engine-owned, per-scope** — NEVER hand-edit; the engine maintains them.
- Active scope resolution: `.riglane/local/active-scope` -> `_scope-config.json` default -> `generic`
- Work with specs via the engine MCP tools: `spec_write` (create/update/delete, dedup), `spec_search` (find +
  dedup preflight, echoes domains), `spec_link` (map an implementing file -> spec). Conversationally the
  `riglane-spec-author` / `riglane-spec-check` skills drive these; bulk extraction from a document -> the
  `doc-spec-extraction` workflow.
- Canonical spec format is engine-bundled (single source) — reference it via `workflow_learn`, not a docs file.
