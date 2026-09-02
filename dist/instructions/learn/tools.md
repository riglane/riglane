TOOLS — workflow tool dependencies
═══════════════════════════════════

Workflows can declare tool dependencies:

tools:
  - name: lint_check           # Pattern ^[a-z][a-z0-9_]*$ — underscores, NO hyphens.
    type: script             # Command exposed via workflow_tools MCP server.
    command: "node .riglane/workflows/templates/my_workflows/<wf>/scripts/lint-check.mjs"
    description: "Run the lint check on given files"
    input_schema:            # JSON Schema for the call arguments.
      type: object
      required: [files]
      properties:
        files: { type: string, description: "Comma-separated file list" }
    required: true           # Workflow blocked if tool unavailable.

  - name: external_api       # Same name pattern — no hyphens.
    type: mcp                # External MCP server dependency.
    description: "Company API server"
    required: true
    expected_tools: ["api_query", "api_mutate"]  # For CC subagent whitelist.

COMMAND SEMANTICS (script tools):
  • The command string is executed VERBATIM from the PROJECT ROOT — use the
    full root-relative script path ({param} placeholders are NOT substituted
    into command).
  • Call arguments arrive as appended --key=value flags (from input_schema)
    AND as JSON in the WORKFLOW_TOOL_ARGS env var — parse whichever is
    easier; env JSON is safest for values with spaces/special chars.

PER-STEP TOOLS (step-level `tools:` DECLARES which workflow tools the step uses):
  - name: analyze
    tools: [lint_check]      # This step may call lint_check — and only it.
  - name: synthesize
    # tools: omitted         # ABSENT → NO workflow tools (same as tools: []).
                             #   A tool must be DECLARED to be granted: like every
                             #   other absent field in the format, absence is the
                             #   minimal grant, never "all". The HARNESS'S NATIVE
                             #   tools (file editing, shell, web/search, …) are
                             #   always available and are not part of this list.
  KEY RULE: a step that calls a workflow tool MUST list it in tools:. Absent = [] = NONE;
  tools: [a,b] = exactly those. Every listed name must match a workflow-declared tool —
  an unknown name is a LOAD ERROR (workflow_validate), not a silent no-op.
  ENFORCED AT THE CALL: an undeclared tool is refused when a step invokes it, on every
  host — declaring is what grants, not what documents. A run reads its declarations
  ONCE, at start: editing tools: while a run is in progress does not change that run;
  the edit applies from the next run.

SCRIPT TOOLS:
  • Exposed via workflow_tools MCP server (separate from workflow_engine).
  • Subagent calls them as MCP tools during step execution.
  • Arguments flow via --key=value flags + WORKFLOW_TOOL_ARGS env JSON
    (see COMMAND SEMANTICS above) — NOT via placeholders in command.

MCP TOOLS:
  • External MCP servers that must be running.
  • workflow_init checks availability; blocks if required + missing.
  • expected_tools: list of the server's specific tool names — the step's
    USABLE set: a step uses only the expected_tools of servers declared for
    it. Other MCP servers (including the project's own) are not usable from
    a step — if a step needs one, declare it. Also used for call tracking:
    on hosts that deliver external MCP calls WITHOUT a server prefix (e.g.
    Cursor — a call arrives as the bare tool name), expected_tools is the
    ONLY way the engine can attribute a call to the server; without it, a
    required-but-uncalled warning is suppressed on such hosts (a bare call
    can't be told apart from no call).

TOOL-CALL TRACKING (what the "declared tool not called" warning means):
  • After a subagent step, the engine checks the tool-call ledger: a tool
    declared for the step (via step-level tools:) that was never called gets a
    host-neutral warning. A script tool counts as called whether invoked as
    the workflow_tools MCP tool OR run directly via the shell (the trace badges
    a shell-run script tool WF-TOOL + BASH). The warning is advisory, not a gate.

WHEN A SCRIPT TOOL IS REQUIRED (capability gap — agent cannot do it otherwise):
  • Binary file handling: PDF parsing, image resize/OCR, audio/video transcoding.
  • Domain-specific libraries: protobuf, complex XML w/ schema validation, niche parsers.
  • Stateful external services: DB connections with pooling, OAuth-refresh flows, SAML.
  • Anything requiring a third-party library not reachable via plain shell.
Without a declared tool here, the subagent will say "I cannot do this" or — worse — 
fabricate output. Always declare for these.

NOT TOOLS: loop_back/routes when.script deciders are NOT tools: entries —
the engine executes them directly; they need no declaration and no
init-workflow/restart follow-ups.

WHEN A SCRIPT TOOL IS PREFERRED (quality — built-ins could do it but unreliably):
  • Deterministic operations: lint, format, structured parse, structured API call.
  • Operations where input_schema validation catches argument errors early.
  • Operations where you want structured tracing (named call vs anonymous Bash).

WHERE THE SCRIPT FILES LIVE:
  .riglane/workflows/templates/my_workflows/<workflow>/scripts/<name>.<ext>
  Colocate with the workflow that uses them. Any executable language.

FOLLOW-UPS AFTER ADDING/CHANGING tools: (and after changing branch_profiles —
they change the generated agent files too, so the same two steps apply)
  1. riglane init-workflow <workflow>  — regenerates per-step subagent files
     on the FOUR agent-file hosts: Claude Code, OpenCode, Copilot, Gemini.
     (Cursor uses a global inventory and Codex spawns a generic agent — neither
     has per-step agent files, so neither needs this step.)
     branch_profiles belong here because they change the SET of files, not just
     their contents: every profile adds its own `<wf>-<step>--<profile>` agent,
     and a profile you delete is removed as an orphan. Skip this after editing
     profiles and the engine falls back to the step-level agent WITH A WARNING —
     the prompt still narrows, but the whitelist no longer enforces the subset.
  2. RESTART the host — the workflow_tools MCP server scans the workflow yamls
     ONCE, at startup, so a newly declared tool stays invisible until then.
     This applies to EVERY host: they all run that server, whatever their
     agent-file story — the scan is a property of the server, not of the host.
  A step-level tools: DECLARATION change alone (which step uses which existing
  tool) needs neither on Claude Code — it applies from the next run start.

SCRIPT CONTRACT (how the engine calls your script):
  • Args: engine appends --key=value CLI args from input_schema.
    Your script parses them (e.g. argparse, or manual --key= prefix scan).
  • Output: script writes result to stdout (typically JSON).
    The stdout content is returned to the subagent as the tool result.
  • Exit code: 0 = success, non-zero = error.
    On error, stderr (or stdout) is shown to the subagent as error message.
  • CWD: project root (where riglane init was run).
  • See examples/tools-demo/ for working script tool implementations.

GENERAL TIPS:
  • Script tools are standard for deterministic operations.
    LLM-driven steps use built-in IDE tools (Read, Write, Edit, Bash).
    When the operation is mechanical (parse, copy, validate), prefer script.
  • Do NOT hardcode interpreter names or temp paths in goal text (python3,
    /tmp/...) — they are platform-inverted traps. The engine injects the
    platform's shell facts (Node version, the working Python name, the temp
    dir) into every subagent step's constraints; goals can just say
    "run a Python script" and let the step agent use the injected names.
