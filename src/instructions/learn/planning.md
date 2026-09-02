PLANNING STEPS — dynamic substep generation
════════════════════════════════════════════

  - name: plan-refactor
    type: planning
    goal: "Refactor module X to improve testability"
    max_substeps: 4          # flat step fields — no nested restrictions: block
    max_plan_attempts: 2

HOW IT WORKS:
  1. step_begin returns engine_instructions (Steps 0-6 procedure).
  2. Orchestrator follows procedure verbatim (not a subagent).
  3. Step 0: Search agent_notes for prior experience (REFERENCE, not a
     template — a referenced prior workflow is NOT a default to re-invoke).
  4. Step 1: Plan actions for THIS goal independently → map to steps. Reuse a
     prior structure ONLY if it genuinely fits (same goal shape, inputs/outputs).
  5. Step 2: Validate draft via workflow_validate_dynamic.
  6. Step 3: Invoke child workflow via workflow_invoke_dynamic.
  7. Step 4: Drive each child substep FROM ITS PAYLOAD — invoke returns
     next_begin for the first substep, each complete_dynamic for the next
     (spawn from spawn_prompt; collect only per the gate flags;
     step_begin_dynamic only when a response carried no payload).
  8. Step 5: Finalize child + write agent_notes reflection.
  9. Step 6: Complete parent planning step with summary.

RESTRICTIONS (configurable per step):
  max_substeps: 4          # Max child steps engine will accept.
  max_plan_attempts: 2     # Max validation calls before BLOCKED.
  allow_parallel: false    # Can child workflow use parallel steps?
  allow_delegation: false  # Can child workflow use delegate_to?

CHILD WORKFLOW FORMAT:
  • Same YAML syntax as regular workflows (steps list, outputs, etc.).
  • NO top-level tools: or params: fields (inherited from parent).
  • struct: references resolve to parent workflow's structs/ dir.
  • Engine auto-injects name, version, description, _dynamic_origin.

TIPS:
  • Planning steps appear as purple cards in trace viewer.
  • carry_forward AFTER a planning step surfaces the PARENT step summary
    (the one you write at its step_complete, covering the child results) —
    not per-substep summaries; child data flows through its promoted files.
  • agent_notes compound across runs — future attempts benefit.
  • Prior notes/workflows are REFERENCE — analyze THIS goal first, reuse
    second; never copy/re-invoke a prior workflow just because it exists.
  • Start simple (2-3 linear substeps). Add complexity only if needed.

WHEN to use planning vs a static workflow shape (design tradeoff):
  workflow_learn(topic="design-choices")
