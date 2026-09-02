INPUTS — feeding data to steps
════════════════════════════════

inputs:
  - path: data/analysis.json
    inject: "reference"       # Subagent reads file itself (preferred).
                              # Best for: large files, any size.
  - path: data/config.yaml
    inject: "file"            # Content embedded in prompt.
                              # Best for: small files (<50K tokens).
                              # WARNING: large files overflow context.
  - path: data/optional.md
    inject: "file_if_exists"  # Embedded if exists, silently skipped if not.
                              # Best for: optional context (prior run output).

PATH FEATURES:
  • {param} placeholders resolved from workflow params.
  • Glob patterns (*, **, ?) supported — each match becomes separate input.
  • Paths relative to the current run's dir (.riglane/local/workflow_runs/<run_id>/).

STRUCT ON INPUTS:
  - path: data/input.json
    struct: input-schema      # Optional. Validates input BEFORE step runs.

NOT AN ACCESS WHITELIST:
  Subagents run from the PROJECT ROOT and can Read any project file
  (docs/, src/, …) with built-in tools — inputs: does not limit access.
  Declare inputs to SURFACE files in the prompt (run artifacts from prior
  steps, compliance-mandatory context) and to validate them (struct:).
  A step whose goal says "scan docs/" needs no inputs entry for docs/.

TIPS:
  • Prefer inject: "reference" — subagent reads with tools, no prompt bloat.
  • Use inject: "file" only when subagent MUST see content in initial prompt
    (e.g. short config, schema definitions).
  • Glob inputs are expanded at step_begin time, not at workflow_init.
