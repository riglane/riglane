OUTPUTS — declaring expected step results
══════════════════════════════════════════

outputs:
  - path: data/report.json
    struct: report-schema     # References structs/report-schema.schema.yaml.
                              # Gate validates JSON/YAML against schema.
  - path: data/summary.md    # No struct = freeform. Gate checks file exists only.

RESERVED NAMESPACE:
  • The run-root prompts/ directory is the engine's own (composed step
    prompt files live there). Author input/output paths must not enter it —
    workflow_validate rejects them. Put author files under data/.

STRUCT SCHEMAS:
  • Schema files live at: <workflow_dir>/structs/<name>.schema.yaml
  • Standard JSON Schema format (type: object, properties: ...).
  • Engine reads schema and includes it in subagent prompt.
  • Gate validates output against schema after step completes.

WRITE PROOF (detects "claimed-success but no actual write"):
  write_proof: "required"          # File MUST be written in this step (default).
  write_proof: "all_members_fresh" # All glob matches must be written (default for globs).
  write_proof: "any_member"        # At least one glob match written.
  write_proof: "off"               # Skip write-proof (file still must exist).

OPTIONAL OUTPUTS:
  - path: data/issues.json
    optional: true            # File may be absent — all checks skipped.
                              # Use for: conditional outputs (report only if issues found).

FROM_DELEGATED (delegation steps only — artifact handoff):
  - path: data/audit-report.json       # CONCRETE parent-side destination
    from_delegated: "data/{run_id}-audit-report.json"
                              # Source in the DELEGATED child run dir;
                              # {param} → CHILD params (incl. child run_id);
                              # glob allowed = exactly 1 match. The engine
                              # copies it at step_complete; validates like a
                              # normal output. workflow_learn(topic="delegation").

PER-ITERATION OUTPUTS (loop_back workflows only):
  - path: data/report.json
    per_iteration: true       # Engine injects the loop counter at load:
                              #   data/report.json → data/report_{iteration}.json
                              # → a DISTINCT file per loop iteration (0-based:
                              # first pass = report_0.json). Without it the
                              # file is overwritten each iteration.
                              # Error in workflows without loop_back.
                              # Details: workflow_learn(topic="loop-back").

VALIDATION AXES (independent — each has its own field):
  existence ← optional       # non-optional output MUST exist, always
  freshness ← write_proof    # was it written DURING this step?
  content   ← struct         # does it match the schema?

OUTPUT PATH PLACEHOLDERS — "concrete or fail-loud" (null-policy):
  An output path names ONE concrete file the gate then verifies. Placeholders
  resolve so the path stays concrete — a null value NEVER silently becomes a
  wildcard (that would hide a missing/mis-named output):
    {param} declared, has value  → the value.
    {param} declared, null/unset → "" — a whole directory segment then
                                   COLLAPSES (that folder vanishes); a fragment
                                   inside a filename leaves a literal gap. The
                                   path stays concrete → gate checks the exact file.
    {x} NOT a declared param     → ERROR at LOAD (riglane validate-workflow /
                                   workflow_validate). Undeclared = a typo, not a
                                   wildcard — declare it in params:, or write a
                                   literal * (below).
    literal * / **               → a real glob, kept as-is. This is the ONLY way
                                   to ask for a wildcard output (e.g. data/*.md).
    {parallel_key.<field>} / {}  → ERROR in a NON-parallel output (parallel-only
                                   namespaces; see topic "parallel").
  Wildcards are OPT-IN and EXPLICIT — you write * yourself. Same rule for
  parallel and non-parallel outputs, so one mental model covers both. (A
  {param} whose VALUE contains * ? [ or a path separator is rejected too — the
  value must be a single concrete name.)

RUNTIME LOCATION (run-identity — parallel-safe paths):
  • A RELATIVE path (data/report.json) resolves into THIS run's isolated
    dir: .riglane/local/workflow_runs/<run_id>/data/report.json. Prefer these —
    parallel runs of the same workflow never collide.
  • An ABSOLUTE / project-root path (e.g. .riglane/...) is taken VERBATIM and is
    NOT run-scoped → parallel runs of the same workflow clobber each other.
    If you must write to a fixed location, put the {run_id} param in the
    path (e.g. .riglane/local/workflow_runs/{run_id}/data/x.json) to stay isolated.

TIPS:
  • Always declare struct when step produces structured data.
    Without it, gate only checks file existence — content errors compound.
  • Goal text says WHAT to produce. Outputs section says WHERE.
    Don't duplicate paths in goal — engine manages paths + branch isolation.
  • For parallel steps the engine resolves each branch's path to a CONCRETE
    location: per-branch identity via {parallel_key.<field>} (NOT a {param} —
    that is one value for all branches → collision); {} = an explicit branch
    index slot; a bare glob (data/x/*.md) lets the engine isolate + merge flat.
    NEVER write a literal _branch_*. Full rules: workflow_learn(topic="parallel").
