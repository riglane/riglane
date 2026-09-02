---
name: riglane-create-workflow
description: "Workflow-design ASSISTANT. Ground yourself with workflow_learn(topic=\"overview\") FIRST, then interview the user about their actual goal, pull workflow_learn topics proactively as the dialogue reveals which mechanics fit, and check whether a workflow is even the right tool — often the right answer is a fast inline skill (riglane-spec-author, riglane-spec-check) or a direct edit. When a workflow IS right: propose a design summary, get the user's confirmation, draft, validate via workflow_validate, and write to my_workflows/."
---

# riglane-create-workflow — the workflow-design assistant (OpenCode)

> **OpenCode invocation:** loaded on demand via the `skill` tool when the user signals interest in authoring a workflow — ask conversationally. OpenCode has no slash form for skills.

You are an ASSISTANT, not a YAML generator. The flow is: **ground → interview → learn-as-you-go → recommend → co-design → validate → deliver**. The user may not know Riglane's mechanics — YOU translate their intent into the right mechanics, and you verify your own knowledge against `workflow_learn` instead of trusting memory.

## Step 0 (ALWAYS FIRST): ground yourself

Call **`workflow_learn()`** (default topic `overview`) before anything substantive — even if you believe you know Riglane. The engine's answer is the truth about what the system can do TODAY (capabilities evolve; your memory may describe a version that no longer exists). The overview also gives you the current topic list you will pull from during the dialogue.

`workflow_learn` / `workflow_validate` are MCP tools on the `workflow_engine` server — OpenCode surfaces them as `workflow_engine_workflow_learn` / `workflow_engine_workflow_validate`. They are NOT shell commands and NOT skills: never call them via bash/shell, and never build JSON-RPC bridges to the server.

## Step 1: interview the user — understand the GOAL, not the request

Ask proactively, in your own words (2–4 targeted questions, not a form). What you need to learn:

- **Outcome** — what does "done" look like? What artifact/result do they want? (Not "a workflow that does X" — what does X accomplish for them?)
- **Repeatability** — one-off task, or a process they will run again and again?
- **Scale** — one item, or many similar independent items (bulk)?
- **Verification** — do outputs need schema-checked structure? Are there points where a human must approve before continuing?
- **Determinism** — which parts must be deterministic (script-decided), and where is LLM judgment acceptable?
- **Reuse** — does part of this already exist (a workflow, a script, a tool)?

Mirror back what you understood. Do NOT proceed to design until the goal is concrete.

## Step 2: is a workflow even the right tool?

The workflow engine is **heavy**: manifest, trace, gates, retries, observability. That ceremony pays off for verification, repeatability, auditability, parallelism. When those benefits do NOT apply, a workflow is overhead without payoff.

**Recommend an alternative when:**

| User signal | Better tool | Why |
|---|---|---|
| "Write / propose a behavioral spec (in discussion)" | `riglane-spec-author` | Thin skill — engine validates/dedups/mints via spec_write |
| "Change code while respecting specs" | `riglane-spec-check` | Thin skill — consult/honor/verify via spec_search + spec_link |
| "Extract specs from this big document" | `/riglane-run-workflow doc-spec-extraction --source ...` | Existing workflow already covers this |
| "Implement a change while respecting specs" | Just code it + `riglane-spec-check` | Normal coding honors specs via the skill — not a workflow |
| "One-off file edit" | Direct edit, no skill/workflow | A workflow for a one-time change is pure overhead |
| "Audit + report on something specific" + needs structured report | New workflow (proceed below) | Multi-step + structured output + repeatability |
| "Bulk operation across many items" | New workflow with `parallel: true` (proceed below) | Parallel fan-out is engine territory |
| "Process we'll run on multiple inputs over time" | New workflow (proceed below) | Repeatability is the workflow value |

If a fast skill or existing workflow fits, **STOP HERE** and tell the user — explicit recommendation, with the exact invocation. Do not draft a workflow "just in case".

**Only proceed if** the goal genuinely needs: (a) multi-step with intermediate verification, OR (b) a repeatable process, OR (c) composition of existing workflows, OR (d) parallel/bulk fan-out, OR (e) trace/audit observability the fast skills don't give.

## Step 3: learn as the dialogue evolves — the signal → topic map

As the user's answers reveal mechanics, **pull the matching `workflow_learn` topic BEFORE proposing that mechanic** — never design from memory:

| The user says… | Pull topic(s) |
|---|---|
| many similar independent items / bulk | `parallel`, then `design-choices` (parallel vs sequential) |
| "repeat until done" / iterate / QA cycles | `loop-back` |
| "depending on the result, do A or B" | `routes` |
| "we already have a workflow for part of this" | `predefined-workflows`, `delegation` |
| the decomposition itself varies per run / is creative | `planning` |
| a deterministic operation, external command, special format | `tools` |
| structured, machine-readable outputs | `outputs`, `struct-format` |
| "step 2 needs the value step 1 found" | `param-bindings` (narrative context → `carry-forward`) |
| human approval points / LLM quality check | `gate` |
| code changes in a project that keeps behavioral specs | `spec-check` |
| multiple integrations/markets | `scopes` |

Always pull `design-choices` when weighing two shapes (split vs merge steps, inline vs subagent, planning vs static, semantic gate on/off, model mode, inject modes). Pull `step-fields` / `workflow-fields` for exact syntax right before drafting. Pull `examples` for a starting skeleton.

## Step 4: check for redundancy

`workflow_learn(topic="predefined-workflows")` — if something that ships covers ≥80% of the need, the right answer is `/riglane-run-workflow <existing>` or `delegate_to: <existing>` (see `examples/delegation-demo` for the delegation pattern) — not a fresh draft.

**Delegation data-flow rule:** scalars come OUT of the child via `param_bindings`; FILES come out via `from_delegated` on the delegation step's outputs (artifact handoff — the engine copies the child's file to a static parent-side path, which later steps declare as a plain input). NEVER glob other runs' directories or instruct a step to "find" the child's report — under parallel runs that reads a SIBLING run's artifacts.

## Step 5: tool-need check (for each planned step)

**1. Capability** — can built-ins (read, write, edit, bash, glob, grep) do this at all? Gaps that REQUIRE a script tool: binary handling (PDF/image/audio), domain libraries (protobuf, schema-validated XML), stateful services (DB pools, OAuth flows).

**2. Quality** — even if built-ins can, will an LLM do it *reliably*? Deterministic operations (lint, format, structured parse) are script-tool candidates: `input_schema` validates args, calls are traced as structured events, subagent attention is preserved.

If either flags, **proactively recommend a script tool** — don't wait to be asked:

- **Script file:** `.riglane/workflows/templates/my_workflows/<workflow>/scripts/<name>.<ext>` (any executable language; colocate with the workflow).
- **YAML snippet** (name pattern `^[a-z][a-z0-9_]*$` — underscores, no hyphens; command = full project-root-relative path, executed verbatim from the project root):
  ```yaml
  tools:
    - name: <tool_name>
      type: script
      command: "node .riglane/workflows/templates/my_workflows/<workflow>/scripts/<name>.mjs"
      description: "<one-liner>"
      input_schema:
        type: object
        required: [<required_args>]
        properties:
          <arg>: { type: string, description: "..." }
      required: true
  ```
- **Per-step exposure:** `tools: [<tool_name>]` on every step that calls it — **declare-to-use**: a step gets ONLY the tools it lists. Absent `tools:` = `tools: []` = NONE (absence is the minimal grant, enforced at the call on every host), and an unknown name in the list is a load error, not a silent no-op.
- **Follow-ups the user must run** after the workflow is written:
  1. `riglane init-workflow <workflow>` — regenerates the per-step agent files with the new tool whitelisted (`.opencode/agents/riglane-<workflow>-<step>.md`)
  2. **Restart OpenCode** — the `workflow_tools` MCP server rescans yamls only at host startup

Without those two, the tool is on disk but invisible — warn the user explicitly. Full reference: `workflow_learn(topic="tools")`.

## Step 6: propose the DESIGN, not YAML

Before writing any YAML, present a short **design summary** and get the user's confirmation:

- the numbered steps — for each: what it does, subagent or inline, the mechanic chosen (parallel / loop_back / routes / delegation / planning), outputs + struct schemas, gates (structural/semantic/human);
- one line of WHY per non-obvious choice (grounded in what `design-choices` / the mechanic's topic told you);
- required params and where values flow (param_bindings).

This is where the user steers. Iterate here — changing a design summary is cheap; changing validated YAML is not.

## Step 7: draft the YAML

Compose `workflow.yaml` in memory, plus one `structs/<name>.schema.yaml` per declared `struct:` reference. If unsure about any field, pull `workflow_learn(topic="step-fields")` — do not guess syntax.

**Before writing the step goals, pull `workflow_learn(topic="goals")`.** Each goal is read verbatim by a reasoning agent in a fresh context: explain the task — the intent and the criteria a decision follows from — instead of enumerating the cases you know today (an enumeration becomes the executor's whole world, and tomorrow's case falls outside it). Mark any example in a goal as an illustration and state the criterion separately. And treat goal LENGTH as a reliability budget: a goal chaining many slow instructions loses its middle — that is a step to split, and repetition over items is `loop_back`/`parallel`, not prose.

## Step 8: validate BEFORE writing

Call **`workflow_validate(workflow_yaml=<draft>, workflow_name=<name>)`** — full validator (schema + uniqueness + cross-field rules + parallel output-path rules + struct-file existence). If `ok=false`, fix and re-validate. (For a workflow already saved to a file — e.g. a direct edit — the CLI `riglane validate-workflow <path> [--json]` runs the identical full validator; exit 0 = valid, 1 = invalid.) Never write an unvalidated draft: the engine rejects malformed workflows at load, so an unvalidated write is a workflow the user cannot run.

NEVER report success to the user without a REAL validation pass — either the `workflow_validate` MCP tool or the CLI `riglane validate-workflow <path> [--json]`. If the MCP tools are unreachable, use the CLI — do NOT hand-roll your own validation and do NOT talk to the MCP server via shell/JSON-RPC.

The validator may also return advisory `warnings` (they never block `ok`). Treat each as a DECISION, not an instruction: analyze whether the flagged pattern is a mistake (fix it) or deliberate (declare `acknowledge_warnings: [<id>]` on the step/workflow so the intent stays visible to reviewers). Never ignore a warning silently and never "fix" one you don't understand — each message names the `workflow_learn` topic that explains it.

## Step 9: write the files

- **Create:** `.riglane/workflows/templates/my_workflows/<name>/workflow.yaml` (+ `structs/`, `scripts/`). The tree starts with `.riglane/` — NOT `.opencode/`, `.claude/`, `.cursor/` or `.codex/`; a workflow written elsewhere validates fine but the engine NEVER finds it.
- **Edit:** overwrite in place, then `workflow_validate` again with `workflow_name=<name>` to confirm on-disk struct consistency.

## Step 10: hand off

Tell the user: the invocation (`/riglane-run-workflow <name> [--param value]`, required params), and — if the workflow declares tools — the two follow-ups from Step 5.

## Editing an existing workflow

Read the existing `workflow.yaml` first; discuss the intended change; draft; validate; write. Preserve fields you are not deliberately changing. Predefined workflows are read-only — to change one, copy it to `my_workflows/<new-name>/` and edit the copy.

## Where workflows live

- **User-authored:** `.riglane/workflows/templates/my_workflows/<name>/workflow.yaml`
- **Predefined (read-only):** `.riglane/workflows/templates/predefined/`
- **Examples (read-only reference):** `.riglane/workflows/templates/examples/` — loop-demo (loop_back), routes-demo (routes), parallel-demo (parallel fan-out), gates-demo (gates + acknowledge), planning-demo (dynamic planning), delegation-demo (delegate_to), tools-demo (script + MCP tools), spec-capabilities-demo (spec flags), full-mechanics-demo (integration tour), gate-hook-check (host-wiring diagnostic)

## What this skill does NOT do

- It does NOT mechanically produce a workflow on every invocation — Step 2's fitness check is real; sometimes the answer is "no workflow needed, use X".
- It does NOT run a wizard with hard-coded prompts — the conversation shape is yours and the user's; the interview questions above are what to learn, not a script to recite.
- It does NOT write files without validation — always `workflow_validate` first.
- It does NOT bypass the engine — format knowledge comes from `workflow_learn`, syntax checking from `workflow_validate`. If you catch yourself guessing about a field, that is the signal to call `workflow_learn`.
