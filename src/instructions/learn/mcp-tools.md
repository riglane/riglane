MCP TOOLS — engine surface catalog
══════════════════════════════════

All tools live under the `workflow_engine` MCP server.
Call as mcp__workflow_engine__<tool> (Claude Code) / mcp_workflow_engine_<tool>
(Cursor) / workflow_engine_<tool> (OpenCode: <server>_<tool>) /
workflow_engine-<tool> (Copilot: <server>-<tool>, single hyphen). On Codex
they may surface bare (<tool>) OR prefixed — MATCH BY THE CORE TOOL NAME,
ignoring any host prefix (do not assume one fixed form).

OPENCODE NAMING NOTE: script tools surface as workflow_tools_<wf>__<tool>
(server prefix + the combined <wf>__<tool> name). External MCP server KEYS
in opencode.json must be underscore-only for Riglane use — a hyphenated key
(my-db) surfaces verbatim (my-db_<tool>) and cannot be declared in tools[]
(name pattern ^[a-z][a-z0-9_]*$), so whitelist/attribution cannot match it.

DEFERRED DISCOVERY (tool-search hosts — Claude Code ToolSearch, Codex
tool_search): tool listing is LAZY. A tool the engine reports *available*
may be MISSING from the first search — that is DEFERRED, NOT absent. The
orchestrator must re-search / load its schema / call it directly by full
name before any fallback, and never run the script via shell on a first
miss. (Script tools — the workflow_tools server — defer the same way.)

ASYNC INJECTION (Cursor): on the FIRST message of a session the tools
list may not contain the engine tools yet — the servers are connected,
their tools are just not injected into this session yet (they inject
asynchronously). Probe with workflow_resolve BEFORE concluding absence:
fail → wait ~20s, retry once; second failure → STOP, surface the error,
and tell the user to SEND A FOLLOW-UP MESSAGE — Cursor often injects the
tools on the next turn (observed: absent turn 1, present turn 2 of one
session). Reconnect/Reload is a last resort, NOT the first advice (the
gap is injection into this session, not config). NEVER infer MCP absence
from ListMcpResources/FetchMcpResource (those list *resources*; the
engine exposes only *tools*, so "No MCP resources found" is expected even
when everything works), nor from riglane doctor/status (project config ≠ this
session) or shell-run riglane mcp-server/mcp-tools (separate processes).

── Lifecycle ─────────────────────────────────────────────────────
  workflow_resolve(name)
    Find definition, return metadata (name, version, params, steps,
    gate config). Use to inspect a workflow before running.

  workflow_validate(workflow_yaml)
    Full validator on a YAML string (schema + every programmatic rule +
    advisory lint) WITHOUT touching disk or any run state. The same
    validator every load runs; CLI twin for saved files:
    riglane validate-workflow <path>.

  workflow_init(name, params?)
    Start a fresh run. Returns run_id + first step name, and normally
    next_begin — the FIRST step's complete begin payload: drive from it
    directly, do NOT call step_begin for it. Each run mints a
    unique run_id and gets its own per-run dir
    (.riglane/local/workflow_runs/<run_id>/), so multiple runs of the same
    workflow can proceed in parallel — no single-active-run restriction.

  workflow_resume(name, run_id?)
    Continue an in-progress run (preserves data/context). Without run_id:
    this workflow's LATEST resumable run — right when there is one, the
    wrong run the moment a newer one is alive beside the stalled one you
    mean. With run_id: exactly that run, or a refusal (unknown, other
    workflow, already terminal) — never a silent redirect. Naming a run is
    not permission to take it: the live-owner refusal still applies.
    Also re-takes a planning step's mid-flight dynamic child run, so after
    a session restart the *_dynamic tools work again — resume the PARENT;
    a dynamic child is never resumed by its own name.

  workflow_finalize(name)
    Mark workflow complete, finalize trace with aggregates.

── Per-step driving (regular flow) ───────────────────────────────
  step_begin(name, step)
    Prepare step. For a SUBAGENT step the ENGINE composes the full task
    into a prompt FILE (prompts/<step>.md in the run dir; inject:file
    content inlined) and returns a SLIM envelope: prompt_file +
    spawn_prompt (use it VERBATIM as the subagent task — never read the
    file or rebuild blocks yourself) + subagent_type + model + gate
    flags. An INLINE (subagent: false) step still returns the full text
    blocks — there YOU are the executor. Delegation steps return
    delegation metadata; parallel steps per-branch prompt files + slim
    branch metadata (the same file pattern).
    COMPOSITE DRIVING: you usually do NOT call this — the SAME payload
    arrives as next_begin on the previous successful response
    (workflow_init, step_complete incl. LOOP_BACK/ENTER_ROUTE; per lane
    as lanes_begin on ENTER_LANES). Call step_begin only when the
    previous response carried no payload (degraded compose, resume, a
    lane absent from lanes_begin) — it stays fully valid and returns
    the identical payload.

  step_collect_result(name, step?)
    Read the gate verdict after a subagent finishes. OPTIONAL when the
    begin payload said gate: {semantic: false, human: false} — call
    step_complete directly there; it validates the verdict itself and a
    failed gate refuses completion with retry guidance. With EITHER flag
    on, collect FIRST as before — that turn carries the semantic check /
    the human question. Returns action:
    PROCEED | RETRY_STEP | STOP_WORKFLOW | BLOCKED_FOREIGN_CALLER (you
    are a spawned worker, not the orchestrator — do your one task and
    stop). Includes stale detection via run_token comparison. A verdict
    that is ABSENT, or that belongs to a DIFFERENT step (normal under
    lanes — concurrent workers share the legacy slot), is re-validated
    engine-inline for the step you named — you never arbitrate a file
    mix-up yourself. A fresh-spawn RETRY_STEP normally carries
    retry_begin — the regenerated prompt file (ending with a Retry
    Feedback section) + spawn_prompt: spawn from it VERBATIM, never
    reassemble the task or relay the failures yourself.

  step_complete(name, step, summary)
    Mark step done. Writes summary to context/, applies param_bindings,
    and moves the cursor to wherever the ENGINE decides: the next
    step, a loop_back target, a route's first step, or a fork's lanes
    (action ENTER_LANES — drive all lanes concurrently; a finished lane
    returns LANE_WAIT while siblings are live; the last one carries
    lanes_exit past the join barrier — topic "lanes") — and on the
    LAST step, or on an AWAITING_* decision return, it deliberately
    does NOT move (obey the returned action; topics "loop-back" and
    "routes"). Safety-net validates outputs if gate-result is missing.
    On every successful advance with a known target the response also
    carries next_begin (lanes_begin on ENTER_LANES) — the admitted
    step's full begin payload; AWAITING_*/error envelopes never do.

── Inbox (human answers outside the terminal; ONE op-polymorphic tool) ──
  inbox(op, name, …)   op: rules | ask | post | check | respond
    op:'rules' (name, step) — fetch the message-composition rules and
    UNLOCK posting for the current pass. Call it IMMEDIATELY before
    composing: a post without a fresh rules fetch is refused, even a
    valid one (the rules belong at the moment of composition).
    op:'ask' (name, step, message | name, message_id) — the PREFERRED
    way to ask: ONE held call that validates + stores the message,
    delivers it on every channel (inbox UI, webhook, and a native host
    dialog in the terminal when the host supports it), HOLDS the call
    until the answer arrives, records it, and returns it. Other shapes:
    relay_required (relay + poll yourself), pending (ask again with the
    returned message_id to resume the hold).
    op:'post' (name, step, message) — validate + store a structured human
    message for the current run (human gate / loop / route questions)
    WITHOUT holding. Invalid structure = rejection with per-field errors
    — fix and re-post; only a valid message reaches the store and the
    webhook. Returns message_id.
    op:'check' (name, message_id, wait_ms?) — poll for the human response
    under relay_required. Returns status "pending" or
    "responded" (+ the response record). wait_ms (max 15000) waits
    server-side; between calls, wait — never busy-loop. The run holds
    durably until the user answers.
    op:'respond' (name, message_id, type, text?, args?, items?) — record
    an answer the ORCHESTRATOR received in the terminal (stamped
    via:"terminal"; web/API answers arrive through the Local API and
    stamp their own channel). The type must be one the message allows;
    a grouped message is answered with type "items" + an items map.
    Full flow + message shape: workflow_learn(topic="inbox").

── Planning step (orchestrator drafts a child workflow) ──────────
  workflow_validate_dynamic(parent_workflow, parent_step, workflow_yaml)
    In-memory validate the drafted YAML against parent restrictions.
    Each call bumps attempts counter; BLOCKED_PLANNING_FAILURE after
    max_plan_attempts.

  workflow_invoke_dynamic(parent_workflow, parent_step, workflow_yaml,
                          inherit_params?)
    Commit YAML to disk + init child run. Re-validates defensively
    without bumping the attempts counter on failure.

  step_begin_dynamic(parent_workflow, parent_step, step)
  step_collect_result_dynamic(parent_workflow, parent_step, step?)
  step_complete_dynamic(parent_workflow, parent_step, step, summary)
    Like the regular per-step trio, but for child substeps. Resolves
    the dynamic child runtime from parent planning state.

  workflow_finalize_dynamic(parent_workflow, parent_step)
    Bridge child terminal status → parent planning.phase ("completed"
    or "failed").

  workflow_replan_dynamic(parent_workflow, parent_step)
    Reset planning.phase for a 2nd attempt after child finalize but
    unsatisfactory result. Does NOT consume an attempt itself — the
    next workflow_validate_dynamic call does.

── Reflection (planning-step companion) ──────────────────────────
  agent_notes_search(step_template, tags?, status?, confidence?, limit?)
    Find prior notes for a planning step template. Returns summaries
    (frontmatter subset + path). Defaults hide failed/low-confidence.

  agent_notes_write(step_template, topic, status, confidence, run_id,
                    body, generated_workflow_path?, tags?, related_runs?)
    Record a reflection after child finalize. Engine sets project/date/
    version automatically.

── Knowledge ─────────────────────────────────────────────────────
  workflow_learn(topic?)
    Get knowledge content. Default topic="overview". List of all
    available topics is returned in available_topics on every response.

── Utility ───────────────────────────────────────────────────────
  list_agent_files(path?, pattern?)
    List files under .riglane/ (bypasses gitignore — IDE search tools
    skip it by design).

TYPICAL CALLING SEQUENCE (regular workflow, composite driving):
  init (returns next_begin for step 1) → for each step: (spawn from the
  payload) → [collect_result only when the payload's gate flags ask] →
  complete (returns next_begin for the next step) → finalize.
  step_begin remains valid — call it only when a response carried no
  payload (degraded compose, resume, a lane absent from lanes_begin).

PLANNING STEP SEQUENCE (inside one parent planning step):
  step_begin (parent) → agent_notes_search → draft YAML →
  workflow_validate_dynamic (loop until ok) → workflow_invoke_dynamic →
  for each substep (driving from payloads — step_begin_dynamic only
  when a response carried no next_begin): (spawn from payload) →
  step_collect_result_dynamic → step_complete_dynamic →
  workflow_finalize_dynamic → agent_notes_write →
  step_complete (parent)
