WORKFLOW SYSTEM — Overview
═════════════════════════

A workflow is a YAML file defining sequential steps. Each step is executed
by a subagent (isolated, gate-validated) or by the orchestrator (inline).

STEP TYPES:
  Regular     { name, goal, outputs }       — one subagent, one task
  Parallel    { parallel: true }             — fan-out across items
  Delegation  { delegate_to: "wf-name" }    — hand off to another workflow
  Planning    { type: planning }             — orchestrator drafts substeps dynamically
  Inline      { subagent: false }            — orchestrator executes; no gate hook,
                                               but declared outputs are still
                                               validated at step_complete (unless
                                               the structural gate is disabled)

  Before WRITING any goal text → topic "goals". A goal is read verbatim by
  a reasoning agent in a fresh context: explain the task and its criteria,
  don't enumerate today's cases — and split a goal that chains slow work.

DATA FLOW:
  inputs      — feed files to step (inject: reference | file | file_if_exists)
  outputs     — declare expected files (struct: validates schema)
  param_bindings — pipe output values into workflow params
  carry_forward  — pass prior step summaries as context

CONTROL FLOW (engine-owned; per-step blocks, NOT step types):
  loop_back   — BACKWARD repetition (yields a boolean). when: script/
                semantic/human + max_iterations. Topic "loop-back".
  routes      — FORWARD conditional branching (yields a route id / proceed):
                run one named route's steps in-line, then continue. Topic
                "routes".
  lanes       — PARALLEL execution lanes: several step sequences run
                CONCURRENTLY after the step, rejoined at an engine-owned
                join barrier (require: all | any). Topic "lanes".
  Step order is engine-enforced: step_begin accepts ONLY the manifest
  cursor step (forward skips / backward re-runs → BLOCKED_OUT_OF_ORDER).

QUALITY:
  gate.structural — file + schema validation (default ON)
  gate.semantic   — LLM quality check (optional)
  gate.human      — user approval (critical steps)
  gate.human_channel — deliver the human question EXTERNALLY (the run
                inbox: durable Q&A artifact outside the terminal). Topic "inbox".
  spec_check      — verify code respects behavioral specs (opt-in; default off)

SCOPES:
  Specs are organized by scope ("generic" plus any declared scope).
  Workflows can target a specific scope via --scope param.
  Engine manages scope lifecycle (snapshot → override → restore).

For details: CALL workflow_learn(topic="<name>")
Topics by area:
  Authoring core: workflow-fields, step-fields, goals, inputs, outputs,
    struct-format, examples, design-choices, predefined-workflows
  Mechanics:      parallel, delegation, planning, loop-back, routes,
    lanes, gate, inbox, param-bindings, carry-forward, tools
  Spec layer:     spec-check, spec-format, spec-tools, scopes
  Runtime/hosts:  mcp-tools
All topics: overview, step-fields, goals, inputs, outputs, parallel, delegation, gate, planning, param-bindings, carry-forward, spec-check, scopes, tools, examples, spec-format, spec-tools, struct-format, mcp-tools, predefined-workflows, workflow-fields, design-choices, loop-back, routes, lanes, inbox
