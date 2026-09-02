DELEGATION — reusing workflows as steps
════════════════════════════════════════

  - name: analyze-component
    delegate_to: delegation-demo-target
    subagent: false              # REQUIRED for delegation
    params:
      component: "{component}"   # Resolved from parent workflow params
    param_bindings:
      verdict: "data/analysis.json::verdict"   # SCALAR from the CHILD's run dir
    outputs:
      - path: data/analysis-details.md              # FILE from the child (handoff)
        from_delegated: "data/{run_id}-details.md"  # source in the CHILD run dir

HOW IT WORKS:
  1. Orchestrator reads delegate_to, finds the target workflow.
  2. Orchestrator runs target workflow DIRECTLY (not as subagent).
  3. Target gets its own manifest, trace, and gate config — in its own run
     dir (under the current run tree), not a separate .riglane/workflows/<name>/.
  4. When target completes, control returns to parent: call step_complete
     on the delegation step and include delegated_run_id: <the child's
     run_id from its workflow_init> — the engine resolves the child run
     deterministically (it also auto-links the child init in-process, so
     omitting it is tolerated but not preferred).
  5. param_bindings read SCALARS from the child's run dir; from_delegated
     outputs collect FILES from it (ARTIFACT HANDOFF below).

ARTIFACT HANDOFF (from_delegated — files OUT of the child):
  The child's files live in ITS OWN run dir whose name contains a dynamic
  run id — a later parent step cannot declare them statically, and hunting
  for them (globs over workflow_runs/, prose "find the report") reads a
  SIBLING run's artifacts under parallel runs. Declare the handoff ON the
  delegation step as an output instead:
    outputs:
      - path: data/audit-report.json               # CONCRETE parent-side dest
        from_delegated: "data/{run_id}-audit-report.json"
        struct: audit-report                        # validated after the copy
  • {param} in the source resolves against the CHILD params (incl. its
    synthetic run_id). A glob is allowed but must match EXACTLY ONE file.
  • The engine copies the match at step_complete BEFORE validating outputs
    — the handoff file then validates like any normal output (existence +
    struct; write_proof does not apply: the engine's copy IS the write).
  • Missing source / multi-match → the step fails (FIX_AND_RETRY);
    optional: true skips a missing source instead.
  • Later steps declare the STATIC parent path as a plain input.
  • The child's steps are embedded in the parent trace as an amber block
    (single-trace view); the delegated run keeps its own trace too.

RULES:
  • subagent: false is MANDATORY — delegation is always orchestrator-driven.
  • Max depth-1: A→B OK, A→B→C prohibited. Hard-enforced by the engine only
    inside planning-drafted children (allow_delegation flag); for static
    workflows it is a binding authoring rule — the engine does NOT resolve
    the target at load to reject A→B→C. Do not rely on a load-time error.
  • Circular delegation (A→B→A): the orchestrator checks its execution
    stack before workflow_init of the target and aborts (procedural check
    from the run-workflow procedure, not an engine guard).
  • Target uses its OWN gate config — parent gate NOT inherited.
  • A delegation step needs NO goal and NO outputs — delegate_to alone is
    valid (goal is optional, for skip-conditions; outputs belong to the
    child workflow's own steps).

GOAL + DELEGATE_TO COEXISTENCE:
  - name: maybe-analyze
    goal: "IF the analyze param is false: skip. OTHERWISE: delegate."
    delegate_to: delegation-demo-target
    subagent: false
  Orchestrator evaluates goal conditions first, then decides whether to delegate.

PARAM INTERPOLATION:
  • {param} placeholders in params: block resolve from parent's current params.
  • Includes values updated by param_bindings from earlier steps.

IMPORTANT — params vs param_bindings vs from_delegated:
  params:          — pass values TO the delegated workflow (delegation-specific).
  param_bindings:  — read SCALAR values FROM step outputs INTO workflow params.
  from_delegated:  — collect FILES from the delegated child's run dir (handoff).
  These are DIFFERENT fields. Do NOT use param_bindings to pass scope/params to delegation,
  and do NOT bind a file PATH as a param — collect the file itself with from_delegated.
  On a delegation step, param_bindings paths resolve in the DELEGATED child's
  run dir — that is how child results flow back to the parent.

LIVE REFERENCE EXAMPLE:
  examples/delegation-demo + examples/delegation-demo-target — a minimal
  A→B pair (tutorial header inside): params INTO the child, verdict OUT via
  param_bindings, the child's dynamically-named details file OUT via
  from_delegated, inline synthesis after. Run: /riglane-run-workflow delegation-demo
  Target contract: takes component (required param) → writes
  data/analysis.json {component, verdict: pass|fail, note} +
  data/{run_id}-details.md.

TIPS:
  • Use delegation to avoid duplicating step sequences across workflows.
  • Common targets: spec-audit, doc-spec-extraction, registry-sync — or any
    workflow of your own in my_workflows/.
  • Delegation steps show as amber cards in trace viewer.

WHEN to delegate vs write a custom inline step (design tradeoff):
  workflow_learn(topic="design-choices")
