LANES — parallel execution lanes with a join barrier (engine-owned)
════════════════════════════════════════════════════════════════════

WHAT: an optional per-step block that, after the step finishes, starts
SEVERAL named lanes of steps CONCURRENTLY and rejoins them at an
engine-owned join barrier. A lane is a full linear workflow segment:
loop_back, routes, planning, parallel fan-out, delegation and
param_bindings all work inside it, scoped to the lane. Like loop_back
and routes, the fork and the join are ENGINE-OWNED control flow: the
engine registers the lane steps, admits each lane's next step
concurrently, and returns the cursor past the fork only when every lane
is terminal — the orchestrator only obeys the returned actions.

NOT to be confused with:
  • routes    — ALTERNATIVE paths: the engine picks ONE. Lanes are
                SIMULTANEOUS: all of them always run (there is no when).
  • parallel  — fan-out of ONE step over N data items (same goal each).
                Lanes are N DIFFERENT step sequences running at once.
  • delegation— runs another workflow. Lane steps are ordinary steps in
                THIS run/manifest/trace.

SYNTAX (declared on the step AFTER which the fork happens):

  - name: gather
    goal: "Prepare the lane inputs"
    lanes:
      define:                      # ≥2 lanes; each runs concurrently.
        - id: research             # globally unique (shared namespace
                                   #   with route ids; not "proceed").
                                   # The fork step may be the FIRST step
                                   #   of the workflow.
          steps:
            - name: fetch-data
              goal: "..."
              outputs: [ { path: data/research.json } ]
        - id: review
          steps:
            - name: audit
              goal: "..."
              outputs: [ { path: data/review.json } ]
      join:
        require: all               # all (default) | any

  - name: synthesize               # the "join logic" = an ORDINARY step
    goal: "Merge the lane reports"
    inputs:                        # lane outputs land in the SHARED run
      - { path: data/research.json, inject: reference }   # dir — read
      - { path: data/review.json, inject: reference }     # them directly
    outputs: [ { path: data/final.json, struct: final } ]

THE JOIN IS NOT A STEP. The barrier + policy + collection are the
engine's; everything an author wants to DO at the join belongs to the
first ordinary step after the block: a merge script is that step's
tools: entry, an LLM judgment is its gate.semantic, a human approval is
its gate.human, follow-up branching is its routes. That step is also
OPTIONAL — lanes that end independent work need nothing after the block.
Three usage tiers, no new mechanisms:
  1. Nothing after the fork — later steps read lane outputs directly
     (or read the collection index, below).
  2. An ordinary next step (subagent OR inline) with a struct: schema —
     the AGENT builds the combined output; the gate enforces the schema.
  3. The same step + tools: [merge_script] — deterministic merging.

WHEN IT RUNS: inside step_complete, AFTER the full gate pass and after
loop_back (if any) resolves to proceed. `routes` and `lanes` on the SAME
step is a LOAD error (they move the cursor in incompatible ways) — nest
one inside the other instead.

ORCHESTRATOR PROTOCOL (actions you will see):
  action: "ENTER_LANES"      → the engine registered every lane and
    returned the {lane → first step} map. Drive ALL lanes concurrently.
    The response normally carries lanes_begin — ONE full begin payload
    per lane id: compose each lane's task from its payload (no
    step_begin) and spawn the independent lane subagents IN ONE MESSAGE
    where the host allows it. A lane absent from lanes_begin is driven
    via step_begin as usual.
  action: "LANE_WAIT"        → this lane finished, siblings are live.
    The result lists them (lanes_running) — keep driving them. Do NOT
    finalize, do NOT retry the call.
  action: "BLOCKED_LANES_ACTIVE" (on step_begin) → the requested step is
    not any live lane's next step. The refusal lists the live lanes and
    each one's next step — drive those.
  lanes_exit on the LAST completing call → the barrier passed: verdicts
    per lane, the cursor is already on the step after the fork, and the
    engine wrote data/<fork-step>-join.json — the collection index
    {require, lanes: {id: {verdict, outputs: [paths]}}} (engine-written;
    write_proof does not apply to it).
  action: "BLOCKED_LANES_FAILED" → the join policy refused (see FAILURE
    below).

THE BARRIER NEVER FINISHES EARLY. There is no way to cancel live
subagents, so the barrier ALWAYS waits for every lane to reach a
terminal state — under BOTH policies. `require: any` is NOT a wall-clock
optimization; it only changes the VERDICT once everyone is terminal:
  require: all (default) — every lane must complete; any failed lane
    blocks (action BLOCKED_LANES_FAILED): report to the user; re-drive
    the failed lane by beginning its parked step (a successful pass
    re-evaluates the barrier), or abort.
  require: any — proceeds when ≥1 lane completed; the next step sees
    which lanes failed in lanes_exit and the join index. ALL lanes
    failed always blocks (no override).

DATA RULES (load-time validated):
  • Lane step names are globally unique (one namespace with main steps).
  • Sibling lanes' declared OUTPUT PATHS must be disjoint — lanes write
    into the SHARED run dir concurrently; a collision would mean a
    nondeterministic winner. This disjointness is also why there is no
    from_lane copy mechanism: the files are already at their declared
    places (unlike delegation, where the child writes in its own run
    dir and from_delegated must copy).
  • Sibling lanes must not bind the SAME param via param_bindings
    (completion order would pick the survivor). Binding DIFFERENT params
    inside lanes is fine; binding on the step after the join is fine.
  • Reading a param that a SIBLING lane binds is timing-dependent — an
    advisory lint (lane-cross-param) flags it; prefer reading the
    sibling's output file after the join.
  • lanes inside a loop range: only on the range-owning (last) step —
    the fork then fires once, on the final proceed (same rule as routes).
  • Nested lanes (a fork inside a lane) are allowed — admission then
    follows the LEAVES of the fork tree.

TRACE: every lane step carries a permanent lane stamp (lane_id +
fork_step) on its manifest/trace card; lanes_enter / lanes_join events
mark the fork and the barrier.

RELATED: topic="routes" (the alternative-path sibling); topic="parallel"
  (data fan-out of one step); topic="design-choices" (when lanes vs
  parallel vs sequential); topic="step-fields" (syntax skeleton).
