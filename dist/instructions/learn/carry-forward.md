CARRY FORWARD — passing context between steps
══════════════════════════════════════════════

Workflow level:
  context:
    carry_forward: "summary"   # All steps see prior summaries (default: "none")

Step level (overrides workflow):
  - name: spec-do-high
    carry_forward: true        # Force summaries even if workflow says "none"
  - name: independent-step
    carry_forward: false       # Suppress even if workflow says "summary"

HOW IT WORKS:
  • After each step_complete, orchestrator writes summary to context/<step>.summary.md.
  • At next step_begin, engine reads all prior summaries and includes in subagent prompt.
  • Summaries are short (2-3 sentences) — written by subagent/orchestrator.

WHEN TO USE:
  • Step depends on prior step's findings (e.g. "implement what analysis found").
  • Sequential steps that build on each other.

WHEN NOT TO USE:
  • Independent steps (no dependency on prior context).
  • Large workflows (5+ steps) — accumulated summaries consume tokens.
  • Parallel steps (each branch is independent by design).

PARALLEL NOTE: a parallel step produces ONE step summary (written at
  step_complete, after the branch merge) — never one per branch.
  Per-branch data must flow through output files, not summaries.

TIP: param_bindings is more precise than carry_forward for passing specific
values. Use carry_forward for narrative context, param_bindings for data.
