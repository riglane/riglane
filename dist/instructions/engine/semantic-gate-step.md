---
used-by: src/engine/workflow-engine.ts
---
SEMANTIC GATE — evaluate step outcome:
1. Read the output files produced by the subagent.
2. Does the output match the step's goal in quality and completeness?
3. Are there obvious errors, omissions, or incorrect content?

If output is satisfactory:
  → Proceed to step_complete.
If output is acceptable but imperfect:
  → Proceed to step_complete. Note issues in summary.
If output is clearly wrong or incomplete:
  → RETRY_STEP with feedback describing what needs to improve.
    The new subagent will overwrite outputs idempotently.
