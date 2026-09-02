SCOPES — multi-integration spec isolation
═════════════════════════════════════════

Scopes add an orthogonal axis to domains. Specs live at:
  .riglane/specs/<scope>/<domain>/<spec-id>.md

THE "GENERIC" SCOPE:
  • Always present (no declaration needed).
  • Universal rules that apply to all integrations.
  • Loaded alongside active scope in every read operation.
  • Writes to generic/ always allowed.

NAMED SCOPES (declared integration / variant scopes):
  • Declared in .riglane/specs/_scope-config.json — each entry {id, label, hint?}.
  • Integration-specific or market-specific rules.
  • NOT write-protected — cross-scope writes are detected after the fact
    (see CROSS-SCOPE WRITES below).

COVERAGE HINT (per named scope, optional but strongly recommended):
  • _scope-config.json scope entry may carry a `hint`: free text saying WHAT
    the scope governs and, ideally, what does NOT belong (with where it goes
    instead) — e.g. "Payments API + refunds. NOT: cross-cutting invariants (→ generic)."
  • The engine INJECTS it into the scope-orientation guidance at spec_check /
    spec_authoring steps (to orchestrator AND subagent), and into the
    spec_check semantic-gate clause — so work stays in the right scope and a
    spec/file that plainly belongs elsewhere is flagged, not silently placed.
  • Set it: `riglane scope add <id> "<label>" --hint "..."` or later
    `riglane scope hint <id> "<text>"` (empty text clears). The riglane-scope-add and
    riglane-spec-author skills prompt for it proactively.

ACTIVE SCOPE RESOLUTION (priority order):
  1. CLI --scope <id>             (per-command)
  2. .riglane/local/active-scope    (user override, gitignored)
  3. _scope-config.json default   (team default)
  4. "generic"                    (fallback)

WORKFLOWS AND SCOPES:
  • Workflow can declare a scope param: --scope <id>
  • Engine MANAGES scope lifecycle automatically:
    1. workflow_init: snapshots current active-scope → preserved_active_scope
    2. workflow_init: overwrites .riglane/local/active-scope with param value
    3. workflow_finalize: restores original active-scope
  • Orchestrator MUST NOT mutate .riglane/local/active-scope manually.
  • manifest.scope_managed tracks whether engine is managing scope.

READING SPECS (default load set):
  active_scope + generic — always both.
  Never load other scopes unless explicitly requested (--scope all).
  _index.json and _registry.json are per-scope.

CROSS-SCOPE WRITES — DETECTED, NOT BLOCKED:
  • Normal spec work cannot land in the wrong scope: the engine places every
    spec itself (scope is engine-set from the run), so spec_write/spec_link
    are safe by construction. Writes to generic/ are always legitimate.
  • A DIRECT file write into another scope is NOT blocked — there is no
    pre-write block on any host. The structural gate reports it AFTERWARDS
    as a scope warning.
  • So treat that warning as a REAL finding, not noise: verify the active
    scope, and if the write was accidental revert the listed file(s) and
    re-run with the correct --scope. Never assume something blocked you.

NUANCES:
  • Scope ≠ inheritance. named-scope specs don't "extend" generic specs.
  • Scope ≠ version. Don't model versions as scopes.
  • Same spec_id across scopes coexists cleanly (different dirs).
  • Don't cache active scope — can change mid-conversation.
  • Promote to generic only after seeing rule apply in 2+ scopes.
