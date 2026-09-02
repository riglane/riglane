---
name: riglane-run-workflow
description: "Run a declarative multi-phase Riglane workflow (doc-spec-extraction, spec-add, spec-audit, spec-do, implement, or a custom one from my_workflows/). Use this whenever the user asks to run, execute, or start a workflow by name. Orchestrates per-step subagents via the MCP workflow engine with structural gates, trace, and parallel execution."
---

# $riglane-run-workflow (Codex)

Run a declarative multi-phase workflow defined in `.riglane/workflows/`.

> **Codex invocation:** explicitly with `$riglane-run-workflow <workflow-name> [args]`, or implicitly when the user asks to run/execute/start a workflow by name. (Codex skills use `$name`, not the `/name` form used by other hosts.)

## Usage

```
$riglane-run-workflow <workflow-name> [--param value] [--model <inherit|auto|lightest|strongest>] [--inbox-webhook <url>] [--no-trace-viewer] [--resume [<run-id>]]
```

## ⛔ FIRST — get the workflow name from YOUR invocation (do this before anything else)

**The workflow name is the FIRST argument of the invocation that triggered this skill.** When the
invocation is `/riglane-run-workflow tools-demo`, the workflow name is `tools-demo`; with
`/riglane-run-workflow doc-spec-extraction --scope aurora`, it is `doc-spec-extraction` and
`--scope aurora` is a param. **Read it directly from your invocation text — it is already in your
context.** Do NOT ask the user for a name that is present in the invocation.

Only if the invocation genuinely carries NO workflow name (a bare invocation): say so in **plain
text**, then either list the directory names under
`.riglane/workflows/templates/{my_workflows,predefined,examples}/` via the `list_agent_files` MCP
tool (NOT file-search tools) and present them, or ask the user in one short plain sentence.

Once you have the name, proceed — go to **Startup → New Run** (or **Resume** if `--resume` is present).

## You Are the Orchestrator

When this skill is invoked, you become the **workflow orchestrator**. For regular steps you spawn subagents (via Codex's `spawn_agent`) — but for **delegation steps** (`delegate_to:`) you execute the delegated workflow yourself, WITHOUT spawning a subagent.

> **⚠️ `.riglane/local/` is typically gitignored (the user's choice — recommended), and `.riglane/` may be behind symlinks; `.riglane/workflows/` (definitions) is committed.** When `.riglane/local/` is gitignored, file search / glob tools will NOT find runtime files there. To **discover** files reliably, use the `list_agent_files` MCP tool (walks the directory server-side — bypasses both gitignore and symlink issues). To **read** a known file, use the read/file tool with the exact path. **Do NOT search inside `.riglane/` with a tool that honors `.gitignore`** — it skips runtime files; prefer `list_agent_files` (or the no-MCP fallback below). When verifying step outputs, **trust the gate result** — the gate hook (`riglane gate-check`) already validated the files server-side, not with host file tools.
>
> **Fallback** (no MCP): list the path with a plain shell command — `find .riglane/<subdir> -type f` (or `ls`). Unlike the IDE's Glob/Grep, a raw shell listing does NOT honor `.gitignore`, so it sees the runtime files. To read a known file, `Read` the exact path.

### ⛔ MANDATORY: Use MCP Workflow Engine Tools

**Step 0 — Confirm the MCP engine tools are available before doing anything else.**

Codex surfaces MCP tools **grouped under their server**, by tool name. **Find each engine tool by its tool name under the `workflow_engine` server, and call it by the name your tools list / search shows** — the bare name (`workflow_resolve`) often works; the exact wrapper varies by codex-cli version, so do NOT assume a format. The engine tools are:

```
workflow_resolve, workflow_init, workflow_resume,
step_begin, step_collect_result, step_complete, workflow_finalize,
list_agent_files, workflow_validate, workflow_learn, …
```

Call them directly by name, e.g.:

```
workflow_resolve({"name": "<workflow>"})
workflow_init({"name": "<workflow>", "params": {...}})
step_begin({"name": "<step>"})
step_collect_result({"name": "<step>"})
step_complete({"name": "<step>", "summary": "..."})
workflow_finalize({})
```

(Arguments come from each tool's schema — pass what it defines; the placeholders above just show the call shape.)

Script tools live under the `workflow_tools` server, named `<workflow>__<tool>`. **Find each by its tool name under `workflow_tools` and call it by the name your tools list / search shows** (the bare `<workflow>__<tool>` often works; don't assume a prefix format); pass the arguments its schema defines:

```
<workflow>__<tool>({...})
```

> **⚠️ Deferred discovery — a 0-result `tool_search` does NOT mean "tool absent". The #1 cause is a LOOSE query.** A `tool_search` with loose keywords (e.g. the bare goal words `tools-demo count_lines`) returns **0 even when the tool IS registered** — the real name always has `__` between workflow and tool (`tools-demo__count_lines`). The script tools the engine reports *available* (in `workflow_init`'s `tools.available`, named in each `step_begin` `tool_docs` block) ARE registered; a 0 from a loose query is a QUERY MISTAKE, not absence. When a script tool is not surfaced:
> 1. **Search/select by the EXACT name from `tool_docs`** — the `<wf>__<tool>` tool under the `workflow_tools` server, by the name your tools list shows (bare often works; don't assume a prefix format), one per tool — NOT loose keywords. `tool_docs` hands you the exact name; use it verbatim.
> 2. **Call it directly by that exact full name** — a registered tool is callable even if a loose search didn't list it.
> 3. If an EXACT-name search still returns 0, the `workflow_tools` server may still be connecting — **wait briefly and re-search the exact name** before anything else.
> 4. Only as a genuine **LAST resort** run the underlying script via the shell — invoke it with the interpreter its `command` declares — `node x.js`, `bash x.sh`, or `python x.py` (for Python: `python3` on Linux/macOS, `python` on Windows; if one reports "command not found", try the other) — and pass each argument as `--key=value` (not `--key value`).
>
> **Never** conclude "tool not available" from a loose-keyword `tool_search`, and **never** jump to the shell when the engine said the tool exists.

**Mandatory probe:** call `workflow_resolve` with `{"name": "<workflow>"}` once.
- ✅ Got metadata back (steps/params/gates) → MCP works. Continue with MCP for the ENTIRE run.
- 🟡 The engine tools are not in your tool list yet → **first re-run `tool_search` / wait briefly and re-check** (per *Deferred discovery* above — Codex surfaces MCP lazily, so a cold first lookup can miss even the engine tools). Only if they are STILL absent after a retry are the `workflow_engine`/`workflow_tools` MCP servers configured but not loaded — usually **the project is not trusted** (Codex loads project `.codex/config.toml` only for trusted folders) or the servers failed to start. **THEN STOP and tell the user:** run `codex` once in this folder and accept the trust prompt (or run `riglane doctor`), then re-launch. Do NOT flail: NEVER self-call `riglane run-workflow`, `riglane mcp-server`, `riglane mcp-tools`, or `riglane doctor` to "expose" tools, do NOT grep the Riglane source repo, do NOT build your own MCP bridge or drive the run via shell — `riglane run-workflow` is an EXTERNAL launcher that spawns a NEW agent; you are already inside a launched one. Your only correct action is to STOP and report.
- 🟡 `workflow_resolve` returns a literal `"tool not found"` / `"server unavailable"` / config error → **STOP and surface the error verbatim.** Do NOT hand-write `manifest.json`/trace or drive the workflow yourself — the engine owns all run state.

> **⚠️ The engine owns ALL run state — you NEVER do.** NEVER hand-write or generate `manifest.json`, trace files, or any run artifact, and NEVER drive the workflow yourself with file/shell tools. If the MCP engine is unavailable, STOP and tell the user (re-trust the folder / restart `codex`; if a previous run is stuck in-progress, `riglane workflow-clear <name>` releases the lock). A run without the engine has no trace, no gate, no audit — there is no "manual" run, only a corrupted one.

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

**Permitted reactions:** print the error verbatim, stop the run, wait for user direction.
**Forbidden reactions:** creating any file the error mentions; editing `workflow.yaml`/`structs/*.schema.yaml`/hooks/scripts/any project-tracked file; retrying the failed engine call; calling other engine tools to "work around" the error.

### ⛔ Anti-Patterns — NEVER Do These

- **NEVER run `riglane workflow-clear` (or otherwise clear/reset/re-init a run) without the user's EXPLICIT permission.** It is a user-only recovery command that finalizes the run as `failed`. If a run is stuck or a step keeps failing, STOP and tell the user what failed and why; offer to clear or resume; act ONLY after they choose. Restarting a run to escape a failing step is never your decision — a repeatedly failing step is a signal to surface, not to bulldoze.
- **NEVER skip, reorder, or jump over a step, and never offer the user a "skip this step" choice.** The engine runs steps in their defined order and refuses every out-of-order move (`BLOCKED_OUT_OF_ORDER`) — there is no skip mechanism. If a step's work does not apply this run, the step still runs and may legitimately do nothing; conditional paths are the workflow author's job (`routes`), not a choice you invent at a gate.
- **NEVER bypass `step_begin`.** The engine returns the step's task spec in `step_begin` output — pass it through verbatim to the worker, do not invent or guess it.
- **NEVER write `manifest.json` manually** when MCP is available. The engine manages manifest lifecycle (state transitions, timestamps, run_token, step tracking).
- **`step_collect_result` after a subagent: decide by the payload’s `gate` flags.** When the step’s begin payload carried `gate: {semantic: false, human: false}`, call `step_complete` DIRECTLY — the engine validates the verdict inside it (a failed gate refuses completion with retry guidance; nothing is lost). When EITHER flag is true, call `step_collect_result` FIRST, exactly as before — that turn carries real work (the semantic check / the human question). Never skip collect on a gated step, and never assume a gate passed without the engine saying so.
- **NEVER advance to the next step without calling `step_complete`**. This writes the summary, applies param_bindings, and transitions manifest state. The engine accepts ONLY the cursor step in `step_begin` — skipping `step_complete` is rejected with `BLOCKED_OUT_OF_ORDER`.
- **NEVER assume gate passed** without evidence. If the gate result is absent or stale, something went wrong — STOP and report.
- **NEVER mutate `.riglane/local/active-scope`** (e.g. via `riglane scope set`, manual edit, or any other side effect) when running a workflow. The engine takes ownership of this file at `workflow_init` for any workflow with a `scope` param: it snapshots the prior value, writes the workflow's scope, and restores it at `workflow_finalize` (or on resume). Orchestrator-side mutation breaks the engine's restore guarantee — pass `--scope` as a workflow param and the engine threads it transparently.

---

## Startup

### New Run

1. Call `workflow_resolve` to get workflow metadata (steps, params, gates, tools)
2. Parse `--param value` arguments. For missing **required** params → ask the user; for missing **optional** params (those with a declared default) → use the default, do not ask
   - **Reserved run-level flag `--model <mode>`** — NOT a workflow param. If present, extract it (do NOT put it in `params`) and pass it to `workflow_init` as the top-level `model_override` argument. Valid values: `inherit` | `auto` | `lightest` | `strongest` (a selection MODE, not a model name). It overrides every subagent step's declared `model:` for this run. If the value is not one of those four, do not guess — surface the error and stop. (The engine re-validates `model_override` and rejects an invalid value.)
   - **Reserved run-level flag `--inbox-webhook <url>`** — NOT a workflow param. If present, extract it (do NOT put it in `params`) and pass it to `workflow_init` as the top-level `inbox_webhook` argument. It names the http(s) URL this run's inbox question envelopes are POSTed to, outranking the workflow's own `inbox_webhook` field and the env/config fallbacks. If the value is not a full http(s) URL, do not guess — surface the error and stop. (The engine re-validates and rejects a non-URL.)
   - **Reserved run-level flag `--no-trace-viewer`** — NOT a workflow param, and it takes no value. If present, extract it (do NOT put it in `params`) and pass `trace_viewer: "off"` to `workflow_init` as a top-level argument. It tells the engine not to auto-open the trace viewer in a browser for this run, whatever the ambient `engine.auto_open_trace_viewer` config says — typically because the application that launched the run has its own UI on it. **Forward it only when the launch actually carried the flag**: it is the launching human's or application's decision to relay, never one for you to make on their behalf.
3. Call `workflow_init` with name, resolved params, and (if given) `model_override` / `inbox_webhook` / `trace_viewer` → creates manifest, trace, run_token. Its response normally carries `next_begin` — the FIRST step’s complete `step_begin` payload: do NOT call `step_begin` for it, drive from the payload (see Step Execution step 1)
   - **If `workflow_init` reports an existing in-progress run** (error mentions an active run / `active_run_id`): do NOT auto-finalize it and do NOT hand-edit any manifest. Tell the user a previous run is still in-progress and **offer the choice** — clear it (`riglane workflow-clear <name>` releases the lock) or resume it (`--resume`). Act ONLY after the user picks.
4. **Check tools availability** — if `workflow_init` returns `tools.blocked: true`:
   - Show the user `tools.block_message` (lists missing required tools/MCP servers)
   - **STOP** — the user must enable the missing servers (and trust the project) before continuing
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
3. Based on `current_step_status`: `completed` → `step_complete` then advance; `in_progress` → resume this step; `failed` → ask user "Retry or skip?"
4. Tell the user: "Resuming from step '<step>'. N steps remaining."
5. Proceed to **Step Execution**

---

## Step Execution

For each step, in order:

### 1. Begin the step

**Composite driving — the payload usually arrives on the PREVIOUS response.** When the response you already hold (`workflow_init`, `step_complete`) carries a `next_begin` field, that IS this step’s full `step_begin` result — do **NOT** call `step_begin`; use `next_begin` as the response below and continue immediately. The same applies per lane to `lanes_begin` on an `ENTER_LANES` response (one payload per lane id) and to `next_begin` on `LOOP_BACK` / `ENTER_ROUTE` responses. A response WITHOUT a payload is the normal protocol: call `step_begin` with workflow name and step name. (`step_begin` always remains valid — e.g. after a resume, or for a lane missing from `lanes_begin`.)

**Engine instructions — applies to ANY engine response, not only `step_begin`:** If **any** engine tool response — `step_begin`, `step_collect_result`, `workflow_finalize_dynamic`, etc. — contains an `engine_instructions` field, **READ it end-to-end and FOLLOW it.** These are contextual instructions from the engine for this moment — summary guidance, retry strategy, a post-finalize outcome check, or (for planning steps) the complete execution procedure. Engine instructions are **additive** — follow them AND the normal flow below, unless they explicitly replace it (planning steps).

Check `type` in response:

**`type: "delegation"`** → do NOT spawn a subagent. See [Delegation](#delegation) below.

**`type: "regular"`** → check the `subagent` field:

- **`subagent: false`** → execute the step **yourself** (inline). Read the `goal`, resolve inputs, do the work, write outputs. Do NOT spawn a subagent. After completing, proceed directly to step 4 (Complete the step). The gate hook will NOT fire — skip step 3 entirely.

- **`subagent: true`** (or field absent) → the ENGINE has already composed the FULL task into a prompt file (`prompt_file`), `inject: file` content included — you never read that file and never rebuild text blocks yourself. Use **`spawn_prompt`** from the payload VERBATIM as the subagent's task prompt: it tells the worker to read its file and carries the run/step marker the gate hook needs. The `gate` field on the same payload decides the collect question (see step 3).

### 2. Spawn the subagent (only when `subagent` is true) — Codex spawn protocol

Codex does NOT auto-spawn per-step subagents and does NOT support named agent targeting — use a **generic spawn carrying the full per-spawn instruction** (this is the only reliable channel; the directive must live in the prompt, hence it is repeated here):

- **Regular step** (`type: "regular"`): call **`spawn_agent`** ONCE with `spawn_prompt` as the `prompt`. Do NOT pass an `agent_type`/named agent — there is none to target. Then call **`wait`** for that agent to finish and read its result. The worker inherits this workspace (no working-dir param needed — Riglane outputs are workspace-relative).
- **Parallel step** (`type: "parallel"`): `step_begin` returns lightweight branch metadata — each entry has `branch_index`, `prompt_file`, `spawn_prompt`, `subagent_type` (generic — ignore for targeting), `model`, and a brief `summary`. For each branch, call `spawn_agent` with **`branch.spawn_prompt`** as the `prompt`. Spawn ALL branches (up to Codex's `agents.max_threads`, default 6), then `wait` for them. **Do NOT resolve `parallel_key` yourself** — the engine already did. **Do NOT read the prompt files yourself** — each worker reads its own file.

### 3. Handle gate results

> **⛔ HOW THE GATE LOOP WORKS**
>
> When a subagent stops, the `SubagentStop` hook runs the structural gate (`riglane gate-check`).
> - **Gate FAIL** → the worker is told to continue (another turn to fix), then the hook fires again
> - **Gate PASS** → the worker stops → control returns to YOU
> - **Retry limit** → the worker stops → you read the result
>
> You do NOT see intermediate gate failures — the retry loop happens inside the worker session. Even if the hook verdict is missing, the engine re-validates the outputs inline at `step_collect_result` — the verdict always lives in the engine.

After the worker completes, call `step_collect_result`. Check `action`:

- **`PROCEED`** → gate passed. If `needs_semantic_gate` → verify outputs are correct and coherent. If `needs_human_gate` → present a summary and ask the user for approval. Then proceed to step 4.
- **`RETRY_STEP`** → gate failed after retries. When the response carries **`retry_begin`**, spawn a **new** worker (`spawn_agent`) with its `spawn_prompt` VERBATIM — the engine regenerated the prompt file with a Retry Feedback section; do NOT reassemble the task yourself. Without `retry_begin`: original task + failure `details`, as before. Track retry count. If retries exceed `max_step_retries` → **STOP workflow.**
- **`STOP_WORKFLOW`** → gate infrastructure failure. **STOP immediately.** Report to user.

**Parallel partial failure:** for parallel steps `step_collect_result` may return `PROCEED` with `failed_branches: [indices]` even when `passed: true` — case (b) partial failure.
- **Default (`gate.allow_partial_step_complete: false`):** re-spawn the failed branches with their original prompts before `step_complete`, or the engine rejects `step_complete` with `BLOCKED_PARTIAL_FAILURE`.
- **`gate.allow_partial_step_complete: true`:** you may proceed to `step_complete` directly.
- **Hard rule (NOT overridable):** when ALL branches fail, or a non-parallel step's last gate failed, the engine ALWAYS rejects `step_complete` with `BLOCKED_PARTIAL_FAILURE`. Re-spawn fresh workers or abort.

### 4. Complete the step

Call `step_complete` with workflow name, step name, and a brief summary (2-3 sentences). The tool handles manifest update, summary file, param_bindings, next step.

**Possible failure responses:**
- **`action: BLOCKED_PARTIAL_FAILURE`** with `blocked_reason` → step has unresolved failures. Re-spawn the failing work (per-branch for partial; full step for catastrophic; fresh worker for non-parallel) OR set `gate.allow_partial_step_complete: true` if partial completion is intentional.
- **`action: "FIX_AND_RETRY"`** → output validation failed for an inline step (`subagent: false`). Read `validation_errors`, fix the files, call `step_complete` again.
- `workflow_done: false` → proceed to `next_step`; `workflow_done: true` → proceed to [Finalization](#finalization)

> **Loop-back / dynamic-planning steps** return engine actions (`LOOP_BACK`, `AWAITING_LOOP_DECISION`, …) carrying their own `engine_instructions` — follow them verbatim. The engine owns the cursor, so you cannot advance past or around a loop on your own; just obey the returned action.

---

## Delegation

When `step_begin` returns `type: "delegation"`:

1. **Check `goal`** — if it contains conditional logic (skip conditions), evaluate it first
2. **Circular delegation check** — verify the target is not already in the execution stack
3. Call `workflow_init` for the delegated workflow using `resolved_params`
4. Run ALL steps of the delegated workflow (same step execution loop — each step spawns its own worker via `spawn_agent`)
5. When complete, call `workflow_finalize` for the delegated workflow
6. Call `step_complete` on the **parent** workflow's delegation step — the tool applies `param_bindings` (reads from the delegated workflow's output dir)
7. Continue the parent workflow

**Important:** Delegation is NOT a subagent. YOU execute the delegated workflow directly. Max one level deep (A→B OK, A→B→C prohibited).

---

## Planning Steps (`type: "planning"`)

When `step_begin` returns `type: "planning"`, the `engine_instructions` field contains the **complete execution procedure** (Steps 0-6). This is the single source of truth — it replaces the normal step flow entirely.

### ⛔ MANDATORY

1. **READ `engine_instructions` end-to-end** before any other action.
2. **FOLLOW it verbatim.** The procedure is contextualized to this step's actual restrictions (max_substeps, max_plan_attempts, remaining budget) and is regenerated each `step_begin` call.
3. **DO NOT paraphrase, summarize, or skip steps.** It includes an explicit anti-patterns block — read it.
4. **DO NOT look for the procedure in this SKILL.md or any other doc.** It lives ONLY in the engine response.

The procedure orchestrates the dynamic MCP tools (`workflow_validate_dynamic`, `workflow_invoke_dynamic`, `step_begin_dynamic`, `step_collect_result_dynamic`, `step_complete_dynamic`, `workflow_finalize_dynamic`, `agent_notes_write`, `agent_notes_search`). The engine response tells you exactly when and how to call each.

If `engine_instructions` is empty or missing on a `type: "planning"` envelope, STOP and surface to the user — this indicates an engine version mismatch.

---

## Finalization

Call `workflow_finalize` with the workflow name. The tool sets manifest status and finalizes the trace with aggregates and synthetic entries.

Tell the user: "Workflow `<name>` completed. All N steps passed." + a brief summary.

---

## Error Handling

### Gate failure at any level — STOP
If any gate fails to execute (`STOP_WORKFLOW` from `step_collect_result`): **STOP immediately**, report (which step, which gate, what happened), and do NOT retry/skip/diagnose/modify files.

### Other errors
- **Worker error/abort**: STOP workflow. Report to user.
- **Gate loop exhausted**: `step_collect_result` returns `RETRY_STEP`. Re-spawn a new worker up to `max_step_retries`.
- **Missing input files**: error before spawning the worker.

## Engine File Protection

**CRITICAL:** Neither you nor any worker may modify:
`.riglane/scripts/`, `.riglane/docs/`, `.riglane/tools/`, `.riglane/workflows/templates/predefined/`, `.agents/skills/`, `.codex/config.toml`

Report bugs to the user — never fix engine files during a workflow run.

## Output File Ownership

**CRITICAL — for subagent steps (`subagent: true`):** you (the orchestrator) must **NEVER write the step's output files** (drafts, specs, reports, data files). Only the worker writes them. If a worker misses an expected output:
1. **Do NOT fill the gap yourself** — you are the orchestrator, not the worker
2. **Retry the worker** (`spawn_agent`) with specific instructions about what was missed
3. If retries are exhausted, **report the gap** to the user — let them decide

Why: for a subagent step the gate runs through the `SubagentStop` hook on the worker's session. An output YOU write for that step bypasses that hook, so the step could pass without its work being gate-checked (false success).

**Exception — inline steps (`subagent: false`):** here YOU are the worker by design. `step_begin` returns `subagent: false` precisely to tell you to do the work and write the outputs yourself — that is correct and required. These outputs are still validated: the engine checks them structurally at `step_complete` and returns `action: FIX_AND_RETRY` if any declared output is missing or invalid. Fix the file(s) and re-call `step_complete`.

---

## Parallel Steps

For `parallel: true` steps:

1. `step_begin` returns `type: "parallel"` with lightweight `branches` metadata (engine resolves `parallel_key` automatically)
2. Each branch's **full task prompt** is written to a file (e.g. `prompts/<step>/branch_0.md` inside the workflow runtime dir). You do NOT compose branch prompts from fields — each worker reads its own prompt file. These files persist after completion for debugging.
3. Each branch has **isolated output paths** (`_branch_0/`, `_branch_1/`, …) — workers write to their own directories
4. The gate validates **only the branch's files** (not the entire output directory) — no cross-branch feedback
5. Spawn all branches via `spawn_agent` (up to `agents.max_threads`, default 6), then `wait`
6. `step_complete` automatically **merges** branch dirs to the final location and cleans up `_branch_*/`
7. On resume, only spawn workers for `pending`/`failed` branches — skip `completed` ones

---

## Key Files

| File | Purpose |
|------|---------|
| `.riglane/workflows/templates/my_workflows/<name>/workflow.yaml` | User-defined workflow (read) |
| `.riglane/workflows/templates/predefined/<name>/workflow.yaml` | Built-in workflow (read) |
| `.riglane/local/workflow_runs/<run_id>/manifest.json` | Runtime state (managed by MCP tools) |
| `.riglane/local/workflow_runs/<run_id>/gate-result.json` | Gate check result (written by the gate hook) |
| `.riglane/local/workflow_runs/<run_id>/trace.json` | Execution trace (managed by MCP tools + gate hook) |
| `.riglane/local/workflow_runs/<run_id>/context/*.summary.md` | Step summaries (managed by MCP tools) |
| `.riglane/specs/` | Behavioral specs (read/write by spec workflows) |
