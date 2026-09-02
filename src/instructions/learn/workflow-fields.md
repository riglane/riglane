WORKFLOW FIELDS — top-level workflow.yaml reference
═══════════════════════════════════════════════════

For step-level fields (goal, inputs, outputs, parallel, gate, ...) see
workflow_learn(topic="step-fields"). This topic covers ONLY the top-
level workflow.yaml shape — required fields, workflow-level config,
and the data shape `workflow_validate` checks first.

REQUIRED — every workflow MUST declare these four:

  name: kebab-case-id        # ^[a-z][a-z0-9_-]*$ — doubles as dir name
  version: 1                 # integer ≥ 1; bump on structural change
  description: "..."         # non-empty human-readable purpose
  steps: [ ... ]             # ordered list, minItems 1

Missing any of these → workflow_validate fails immediately with
"must have required property '<name>'". This is the most common
first-draft error — include all four from the start.

OPTIONAL top-level fields:

  params:                    # list of {name, description?, required?, default?}
    - name: scope            # ^[a-z][a-z0-9_]*$
      description: "..."
      required: true         # default false
      default: "generic"     # any JSON-compatible value

  gate:                      # default config inherited by every step
    structural: true         # default true
    semantic: false          # default false
    human: false             # default false; or {script: "<cmd>"} for a
                             # conditional gate (verdict at gate time) — topic "gate"
    max_step_retries: 3      # orchestrator re-spawns; default 3
    max_gate_retries: 5      # in-session gate loops; default 5
    allow_partial_step_complete: false
                             # blocks step_complete on parallel partial-fail

  context:
    carry_forward: "none"    # "none" (default) | "summary"
                             # step.carry_forward (bool) overrides per step

  tools:                     # workflow tool dependencies
    - name: my_tool          # ^[a-z][a-z0-9_]*$
      type: script           # "script" | "mcp"
      command: "..."         # script-only, required
      description: "..."     # recommended (script tools)
      input_schema: { ... }  # script-only JSON Schema for args
      required: true         # mcp-only (default true)
      expected_tools: [...]  # mcp-only — the step-usable tool names

  parallel_spawn_delay_ms: 5000
                             # workflow-level default delay between
                             # parallel-subagent spawns. Reduces prompt-
                             # cache misses. Recommended 3000-5000 for
                             # 100K-300K token prompts. Per-step override
                             # via step.parallel_spawn_delay_ms.

  inbox_webhook: http://127.0.0.1:9000/cb
                             # DEFAULT webhook for this workflow's runs:
                             # the engine POSTs each inbox question
                             # envelope there. Outranked by the run-level
                             # --inbox-webhook; outranks the ambient
                             # config/env pair (where config wins over env
                             # — see topic "inbox"). A non-localhost URL in
                             # a committed file draws an advisory
                             # (webhook-url), and a private address belongs
                             # on the run, not in the file. Topic: inbox.

  acknowledge_warnings: [id, ...]
                             # Silence specific ADVISORY lint warnings you
                             # have consciously decided against. Each id is
                             # printed in the warning itself (workflow_validate /
                             # riglane validate-workflow) — copy it from there; an
                             # unknown id is reported back to you. Workflow-level
                             # acknowledges workflow-scoped warnings; the same
                             # field on a STEP acknowledges that step's warnings.
                             # It stays in the YAML on purpose, so your decision
                             # is visible to human reviewers. Warnings never
                             # block a run — acknowledge only deliberate choices.

MINIMUM VIABLE WORKFLOW (paste as a starting point):

  name: my-workflow
  version: 1
  description: One-line purpose of this workflow.
  steps:
    - name: first-step
      goal: "What the subagent should do."
      outputs:
        - path: data/result.md

This passes workflow_validate with zero edits — copy, rename, expand.

NUANCES:
  • additionalProperties: false at every level — unknown fields fail.
    Typos like `parmas:` (instead of `params:`) fail loud at validate.
  • `params[*].default` value type is unconstrained (any JSON type).
    `required: true` + `default` together: workflow still loads; the
    default makes the param effectively optional.
  • Workflow `name` MUST match the directory name under
    `my_workflows/<name>/` — engine enforces this at load.
  • Engine auto-injects a synthetic `run_id` param at workflow_init,
    overwriting any user-supplied param with the same name.

NEXT:
  • Step-level fields:        workflow_learn(topic="step-fields")
  • Concrete patterns:        workflow_learn(topic="examples")
  • Validate a draft:         workflow_validate(workflow_yaml=...)
                              CLI (a saved file): riglane validate-workflow <path> [--json]
                              — identical full validator; 0 valid / 1 invalid.
