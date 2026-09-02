---
used-by: src/engine/workflow-engine.ts
---
GEMINI SPAWN: spawn the subagent via the invoke_agent tool — invoke_agent(agent_name=<the subagent_type from this envelope>, prompt=<the composed task prompt VERBATIM>). If the gate blocks the result, the block reason is the retry feedback: re-invoke the SAME agent_name with a NEW prompt carrying it (sessions cannot be resumed).
