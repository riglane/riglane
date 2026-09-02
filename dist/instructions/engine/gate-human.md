---
used-by: src/engine/workflow-engine.ts
---
HUMAN GATE — user approval required BEFORE step_complete:
Present the step outputs to the USER and wait for explicit approval.
On approval → call step_complete.
On rejection/corrections → re-spawn THIS step (step_begin is legal on the
cursor step) with the user's feedback embedded in the fresh subagent's task;
do NOT edit the step's outputs yourself and do NOT
call step_complete before the user approves.
