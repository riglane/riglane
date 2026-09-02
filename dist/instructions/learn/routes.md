ROUTES — conditional forward routing (engine-owned)
════════════════════════════════════════════════════

WHAT: an optional per-step block that, after the step finishes, picks ONE
named route (or none) and runs that route's steps as ordinary steps IN THE
SAME RUN, then continues. Like loop_back, route selection is ENGINE-OWNED:
the engine evaluates the conditions, injects the chosen route's steps into
the live run, and moves the cursor — the orchestrator only obeys.

NOT to be confused with:
  • loop_back  — BACKWARD repetition, yields a BOOLEAN (loop?). routes go
                 FORWARD and yield a STRING (which route, or "proceed").
  • delegation — runs ANOTHER workflow (separate manifest/run). Route steps
                 are ordinary steps in THIS run/manifest/trace.
  • planning   — orchestrator DRAFTS steps at runtime. Routes are AUTHORED
                 up front in workflow.yaml; the engine just activates one.

SYNTAX (declared on the step AFTER which the choice is made):

  - name: triage
    goal: "Classify the issue and write data/triage.json"
    outputs: [ { path: data/triage.json, struct: triage } ]
    routes:
      when:                          # ≥1 key required. Yields a STRING.
        script: "python .riglane/workflows/templates/my_workflows/<wf>/scripts/pick_route.py"
        semantic: "Which path fits — hotfix or full review?"
        human: true
      define:                        # ≥1 route. Each runs as ordinary steps.
        - id: hotfix                 # globally unique; NOT "proceed".
          steps:
            - name: hotfix-patch
              goal: "..."
              outputs: [ ... ]
        - id: full_review
          steps:
            - name: deep-analyze
              goal: "..."

WHEN IT RUNS: inside step_complete, ONLY after the full gate pass AND after
loop_back (if any) resolves to proceed. A step may have BOTH loop_back and
routes — it loops until proceed, THEN routes.

DECIDERS (yield a route id or the reserved "proceed" = take none):
  • script   — engine executes it (shell, project root, 60s). $RIGLANE_RUN_DIR
               is injected = this run's dir; read inputs from
               $RIGLANE_RUN_DIR/data/... (per-run, parallel-safe). Contract:
               exit 0 + stdout {"route": "<id>"|"proceed"}. A non-string
               route, an unknown id, or any error → STOP_WORKFLOW.
  • semantic — condition text the orchestrator LLM evaluates → a route id
               or "proceed". Prefer script when a prior output already
               RECORDS the choice (a JSON field read should not cost a
               judgment); semantic when picking takes real judgment.
  • human    — the user picks; the orchestrator relays script+semantic as
               ADVICE. With human present, the USER is the final authority
               and may override script/semantic.
               when.human_channel: external|both delivers the question through
               the run inbox (choices carry the route ids + "proceed") —
               workflow_learn(topic="inbox").
  If the USER must have the final say on WHICH PATH is taken, that is
  when.human here — NOT gate.human on the step (a human gate approves the
  step's OUTPUT; only the route decider chooses the path).
  Order: script → semantic → human.
  COMBINATION: with human → human decides (override). Without human, when
  BOTH script and semantic are set they must AGREE on the same value;
  any disagreement → take NO route (proceed) + a user-facing note. A
  single decider decides alone.

ORCHESTRATOR PROTOCOL (step_complete responses):
  action: "ENTER_ROUTE"            → engine injected the route's steps and
    moved the cursor to the first one. The response normally carries
    next_begin — that step's FULL begin payload: drive from it, do NOT
    call step_begin (without a payload: step_begin(next_step)). Then run
    the route's steps in order. When the last completes the engine returns
    the cursor to the step after the routing step automatically.
  action: "AWAITING_ROUTE_DECISION" → engine needs the LLM/human judgment.
    Follow engine_instructions, then call step_complete AGAIN with
    route_decision: "<id>"|"proceed" and a short route_rationale. The script
    verdict is cached (not re-run). The cursor has NOT moved.
  No route taken (proceed) → normal next-step. If script/semantic disagreed,
    engine_instructions carry a note to relay to the user.
  When a route's LAST step completes the engine pops the route and returns
    the cursor automatically — the step_complete result carries route_exit
    {from, to} + engine_instructions explaining the return (it is normal
    control flow, not an error). You do NOT track the route stack — just
    obey the next_step the engine gives you.
  Decisions land in manifest.steps[<step>].route_state; each route step gets
  a permanent route stamp (route_id + owner_step) on its manifest/trace card.

AFTER A ROUTE: control returns to the step that follows the routing step in
the main flow (normal continuation), or the workflow ends if there is none.
Do NOT duplicate a common final step inside every route — steps that must
run regardless of the chosen route belong AFTER the routing step in the
main flow; the engine returns the cursor there automatically.

NESTING: a route step may be ANY step type, including its OWN routes block
(sub-routes) — the author owns the thread. The engine tracks the route stack
so the cursor descends into and returns out of nested routes correctly.

VALIDATION (load-time, part of fullValidateWorkflow):
  • route ids globally unique; an id may NOT be "proceed" (reserved).
  • route STEP names are globally unique (same namespace as main steps).
  • route steps are ordinary sequential steps — different routes MAY
    declare the SAME output path (only one route runs; downstream reads
    one place). No per-branch isolation here — that is parallel.
  • ≥1 when key; ≥1 route; ≥1 step per route.
  • a loop_back inside a route may target only steps in that SAME route
    (no cross-boundary jumps); many loops per sequence, nested or disjoint.
  • routes are NOT allowed inside orchestrator-drafted planning children.

STEP-ORDER NOTE: step_begin still accepts ONLY the manifest cursor step.
Route steps become beginnable only AFTER the engine selects their route
(ENTER_ROUTE); beginning a route step earlier → BLOCKED_OUT_OF_ORDER.

RELATED: workflow_learn(topic="loop-back") — the backward sibling;
  topic="step-fields" — syntax skeleton; topic="gate" — quality gates
  (evaluated BEFORE routes; independent).
