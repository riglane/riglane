# doc-spec-extraction — Extract Specs from Documentation

Extracts behavioral specifications from any technical document — programming guides, API references, standards, specifications. Performs **deep analysis** to find requirements that may be scattered across sections, interdependent, or implicit.

Outputs go to `.riglane/specs/<scope>/` for reuse by other workflows (spec-audit, registry-sync, etc.).

## Why this workflow exists

Large technical documents (thousands of lines) contain requirements buried across chapters, cross-referencing each other, sometimes contradicting each other. Manually extracting and organizing them is tedious and error-prone. This workflow automates the process. **ANALYZE runs first and always**; from its plan two independent branches run when — and only when — they apply:

1. **Deep analysis** (always) — reads the full document, discovers domains and requirements, dedups against existing specs, proposes domain/spec redesign where the existing layout no longer fits, and writes an `execution_plan` roadmap the branches key on
2. **Extract branch** *(runs only when there are new specs to draft)* — parallel per-domain drafting → cross-validation (engine batch dry-run + semantic reading) → ONE atomic `create_batch` commit; the engine mints ids, resolves cross-references, derives the index
3. **Reorganize branch** *(runs only when ANALYZE proposed applicable move/rename redesign)* — the user approves proposals per-move and the engine applies them via `spec_write(op:move / rename_domain)`, so each run also *improves* the existing tree, not only appends to it

Because extraction is a **branch, not a mandatory step**, a run with nothing new to draft (e.g. everything was already covered) does not fail — it skips straight to reorganize. All four combinations of "new specs? × reorganize?" are handled, including "0 new specs but existing specs to move."

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `source` | **Yes** | — | Path to the source document |
| `scope` | No | `generic` | Target scope for the specs. Must be `generic` or a scope declared in `.riglane/specs/_scope-config.json` |
| `focus` | No | *(full document)* | Free-text: which sections/topics to analyze |
| `supplementary` | No | — | Path to a supplementary document (FAQ, errata, addendum) |
| `domain` | No | *(auto-discover)* | Target domain for the specs |
| `consider_reorganize` | No | `true` | When on, ANALYZE proposes redesign and approved move/rename proposals are applied after commit (CURATE → APPLY). Set `false` to skip redesign entirely (create-only run) |

## Usage

```
# Analyze a full document
/riglane-run-workflow doc-spec-extraction --source "docs/programming-guide.md"

# Focus on specific topics
/riglane-run-workflow doc-spec-extraction --source "docs/api-reference.md" --focus "authentication and authorization"

# With supplementary document
/riglane-run-workflow doc-spec-extraction --source "docs/riglane-spec.md" --supplementary "docs/faq.md"

# Target a scope + domain
/riglane-run-workflow doc-spec-extraction --source "docs/guide.md" --scope <scope> --domain <domain>
```

## Steps

### Step 1: ANALYZE (human gate)

Reads the full source document and performs deep requirements analysis.

**Key behaviors:**
- Even with `--focus`, reads the FULL document for cross-references and dependencies
- Identifies requirements scattered across multiple sections; traces indirect dependencies; extracts implicit requirements from examples and error descriptions
- Reuses the scope's existing domain names instead of inventing near-synonyms
- **Scope-fit check** — consults the target scope's coverage hint (`_scope-config.json`); a requirement that clearly belongs to a different scope (or `generic`) is flagged in `discrepancies` rather than silently drafted into the wrong scope
- **Dedups proactively** against existing specs in the target scope AND `generic`: already-covered requirements are skipped (`covered_skip`); near-matches judged distinct are drafted and flagged (`near_match_distinct`)
- **Redesign analysis** — when the scope already has domains/specs (and `consider_reorganize` is on), evaluates whether the CURRENT layout still fits the growing corpus and records `redesign_proposals`: `split_domain`, `merge_domains`, `rename_domain`, `move_spec`, `merge_specs`, `update_spec`. Grounded in actual spec ids/domains, each with a rationale and a concrete suggested action. The move/rename-reducible kinds are **applied** after commit (see Step 5); `merge_specs`/`update_spec` are content edits that stay advisory
- Assigns every planned requirement a batch-globally-unique `temp_key` (becomes the draft filename and the `create_batch` handle — the engine mints the final `<domain>-NNN` at commit)
- Flags ambiguities and discrepancies for user review
- **Scope boundary:** sibling scopes are invisible — never inspected, never touched

**Output:** `data/analysis-report.json` — scope resolution, understanding summary, domains with requirements + cross-reference graph, dedup findings, redesign proposals, discrepancies.

**Gate:** Human — user reviews the analysis (including the redesign proposals as their own section) and confirms. Rejecting with feedback re-runs ANALYZE — e.g. to re-plan placement around an approved split/merge proposal. **After the gate passes**, a `routes` decider (`scripts/has-draftable.mjs`) checks the plan: if ≥1 domain has requirements to draft it enters the **extract branch** (Steps 2–4); otherwise it skips straight to reorganize-gate (Step 5).

### Steps 2–4: EXTRACT branch *(conditional — only when there are new specs to draft)*

These three run as one route on ANALYZE. When ANALYZE found nothing new to draft, the branch is skipped entirely (no "0 items" failure — extraction is a branch, not a mandatory step).

### Step 2: EXTRACT (parallel)

Writes draft spec files per domain from the approved analysis. **Create-only:** every draft is a NEW spec; existing specs are read only for cross-references — deduplication already happened in ANALYZE and the engine enforces it again at commit.

- Parallel fan-out: one subagent per domain, drafts at `data/drafts/{domain}/<temp_key>.md`
- Frontmatter: `domain`, `title`, `summary`, `applies_to` (+ `source_sections`, `related_specs` for existing-spec refs, `related_by_temp_key` for intra-batch refs, `domain_description` for new domains). The engine sets `spec_id`, `scope`, timestamps — drafts never hand-assign ids, and there is NO severity field
- Body sections (required): Rule Statement, Validation Criteria, Source Reference. Optional: Valid Examples, Invalid Examples (add only when the rule is ambiguous)

### Step 3: VALIDATE (human gate)

Two layers over ALL drafts:

- **(A) Engine batch preview** — ONE `spec_write(op:create_batch, dry_run:true)` call over the whole set: structural validation, domain rules, temp_key graph (dangling refs), dedup against existing specs AND candidate-vs-candidate. Writes nothing
- **(B) Semantic verification by reading** — accuracy, completeness, consistency, traceability, testability, examples — each draft against its cited source sections
- **(C) Dedup HOLD adjudication** — near-certain matches are read side-by-side and either acknowledged distinct or dropped
- **Output:** `data/validation-report.json` with per-draft `ready`/`held` verdicts that COMMIT consumes verbatim

### Step 4: COMMIT

Persists the `ready` drafts via ONE `spec_write(op:create_batch)` call — atomic, all-or-nothing. The engine mints ids, resolves cross-references (including intra-batch temp_key refs), dedups, writes every `.md`, and derives `_index.json`. Held drafts stay in `data/drafts/` untouched. Prints a detailed summary. This is the last step of the extract branch; control returns to reorganize-gate.

### Step 5: REORGANIZE-GATE + reorganize branch *(conditional)*

`reorganize-gate` is a tiny inline pivot that **always runs** — reached whether or not the extract branch was taken. It does no work itself; its `routes` decider (`scripts/has-applicable-moves.mjs`) checks the analysis report: if ANALYZE proposed ≥1 applicable (move/rename-reducible) redesign, the run enters the two-step reorganize branch; otherwise it ends. (Owning the route here — not on COMMIT — is what makes reorganize reachable even when extraction was skipped.)

- **CURATE (human gate)** — presents the applicable proposals (`move_spec`, `split_domain`, `merge_domains`, `rename_domain`), captures the user's **per-move** decision (accept some, skip others), and writes `data/approved-moves.json` (an EMPTY set is legal → APPLY no-ops)
- **APPLY** — executes each approved operation via `spec_write(op:move / op:rename_domain)`; the engine re-mints ids, rewrites same-scope `related_specs` across the live tree (so any just-committed new specs' refs are fixed too), and updates the index/registry atomically. Body/prose references to a moved id are surfaced as warnings for the user to resolve

This is **create-last**: new specs (if any) are committed first, then existing specs move into the (possibly new) domains — so a single run both appends and tidies. `merge_specs`/`update_spec` proposals are never auto-applied (content edits — separate manual pass).

## Gate Configuration

| Step | Structural | Semantic | Human |
|------|-----------|----------|-------|
| ANALYZE | ✅ | ✅ | ✅ |
| EXTRACT *(extract branch)* | ✅ | ✅ | — |
| VALIDATE *(extract branch)* | ✅ | ✅ | ✅ |
| COMMIT *(extract branch)* | ✅ | ✅ | — |
| reorganize-gate *(inline pivot)* | — | — | — |
| CURATE *(reorganize branch)* | ✅ | ✅ | ✅ |
| APPLY *(reorganize branch)* | ✅ | ✅ | — |

## Running against a scope that already has specs

Re-running on the same document/scope is safe by construction:

- **Dedup** (ANALYZE + engine at VALIDATE/COMMIT) prevents duplicate specs — covered requirements are skipped, near-matches are surfaced for human adjudication
- **Redesign proposals** (ANALYZE) tell you when the accumulated corpus has outgrown its domain layout — e.g. a domain that should split, sibling domains that should merge, existing specs that belong elsewhere. Move/rename-reducible proposals (`move_spec`, `split_domain`, `merge_domains`, `rename_domain`) are applied after commit through the CURATE → APPLY branch when you approve them (see Step 5); `merge_specs`/`update_spec` (content edits) stay advisory for a separate pass. Set `consider_reorganize=false` to skip redesign entirely
- Existing specs' **content** is never overwritten — the pipeline only creates new specs and *relocates* existing ones (move/rename) when you approve it

## Output Structure

```
.riglane/specs/<scope>/
├── _index.json                 # Derived by the engine — never hand-edited
├── _registry.json              # Implementation mapping (files → specs)
├── <domain>/
│   ├── <domain>-001.md
│   └── ...
└── ... (one directory per domain)
```

Spec frontmatter is engine-owned where it matters: `spec_id`, `scope`, `created_at`, `updated_at` are set by `spec_write`; drafts supply `domain`, `title`, `summary`, `applies_to`, `source_sections`, `related_specs`. Body sections (required): Rule Statement, Validation Criteria, Source Reference. Optional: Valid Examples, Invalid Examples (add only when the rule is ambiguous).

## Files

| File | Purpose |
|------|---------|
| `workflow.yaml` | Workflow definition. ANALYZE (always) → **extract branch** [EXTRACT → VALIDATE → COMMIT] → reorganize-gate → **reorganize branch** [CURATE → APPLY]. Both branches are conditional `routes`. |
| `structs/analysis-report.schema.yaml` | Schema for the ANALYZE output (JSON), incl. `redesign_proposals` + the `execution_plan` roadmap |
| `structs/validation-report.schema.yaml` | Schema for the VALIDATE output (JSON) |
| `structs/approved-moves.schema.yaml` | Schema for the CURATE output (JSON) — the per-move-approved reorganization ops APPLY executes |
| `scripts/has-draftable.mjs` | `routes` decider — enters the extract branch iff ANALYZE found ≥1 domain with requirements to draft |
| `scripts/has-applicable-moves.mjs` | `routes` decider — enters the reorganize branch iff ANALYZE proposed an applicable move/rename |
| `README.md` | This file |
