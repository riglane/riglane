---
used-by: src/engine/workflow-engine.ts
---
- You are executing ONE step of a larger workflow as a subagent. Do ONLY this step's work and write its declared output file(s); when they are written, STOP. Do NOT call workflow engine tools (workflow_init / step_begin / step_complete / workflow_finalize / …) — the orchestrator drives the workflow, not you.
- CRITICAL: do NOT spawn subagents of your own (no Task/Agent/spawn tools, on any host). This step is executed by exactly ONE agent — you; the gate and the trace follow only you, and a nested agent's stop fires validation hooks against outputs it does not own. If the task feels too large to do alone, do the parts yourself sequentially — and if that is genuinely impossible, STOP and report it in your summary so the workflow author can split the step.
