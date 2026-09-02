---
used-by: src/engine/workflow-engine.ts
placeholders: stepTemplateName, resolvedGoal, attempts, maxPlanAttempts, remaining, maxSubsteps, parallelClause, delegationClause
---
═══════════════════════════════════════════════════════════════
PLANNING STEP PROCEDURE — follow these steps in order, verbatim
═══════════════════════════════════════════════════════════════

Goal: {{resolvedGoal}}
Step template: {{stepTemplateName}}
Plan-draft attempts used: {{attempts}}/{{maxPlanAttempts}} ({{remaining}} remaining)

── Step 0: Consult prior notes ────────────────────────────────
CALL: agent_notes_search(step_template="{{stepTemplateName}}",
                          tags=<keywords extracted from goal>)
READ the top matches (up to 3) using the Read tool before drafting.
Notes with status=success and confidence=high/medium are returned by
default; pass explicit filters if you need failed/experimental/low.
Prior notes are REFERENCE — read them to learn what worked, what failed,
and pitfalls to avoid. They reflect a PAST goal that may differ from yours;
they are NOT a template to copy, and a referenced prior workflow is NOT a
default to re-invoke. You plan independently in Step 1, then reuse only
what genuinely fits.

── Step 1: Plan actions, then draft child workflow YAML ───────

FIRST: Plan your actions as a numbered list — what do you need to
do, in what order? Think about the GOAL, not about workflow syntax.
Do this independently EVEN IF Step 0 surfaced a prior note or workflow —
analyze THIS goal + THIS run's inputs first; reuse second.

NEXT: If Step 0 found a prior approach, compare it to your plan. Adopt a
prior structure ONLY if its steps genuinely fit your situation (same goal
shape, same inputs/outputs); otherwise adapt it or draft fresh. Do NOT
re-invoke or copy a prior workflow just because it exists.

THEN: Map each action to a workflow step using this guide:

  Step types (pick one per action):
    Step names: kebab-case (e.g. analyze-code, write-tests). Unique within workflow.
    Regular step     { name, goal, outputs }
      → One subagent does one thing. Most common.
    Parallel step    { parallel: true, parallel_key: "manifest.items[*]" }
      → Same action repeated for many items. One subagent per item.
      → parallel_key is a JSONPath into a JSON file from a prior step
        (e.g. "scan-result.tasks[status=pending]" reads scan-result.json).
      → Items must be truly independent.
    Inline step      { subagent: false }
      → Orchestrator does it. Fast, no gate. For lightweight checks.

  Data flow between steps:
    inputs:                           # list of {path, inject}
      - path: data/report.json
        inject: "reference"           # subagent reads (preferred)
      - path: data/small.md
        inject: "file"                # content in prompt (<50K only)
    outputs:                          # list of {path, struct?}
      - path: data/result.json
        struct: result-schema         # references structs/result-schema.schema.yaml
      - path: data/summary.md         # no struct → freeform, no schema validation
    param_bindings: { p: "file.json::field" }  # pipe step output → workflow param
    carry_forward: true               # boolean — pass prior step summaries

  Quality gates (per-step configurable):
    gate.structural: true — auto-validates output schema (default ON).
    spec_check: true      — opt into behavioral spec check (default false; set true on code-modifying steps).

  Experience tips:
    • 2-4 steps is the sweet spot. Each subagent costs time + context.
    • Declare outputs with struct when possible — catches errors early.
    • Goal text says WHAT. Outputs section says WHERE. Don't duplicate paths.

  Available workflows (for delegate_to): discover the installed set via
  workflow_learn(topic="predefined-workflows") — NEVER assume a name exists.

  For EXACT SYNTAX of any field, CALL: workflow_learn(topic="step-fields").
  Deeper topics: "parallel", "gate", "inputs", "outputs", "delegation",
  "param-bindings", "carry-forward". List all: workflow_learn(topic="overview").
  For WHEN to choose option A vs B (design tradeoffs, not syntax):
  workflow_learn(topic="design-choices").

Restrictions for this child workflow:
  - max {{maxSubsteps}} substeps (parent's max_substeps)
{{parallelClause}}
{{delegationClause}}
  - NO nested type: planning substeps (engine validator rejects)
  - NO top-level 'tools:' or 'params:' fields (forbidden)
  - struct: references must resolve to <parent_dir>/structs/<name>.schema.yaml
  - steps MUST be a YAML list:
      steps:
        - name: my-step        # ✓ correct (list)
          goal: "do something"
      NOT:
        steps:
          my-step:              # ✗ wrong (map) — engine rejects
            goal: "do something"
The generated workflow inherits this planning step's context; engine
will auto-inject _dynamic_origin, name, version, and description.

── Step 2: Validate the draft ─────────────────────────────────
CALL: workflow_validate_dynamic(
        parent_workflow=<this parent>,
        parent_step="{{stepTemplateName}}",
        workflow_yaml=<your drafted YAML>)
Iterate: on errors, re-draft and re-validate. The engine bumps the
attempts counter on each call regardless of outcome. After
{{maxPlanAttempts}} attempts, further calls return
BLOCKED_PLANNING_FAILURE — at that point you MUST stop and surface
the latest validation errors to the user. Do NOT keep guessing.

── Step 3: Commit + invoke the child run ──────────────────────
CALL: workflow_invoke_dynamic(
        parent_workflow=<this parent>,
        parent_step="{{stepTemplateName}}",
        workflow_yaml=<exactly the YAML you just validated>,
        inherit_params={<params to pass to child, if any>})
Engine writes workflow.yaml under .riglane/local/workflow_runs/<run_id>/dynamic/, initializes
the child manifest, and updates this planning step phase to "executing".
Engine re-validates defensively; if you pass different YAML, validation
errors return WITHOUT bumping attempts. Returns child_run_id,
child_workflow_path, child_runtime_dir, step_names.

── Step 4: Drive each substep ─────────────────────────────────
COMPOSITE DRIVING: the response you already hold normally carries the
next substep's FULL begin payload — workflow_invoke_dynamic returned
next_begin for the FIRST substep, and each step_complete_dynamic
returns next_begin for the following one. Drive from the payload; call
step_begin_dynamic ONLY when a response carried no payload.
For each substep (in order):
  a) Take the substep's begin payload from the PREVIOUS response
     (invoke / complete). Without one: CALL step_begin_dynamic(
             parent_workflow=<this parent>,
             parent_step="{{stepTemplateName}}",
             step=<substep name>)
  b) Spawn the subagent from the payload's spawn_prompt VERBATIM
     (subagent steps; an inline payload carries the blocks — do the
     work yourself)
  c) The payload's gate flags decide the collect question: both false →
     skip to (d) — step_complete_dynamic validates the verdict itself.
     Either flag true → CALL step_collect_result_dynamic(parent_workflow,
     parent_step, step):
     IF action = PROCEED: continue to (d)
     IF action = RETRY_STEP: re-spawn from retry_begin's spawn_prompt
       VERBATIM (its prompt file already ends with the retry feedback)
     IF action = STOP_WORKFLOW: surface to user and stop
  d) CALL: step_complete_dynamic(parent_workflow, parent_step, step, summary)

── Step 5: Finalize child run + reflect ───────────────────────
CALL: workflow_finalize_dynamic(parent_workflow, parent_step)
Engine bridges child terminal status to parent.planning.phase
('completed' or 'failed').

CALL: agent_notes_write(
        step_template="{{stepTemplateName}}",
        topic=<kebab-case summary>,
        status=<success|partial|failed|experimental>,
        confidence=<high|medium|low>,    # be honest!
        run_id=<this parent run_id>,
        body=<markdown — Goal/Approach/What worked/What didn't/Reference>)
Confidence honesty: high = validated across multiple cases; medium =
worked once on this case; low = incomplete or unsure. Future planning
runs will read your notes — don't lie to your future self.

── Step 5b: Evaluate outcome ─────────────────────────────────
Before completing, evaluate whether the GOAL was achieved:

  1. Did all substeps complete successfully?
  2. Read key output files — are the results correct and complete?
  3. Does the outcome match the planning step's original goal?

THREE POSSIBLE OUTCOMES:

  GOAL ACHIEVED, execution good:
    → Proceed to Step 6 (step_complete).

  GOAL ACHIEVED, but approach could be improved:
    → Proceed to Step 6. Include improvement notes in the summary.
      agent_notes (Step 5) should already describe what could be better.

  GOAL NOT ACHIEVED (results incomplete or incorrect):
    → Call workflow_replan_dynamic(parent_workflow, parent_step).
      This resets planning phase so you can draft a FIX workflow.
      Then go back to Step 1 and draft a targeted fix plan:
        - Focus ONLY on what failed or is missing.
        - Substeps are idempotent — correct files stay untouched.
        - Follow Steps 1-5 again (validate → invoke → drive → finalize).
        - Then return here (Step 5b) to re-evaluate.
      Keep a mental log of what worked vs failed across iterations.
      You will write all of this to agent_notes when finally successful.

── Step 6: Complete this planning step ────────────────────────
CALL: step_complete(
        name=<this parent workflow>,
        step="{{stepTemplateName}}",
        summary=<2-4 sentence summary — see guidance below>)
This advances the parent workflow past the planning step.

Summary MUST include:
  1. Whether Step 0 (agent_notes_search) found relevant prior notes
     — mention topic/count, or "no prior notes found"
  2. How many substeps were generated, executed, and their outcomes
     — e.g. "3 substeps, all passed" or "4 substeps, 1 required retry"
  3. Whether the overall goal was fully achieved, partially, or failed
  4. Any notable observations (idempotent run, unexpected findings, retries)

═══════════════════════════════════════════════════════════════
ANTI-PATTERNS — DO NOT do any of the following
═══════════════════════════════════════════════════════════════

✗ Skip Step 0 (notes search) because you think you already know the
  approach. Prior failures or partial successes change the calculus.
✗ Persist this procedure into any doc file. It is engine-generated
  fresh each time — there is no static copy to maintain.
✗ Paraphrase the tool calls or arguments above. The engine validates
  exact parameter names; paraphrased calls fail with cryptic errors.
✗ Draft a workflow with parallel/delegation substeps when the
  restrictions disallow them. Engine validator rejects loud.
✗ Re-validate with different YAML in Step 3 (workflow_invoke_dynamic).
  Engine catches drift between Step 2 and Step 3 inputs; on mismatch
  you must restart from Step 1 with the new draft.
✗ Continue planning after BLOCKED_PLANNING_FAILURE. The attempts
  budget is hard; the right move is to stop and surface to user.
✗ Write agent_notes with inflated confidence. A single happy-path run
  is NOT high confidence. A run on a new domain is at most medium.
✗ Skip Step 5 (notes + finalize). Without notes, the next planning
  attempt starts from scratch — your work does not compound.
✗ Directly edit manifest.json or trace.json files when engine state seems
  wrong (e.g. "phase stuck at validating", "child_run_id missing"). The
  engine is the ONLY authoritative writer of these files. A direct edit
  can corrupt downstream gate dispatch, file locking, retry counters, and
  trace reconstruction in non-obvious ways. If state appears inconsistent,
  surface the manifest content + tool response verbatim to the user and
  STOP. Engine bugs are reported via the user, not patched in place.
✗ Re-call workflow_validate_dynamic after workflow_invoke_dynamic has
  succeeded. The engine rejects this with BLOCKED_PLANNING_FAILURE —
  re-planning after commit requires finalizing the current run and
  starting fresh.

You MUST follow this procedure verbatim. Do not summarize, do not
rephrase. If a step seems unnecessary for your goal, surface that
judgment to the user — do not skip silently.
