PREDEFINED WORKFLOWS — ships with Riglane, ready for use
═══════════════════════════════════════════════════

Most live in .riglane/workflows/templates/predefined/ (package-owned); the demo /
diagnostic ones (loop-demo, gate-hook-check) live in examples/. Both dirs are
resolvable by name — same run/delegate mechanics.

A FOURTH bucket, community/, holds workflows installed from the public
catalog (riglane add). They resolve by the same mechanics BUT the engine
REFUSES to load one until the user has enabled it with `riglane trust
<id>` — and refuses again if its files change afterwards. If you hit that
refusal: surface the message verbatim and STOP. Enabling shared code is
the user's decision — never run the trust command yourself and never
edit the trust store.

EDITING A PREDEFINED WORKFLOW (copy-on-write): predefined/ is refreshed by
riglane update — do not customize it in place expecting the edit to stay there.
When the CLI detects an edited predefined workflow (riglane init/update, or the
riglane ui workflow picker), it PROMOTES the edit: the edited directory is
copied to my_workflows/<same-name>/ and predefined/ is restored pristine.
The copy keeps the name — resolve precedence (my_workflows → predefined)
means the user copy wins for run/delegate by name. To customize a
predefined workflow deliberately, copy it to my_workflows/ yourself.
Run via:    /riglane-run-workflow <name> [--param=value]
Delegate:   - name: my-step
              delegate_to: <name>
              subagent: false
              params: { … }

── Spec lifecycle ────────────────────────────────────────────────

  spec-audit
    READ-ONLY code-compliance audit — execute each spec's Validation
    Criteria against the implementing code, report real reachable
    divergences. Never modifies code, specs, or the registry.
    Steps:  discover (human gate) → review (parallel) → verify → report
    Params: scope?, domain?, spec_id?, applies_to?
    Use when: divergence report without changes.

  NOTE: interactive spec AUTHORING is not a workflow — it is the
  /riglane-spec-author skill driving the engine spec tools (spec_write /
  spec_search / spec_link). See workflow_learn(topic="spec-tools").

── Spec extraction (from documentation) ──────────────────────────

  doc-spec-extraction
    Extract behavioral specs from source documentation (partner specs,
    programming guides, PDFs).
    Steps:  analyze (human gate) → extract (parallel per-domain) →
            validate (human gate) → commit
    Params: source (required), scope?, focus?, domain?, supplementary?
    When the scope already has specs, ANALYZE also emits ADVISORY
    redesign_proposals (split/merge/rename domains, move/consolidate
    existing specs) — surfaced at the human gate, never applied by the
    workflow itself (its pipeline only creates new specs).
    Use when: bulk import of specs from a long source document.

── Registry maintenance ──────────────────────────────────────────

  registry-sync
    Reconcile the spec→code registry (_registry.json) with reality: full
    analysis of which file implements which spec (direct + indirect), diffed
    against the registry. Scope-aware; applies changes via spec_link (never
    hand-edits the registry). Advisory: cross-scope placement (uses scope
    coverage hints) + domain-structure redesign — surfaced, not applied.
    Steps:  discover → scan (parallel per-domain) → review (human gate) →
            register (inline, spec_link)
    Params: scope?, domain?, spec_id?, search_paths?
    Use when: registry has drifted after large refactor or new feature.

── Examples & diagnostics (in examples/, NOT predefined) ─────────

  gate-hook-check
    Probes whether subagentStop hook fires correctly, gate-check
    processes input, and trace system records as expected. Fast smoke
    test (~30 seconds).
    Steps:  probe-hook → probe-struct → probe-retry
    Params: message?
    Use when: setting up Riglane in a new project; debugging hook issues.

  loop-demo
    Reference + self-test for the loop_back mechanism. Repeats a
    two-step cycle until the plan is exhausted (when.script decider,
    max_iterations budget). Demonstrates both iteration data flows
    (overwrite vs per_iteration files), param_bindings, inline summary.
    Steps:  prepare-plan → [run-scenario → record-result]⟲ → summarize
    Params: scenarios? (default 3)
    Use when: learning/testing loop_back; verifying loop trace dividers.

  delegation-demo (+ delegation-demo-target)
    Reference + self-test for the delegate_to mechanism — a minimal A→B
    pair: params INTO the delegated child, verdict OUT of the child's run
    dir via param_bindings, inline synthesis after. The target is also
    runnable standalone.
    Steps:  analyze-component (delegation) → report (inline)
    Params: component? (default demo-widget)
    Target contract: component (required) → data/analysis.json
      {component, verdict: pass|fail, note}.
    Use when: learning/testing delegation; template for A→B composition.

  tools-demo
    Script tools end-to-end: workflow-level tools:, per-step tools:
    declaration (declare-to-use: a step lists exactly what it calls;
    absent/[] = none), co-located scripts in two
    languages (node .mjs + python .py), optional external MCP dependency.
    Use when: learning/testing workflow script tools.

  full-mechanics-demo
    "Kitchen sink" validation workflow — one run exercises (almost) every
    mechanic: script tool, planning, parallel fan-out with dynamic paths,
    inline aggregation, loop_back + per_iteration + param_bindings, routes,
    gate-fail chain (opt-in via mode=fail).
    Use when: validating an Riglane install end-to-end; regression catching.

  routes-demo
    Routes (conditional forward branching) reference: severity triage picks
    one of several named routes; includes a route-local loop_back and a
    nested sub-route.
    Use when: learning/testing routes.

  parallel-lanes-demo
    Lanes (parallel execution lanes) reference: a fork step starts two
    concurrent lanes — one loops within itself, the other routes within
    itself — writing disjoint outputs into the shared run dir; the engine
    joins them at the barrier (require: all) and writes the collection
    index; an ordinary inline step then merges the lane outputs under a
    struct-validated schema.
    Use when: learning/testing lanes (topic "lanes").

  parallel-demo
    Parallel fan-out reference: manifest → [status=pending] filter → one
    branch per item with filesystem-safe {parallel_key.name} identity
    (the slashed-path trap, solved) → glob consumption of merged results.
    Use when: learning/testing parallel + parallel_key.

  gates-demo   ← START HERE on a fresh install
    Gate system reference: structural gate + both retry budgets, semantic
    gate ON the producing step (gates are config, not steps), a human
    approval checkpoint, and a live acknowledge_warnings lesson.
    Zero shell — nothing to install or trust — and it ends in a readable
    data/final.md, so a first run is worth watching rather than merely
    completing: isolated steps, declared outputs, and a gate that must
    pass before the next step may begin.
    Params: topic?
    Use when: learning/testing gates and warning acknowledgment; the
      recommended first run on a new install.

  inbox-demo
    Run inbox reference: human gates delivered outside the terminal
    (human_channel: both) — a single question with predefined choices,
    then a GROUPED message (items) answered in one exchange; durable
    Q&A records with
    the via audit field, answer through the Local API / webhook consumer /
    terminal, and the step_complete fresh-response enforcement.
    Use when: learning/testing the inbox channel (topic "inbox").

  planning-demo
    Dynamic planning reference: a {request}-dependent child workflow drafted
    at runtime under flat restriction fields; child output promoted back and
    consumed inline; agent_notes before/after.
    Use when: learning/testing type: planning.

  spec-capabilities-demo
    Spec capability flags reference: spec_authoring validate (dry-run) →
    persist (real spec_write mint) → spec_check consumption + spec_link.
    Use when: learning/testing the per-step spec flags (needs .riglane/specs/).

CHOOSING FOR delegate_to:
  • Spec-related sub-tasks: spec-audit (read-only), registry-sync.
  • A minimal reference target: delegation-demo-target (see delegation-demo).
  • Your own workflows in my_workflows/ are equally valid targets.
  • AVOID as delegate targets: doc-spec-extraction (long-running,
    interactive — assumes user interaction in the ANALYZE human gate,
    which breaks composition).

AUTHORING NEW WORKFLOWS:
  There is no predefined workflow for authoring. Use the `/riglane-create-workflow`
  skill — it orients the agent to call workflow_learn + workflow_validate
  collaboratively with the user. Output goes to
  .riglane/workflows/templates/my_workflows/<name>/workflow.yaml.
