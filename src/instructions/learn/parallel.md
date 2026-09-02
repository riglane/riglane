PARALLEL STEPS — fan-out across items
═════════════════════════════════════

  - name: audit-files
    parallel: true
    parallel_key: "scan-result.tasks[status=pending]"

HOW IT WORKS:
  1. Engine reads parallel_key → resolves list of items from a JSON file.
  2. Writes one prompt file per branch: prompts/<step>/branch_N.md.
  3. Returns branch metadata to orchestrator.
  4. Orchestrator spawns one subagent per branch.
  5. Engine resolves EACH branch's output path to a CONCRETE location
     (see OUTPUT PATHS below) and hands it to that branch's subagent.
  6. Gate validates each branch's resolved paths; step_complete strips any
     isolation scaffold, leaving files at their final (semantic) location.

PARALLEL_KEY SYNTAX:
  "manifest.tasks"                     — all items in .tasks array
  "manifest.tasks[*]"                  — same, the explicit spelling
  "manifest.tasks[status=pending]"     — filtered by field value
  "scan-result.files[*]"              — items from the scan-result STRUCT
  Navigation is DOTS-ONLY; brackets exist only as those two terminal
  suffixes. Index access ("tasks[0]") or other JSONPath spellings are a
  LOAD error — the syntax is validated at load, not discovered mid-run.

  The struct-name prefix (before the dot) matches a prior step's output:
    Step 1 outputs: { path: "data/scan-result.json", struct: scan-result }
    Step 2: parallel_key: "scan-result.tasks[*]"  ← engine finds the file
  The prefix is the STRUCT name — not a step name, not a file basename.
  Resolution order: a prior output declaring that struct wins (its path,
  wherever it is); only with no struct match does the engine fall back to
  the convention data/<prefix>.json.

OUTPUT PATHS IN A PARALLEL STEP (engine-filled, per branch):
  The engine resolves each branch's output path to a CONCRETE location and
  hands it to the subagent — the subagent writes EXACTLY there and never
  fills in a placeholder itself. Placeholders you may use in the path:

    {param}                — a workflow param: SAME value for every branch.
                             null/unset → '' (a whole directory segment then
                             collapses = the folder disappears; a filename
                             fragment leaves a literal gap).
    {parallel_key.<field>} — THE per-branch value: field <field> of THIS
                             branch's parallel_key item. This is how you give
                             each branch its own path/name. Different per
                             branch. Must be a non-empty scalar (else error).
    {parallel_key}         — the whole item, when items are scalars (["a","b"]).
    {}                     — explicit branch-index slot → the engine's
                             isolation dir (_branch_N), stripped at merge.
    * / **                 — a glob YOU fill with your own filenames.
    {x} (anything else)    — LOAD ERROR (not a param, not parallel_key).
                             Catches typos; no silent fallback.

PER-BRANCH ORGANIZATION — pick the shape you want:
  • Per-domain subfolders (stays, no merge — the name isolates):
      outputs: [ { path: "data/drafts/{parallel_key.name}/*.md" } ]
      → branch "ui" writes data/drafts/ui/…, branch "recovery" → data/drafts/recovery/…
  • Distinct filenames, flat:
      outputs: [ { path: "data/reviews/{run_id}-{parallel_key.name}-result.json" } ]
      → data/reviews/<run_id>-<name>-result.json per branch.
  • Don't care, just isolate (engine adds _branch_N, merges flat):
      outputs: [ { path: "data/drafts/*.md" } ]
      → YOU must give distinct filenames (the * glob), else branches collide.

KEY RULE: per-branch identity comes from {parallel_key.<field>} (engine fills
it from the item) — NEVER from a {param} (one value → all branches resolve the
SAME path → collision → the engine errors), and NEVER a placeholder the
subagent fills. The engine owns the path; the subagent only invents filenames
inside a * glob. MERGE strips only the engine's _branch_N scaffold; {param}
and {parallel_key.…} segments are permanent. NEVER write a literal _branch_*.

BRANCH PROFILES — per-branch rights (STATIC, authored):
  branch_profiles:               # parallel steps only
    backend:  { tools: [run_tests], struct: backend-report }
    frontend: { tools: [ui_diff] }
  • A parallel_key item SELECTS its profile: its `profile` field, else its
    `name` field. With profiles declared, EVERY item must resolve to one —
    a miss fails loud at branch resolution (never a silent union grant).
  • tools — the profile subset. MUST be ⊆ the step's own tools: (load
    error otherwise): the step list is the UNION the workflow_tools server
    enforces — branch identity never reaches the tool call, so the server
    cannot enforce narrower (a stated seam). The branch's PROMPT documents
    only its subset, and the per-profile agent artifacts carry the
    construction half on agent-file hosts.
  • struct — replaces the step's struct-bearing output schema for this
    profile's branches (requires EXACTLY ONE struct-bearing output; the
    schema file must exist). Enforced per branch by the gate on all hosts.
  • WHY static profiles, not per-item runtime data: only authored profiles
    can be enforced by construction (generated agent artifacts); runtime
    subsets could only ever be prompt text. The item picks WHICH profile
    runs — it never defines one.
  • On agent-file hosts, init-workflow generates ONE EXTRA agent file per
    profile, named `<wf>-<step>--<profile>`, whose whitelist is the subset
    and whose validator hook carries --profile (the frozen verdict then
    judges against `<step>::<profile>`). The engine spawns the per-profile
    agent for a profiled branch when the file exists; a missing file falls
    back to the step-level agent WITH A WARNING (prompt still narrows).
    Regenerate agent files + restart the host after changing profiles.
  Use when branches are heterogeneous (each needs its own tools/schema —
  e.g. one branch per subsystem, each with its own fetchers and report
  schema). Homogeneous fan-out needs none.

carry_forward on a parallel step yields ONE step summary (written at
step_complete, after the merge) — NOT one per branch; per-branch data must
flow through output files.

SPAWN THROTTLING (cost optimization):
  parallel_spawn_delay_ms: 5000   # Delay between first and subsequent spawns.
  • First subagent populates prompt cache; others reuse it (~3× cost savings).
  • Recommended for ≥5 branches with ≥50K token prompts.
  • Can be set per-step or at workflow level.

TIPS:
  • Items MUST be independent. If branch B depends on branch A → use sequential.
  • Parallel adds overhead: N × spawn time. For 2-3 items, sequential may be faster.
  • A prior step must produce the JSON file that parallel_key reads from.
  • Filter normalization: step_complete normalizes filter field values to prevent
    LLM subagents from breaking parallel resolution (e.g. status: "completed"
    instead of "pending").

WHEN to use parallel vs sequential (design tradeoff, not just syntax):
  workflow_learn(topic="design-choices")
