<!-- Riglane workflow context — written by `riglane init --opencode` / `riglane update`.
     Injected into every session via the `instructions` entry in .opencode/opencode.json. -->

# Riglane Context (OpenCode)

This project uses Riglane (Workflow Engine + Spec Guard).
Format reference lives in the engine — call `workflow_learn` (workflow + spec
authoring). There is no `.riglane/docs/` directory.

## MCP tools

The Riglane engine is exposed through two MCP servers configured in
`.opencode/opencode.json`. OpenCode surfaces their tools as
`<server>_<tool>` (single underscore): `workflow_engine_workflow_resolve`,
`workflow_engine_step_begin`, `workflow_engine_workflow_learn`, … and the
per-workflow script tools as `workflow_tools_<workflow>__<tool>`.

- If an engine tool seems absent, locate it by SEMANTICS: scan your tools for
  any name containing a core engine tool name (`workflow_resolve`,
  `workflow_init`, `step_begin`, …) or the server name `workflow_engine`,
  ignoring the prefix form. Call whichever exists by its full name.
- Found nothing → the server may still be connecting; retry once, then STOP
  and tell the user the `workflow_engine` MCP server is unavailable. Do NOT
  run engine scripts via bash/shell — that bypasses the engine, trace, and
  gate. NEVER self-call `riglane run-workflow`, `riglane mcp-server`, or
  `riglane mcp-tools` from inside a session.

## Workflow execution rules

1. **NEVER orchestrate manually** when the MCP engine tools are available.
   NEVER invent subagent types — pass engine-returned values verbatim.
   NEVER write `manifest.json` by hand.
2. **Engine config errors → STOP, surface verbatim, do NOT self-fix.** Errors
   mentioning "references struct schema(s) that do not exist", "has an invalid
   configuration", "STOP_WORKFLOW", "BLOCKED_*", or any message labelled
   "ORCHESTRATOR DIRECTIVE" target the **workflow author**, not you. Print the
   error verbatim and STOP. Do NOT create missing files, edit `workflow.yaml`,
   or retry.
3. **`engine_instructions` → follow verbatim when present.** Any engine
   response may carry contextual directives; for `type: "planning"` steps they
   contain the complete execution procedure. Do NOT paraphrase or skip steps.
4. **Tool execution infrastructure errors → report, do NOT bypass MCP.**
   "command not found" / "permission denied" / "timed out" from an MCP script
   tool is a system configuration problem. Report verbatim and STOP — running
   the script directly via shell bypasses trace recording and gate validation.

## Conventions

- `workflow.yaml` defines steps, inputs, outputs, and gate config; struct
  schemas live in `structs/`.
- `manifest.json` and `context/` are auto-generated — never edit manually.
- Predefined workflows live in `.riglane/workflows/templates/predefined/` (engine
  distribution — do not modify); user workflows in
  `.riglane/workflows/templates/my_workflows/`.
- Behavioral specs live at `.riglane/specs/{scope}/{domain}/{spec_id}.md` — one
  requirement per file, engine-minted `spec_id`, no severity/status (every
  spec is a MUST; specs are deleted, not deprecated).
- `_index.json` / `_registry.json` are engine-owned — NEVER hand-edit. Work
  with specs via `spec_write` / `spec_search` / `spec_link` (conversationally:
  the `riglane-spec-author` / `riglane-spec-check` skills).
- OpenCode loads config once at startup — after `riglane update` or any change to
  `.opencode/`, restart OpenCode.
