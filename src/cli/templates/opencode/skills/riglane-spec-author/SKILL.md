---
name: riglane-spec-author
description: "Propose and author a behavioral spec when a durable or regulatory requirement emerges in discussion — via spec_write (the engine validates, dedups, and mints the id). For use in conversation with the user, not inside a workflow step."
---

# riglane-spec-author

Author a behavioral spec — one requirement per file. The Riglane engine owns identity, validation,
dedup, and the index/registry. You author the **content** and call the tool; you never hand-edit
`_index.json` / `_registry.json` (the engine writes them — manual edits are blocked).

## When
- In discussion with the user, a **durable / regulatory** requirement emerges that should persist as a spec.
- Explicit request, or the `skill` tool loads this when the user's request matches.
- **Bulk** extraction from a document (many mutually-referencing specs) → use the `doc-spec-extraction`
  workflow instead (it batches via `create_batch`), not this skill.

## Procedure
1. **Scope.** Write to the active scope by default; promote to `generic` only for a genuinely universal
   rule (when in doubt: active). Read set = active + generic.
   - **Coverage hint (proactive).** Check the active scope's coverage hint (`riglane scope show`). It states
     what the scope governs and what belongs elsewhere — use it to confirm this requirement actually
     belongs to this scope (a rule about a different integration → its scope; a cross-integration
     invariant → `generic`). If the scope is a non-`generic` integration scope and has **no** hint yet,
     proactively OFFER to add one — a one-to-three-sentence description of what it covers and what does
     NOT belong (with where those go). It sharpens every future placement decision. On agreement:
     `riglane scope hint <scope> "<text>"`.
2. **Preflight — dedup + domains.** Call `spec_search` for the area / keywords. It returns matching
   specs **and** the current `domains` list. **Reuse an existing domain** (don't invent a near-synonym);
   check whether the requirement is already covered before creating a duplicate.
3. **Author content.** One requirement = one file: YAML frontmatter + Markdown body. Required sections:
   Rule Statement / Validation Criteria / Source Reference (optional: Valid/Invalid Examples, only when
   the rule is ambiguous). Keep it TIGHT — a testable one-sentence Rule Statement; never strengthen a
   source "can/may/should" into a "must". Do **not**
   write engine-set fields (`spec_id`, `scope`, dates). Format reference: `workflow_learn(topic="spec-format")`
   — the engine validates against the same bundled schema, so don't restate it here.
4. **Register.** Call `spec_write(op:create, scope, content)`. The engine validates, runs dedup, mints
   `<domain>-NNN`, and derives the index.
   - **Dedup pushback** (near-certain hold) → choose one: `acknowledge_distinct` (genuinely different),
     abandon (already covered), or `spec_write(op:update, spec_id:<match>)` (merge into the existing spec).
   - Introducing a **new domain** → include a one-line `domain_description` in the frontmatter.
5. Report the assigned `spec_id`.

`spec_search` / `spec_write` are Riglane `workflow_engine` MCP tools (OpenCode surfaces them as
`workflow_engine_spec_search` / `workflow_engine_spec_write`).

## Do NOT
- Hand-write `_index.json` / `_registry.json` — engine-owned, and manual edits are blocked.
- Add severity / status / tags — no such fields exist (every spec is binding; conditional obligation lives as
  prose inside the Rule Statement).
