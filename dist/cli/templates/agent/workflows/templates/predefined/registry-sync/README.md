# registry-sync

Reconcile the spec→code registry (`_registry.json`) with reality. Performs a full analysis of **which source file implements which spec** — tracing direct and indirect relationships — then diffs against the current registry to surface untracked implementations and stale entries. Scope-aware, and advisory about cross-scope placement and domain-structure health. Every change is applied through the engine's `spec_link` tool after a human gate; the registry is **never hand-edited**.

## When to Use

- After manual code edits that affect spec-covered areas
- After refactoring (renamed/moved/deleted files) — catches stale entries
- After adding new files that implement existing specs
- Periodically, to catch drift between code and registry
- Directly: `/riglane-run-workflow registry-sync --scope <scope>`

## Steps

| Step | Kind | Gate | Description |
|------|------|------|-------------|
| **DISCOVER** | subagent | structural + semantic | Resolve the sync set: which specs (active scope + generic, filtered), their CURRENT registry mappings, and the scope coverage hints. Read-only planning. |
| **SCAN** | subagent, parallel per-domain | structural + semantic | For each spec, find the implementing code (direct + indirect), map to a spec role, diff against the registry. Advisory cross-scope analysis using the coverage hints. Read-only. |
| **REVIEW** | subagent | structural + semantic + **human** | Consolidate findings, present the proposed change set + advisory (cross-scope + domain redesign). User approves what to apply. |
| **REGISTER** | inline (orchestrator) | structural + semantic | Apply approved additions/removals via `spec_link(op:add/remove)`. Never touches `_registry.json` directly. |

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `scope` | No | `generic` | Scope to reconcile (`generic`, `all`, or a declared scope id). `generic` is always included alongside. |
| `domain` | No | *(all)* | Limit to a single domain |
| `spec_id` | No | *(all)* | Limit to a single spec (overrides `domain`) |
| `search_paths` | No | *(whole project)* | Comma-separated directories to scan |

## What It Finds

- **New matches** — files that implement a spec but are not in `_registry.json` (or are there with a different role), each with a spec **role** (`implements` / `configures` / `verifies` / `uses` / `affects`), a **confidence** (high/medium/low), and the traced reason.
- **Stale entries** — registered files that no longer exist or no longer relate to the spec.
- **Cross-scope findings (advisory)** — specs whose implementing code sits predominantly in another scope's area, judged against each scope's **coverage hint** (`_scope-config.json`). Surfaced for a human decision; the workflow never moves a spec across scopes itself. Weak/absent without coverage hints — add them via `riglane scope hint <scope> "<text>"`.
- **Domain redesign proposals (advisory)** — when the reconciled corpus shows the domain layout no longer fits (a domain grown too broad → split; near-synonym or sparse siblings → merge; a spec in the wrong domain → move; a stale name → rename). Surfaced for a human decision; not applied.

## How changes are applied

REGISTER is **inline**: the orchestrator calls `spec_link` directly (the engine owns `_registry.json` / `_index.json` — manual edits are blocked). `spec_link(op:add, spec_id, scope, file, role)` for additions; `spec_link(op:remove, spec_id, scope, file, reason)` for removals. The advisory sections (cross-scope, redesign) are recorded in the change report but intentionally NOT applied — they are separate, human-driven follow-ups.

## Files

| File | Purpose |
|------|---------|
| `workflow.yaml` | 4-step workflow (DISCOVER → SCAN → REVIEW → REGISTER) |
| `structs/discovery-plan.schema.yaml` | Schema for DISCOVER output (sync set + current mappings + scope hints) |
| `structs/scan-result.schema.yaml` | Schema for a per-domain SCAN output |
| `structs/registry-changes.schema.yaml` | Schema for REVIEW output (approved changes + advisory) |
