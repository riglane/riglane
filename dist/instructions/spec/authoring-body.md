---
used-by: src/engine/spec-tools.ts
placeholders: scope, fieldsList, sectionsList
---
**Spec Authoring:**
Write to scope '{{scope}}' unless the rule is genuinely universal (→ generic; when in doubt: this scope).
A source often specifies a contract between parties — spec ONLY the obligations of the party THIS
corpus governs; a requirement that is another party's duty does not belong here.

**Format** — YAML frontmatter + Markdown body.
  You write: {{fieldsList}}. New domain → also add domain_description (one line).
  Engine-set, do NOT write: spec_id, scope, created_at, updated_at.
  Required sections: {{sectionsList}}.
  Optional: ## Valid Examples / ## Invalid Examples — add ONLY when the rule is ambiguous;
    skip when it is self-evident. A padded example is a drift surface, not a safety net.

**Write it TIGHT — a spec is read many times by agents who lack your context:**
  - ONE spec states ONE rule. Need composition or linkage? reference other rules via related_specs —
    never bundle two obligations in one spec (split them). related_specs must point to EXISTING specs.
  - Rule Statement: ONE sentence, testable, MUST/MUST NOT with concrete values. No hedging
    ("appropriate", "properly", "as needed", "if applicable").
  - Preserve source modality, never STRENGTHEN it: "can/may/optional/if any" is a PERMITTED
    option — never rendered as "must"; "should" is recommended, not mandatory. Do NOT draft a
    permissive capability as a standalone MUST spec (there is no severity field) — fold a genuine
    option into the related mandatory spec as a clause, or omit it. "Same as X" is an analogy
    about behavior — it does NOT transfer X's obligation, cadence, or strength.
  - Each section ADDS a distinct layer, never restates the rule. Validation Criteria is the
    executable audit oracle: WHERE to check, what to EXCLUDE, and what counts as a REAL
    (reachable) violation — an unreachable or inert occurrence is NOT one. Source Reference =
    the verbatim source quote + exact section. No section may add, broaden, or strengthen the rule.

**Register via spec_write** (op:create): the engine validates, dedups, mints spec_id (<domain>-NNN),
and derives _index/_registry — never hand-edit those. Use dry_run:true to preview validation + dedup.

**Keep the domain map clean (spec_write op:move / rename_domain):** when a domain mixes unrelated
concerns, or a spec now belongs elsewhere, RELOCATE it — never delete+recreate. op:move re-homes one
spec (spec_id) or a batch (spec_ids) into another domain (to_domain) or scope (to_scope); rename_domain
renames a whole domain. The engine re-mints ids and moves file+index+registry+same-scope related_specs,
then RETURNS cross_scope_refs/body_refs it left for YOU to update via op:update. Preview with dry_run:true.
