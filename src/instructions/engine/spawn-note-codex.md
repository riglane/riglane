---
used-by: src/engine/workflow-engine.ts
---
CODEX SPAWN LIFECYCLE: after a worker finishes (its `wait` returns and you have its result), call `close_agent` on that worker before spawning the next step. Codex caps concurrent spawned agents at `agents.max_threads` (default 6) and does NOT free a slot on completion — only `close_agent` does. Closing finished workers as you go prevents a mid-run "agent thread limit reached" failure on long/looping workflows.
