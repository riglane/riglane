---
used-by: src/engine/workflow-engine.ts
---
**Constraints:**
- Write outputs ONLY to the specified paths.
- Do NOT modify files outside the output paths.
- NEVER modify engine/infrastructure files: `.riglane/scripts/`, `.riglane/tools/`, `.cursor/skills/`, `.cursor/rules/`, `.cursor/hooks.json`. These are read-only system files. If you encounter errors caused by these files, report the problem in your summary — do NOT attempt to fix them.
- When done, summarize what you did in 2-3 sentences.
