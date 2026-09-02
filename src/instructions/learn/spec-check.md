SPEC CHECK — behavioral spec enforcement in workflows
════════════════════════════════════════════════════

spec_check: false (default; opt-in) — set true on a step that CHANGES the
  project and must respect behavioral specs. false = skip (analysis, reporting,
  pure reads). Declare it explicitly on code-modifying steps.

SIBLING FLAG — spec_authoring (steps that WRITE specs, not code):
  spec_authoring: persist   — step authors specs via spec_write; the engine
                              auto-declares .riglane/specs/ outputs for the gate.
                              Requires a `scope` workflow param; incompatible
                              with parallel: true (validator-enforced).
  spec_authoring: validate  — step may only PREVIEW (spec_write dry_run);
                              construction guard blocks real writes.
  spec_check consumes specs; spec_authoring produces them. A pure analysis
  step needs neither.

WHAT spec_check: true DOES (engine side):
  • step_begin injects spec-consultation guidance into the subagent task.
  • The semantic gate (if enabled) gets a spec-compliance clause — the
    orchestrator verifies the change respects the specs it touched.
  • The step gains the spec tools (spec_search + spec_link) — on Claude Code
    they leave the agent file's disallowedTools line; regenerate agents via
    /riglane-init-workflow after changing the flag.

YOUR ROLE AS SUBAGENT (when spec_check is enabled):
  1. DISCOVER — spec_search is the sanctioned channel: query by the domain /
     applies_to of the area you are changing. The registry mapping is a
     reinforcing hint, NOT the only channel — freshly extracted specs must
     be respected even before any registry linkage exists.
  2. READ each relevant spec (Read the path from the results). The Rule
     Statement is the binding rule — every spec is mandatory by construction
     (no MUST/SHOULD/MAY gradient; conditional semantics live in the prose).
  3. VERIFY before coding — check your planned changes won't violate specs.
  4. IMPLEMENT — make changes that comply with all relevant specs.
  5. VERIFY after coding — confirm no specs were violated.
  6. REPORT — if a violation is unavoidable, STOP and report in summary.

AFTER IMPLEMENTATION — update the code↔spec registry via spec_link ONLY:
  _index.json / _registry.json are ENGINE-OWNED — never hand-edit them
  (a hook hard-blocks it). For each changed file that relates to a spec:
    spec_link(op:add, spec_id, file, role)
  role ∈ {implements, configures, verifies, uses, affects}:
    implements — produces the behavior (verify ALL requirements)
    configures — sets constrained values (verify values match the spec)
    verifies   — tests it (verify coverage still holds)
    uses       — consumes the contract (don't break the interface)
    affects    — indirect dependency (re-verify on change)
  Do NOT invent new specs; do NOT link unrelated files (config helpers,
  test scaffolding, infrastructure). Removal (op:remove) needs a reason —
  see workflow_learn(topic="spec-tools").

BEHAVIORAL SPECS:
  • Markdown files in .riglane/specs/<scope>/<domain>/<spec_id>.md
  • ONE behavioral rule per spec; all specs are mandatory (no severity).
  • Persist across sessions — "memory" for requirements.
  • Format: workflow_learn(topic="spec-format").

ENFORCEMENT IS LAYERED:
  spec_check injects INSTRUCTIONS — LLM compliance is not guaranteed.
  The structural gate (gate-check) is the hard enforcement layer.
  For maximum safety: declare output struct schemas (hard validation).

WORKFLOWS/SKILLS THAT MANAGE SPECS (not your job as subagent):
  doc-spec-extraction — extract specs from documentation (workflow)
  spec-audit          — read-only code-compliance audit (workflow)
  registry-sync       — reconcile registry drift (workflow)
  /riglane-spec-author    — interactive spec authoring (skill → spec_write)
  /riglane-spec-check     — interactive compliance check (skill)

WHEN TO LEAVE spec_check OFF (the default):
  • Analysis-only steps (no code modifications)
  • Reporting / documentation steps
  • Steps that read but don't write source code
  • Planning/scanning steps

RELATED: topic="spec-tools" (spec_search/spec_write/spec_link reference);
  topic="spec-format" (the .md shape); topic="scopes" (scope model).
