---
used-by: src/engine/workflow-engine.ts
---
SEMANTIC GATE — evaluate planning step outcome:
1. Did ALL substeps complete successfully?
2. Is the overall GOAL fully achieved, or only partially?
3. Are the results correct and complete?

If goal ACHIEVED and execution was good:
  → Proceed to step_complete. Write a concise summary.
If goal ACHIEVED but workflow/approach could be improved:
  → Proceed to step_complete. Write a detailed summary noting
    what could be better. Record improvements in agent_notes_write
    so future planning runs benefit.
If goal NOT achieved (results incomplete or incorrect):
  → Call workflow_replan_dynamic(parent_workflow, parent_step).
    This resets planning phase so you can draft a FIX workflow.
    Then go through Steps 1-5 again with a targeted fix plan:
      Step 1: Draft a new workflow addressing ONLY the gaps.
      Steps 2-5: Validate → invoke → drive → finalize.
    Substeps are idempotent — existing correct files stay.
    Keep a mental log of what worked vs failed for agent_notes.
