---
name: riglane-run-workflow
description: "Run a declarative multi-phase workflow (doc-spec-extraction, spec-audit, registry-sync, or custom from my_workflows/). Orchestrates subagents via MCP workflow engine with structural gates, trace, and parallel execution."
argument-hint: "<workflow-name> [--param value] [--model inherit|auto|lightest|strongest] [--resume [<run-id>]]"
---

# /riglane-run-workflow

Run a declarative multi-phase workflow defined in `.riglane/workflows/`.

## Usage

```
/riglane-run-workflow <workflow-name> [--param value] [--model <inherit|auto|lightest|strongest>] [--inbox-webhook <url>] [--no-trace-viewer] [--resume [<run-id>]]
```

## ⛔ FIRST — get the workflow name from YOUR invocation (do this before anything else)

**The workflow name is the FIRST argument of the message that triggered this skill.** When the
invocation is `/riglane-run-workflow tools-demo`, the workflow name is `tools-demo`; with
`/riglane-run-workflow doc-spec-extraction --scope aurora`, it is `doc-spec-extraction` and `--scope aurora`
is a param. **Read it directly from your invocation text — it is already in your context.** Do NOT
ask the user for a name that is present in the invocation, and do NOT call a question/`ask_user`
tool with empty options.

Only if the invocation genuinely carries NO workflow name (bare `/riglane-run-workflow`):
- Say so in **plain text** and either (a) offer to list — call `workflow_resolve` is not a lister,
  so instead read the directory names under `.riglane/workflows/templates/{my_workflows,predefined,examples}/`
  via the `list_agent_files` MCP tool (NOT Glob/Grep) and present them; or (b) ask the user in one
  short plain sentence. Never emit a malformed question-tool call.

Once you have the name, go to **Startup → New Run** (or **Resume** if `--resume` is present).

## You Are the Orchestrator

When the user invokes this skill, you become the **workflow orchestrator**. For regular steps you spawn subagents — but for **delegation steps** (`delegate_to:`) you execute the delegated workflow yourself, WITHOUT spawning a subagent.

> **⚠️ `.riglane/local/` is typically gitignored (the user's choice — recommended), and `.riglane/` may be behind symlinks; `.riglane/workflows/` (definitions) is committed.** When `.riglane/local/` is gitignored, file search / glob tools will NOT find runtime files there. To **discover** files reliably, use the `list_agent_files` MCP tool (walks the directory server-side — bypasses both gitignore and symlink issues). To **read** a known file, use the Read tool with the exact path. **NEVER use Glob or Grep** to search inside `.riglane/`. When verifying step outputs, **trust the gate result** — the gate hook (`riglane gate-check`) already validated the files server-side, not with IDE tools.
>
> **Fallback** (no MCP): list the path with a plain shell command — `find .riglane/<subdir> -type f` (or `ls`). Unlike the IDE's Glob/Grep, a raw shell listing does NOT honor `.gitignore`, so it sees the runtime files. To read a known file, `Read` the exact path.

### ⛔ MANDATORY: Use MCP Workflow Engine Tools

**Step 0 — Find MCP tools. Do this before reading anything else in this section.**

Search your direct tools list for ANY of these (check in order):

| Priority | Pattern in tools list | How to call |
|----------|----------------------|-------------|
| 1 | combined server-tool names: `workflow_engine-workflow_resolve`, `workflow_engine-workflow_init`, … (Copilot registers MCP tools as `<server>-<tool>`) | Call directly by the combined name your tools list shows |
| 2 | engine tools by bare tool name (`workflow_resolve`, `workflow_init`, …), grouped under the `workflow_engine` server | Call by the name your tools list shows for that server |

Outcome:

- Found the engine tools in your list (combined or bare form) → Proceed to Step 1A.
- Found none → the MCP servers may not have loaded. Copilot reads MCP config (`.github/mcp.json`) at session start and requires the folder to be trusted. Apply the **Fallback** below (it recognizes any naming form by core tool name), and then **Step 0.5** — the mandatory probe is required before ANY stop. Only after the probe has failed twice → **STOP and tell the user**: check `/mcp` for the `workflow_engine` server status, confirm the folder is trusted, then restart the session (MCP config is read at startup). **Whatever you do, do NOT flail:** NEVER self-call `riglane run-workflow`, `riglane mcp-server`, `riglane mcp-tools`, or `riglane doctor`, do NOT grep the Riglane source repo, do NOT create your own MCP bridge or run scripts via shell — none of these expose MCP tools in THIS session (`riglane run-workflow` is an EXTERNAL launcher that spawns a NEW agent; you are already inside a launched one). Your only correct action is to STOP and report.

**Step 0.5 — Mandatory probe (required before ANY stop).** Call `workflow_resolve` with `{"name": "<workflow>"}` — even if Step 0 and the Fallback found nothing in your tools list:

- ✅ Metadata back → MCP is available; continue (regardless of what the name search said).
- ⏳ Tool absent / `"tool not found"` / `"server unavailable"` → wait ~20 seconds, retry ONCE.
- 🛑 Second failure → STOP. Surface the exact error verbatim, then tell the user to check the `workflow_engine` server in `/mcp`, confirm folder trust, and restart the session (Copilot reads MCP config at startup). Do NOT ask the user to act BEFORE the probe has failed twice with a concrete error.

**NEVER infer MCP absence from:**
- `ListMcpResources` / `FetchMcpResource` — those list MCP *resources*; the workflow engine exposes only *tools*, so "No MCP resources found" is the EXPECTED result even when everything works.
- `riglane doctor` / `riglane status` — they check project *config*, not whether THIS session has the tools.
- `riglane mcp-tools` / `riglane mcp-server` run via shell — those start *separate processes*; they prove nothing about this session.
- An empty name search alone — Step 0 finding nothing is a *retry-then-probe* signal, not proof of absence.

**Fallback — if the discovery above found nothing for your host.** The discovery above targets specific hosts; if your environment surfaces MCP tools differently (a different agent is reading this file, or the host changed its naming), do NOT give up and do NOT fall back to Bash. Locate the engine tools by SEMANTICS: (1) scan your available tools for ANY name CONTAINING a core engine tool name (`workflow_resolve`, `workflow_init`, `step_begin`, ...) or the server name `workflow_engine`, ignoring the prefix — known forms are `mcp__workflow_engine__workflow_resolve` (double underscore) and `mcp_workflow_engine_workflow_resolve` (single underscore); call whichever exists directly by its full name. (2) If you only have a generic MCP wrapper (e.g. `CallMcpTool`), call the engine through it: `CallMcpTool(server="workflow_engine", toolName="workflow_resolve", arguments={...})`. (3) Found nothing either way → the MCP server may still be connecting; wait ~20 seconds and re-check. (4) Still absent after the retry → STOP and tell the user the `workflow_engine` MCP server is unavailable; do NOT run scripts via Bash/shell (it bypasses the engine, trace, and gate).

**Step 1A — Direct MCP tools (engine tools appear directly in your list).**

The engine tools live under the `workflow_engine` server. Copilot registers each MCP tool under a combined `<server>-<tool>` name (e.g. `workflow_engine-workflow_resolve`) — call each by the exact name your tools list shows (do NOT invent a different prefix):

```
workflow_resolve({"name": "<workflow>"})
workflow_init({"name": "<workflow>", "params": {...}})
step_begin({"name": "<step>"})
step_collect_result({"name": "<step>"})
step_complete({"name": "<step>", "summary": "..."})
workflow_finalize({})
```

(Arguments come from each tool's schema — pass what it defines; the placeholders above just show the call shape.)

Script tools live under the `workflow_tools` server, registered as `workflow_tools-<workflow>__<tool>` (combined form). Call each by the exact name your tools list shows; pass the arguments its schema defines:
```
workflow_tools-<workflow>__<tool>({...})
```

> **⚠️ If a script tool isn't in your tool list yet, treat it as "not surfaced yet", NOT absent.** The `workflow_tools` server scans workflow yamls only at its own startup, and Copilot loads MCP config at session start. For a tool the engine reported *available* (in `workflow_init`'s `tools.available`, or named in a `step_begin` `tool_docs` block) that you cannot see: (1) **re-check** your tool list for the combined `workflow_tools-<wf>__<tool>` name; (2) if the tool was declared AFTER this session started, the server has not rescanned — the fix is a session restart, not a workaround. Only as a genuine **LAST resort** run the underlying script via the shell — invoke it with the interpreter its `command` declares — `node x.js`, `bash x.sh`, or `python x.py` (for Python: `python3` on Linux/macOS, `python` on Windows; if one reports "command not found", try the other) — and pass each argument as `--key=value` (not `--key value`). Do **NOT** fall back to Bash just because the tool was missing on first look.

**Step 2 — Verify via call response.**

Decide based on the **response** from your first `workflow_resolve` call:

- ✅ Got metadata payload (steps/params/gates) → **MCP path**. Continue with MCP for the ENTIRE run.
- 🟡 Got literal `"tool not found"` / `"server unavailable"` / `"not registered"` error → **STOP and surface the error to the user verbatim.** Do NOT hand-write `manifest.json`/trace or drive the workflow yourself — the engine owns all run state.

**Anti-pattern #1:** Announcing "no MCP" without calling `workflow_resolve` once. Always probe before concluding.

**Anti-pattern #2:** Finding the engine tools under an unexpected name form (combined `workflow_engine-<tool>` vs bare `<tool>`) and ignoring them because the form differs. Match by the core tool name.

**Anti-pattern #3:** treating SKILL.md as informational while skipping the procedural Step 0 search. Step 0 is an **action**, not a definition — do the literal string search before forming any conclusion.

**Anti-pattern #4:** using `ListMcpResources`/`FetchMcpResource` as an availability check for the engine. Resources ≠ tools — an empty resources list is the expected result for the (tools-only) workflow engine. Probe with `workflow_resolve` (Step 0.5) instead.

**Only if `workflow_resolve` actually returns an error** → **STOP and surface the error to the user verbatim.** The MCP engine is the only supported way to run a workflow.

> **⚠️ The engine owns ALL run state — you NEVER do.** NEVER hand-write or generate `manifest.json`, trace files, or any run artifact, and NEVER drive the workflow yourself with file/shell tools. If the MCP engine is unavailable, STOP and tell the user (reconnect MCP; if a previous run is stuck in-progress, `riglane workflow-clear <name>` releases the lock). A run without the engine has no trace, no gate, no audit — there is no "manual" run, only a corrupted one.

### ⛔ Engine Config Errors — Surface, Do NOT Self-Fix

When the engine returns a load-time or config-validation error, **STOP and surface it to the user verbatim**. Do **NOT** attempt to "fix" the underlying problem by creating files, editing `workflow.yaml`, populating `structs/`, generating schemas, modifying hooks, or any other workspace mutation.

**Errors that REQUIRE stop + surface (non-exhaustive list of signal phrases):**
- `"references struct schema(s) that do not exist on disk"`
- `"contains a literal '_branch_*' segment"`
- `"has an invalid configuration"`
- `"ORCHESTRATOR DIRECTIVE"` (any engine error containing this directive — read it and obey)
- `"WorkflowConfigError"` / `"action": "STOP_WORKFLOW"`
- `"BLOCKED_PARTIAL_FAILURE"` from a guard (do not retry blindly — surface and await user decision)
- Any error whose message tells you to do something — the message is talking to the **author**, not to you. Your job is to **relay it**.

**Why this rule exists:** engine error messages frequently contain remediation hints written for a human author (e.g. "create the missing schema file"). LLM orchestrators tend to read these as imperatives addressed to themselves. They are not. The author must decide whether to create, remove, or restructure; you cannot make that judgement correctly because you do not know the author's intent for the missing artifact's shape.

**If the engine error has BOTH "ORCHESTRATOR DIRECTIVE" AND "AUTHOR REMEDIATION" sections,** the split is explicit: obey the orchestrator section (stop, surface), do not act on the author section (that's for the user to read).

**Permitted reactions to engine config errors:**
1. Print the error verbatim to the user.
2. Stop the workflow run.
3. Wait for user direction.

**Forbidden reactions:**
1. Creating any file the error mentions as missing.
2. Editing `workflow.yaml`, `structs/*.schema.yaml`, hooks, scripts, or any project-tracked file in response to engine errors.
3. Retrying the failed engine call.
4. Calling other engine tools to "work around" the error.

### ⛔ Anti-Patterns — NEVER Do These

- **NEVER run `riglane workflow-clear` (or otherwise clear/reset/re-init a run) without the user's EXPLICIT permission.** It is a user-only recovery command that finalizes the run as `failed`. If a run is stuck or a step keeps failing, STOP and tell the user what failed and why; offer to clear or resume; act ONLY after they choose. Restarting a run to escape a failing step is never your decision — a repeatedly failing step is a signal to surface, not to bulldoze.
- **NEVER skip, reorder, or jump over a step, and never offer the user a "skip this step" choice.** The engine runs steps in their defined order and refuses every out-of-order move (`BLOCKED_OUT_OF_ORDER`) — there is no skip mechanism. If a step's work does not apply this run, the step still runs and may legitimately do nothing; conditional paths are the workflow author's job (`routes`), not a choice you invent at a gate.
- **NEVER invent or guess subagent types.** step_begin returns `subagent_type` — pass it VERBATIM as the `task` tool's agent type. The per-step agents are real custom agents; never substitute the built-in general-purpose agent (its runs bypass the gate hook).
- **NEVER write `manifest.json` manually** when MCP is available. The engine manages manifest lifecycle (state transitions, timestamps, run_token, step tracking).
- **`step_collect_result` after a subagent: decide by the payload’s `gate` flags.** When the step’s begin payload carried `gate: {semantic: false, human: false}`, call `step_complete` DIRECTLY — the engine validates the verdict inside it (a failed gate refuses completion with retry guidance; nothing is lost). When EITHER flag is true, call `step_collect_result` FIRST, exactly as before — that turn carries real work (the semantic check / the human question). Never skip collect on a gated step, and never assume a gate passed without the engine saying so.
- **NEVER advance to the next step without calling `step_complete`**. This writes the summary, applies param_bindings, and transitions manifest state.
- **NEVER assume gate passed** without evidence. If `gate-result.json` is absent or stale, something went wrong — STOP and report.
- **NEVER mutate `.riglane/local/active-scope`** (e.g. via `riglane scope set`, manual edit, or any other side effect) when running a workflow. The engine takes ownership of this file at `workflow_init` for any workflow with a `scope` param: it snapshots the prior value into `manifest.preserved_active_scope`, writes the workflow's scope, and restores the prior value at `workflow_finalize` (or on resume). Orchestrator-side mutation breaks the engine's restore guarantee, leaks state into the user's environment, and is **never** required — pass `--scope` as a workflow param and the engine threads it transparently to the validator.

---

## Startup

### New Run

1. Call `workflow_resolve` to get workflow metadata (steps, params, gates, tools)
2. Parse `--param value` arguments. For missing **required** params → ask the user; for missing **optional** params (those with a declared default) → use the default, do not ask
   - **Reserved run-level flag `--model <mode>`** — NOT a workflow param. If present, extract it (do NOT put it in `params`) and pass it to `workflow_init` as the top-level `model_override` argument. Valid values: `inherit` | `auto` | `lightest` | `strongest` (a selection MODE, not a model name). It overrides every subagent step's declared `model:` for this run. If the value is not one of those four, do not guess — surface the error and stop. (The engine re-validates `model_override` and rejects an invalid value.)
   - **Reserved run-level flag `--inbox-webhook <url>`** — NOT a workflow param. If present, extract it (do NOT put it in `params`) and pass it to `workflow_init` as the top-level `inbox_webhook` argument. It names the http(s) URL this run's inbox question envelopes are POSTed to, outranking the workflow's own `inbox_webhook` field and the env/config fallbacks. If the value is not a full http(s) URL, do not guess — surface the error and stop. (The engine re-validates and rejects a non-URL.)
   - **Reserved run-level flag `--no-trace-viewer`** — NOT a workflow param, and it takes no value. If present, extract it (do NOT put it in `params`) and pass `trace_viewer: "off"` to `workflow_init` as a top-level argument. It tells the engine not to auto-open the trace viewer in a browser for this run, whatever the ambient `engine.auto_open_trace_viewer` config says — typically because the application that launched the run has its own UI on it. **Forward it only when the launch actually carried the flag**: it is the launching human's or application's decision to relay, never one for you to make on their behalf.
3. Call `workflow_init` with name, resolved params, and (if given) `model_override` / `inbox_webhook` / `trace_viewer` → creates manifest, trace, run_token. Its response normally carries `next_begin` — the FIRST step’s complete `step_begin` payload: do NOT call `step_begin` for it, drive from the payload (see Step Execution step 1)
   - **If `workflow_init` reports an existing in-progress run** (error mentions an active run / `active_run_id`): do NOT auto-finalize it and do NOT hand-edit any manifest. Tell the user a previous run is still in-progress and **offer the choice** — clear it (`riglane workflow-clear <name>` releases the lock) or resume it (`--resume`). Act ONLY after the user picks. (A run gets stuck when an earlier agent died mid-run; the engine never auto-clears it.)
4. **Check tools availability** — if `workflow_init` returns `tools.blocked: true`:
   - Show the user: `tools.block_message` (lists missing required tools/MCP servers)
   - **STOP** — user must configure the missing MCP servers (`.github/mcp.json` or `copilot mcp add`) and restart the session before continuing
   - If `tools.missing` contains only `required: false` items → warn but continue
5. **Check `scope_warning`** — if `workflow_init` returns a `scope_warning` (the `--scope` value is not a declared scope), relay it to the user and **PAUSE for confirmation**: it is usually a typo or the wrong scope. Proceed only if the user confirms the scope is intentional (they can declare it with `riglane scope add`). Do NOT silently continue into a stray scope directory.
6. Tell the user: "Starting workflow `<name>` (version <V>). <description>. N steps."
7. Proceed to **Step Execution**

### Resume (`--resume [<run-id>]`)

1. Call `workflow_resume` → returns current state, summaries, next step
   - **`--resume <run-id>`** (optional): pass it through as `workflow_resume(name, run_id)`.
     Without an id the engine resumes the LATEST resumable run of this workflow — right when
     there is one, and the WRONG run the moment a newer run is alive beside the stalled one the
     user means. An id that does not resolve (unknown, other workflow, already terminal) is
     REFUSED — never quietly swapped for another run.
2. If error → report to user
3. Based on `current_step_status`:
   - `completed` → call `step_complete` then advance
   - `in_progress` → resume this step
   - `failed` → ask user: "Retry or skip?"
4. Tell the user: "Resuming from step '<step>'. N steps remaining."
5. Proceed to **Step Execution**

---

## Step Execution

For each step, in order:

### 1. Begin the step

**Composite driving — the payload usually arrives on the PREVIOUS response.** When the response you already hold (`workflow_init`, `step_complete`) carries a `next_begin` field, that IS this step’s full `step_begin` result — do **NOT** call `step_begin`; use `next_begin` as the response below and continue immediately. The same applies per lane to `lanes_begin` on an `ENTER_LANES` response (one payload per lane id) and to `next_begin` on `LOOP_BACK` / `ENTER_ROUTE` responses. A response WITHOUT a payload is the normal protocol: call `step_begin` with workflow name and step name. (`step_begin` always remains valid — e.g. after a resume, or for a lane missing from `lanes_begin`.)

**Engine instructions — applies to ANY engine response, not only `step_begin`:** If **any** engine tool response — `step_begin`, `step_collect_result`, `workflow_finalize_dynamic`, etc. — contains an `engine_instructions` field, **READ it end-to-end and FOLLOW it.** These are contextual instructions from the engine for this moment — they may include summary guidance, retry strategies, a post-finalize outcome check (e.g. the planning Step 5b evaluation returned by `workflow_finalize_dynamic`), or (for planning steps) the complete execution procedure. Engine instructions are **additive** — follow them AND the normal step flow below, unless they explicitly replace the flow (planning steps).

Check `type` in response:

**`type: "delegation"`** → do NOT spawn a subagent. See [Delegation](#delegation) below.

**`type: "regular"`** → check the `subagent` field:

- **`subagent: false`** → execute the step **yourself** (inline). Read the `goal`, resolve inputs, do the work, write outputs. Do NOT spawn a subagent. After completing, proceed directly to step 4 (Complete the step). The gate hook will NOT fire — skip step 3 entirely.

- **`subagent: true`** (or field absent) → the ENGINE has already composed the FULL task into a prompt file (`prompt_file`), `inject: file` content included — you never read that file and never rebuild text blocks yourself. Use **`spawn_prompt`** from the payload VERBATIM as the subagent's task prompt: it tells the worker to read its file and carries the run/step marker the gate hook needs. The `gate` field on the same payload decides the collect question (see step 3).

### 2. Spawn subagent (only when `subagent` is true)

- **Regular step** (`type: "regular"`): spawn ONE subagent with `spawn_prompt` as the task
- **Parallel step** (`type: "parallel"`): `step_begin` returns lightweight branch metadata — each entry has `branch_index`, `prompt_file`, `spawn_prompt`, `subagent_type` (engine-managed, pass verbatim), `model`, and a brief `summary`. For each branch, spawn a subagent using **`branch.spawn_prompt`** as the task prompt. Spawn ALL subagents in a SINGLE message. **Do NOT resolve parallel_key yourself** — the engine has already done it. **Do NOT read the prompt files yourself** — the subagent reads its own file.

### 3. Handle gate results

> **⛔ HOW THE GATE LOOP WORKS (Copilot hook semantics)**
>
> When a subagent completes, the `subagentStop` hook runs the gate command `riglane gate-check`.
> - **Gate FAIL** → the hook blocks the stop and the gate feedback becomes the subagent's next turn (another chance to fix) → hook fires again
> - **Gate PASS** → subagent STOPS → control returns to YOU
> - **Retry limit** → subagent stops → you read the result
>
> You do NOT see intermediate gate failures. The retry loop happens inside the subagent session.

After the subagent completes: if the begin payload said `gate: {semantic: false, human: false}`, skip straight to step 4 (Complete the step) — `step_complete` validates the verdict itself. Otherwise call `step_collect_result` and check `action`:

- **`PROCEED`** → gate passed
  - If `needs_semantic_gate` → verify outputs are correct and coherent
  - If `needs_human_gate` → present summary and ask user for approval
  - Then proceed to step 4

- **`RETRY_STEP`** → gate failed after retries. When the response carries **`retry_begin`**, spawn a **new** subagent with its `spawn_prompt` VERBATIM — the engine regenerated the prompt file and appended a Retry Feedback section; do NOT reassemble the task or relay the failures yourself. Without `retry_begin` (degraded compose / parallel branches): original task + failure `details`, as before. Track retry count. If retries exceed `max_step_retries` → **STOP workflow.**

- **`STOP_WORKFLOW`** → gate infrastructure failure. **STOP immediately.** Report to user.

**Parallel partial failure handling:**

For **parallel** steps `step_collect_result` may return `PROCEED` with a `failed_branches: [indices]` field even when `passed: true`. This is **case (b) partial failure** — some branches succeeded, others did not.

- **Default behavior (workflow.yaml `gate.allow_partial_step_complete: false`):** You MUST re-spawn the failed branches with their original task prompts before calling `step_complete`. If you skip this, the engine will reject `step_complete` with `action: BLOCKED_PARTIAL_FAILURE`.
- **When `gate.allow_partial_step_complete: true`:** You may proceed to `step_complete` directly with partial branches.
- **Hard rule (NOT overridable):** When ALL branches fail (case c, catastrophic) or a non-parallel step's last gate-check failed, the engine ALWAYS rejects `step_complete` with `action: BLOCKED_PARTIAL_FAILURE`. Re-spawn fresh subagents for the step or abort the run.

### 4. Complete the step

Call `step_complete` with workflow name, step name, and a brief summary (2-3 sentences).

The tool handles: manifest update, summary file, param_bindings, next step.

**Possible failure responses:**

- **`action: BLOCKED_PARTIAL_FAILURE`** with `blocked_reason: 'all_branches_failed' | 'partial_branches_failed' | 'non_parallel_failed'` → step has unresolved failures. Re-spawn the failing work (per-branch for partial; full step for catastrophic; fresh subagent for non-parallel) OR set `gate.allow_partial_step_complete: true` in workflow.yaml if partial completion is intentional. The engine `step_begin` for the next step will also block until the previous step is resolved.

- **`action: "FIX_AND_RETRY"`** → output validation failed for an inline step (`subagent: false`). Read `validation_errors`, fix the output files, then call `step_complete` again.
- `workflow_done: false` → proceed to `next_step`
- `workflow_done: true` → proceed to [Finalization](#finalization)

> **Loop-back / dynamic-planning steps** return engine actions (`LOOP_BACK`, `AWAITING_LOOP_DECISION`, …) that carry their own `engine_instructions` — follow them verbatim per the rule above. The engine owns the cursor, so you cannot advance past or around a loop on your own; just obey the returned instruction.

---

## Delegation

When `step_begin` returns `type: "delegation"`:

1. **Check `goal`** — if it contains conditional logic (skip conditions), evaluate it first
2. **Circular delegation check** — verify target is not already in the execution stack
3. Call `workflow_init` for the delegated workflow using `resolved_params`
4. Run ALL steps of the delegated workflow (same step execution loop — each step spawns its own subagents)
5. When complete, call `workflow_finalize` for the delegated workflow
6. Call `step_complete` on the **parent** workflow's delegation step — the tool applies `param_bindings` (reads from delegated workflow's output dir)
7. Continue parent workflow

**Important:** Delegation is NOT a subagent. YOU execute the delegated workflow directly. Max one level deep (A→B OK, A→B→C prohibited).

---

## Planning Steps (`type: "planning"`)

When `step_begin` returns `type: "planning"`, the `engine_instructions` field contains the **complete execution procedure** (Steps 0-6). This is the single source of truth — it replaces the normal step flow entirely.

### ⛔ MANDATORY

1. **READ `envelope.engine_instructions` end-to-end** before any other action.
2. **FOLLOW it verbatim.** The procedure is contextualized to this step's actual restrictions (max_substeps, max_plan_attempts, remaining budget, etc.) and is regenerated each `step_begin` call.
3. **DO NOT paraphrase, summarize, or skip steps.** The procedure includes an explicit anti-patterns block — read it.
4. **DO NOT look for the procedure in this SKILL.md or any other doc.** It lives ONLY in the engine response. Treating SKILL.md as the procedure source is itself an anti-pattern called out in the engine output.

The procedure orchestrates 8 dynamic MCP tools (`workflow_validate_dynamic`, `workflow_invoke_dynamic`, `step_begin_dynamic`, `step_collect_result_dynamic`, `step_complete_dynamic`, `workflow_finalize_dynamic`, `agent_notes_write`, `agent_notes_search`). The engine response tells you exactly when and how to call each.

If `engine_instructions` is empty or missing on a `type: "planning"` envelope, STOP and surface to the user — this indicates an engine version mismatch.

---

## Finalization

Call `workflow_finalize` with workflow name. The tool sets manifest status, finalizes trace with aggregates and synthetic entries.

Tell the user: "Workflow `<name>` completed. All N steps passed." + brief summary.

---

## Error Handling

### Gate failure at any level — STOP

If any gate fails to execute (`STOP_WORKFLOW` from `step_collect_result`):
1. **STOP immediately** — do NOT continue
2. Report to user: which step, which gate, what happened
3. Do NOT: retry, skip, diagnose, or modify files

### Other errors

- **Subagent error/abort**: STOP workflow. Report to user.
- **Gate loop exhausted**: `step_collect_result` returns `RETRY_STEP`. Re-spawn new subagent up to `max_step_retries`.
- **Missing input files**: Error before spawning subagent.

## Engine File Protection

**CRITICAL:** Neither you nor subagents may modify:
`.riglane/scripts/`, `.riglane/docs/`, `.riglane/tools/`, `.riglane/workflows/templates/predefined/`, `.github/skills/`, `.github/instructions/`, `.github/hooks/`, `.github/agents/riglane-*`

Report bugs to the user — never fix engine files during a workflow run.

## Output File Ownership

**CRITICAL — for subagent steps (`subagent: true`):** you (the orchestrator) must **NEVER write the step's output files** (drafts, specs, reports, data files). Only the subagent writes them. If a subagent misses an expected output:

1. **Do NOT fill the gap yourself** — you are the orchestrator, not the worker
2. **Retry the subagent** with specific instructions about what was missed
3. If retries are exhausted, **report the gap** to the user — let them decide

Why: for a subagent step the gate runs through the `subagentStop` hook on the subagent's session. An output YOU write for that step bypasses that hook, so the step can pass without its work being gate-checked (false success).

**Exception — inline steps (`subagent: false`):** here YOU are the worker by design. `step_begin` returns `subagent: false` precisely to tell you to do the work and write the outputs yourself — that is correct and required, NOT a violation of the rule above. These outputs are not unchecked: the engine still validates them structurally at `step_complete` and returns `action: FIX_AND_RETRY` if any declared output is missing or invalid (see Step 4 under Step Execution). Fix the file(s) and re-call `step_complete`.

---

## Parallel Steps

For `parallel: true` steps:

1. `step_begin` returns `type: "parallel"` with lightweight `branches` metadata (engine resolves `parallel_key` automatically)
2. Each branch's **full task prompt** is written to a file (e.g., `prompts/<step>/branch_0.md` inside the workflow runtime dir). The orchestrator does NOT compose prompts from fields — it tells each subagent to read its prompt file. These files persist after workflow completion for debugging.
3. Each branch has **isolated output paths** (`_branch_0/`, `_branch_1/`, ...) — subagents write to their own directories
4. Gate-check validates **only the branch's files** (not the entire output directory) — no cross-branch feedback
5. Spawn ALL branches in a single message, one subagent per branch entry
6. `step_complete` automatically **merges** branch dirs to the final location and cleans up `_branch_*/`
7. On resume, only spawn subagents for `pending` and `failed` branches — skip `completed` ones

---

## Key Files

| File | Purpose |
|------|---------|
| `.riglane/workflows/templates/my_workflows/<name>/workflow.yaml` | User-defined workflow (read) |
| `.riglane/workflows/templates/predefined/<name>/workflow.yaml` | Built-in workflow (read) |
| `.riglane/local/workflow_runs/<run_id>/manifest.json` | Runtime state (managed by MCP tools) |
| `.riglane/local/workflow_runs/<run_id>/gate-result.json` | Gate check result (written by the gate hook `riglane gate-check`) |
| `.riglane/local/workflow_runs/<run_id>/trace.json` | Execution trace (managed by MCP tools + the gate hook) |
| `.riglane/local/workflow_runs/<run_id>/context/*.summary.md` | Step summaries (managed by MCP tools) |
| `.riglane/specs/` | Behavioral specs (read/write by spec workflows) |
| `riglane gate-check` (CLI, run by the hook) | Structural gate (called by the subagentStop hook) |

