DESIGN CHOICES — tradeoff guide for authoring (not rules)
═════════════════════════════════════════════════════════

These are starting points for design decisions, NOT prescriptive rules.
Real workflows depend on the project's cost tolerance, infrastructure,
iteration speed, and what failures are actually expensive. Use the
reasoning below to think about tradeoffs — then decide what fits.

For mechanics (HOW to write field X): see the per-feature topic.
This topic is about WHEN to choose option A vs option B.

━━━ GRANULARITY — when is something a separate step? ━━━

  Test: can you write the step's goal in one sentence WITHOUT "and"?
    "Scan files and write findings"    → 2 actions, candidate for split.
    "Discover modules + write manifest" → 1 action (single output), 1 step.

  A separate step earns its place when:
    • It needs a different gate (e.g. semantic on quality-critical output).
    • It isolates an expensive operation (parallel-able? gated checkpoint?).
    • The output of A blocks the start of B (real data-flow boundary).
    • RELIABILITY alone: the goal chains many individually SLOW
      instructions. One agent executes them in one context — attention
      degrades with distance and the middle instructions quietly drop,
      while the gate can only judge the declared OUTPUTS, never whether
      instruction 4 of 9 happened. Splitting gives each part a fresh
      context and its own gate. (This criterion is about duration and
      count, where the one-sentence test above is about actions — a
      goal can pass that test and still be too long to follow.)
      Topic "goals".

  Steps are NOT separate when:
    • Tightly coupled, < 30s total, no observable intermediate state.
    • Pure synthesis (read prior outputs → write report). Keep inline.

  Step count is irrelevant. 3 or 13 — what matters is each step
  defending its own existence by one of the criteria above.

  Example: doc-spec-extraction is 4 steps (analyze → extract parallel →
  validate → commit). Each has distinct gate + data boundary. Merging
  any pair would lose a checkpoint.

━━━ PARALLEL vs SEQUENTIAL ━━━

  Tradeoff: parallel gives ~N× wall-time speedup but costs N× spawn
  overhead + N× isolated context. Worth it when item count × per-item
  wall time clearly exceeds the spawn cost.

  Lean parallel when:
    • Items are TRULY independent (no shared mutable state, no ordering).
    • N ≥ 3 AND per-item wall time ≥ 1 min.
    • Engine's per-branch isolation (_branch_N/) is desired.

  Lean sequential when:
    • N = 2 (spawn overhead usually exceeds savings).
    • Items share state (later item reads earlier item's output).
    • You'd nest delegation under parallel (engine prohibits depth-2).

  Depends on: project's tolerance for spawn cost vs latency. CI/CD
  contexts often favor parallel even at smaller N.

  Example: doc-spec-extraction extracts per-domain in parallel (clearly
  independent domains). delegation-demo runs sequential because the
  report step needs the verdict from the delegated step.

━━━ LANES vs PARALLEL vs ROUTES ━━━

  Three mechanisms fan work out; they answer different questions:
    parallel  — ONE step, N data items, the SAME goal per item. The item
                list comes from a prior step's JSON at runtime.
    lanes     — N DIFFERENT step sequences running at once, authored up
                front, rejoined at a barrier. Each lane may loop, route,
                plan or delegate independently.
    routes    — N alternatives of which exactly ONE runs. Nothing is
                concurrent; the engine picks by a decider.

  Lean lanes when:
    • The concurrent work is HETEROGENEOUS — each track has its own
      steps, gates, schemas (e.g. an evidence-gathering track and an
      independent audit track feeding one synthesis).
    • A track needs its own control flow (a loop or route inside it).
    • The tracks must not see each other's intermediate reasoning —
      lane isolation is per-sequence, not per-item.

  Lean parallel when:
    • The work is HOMOGENEOUS fan-out over a runtime-discovered list
      (audit N modules, review N files) — one goal, many items.

  Lean sequential (neither) when:
    • One track's output feeds the other — a dependency is an ORDER,
      and concurrency would just hide it.

  Join tradeoff: `require: any` does NOT save wall time — the barrier
  always waits for every lane to reach a terminal state (live subagents
  cannot be cancelled); the policy only decides whether failed lanes
  block. Use `any` for optional enrichment lanes, `all` (default) when
  every lane's output feeds the step after the join.

━━━ INLINE (subagent: false) vs SUBAGENT ━━━

  Tradeoff: inline runs in the orchestrator's session (no spawn cost,
  no gate hook / no in-session retry loop, full context; declared
  outputs are still safety-net validated at step_complete unless the
  structural gate is disabled). Subagent
  runs in isolated session (gate-validated with retries, deterministic,
  but spawn cost + context preamble).

  Inline (subagent: false) when:
    • Pure synthesis: read prior outputs → write report/summary.
    • Small lookup or validation step (< 30s of work).
    • No file modification, no expensive ops, no need for gate validation.
    • Final reporting steps where structural gate would be noise.
    • BUT: if the final deliverable warrants struct validation + retry
      loops, keep it a subagent step — inline trades the retry loop for
      cheapness (outputs still get a one-shot check at step_complete).

  Subagent (default) when:
    • Code modification or multi-file changes.
    • Expensive operation worth isolating (token budget, retry surface).
    • You want deterministic gate-checked output.

  Depends on: orchestrator's context budget. If orchestrator already
  juggles many tasks, lean toward subagent even for synthesis.

━━━ DELEGATE vs CUSTOM INLINE STEP ━━━

  Tradeoff: delegation reuses a predefined workflow (consistency +
  proven shape) but costs an extra workflow_init/finalize roundtrip
  (~30s) and limits you to engine's max depth-1 nesting.

  Delegate when:
    • A predefined workflow covers ≥ 80% of what you need.
    • The reused workflow has its own gate, spec-check, retries you want.
    • Single delegation depth (not nested under parallel — engine rejects).

  Custom inline step when:
    • You need parallel branches (delegation under parallel = depth-2).
    • Your step's shape differs significantly from any predefined.
    • You want bespoke gate config that the predefined doesn't expose.

  Depends on: maintenance cost. Delegating to a shared workflow means
  your run inherits its bugs + improvements. Inline means independence.

━━━ PLANNING STEP vs STATIC SHAPE ━━━

  Tradeoff: planning step lets the orchestrator dynamically draft a child
  workflow per invocation (adaptive). Costs: child workflow draft +
  validate + execute = ~2-3× the latency of a static step.

  Use planning when:
    • Substep count or shape varies per invocation (e.g. "implement X"
      where X is user-supplied and the implementation strategy depends
      on what X actually is).
    • Discovery itself is the work (orchestrator must reason about
      decomposition).

  Skip planning when:
    • Structure is known upfront (e.g. "refactor 8 modules with same shape").
    • You can express the same work as a parallel step over a known list.

  Example: full-mechanics-demo's plan-approach step uses planning because
  each processing goal is unique. doc-spec-extraction uses static +
  parallel because the domain list is discoverable, not creative.

━━━ MODEL MODE (step-level `model:`) ━━━

  `model:` is a selection MODE, not a model name — you never name a
  concrete model (authors rarely know the host's internal identifiers;
  Riglane runs on any agent/LLM stack). The engine turns the mode into an
  orchestrator instruction at step_begin:
    inherit    — same model as the orchestrator; no downgrade/upgrade.
    auto       — DEFAULT (when omitted): the orchestrator judges the
                 step's difficulty and picks a fitting model itself.
    lightest   — cheapest/fastest tier available on the host.
    strongest  — most capable tier available on the host.

  Tradeoff: lighter tiers are cheaper but weaker at reasoning and
  judgment; stronger tiers cost more per step but reduce retries on hard
  tasks.

  Declare `lightest` when:
    • Mechanical extraction (scan files → structured JSON).
    • Formatting, reshaping data, ID matching.
    • Summarization of prior step outputs into a report.

  Leave `auto` (omit) when:
    • Code modification with semantic reasoning required.
    • Multi-file synthesis.
    • Spec compliance interpretation.
    • You have no strong signal — trust the orchestrator's judgment.

  Declare `strongest` when:
    • Deep multi-file refactor with hard tradeoffs.
    • Novel algorithm design.
    • Tasks where one retry costs more than the model price difference.

  Declare `inherit` when:
    • Consistency with the orchestrator matters more than cost (e.g. the
      step continues reasoning the orchestrator started).

  Depends on: project's cost vs accuracy ratio. The modes are
  INSTRUCTIONS to the orchestrator (on CC the generated per-step agent
  file additionally pins the mapped tier).

  RUN-LEVEL OVERRIDE: a run may override the per-step MODE for ALL subagent
  steps at once via `--model <mode>` (same four values) on `riglane run-workflow`,
  the `riglane ui` Run tab, or a launcher app — the skill forwards it to workflow_init as
  `model_override` (stored in manifest.model_override; applied at step_begin).
  Use it to force a whole run onto the strong tier for a hard task, or the
  light tier for a cheap dry-run, without editing workflow.yaml. Omit for the
  authored per-step MODES. Invalid values are rejected at workflow_init.

━━━ SEMANTIC GATE — when to add it ━━━

  Tradeoff: semantic gate runs an LLM check after the subagent finishes.
  Catches "claims-done-but-incoherent" failures. Costs ~1 extra LLM call
  per step run. Structural gate alone catches schema/file failures (free).

  Semantic gate worth it when:
    • Output is judgment (consistency report, completeness audit).
    • Step is a single-point-of-truth (no other step catches its mistakes).
    • Quality is high-stakes — humans would otherwise re-review by hand.

  Skip semantic gate when:
    • Output is schema-validated (structural gate suffices).
    • Per-branch in a parallel step (cost multiplies by branch count).
    • Step is intermediate — downstream step will catch any leakage.

  Example: consistency-check across 8 refactored modules = semantic gate ON
  (judgment + single point of truth). Per-branch refactor = OFF (structural
  catches schema; consistency-check catches semantic).

━━━ INJECT MODE — reference / file / file_if_exists ━━━

  Tradeoff: reference makes the subagent read the file itself (skippable
  under context pressure). file embeds content in prompt (subagent MUST
  see it, but consumes prompt budget). file_if_exists is reference with
  graceful absence.

  inject: "reference" (default) when:
    • File is large (> 50K tokens).
    • "Agent might skim or skip if not needed" is acceptable.
    • Most input cases.

  inject: "file" when:
    • COMPLIANCE-MANDATORY input (spec the subagent MUST consult).
    • Small file (< 50K tokens — larger overflows prompt).
    • Missing-read would be a real failure, not just suboptimal.

  inject: "file_if_exists" when:
    • Optional context (e.g. prior-run reflection log, optional config).
    • Absence is normal and should not block the step.

  Depends on: how reliably your subagent reads referenced files. Some
  models read everything; others skim. If unsure, prefer "file" for
  must-have specs.

━━━ parallel_spawn_delay_ms — when to set it ━━━

  Tradeoff: a delay between parallel spawns lets the first subagent
  populate the prompt cache. Subsequent spawns reuse cache → ~3× cost
  savings. Cost: total wall time grows by (N-1) × delay.

  Set 3000-5000ms when:
    • N ≥ 5 branches.
    • Per-branch prompt ≥ 50K tokens (cacheable substance).
    • Cost matters more than maximum wall-time concurrency.

  Skip (omit / 0) when:
    • N < 5 branches (cache savings small).
    • Per-branch prompt is small (< 50K — no real cache material).
    • Wall time is critical (real-time pipelines).

━━━ spec_check — ON vs OFF per step ━━━

  Default is OFF (opt-in). Setting spec_check: true makes the engine
  inject spec-consultation guidance at step_begin and a spec-compliance
  clause into the semantic gate. Cost is minimal (a few prompt lines).

  Turn ON (spec_check: true) when:
    • Step modifies source code in a project that keeps behavioral specs.
    • Step decides shape that downstream code-changing steps will follow.

  Leave OFF (default) when:
    • Step does not modify code (pure analysis, scan, JSON shaping).
    • Step writes docs / summaries / reports.
    • Step's output is not constrained by behavioral specs.

  Example: analyze-modules + summary = OFF (default). refactor-module +
  consistency-check = spec_check: true.

━━━ Final reminder ━━━

  These heuristics are starting points. The right answer for your
  specific workflow depends on: project cost model, team conventions,
  infrastructure constraints, what failures are actually expensive.
  Use them to think about tradeoffs, not as gospel.
