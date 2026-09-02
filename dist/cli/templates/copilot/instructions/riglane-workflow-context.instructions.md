---
applyTo: ".riglane/**"
description: "Riglane context — apply when working with workflows, specs, structs, or manifest files"
---

# Riglane Context

You are working with Riglane files (Workflow Engine + Spec Guard).

Format reference lives in the engine — call `workflow_learn` (workflow + spec authoring). There is no `.riglane/docs/` directory.

## CRITICAL: /riglane-run-workflow Protocol

**When the user invokes `/riglane-run-workflow` (or you need to execute a workflow), you MUST:**

1. **Read the skill file FIRST** — `.github/skills/riglane-run-workflow/SKILL.md` — before doing anything else. This file contains the mandatory protocol, anti-patterns, and error handling.
2. **Verify MCP tools — name discovery FIRST, engine call SECOND.** Procedure:
   - **(a) Search your direct tools list for `workflow_engine-*` (Copilot combined form, e.g. `workflow_engine-workflow_resolve`) or bare engine tool names grouped under the `workflow_engine` server.** Found any → you have MCP. Found none → apply the Fallback below (it recognizes any naming form by core tool name) BEFORE concluding MCP is unavailable. When the (b) probe has failed twice, STOP and tell the user to check the `workflow_engine` server in `/mcp`, confirm the folder is trusted, and restart the session (Copilot reads MCP config at startup). NEVER self-call `riglane run-workflow`, `riglane mcp-server`, `riglane mcp-tools`, or `riglane doctor`, do NOT grep the Riglane source, do NOT bypass via shell (`riglane run-workflow` is an external launcher that spawns a NEW agent; you are already inside one).
   - **(b) Call `workflow_resolve` — MANDATORY before any stop, even if (a) found nothing.** Combined form: `workflow_engine-workflow_resolve({"name":"..."})`. Fails / tool absent → retry ONCE; second failure → STOP with the verbatim error. Do NOT ask the user to act before that.
   - **(c) Decide based on the CALL RESPONSE.** ✅ metadata payload → MCP path; 🟡 error → report to user, do NOT bypass MCP. **NEVER infer MCP absence from:** MCP resource listings (resources ≠ tools — the engine exposes only tools, so an empty resources list is expected even when everything works); `riglane doctor`/`riglane status` (project config OK ≠ this session has tools); shell-run `riglane mcp-tools`/`riglane mcp-server` (separate processes); an empty name search alone.
   - See `.github/skills/riglane-run-workflow/SKILL.md` Step 0/1/2 for the full protocol + anti-patterns.

**Fallback — if the discovery above found nothing for your host.** The discovery above targets specific hosts; if your environment surfaces MCP tools differently (a different agent is reading this file, or the host changed its naming), do NOT give up and do NOT fall back to Bash. Locate the engine tools by SEMANTICS: (1) scan your available tools for ANY name CONTAINING a core engine tool name (`workflow_resolve`, `workflow_init`, `step_begin`, ...) or the server name `workflow_engine`, ignoring the prefix — known forms are `mcp__workflow_engine__workflow_resolve` (double underscore) and `mcp_workflow_engine_workflow_resolve` (single underscore); call whichever exists directly by its full name. (2) If you only have a generic MCP wrapper (e.g. `CallMcpTool`), call the engine through it: `CallMcpTool(server="workflow_engine", toolName="workflow_resolve", arguments={...})`. (3) Found nothing either way → the MCP server may still be connecting; wait ~20 seconds and re-check. (4) Still absent after the retry → STOP and tell the user the `workflow_engine` MCP server is unavailable; do NOT run scripts via Bash/shell (it bypasses the engine, trace, and gate).

3. **NEVER orchestrate manually** when MCP tools are available. NEVER invent per-step subagent types — pass engine-returned `subagent_type` verbatim as the `task` tool's agent type. NEVER write `manifest.json` by hand.
4. **Engine config errors → STOP, surface, do NOT self-fix.** If the engine returns errors containing phrases like "references struct schema(s) that do not exist", "contains a literal '_branch_*' segment", "has an invalid configuration", "STOP_WORKFLOW", "BLOCKED_PARTIAL_FAILURE", "BLOCKED_PLANNING_FAILURE", or any message labelled "ORCHESTRATOR DIRECTIVE" — these errors target the **workflow author**, not you. Print the error verbatim to the user and STOP. Do NOT create missing files, edit `workflow.yaml`, populate `structs/`, generate schemas, or retry. The author must decide the correct fix; you cannot do so without knowing their intent.
5. **`engine_instructions` → follow when present.** Any `step_begin` response may include an `engine_instructions` field with contextual directives (summary guidance, retry strategies, or for planning steps the complete execution procedure). Read and follow it verbatim. For `type: "planning"` steps, `engine_instructions` contains the full Step 0-6 procedure — it replaces the normal step flow entirely. Do NOT paraphrase, summarize, or skip steps. Do NOT search this instructions file or SKILL.md for the procedure — it lives ONLY in the engine response.
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
- Active scope resolution: `.riglane/local/active-scope` → `_scope-config.json` default → `generic`
- Work with specs via the engine MCP tools: `spec_write` (create/update/delete, dedup), `spec_search` (find +
  dedup preflight, echoes domains), `spec_link` (map an implementing file → spec). Conversationally the
  `riglane-spec-author` / `riglane-spec-check` skills drive these; bulk extraction from a document → the
  `doc-spec-extraction` workflow.
- Canonical spec format is engine-bundled (single source) — reference it via `workflow_learn`, not a docs file.
