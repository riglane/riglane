---
used-by: src/engine/workflow-engine.ts
placeholders: nodeVersion, py, otherPy, tmpdir
---
- Shell facts (for any shell commands you run): Node.js is available — the engine itself runs on it ({{nodeVersion}}). This platform's Python command is `{{py}}` (if it is missing or misbehaves, try `{{otherPy}}`; if neither works, report it in your summary — NEVER install anything). Scratch files go in `{{tmpdir}}` — do not hardcode a POSIX `/tmp` path.
