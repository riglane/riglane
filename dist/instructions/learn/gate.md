GATE CONFIGURATION — quality validation between steps
════════════════════════════════════════════════════

Three layers, independently configurable:

  structural (default: true)
    • File existence + JSON schema compliance.
    • Deterministic, fast, always recommended.
    • Runs via gate-check script (hard enforcement).
    • Inline (subagent: false) steps skip the gate hook, but their
      declared outputs are still validated at step_complete.
    • structural: false disables ALL of it — hook, engine-inline gate
      AND the step_complete safety net honor the same flag, so the
      opt-out behaves identically on every host.

  semantic (default: false)
    • LLM evaluates completeness and correctness.
    • Slow, costly. Use for content quality checks.

  human (default: false)
    • Orchestrator asks user for approval.
    • Use for critical, irreversible steps.
    • human_channel: terminal (default) | external | both — WHERE the question
      is delivered. With external|both the question and the answer become
      durable engine artifacts and step_complete REFUSES without a fresh
      recorded response (AWAITING_HUMAN_RESPONSE) — the approval is
      verified, not taken on faith. Full flow: workflow_learn(topic="inbox").
    • CONDITIONAL: `human: {script: "<command>"}` — the engine runs the
      command at gate time (after the step's outputs exist, so it can
      inspect them) and it must print {"human": true|false} to stdout;
      true means THIS run of the step needs approval. Same decider
      contract as loop_back/routes when.script: run from the project
      root, $RIGLANE_RUN_DIR injected, non-zero exit or malformed output
      stops the workflow. The verdict is evaluated once per step per run
      and recorded in the manifest (human_gate_verdict) — resume, the
      gate hook and step_complete all read the same answer. step_begin
      announces such a gate as human: "conditional"; the actual verdict
      arrives with step_collect_result's needs_human_gate. A conditional
      gate inherited by a delegated child counts as human: true (the
      script belongs to the parent step's own gate pass).

TWO RETRY MECHANISMS:

  max_gate_retries (default: 5)
    Gate-hook loops WITHIN one subagent session.
    Subagent gets feedback ("missing field X") and fixes in-place.
    Preserves context — most efficient retry.

  max_step_retries (default: 3)
    Orchestrator re-spawns a NEW subagent with fresh context.
    Used when subagent fundamentally can't self-correct.
    Carries failure feedback from previous attempt.

PER-STEP OVERRIDE:
  gate:                     # workflow-level default
    structural: true
    max_gate_retries: 5

  steps:
    - name: critical-step
      gate:
        human: true          # require approval for this step
        max_step_retries: 1  # one chance, then STOP

PARTIAL FAILURE (parallel steps):
  allow_partial_step_complete: false   # Default: block on any branch failure.
  • Set true only when partial completion is intentional.
  • Hard rule (no override): all-branches-failed always blocks.

GATES ARE PER-STEP CONFIG, NOT STEPS: do not author a "quality-check" /
"validation" step that merely re-reads another step's outputs — declare
semantic (or human) gate ON the producing step instead. (A separate
VERIFY step is legitimate only when it does real independent work and
declares its own outputs — see spec-audit.)
SCOPE on an inline step (subagent: false) — the two halves differ, so read
both before assuming a gate is decoration (lint warns: inline-agent-gate):
  • semantic — INERT. There is no gate hook and no in-session retry loop.
  • human    — terminal channel: inert in the same way. But with
    human_channel external|both it is FULLY LIVE: step_begin/collect deliver
    the protocol and step_complete REFUSES the step until a fresh recorded
    answer exists (the enforcement is in the engine, not in the hook). An
    inline step with an external human gate WILL block the run until the
    user answers — that is not decoration.

WHEN to enable semantic gate vs leave structural-only (design tradeoff):
  workflow_learn(topic="design-choices")
