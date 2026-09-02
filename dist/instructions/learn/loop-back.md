LOOP BACK — engine-evaluated repetition
════════════════════════════════════════

WHAT: an optional per-step block that repeats an earlier slice of the
workflow. Repetition is ENGINE-OWNED control flow: the engine evaluates
the conditions, resets the looped steps, and moves the cursor — the
orchestrator only obeys the returned action. Typical use: test cycles
(design-scenario → execute → report, until no scenarios remain).

SYNTAX (declared on the LAST step of the cycle):

  - name: report
    goal: "..."
    loop_back:
      to: design-scenario      # this step or an EARLIER one (backward only;
                               #   to: <same step> = conscious self-redo)
      max_iterations: 20       # REQUIRED. Hard engine budget (anti-runaway).
                               #   LITERAL integer — {param} is NOT resolved here.
      when:                    # ≥1 key required. Navigation, NOT quality gates.
        script: "python .riglane/workflows/templates/my_workflows/<wf>/scripts/has_more.py"
        semantic: "Are there uncovered scenarios left?"
        human: true

WHEN IT RUNS: inside step_complete, ONLY after the full gate pass and
param_bindings. A failed step never evaluates its loop_back.

DECIDERS — AND with short-circuit: to LOOP, every configured decider must
say loop; evaluation stops at the FIRST "proceed" (then the workflow moves on):
  • script   — engine runs it via the shell (PROJECT ROOT cwd, 60s timeout); any
               interpreter — node x.js / bash x.sh / python x.py. Because cwd is
               the project root, reference the script by its FULL root-relative
               path (e.g. .riglane/workflows/templates/my_workflows/<wf>/scripts/x.py)
               — a bare "scripts/x.py" will NOT resolve.
               $RIGLANE_RUN_DIR is injected = this run's dir; read inputs from
               $RIGLANE_RUN_DIR/data/... (run-identity: per-run, parallel-safe).
               Contract: exit 0 + stdout {"loop": true|false}. Any error →
               STOP_WORKFLOW (surface to user; never fabricate a decision).
  • semantic — condition text the orchestrator LLM evaluates against the
               step outputs, on engine assignment. POLARITY: TRUE = one
               more pass (the mirror of the script contract {"loop": true}).
               Phrase it as "is there more to do?" — NEVER as "is the result
               good?" (that inverts: a good result would then loop until
               the budget stops it).
  • human    — the user decides; the orchestrator relays the question.
               when.human_channel: external|both delivers it through the run
               inbox (durable Q&A record; choices carry loop|proceed) —
               workflow_learn(topic="inbox").
  Evaluation order: script → semantic → human (cheap → expensive).
  The decider is NOT a step and NOT a tools: entry — the ENGINE runs
  when.script itself. Do not author a separate "check"/"decide" step (a
  wasted subagent spawn that may re-run the script), and do not declare
  the decider under tools: (no init-workflow/restart follow-ups apply).

FEEDBACK ACROSS PASSES: nothing carries into the next pass by itself.
Thread it MECHANICALLY: the deciding step WRITES the feedback to a
declared output (e.g. data/feedback.md) and the looped steps declare it
as an input (file_if_exists covers pass 1) — or pipe a single value via
param_bindings. A goal saying "incorporate the feedback" with no such
wiring reads nothing, every pass.

ORCHESTRATOR PROTOCOL (step_complete responses):
  action: "LOOP_BACK"              → engine already reset statuses of
    [to..this] and moved the cursor. The response normally carries
    next_begin — the target's FULL begin payload: drive from it, do NOT
    call step_begin (without a payload: step_begin(next_step)). Do NOT
    finalize; do NOT treat as an error.
  action: "AWAITING_LOOP_DECISION" → engine needs the LLM/human judgment
    it cannot produce itself. Follow engine_instructions, then call
    step_complete AGAIN with loop_decision: "loop"|"proceed" and a short
    loop_rationale. The script verdict is cached — NOT re-executed on the
    re-call. The cursor has NOT moved; do not call step_begin in between.
  Budget exhausted (iterations == max_iterations) → normal proceed; the
    audit trail records decided_by: budget_exhausted.
  Every decision lands in manifest.steps[<step>].loop_state (iterations,
  last_decision, last_decided_by, last_rationale).

ITERATION DATA FLOW:
  Default: paths re-resolve each iteration and files OVERWRITE
  (current-state dataflow — the next iteration reads the fresh files).
  Distinct per-iteration files are opt-in PER OUTPUT:

    outputs:
      - { path: data/report.json, per_iteration: true }
        # engine injects the counter at load:
        #   data/report.json → data/report_{iteration}.json
        # 0-based: the first pass writes report_0.json, then report_1.json…
      - path: data/scenario.json          # overwritten each iteration
    inputs:
      - path: data/report_*.json          # glob = accumulated history

  Under the hood: synthetic {iteration} param (0-based, engine-managed
  like run_id; injected at workflow_init for loop workflows, incremented
  on every LOOP_BACK). Power users may write the {iteration} placeholder
  by hand for custom positions (iter_{iteration}/report.json).
  With SEVERAL loops, {iteration} is resolved PER STEP at step_begin: it
  is the counter of the innermost loop whose range contains that step, so
  a second loop starts its files at _0 again instead of continuing the
  numbering of the first loop. A step outside every range keeps the last
  counter (read accumulated history with a glob instead).

  Loop steps may freely overwrite files created BEFORE the loop (e.g. a
  plan/progress file from a setup step) — inputs re-resolve fresh at every
  step_begin; nothing is cached across iterations.

VALIDATION (load-time, part of fullValidateWorkflow):
  • loop_back.to must exist and be this step or an EARLIER one.
  • Loop range [to..step] may contain only plain regular steps
    (no parallel / delegate_to / type: planning) — v1.
  • MANY loop_back blocks per sequence are allowed — their step ranges
    must be properly NESTED or DISJOINT (like blocks in a structured
    language). A PARTIAL overlap is refused: with [a..c] and [b..e] the
    inner loop would return outside the loop that is mid-flight, leaving
    {iteration} undefined. A nested loop gets a FRESH budget on every
    pass of the loop containing it, and {iteration} always means the
    INNERMOST loop the step belongs to (a step after every loop keeps
    the last count, unchanged). A loop targets only its own sequence
    (main loops within main; a route loops within that route).
  • A `routes` block inside a loop range is allowed ONLY on that range's
    OWNING (last) step — it fires once, on the final proceed. Any step
    STRICTLY inside a range is refused, INCLUDING the owner of a nested
    loop (its routes would re-fire on every outer pass).
  • per_iteration / {iteration} in a workflow WITHOUT loop_back → error
    (the counter never exists; a stray placeholder would silently
    degrade to a * glob during validation).
  • Do NOT declare a user param named "iteration" in a loop workflow.

STEP-ORDER NOTE: step_begin accepts ONLY the manifest cursor step —
forward skips, backward re-runs, and completed re-begins are refused
(BLOCKED_OUT_OF_ORDER with a corrective directive). loop_back is the
sanctioned way to repeat; orchestrator-initiated repetition is not.

RELATED: workflow_learn(topic="step-fields") — syntax skeleton;
  topic="workflow-fields" — the workflow-level fields this file needs
    around the steps (name, version as an INTEGER, description, params);
  topic="outputs" — per_iteration field; topic="gate" — quality gates
  (evaluated BEFORE loop_back; independent axes); topic="routes" — the
  FORWARD sibling (conditional branching).
