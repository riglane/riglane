STEP FIELDS — complete reference
════════════════════════════════

steps:                               # YAML list (NOT map)
  - name: kebab-case-name            # Required. Unique within workflow.
    goal: "What the subagent should do"  # Required. Read VERBATIM by a
                                      #   reasoning agent in a FRESH context:
                                      #   explain the task (intent + criteria),
                                      #   don't enumerate today's cases; keep it
                                      #   self-contained. Topic "goals".
    subagent: true                    # Default. false = orchestrator executes inline
                                      #   (no gate hook; declared outputs are still
                                      #   validated at step_complete unless
                                      #   structural: false).
    spec_check: false                 # Default (opt-in). true = respect behavioral
                                      #   specs on code-modifying steps.
    model: auto                       # Optional MODE (not a model name):
                                      #   inherit | auto (default) | lightest | strongest.

    # ── Parallel ──
    parallel: true                    # Fan-out mode.
    parallel_key: "manifest.items[*]" # Item list rooted at a STRUCT name
                                      #   (the struct of a prior output). Topic "parallel".
    parallel_spawn_delay_ms: 5000     # Cache optimization (ms between spawns).
    branch_profiles:                  # Optional. STATIC per-branch rights:
      backend:                        #   item selects a profile (its profile
        tools: [run_tests]            #   field, else its name). tools ⊆ the
        struct: backend-report        #   step's own tools:; struct replaces
      frontend:                       #   the struct-bearing output's schema
        tools: [ui_diff]              #   per branch. Topic "parallel".

    # ── Inputs ──
    inputs:
      - path: data/input.json         # File path ({param} placeholders OK).
        inject: "reference"           # "reference" | "file" | "file_if_exists"

    # ── Outputs ──
    outputs:
      - path: data/result.json
        struct: result-schema         # References structs/<name>.schema.yaml.
        write_proof: "required"       # "required" | "all_members_fresh" | "any_member" | "off"
        optional: false               # true = file may be absent without failure.

    # ── Native-surface narrowing ──
    deny: [shell]                     # Optional. Host-neutral capability ids this
                                      #   SUBAGENT step must NOT have (absent = full
                                      #   native surface, the default; this field only
                                      #   narrows). v1 vocabulary: shell. The engine
                                      #   owns the per-host tool names. Enforced via
                                      #   the generated per-step agent on agent-file
                                      #   hosts; instruction-only on Cursor/Codex (no
                                      #   per-step agent identity — a stated seam).
                                      #   NOT a sandbox: edit tools still write files,
                                      #   granted MCP tools still reach the network.
                                      #   Inert on inline steps (lint warns).

    # ── Data flow ──
    param_bindings:
      my_param: "data/out.json::field_name"  # Pipe value into workflow param.
    carry_forward: true               # Boolean. Pass prior step summaries.

    acknowledge_warnings: [no-outputs]  # Silence advisory lint warnings for THIS
                                      #   step. Ids come from the warning text
                                      #   (workflow_validate). Workflow-level
                                      #   field of the same name: workflow-fields.

    # ── Gate override ──
    gate:
      structural: true
      semantic: false
      human: false                    # true | false | {script: "<cmd>"} — conditional:
                                      #   the command decides at gate time whether THIS
                                      #   run needs approval. Topic "gate".
      human_channel: terminal         # terminal (default) | external | both — where the
                                      #   human question is delivered. inbox|both makes
                                      #   the answer a durable, engine-verified record.
                                      #   Only with a human gate. Topic "inbox".
      max_step_retries: 3             # Orchestrator re-spawns.
      max_gate_retries: 5             # In-session self-correction loops.
      allow_partial_step_complete: false  # For parallel: block on partial failure.

    # ── Delegation ──
    delegate_to: workflow-name         # Hand off to another workflow.
    params:                            # Params to pass to delegated workflow.
      component: "{component}"
    outputs:                           # Artifact handoff (delegation only):
      - path: data/report.json         #   CONCRETE parent-side destination
        from_delegated: "data/{run_id}-report.json"  # source in CHILD run dir
                                       #   ({param} → CHILD params; glob = exactly 1 match)

    # ── Planning ──
    type: planning                    # Orchestrator drafts child workflow.
    max_substeps: 4                   # Flat step fields — NOT nested under
    max_plan_attempts: 2              #   a restrictions: block.
    allow_parallel: false             # May the child use parallel steps?
    allow_delegation: false           # May the child use delegate_to?

    # ── Loop back (engine-evaluated repetition) ──
    loop_back:                        # Optional. Evaluated AFTER full gate pass.
      to: earlier-step                # This step or an EARLIER one (backward only).
      max_iterations: 20              # Required. LITERAL integer ({param} not resolved).
      when:                           # Navigation conditions (NOT quality gates).
        # Deciders run from the PROJECT ROOT — use the full root-relative path:
        script: "python .riglane/workflows/templates/my_workflows/<wf>/scripts/check.py"
        semantic: "more tests needed?" # LLM-evaluated on engine assignment.
        human: true                   # User decides (orchestrator relays).
        human_channel: terminal       # terminal (default) | external | both. Topic "inbox".
    # Full semantics, iteration data flow, per_iteration outputs:
    #   workflow_learn(topic="loop-back")

    # ── Routes (engine-evaluated FORWARD conditional branching) ──
    routes:                           # Optional. Evaluated AFTER gates + loop_back.
      when:                           # ≥1 key. Yields a route id or "proceed".
        # Runs from the PROJECT ROOT — full root-relative path, as with loop_back:
        script: "python .riglane/workflows/templates/my_workflows/<wf>/scripts/pick.py"
        semantic: "which route?"      # LLM picks a route id or "proceed".
        human: true                   # User picks (final authority).
        human_channel: terminal       # terminal (default) | external | both. Topic "inbox".
      define:                         # ≥1 named route; steps run in-line.
        - id: route-a                 # globally unique; not "proceed".
          steps: [ { name: a1, goal: "..." } ]
    # Full semantics (deciders, ENTER_ROUTE/AWAITING, nesting, return):
    #   workflow_learn(topic="routes")

    # ── Lanes (engine-evaluated PARALLEL execution lanes) ──
    lanes:                            # Optional. Fork after this step —
      define:                         #   ALL lanes run CONCURRENTLY (no
        - id: lane-a                  #   when). ≥2 lanes; ids globally
          steps: [ { name: a1, goal: "..." } ]   # unique. A lane is a full
        - id: lane-b                  #   linear segment (loop_back/routes/
          steps: [ { name: b1, goal: "..." } ]   # planning inside are fine).
      join:
        require: all                  # all (default) | any — the barrier
                                      #   ALWAYS waits for every lane; the
                                      #   policy only changes the verdict.
    # The join is NOT a step — merge/judge in the ordinary step AFTER the
    # block. Mutually exclusive with routes: on the same step (load error).
    # Full semantics (barrier, join index, failure): workflow_learn(topic="lanes")
