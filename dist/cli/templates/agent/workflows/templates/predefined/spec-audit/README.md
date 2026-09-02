# spec-audit — Read-Only Code-Compliance Audit

Reads the source code and measures how far the **implementation** diverges from
its behavioral specs. For each spec, it executes the spec's **Validation
Criteria** against the implementing code and reports every real, reachable
divergence — what it is, how severe the divergence is, and the full code path
that produces it. **Pure read-only**: never modifies code, specs, or the
registry, and never proposes fixes (how to fix is a human decision, carried out
in a separate implementation pass).

## Why this workflow exists

`spec_check` (the opt-in per-step flag, and the `riglane-spec-check` skill) guards
specs during implementation (write path). `spec-audit` checks compliance after
the fact (read path) — periodic QA, pre-release audits. It answers: **"How far
has the code drifted from its specs, and exactly how?"**

The audit is a diagnosis, not a remediation. It produces a structured audit
document (consumable by the Projects Spec & Audit tool — `riglane ui` → Tools);
fixing is a separate, human-directed step.

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `scope` | No | `generic` | Scope to audit (`generic`, `all`, or a declared scope id). `generic` is always included alongside the selected scope. `all` audits every declared scope. |
| `domain` | No | *(all)* | Filter to a single domain. |
| `spec_id` | No | *(all)* | Filter to a single spec (format `<domain>-NNN`). Most specific — overrides `domain`. |
| `applies_to` | No | *(all)* | Filter to specs whose `applies_to` overlaps this area (component / module / file hint). Area-level scoping. |

No filter → audits **every** spec (comprehensive, per-spec).

## Usage

```
# Audit every spec in the active scope (+ generic)
/riglane-run-workflow spec-audit --scope <scope>

# Audit a single domain
/riglane-run-workflow spec-audit --scope <scope> --domain <domain>

# Audit a single spec
/riglane-run-workflow spec-audit --scope <scope> --spec_id "<domain>-NNN"

# Audit an area
/riglane-run-workflow spec-audit --scope <scope> --applies_to <area>

# Audit every scope in the project
/riglane-run-workflow spec-audit --scope all
```

## Steps

### Step 1: DISCOVER (human gate)

Resolves the audit set: which specs to audit and which source files implement
each. Planning only — does not read code yet.

- Enumerates specs by reading `_index.json` (active + generic) — the sanctioned
  full-enumerate path (an audit lists everything; no `spec_search` / no spec MCP
  tools — the whole workflow is builtins + file reads).
- Applies audit-scoping filters (most specific wins): `spec_id` > `domain` >
  `applies_to` > all.
- Discovers implementing code per spec: `_registry.json` `implemented_by` is a
  fast **hint**, not the only channel — DISCOVER **always** also
  area-searches the codebase for the spec's `applies_to`, so an unregistered
  spec is still audited.
- Groups specs by domain for parallel fan-out; flags specs with no
  implementation found.

**Output:** `data/{run_id}-discovery-plan.json`.
**Gate:** Human — user confirms the audit set before REVIEW.

### Step 2: REVIEW (parallel by domain) — traces the real code

Each subagent audits its domain's specs against the implementing code by
**executing each spec's Validation Criteria** — and it **traces the actual
bodies** to find genuine divergences. The heavy code reading lives here, in the
disposable per-domain subagent context (not in the orchestrator).

- Reads the spec's `## Rule Statement` (one rule per spec) + `## Validation
  Criteria` (what to verify / where / what to exclude).
- **Traces, does not skim:** reads the bodies of the functions/methods carrying
  the behavior, following ≥1 call level, opening other files as needed.
- Classifies compliance: `compliant` / `violation` / `partial` / `unverifiable`.
  A `compliant` verdict is an **evidenced** claim (body read, proof named) — not
  "looks fine from the call site" — which is what stops false negatives at the
  source.
- A divergence is a **real, reachable** functional path that violates the Rule
  Statement (per the Validation Criteria's EXCLUDE clause) — NOT a keyword/pattern
  match. Unreachable or inert occurrences are not divergences.

**Output:** `data/reviews/{run_id}-{domain}-review-result.json`.

### Step 3: VERIFY (subagent, `model: inherit`) — independent depth, always runs

An independent second pass at full model strength (`inherit` = same tier as the
orchestrator) but in a **fresh, disposable subagent context** — so the heavy
body-reading never bloats the long-lived orchestrator. Processes items one by one.

- **Re-checks every divergence** (`violation` / `partial`) AND **a sample of the
  `compliant` verdicts** — the false-negative net (≥ ~1 in 4, always including
  high-stakes rules and thin-looking compliant notes).
- Reads the actual implementation **bodies** (the implementing source files, not just declarations),
  tracing every involved call at least one level deep.
- Reclassifies: a divergence → `confirmed` / `false_positive` / `inconclusive`;
  a sampled compliant → `compliant_confirmed` / `missed_violation` (REVIEW was
  wrong — a real divergence it missed) / `inconclusive`.
- For `confirmed` AND `missed_violation`, finalizes the divergence severity and
  writes the full traced code **path**.
- Un-sampled `compliant` / `unverifiable` findings pass through untouched.

**Output:** `data/{run_id}-verified-results.json`.

### Step 4: REPORT

Consolidates everything into one structured audit document. Diagnosis only — no
fix suggestions.

- Uses VERIFY's verdicts: a divergence is any `confirmed` **or** `missed_violation`
  (a REVIEW false-negative VERIFY overturned); excludes `false_positive`;
  `compliant_confirmed` stays compliant; marks `inconclusive`.
- Groups divergences by domain, then by divergence severity.
- Emits `report_version` + `run_id` (self-contained for the report viewer) and,
  per divergence, a structured `file` (+ `line` when pinpointable) alongside the
  prose `path`.

**Output:** `data/{run_id}-audit-report.json`.

## Gate Configuration

| Step | Structural | Semantic | Human |
|------|-----------|----------|-------|
| DISCOVER | yes | yes | **yes** |
| REVIEW | yes | yes | no |
| VERIFY | yes | yes | no |
| REPORT | yes | yes | no |

## Compliance Statuses

| Status | Meaning |
|--------|---------|
| `compliant` | Code satisfies the Rule Statement |
| `violation` | Code clearly diverges from the Rule Statement |
| `partial` | Code partially satisfies (some cases handled, others not) |
| `unverifiable` | Cannot determine from static reading alone |

## Divergence Severity (degree of divergence — NOT spec obligation)

Every spec is mandatory (there is no MUST/SHOULD/MAY tiering). Divergence severity
grades how badly the implementation diverges:

| Severity | Meaning |
|----------|---------|
| `not_implemented` | The behavior is entirely absent |
| `partial` | A real but incomplete gap |
| `edge_case` | A narrow missed case |

## Output Structure

```
data/                                        # under .riglane/local/workflow_runs/<run_id>/
  {run_id}-discovery-plan.json               # Audit set (from DISCOVER)
  reviews/
    {run_id}-<domain>-review-result.json     # Per-domain traced findings (REVIEW)
    {run_id}-<domain>-review-result.json
    ...
  {run_id}-verified-results.json             # Deep-verified findings (VERIFY)
  {run_id}-audit-report.json                 # Final consolidated document (REPORT)
```

## Edge Cases

**No specs found:** DISCOVER warns at the human gate; REPORT produces an empty
audit.

**No `_registry.json` / no mapping:** the spec is marked `no_registry_mapping`,
but the always-on area-search still discovers its implementing code.

**No implementation found at all:** surfaced as a coverage note (spec↔code
linkage health) and, where relevant, `not_implemented` divergences.

**Filter matches nothing:** DISCOVER catches it at the human gate and lists the
closest specs/domains.

**All compliant:** REPORT shows a 100% compliance rate with no divergences.

## Files

| File | Purpose |
|------|---------|
| `workflow.yaml` | 4-step workflow (DISCOVER, REVIEW, VERIFY, REPORT) |
| `structs/discovery-plan.schema.yaml` | Audit-set schema |
| `structs/review-result.schema.yaml` | Per-domain traced findings schema |
| `structs/audit-report.schema.yaml` | Final consolidated (viewer-ready) report schema |
| `README.md` | This file |
