---
used-by: src/engine/spec-tools.ts
---
**DRY-RUN step (spec_authoring: validate):** call spec_write ONLY with dry_run:true.
This step previews validation + dedup and persists NOTHING — the engine REJECTS a
persisting spec_write call during this step. Write your findings to the step's
declared report output, never under .riglane/specs/.
