---
name: riglane-spec-check
description: "Respect the project's behavioral specs when changing code, config, or data — consult the relevant specs first, honor them, verify after, and register file-to-spec links via spec_link. A spec conflict is above your level: STOP and surface it."
---

# riglane-spec-check

Honor the project's behavioral specs whenever you change the project (code / config / data).

## Before you change
1. **Scope** = active + generic (universal invariants always apply).
2. **Find the relevant specs by the AREA you are touching** — call `spec_search` (by domain /
   applies_to / keywords). A spec's `applies_to` and `_registry.json` are **fast hints**, NOT the only
   channel — judge by what your change actually affects. `spec_search` also returns the current `domains`.
3. Read each relevant spec; plan your change to honor its **Rule Statement**.

## After you change
4. Re-verify the modified artifacts still honor each relevant spec.
5. **Conflict?** If honoring a spec is impossible → **STOP and report** the conflict in your summary. A
   spec conflict is a decision above your level; do not silently override a spec.

## Register the link
When your change makes a file relate to a spec:
6. `spec_link(op:add, spec_id, file, role)` — `role` ∈:
   - `implements` — produces the behavior → verify ALL its requirements
   - `configures` — sets the constrained values → verify the values
   - `verifies` — tests the behavior → verify coverage
   - `uses` — consumes the spec's contract → don't break the consumption
   - `affects` — indirect dependency that ripples into the spec → re-verify proactively on change
7. Remove a link only if **YOUR change is the cause**: `spec_link(op:remove, ..., reason)`. A suspected
   pre-existing wrong mapping → flag it in your summary, do NOT remove it.

`spec_search` / `spec_link` are Riglane `workflow_engine` MCP tools (OpenCode surfaces them as
`workflow_engine_spec_search` / `workflow_engine_spec_link`). Do NOT hand-write `_registry.json`
(`spec_link` owns it; manual edits are blocked).
