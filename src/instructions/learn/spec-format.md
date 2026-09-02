SPEC FORMAT — authoring a behavioral spec
═════════════════════════════════════════

A spec = ONE behavioral requirement, one file. Specs are ENGINE-OWNED:
author them through the spec_write tool (workflow_learn topic="spec-tools"),
NOT by hand-placing files. The engine mints the id, sets the scope, and
derives the index — you write the content.

ONE spec = ONE rule — never bundle two obligations; for composition or linkage,
reference other rules via related_specs (which MUST point to EXISTING specs). When a
source specifies a contract between parties, spec only the party THIS corpus governs.

FILE LOCATION (the engine decides the exact path):
  .riglane/specs/<scope>/<domain>/<spec_id>.md
    scope    "generic" (universal) or a named scope (any declared scope id).
             ENGINE-SET from the run scope — you do NOT choose the dir.
    domain   logical grouping (ui, auth, rate-limit, …).
             ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ — lowercase words joined by SINGLE
             hyphens. NO underscores, no trailing hyphen (engine rejects).
    spec_id  <domain>-<NNN>, e.g. auth-001. ENGINE-MINTED (high-water
             counter) — you never assign it. A within-batch temp_key /
             proposed handle is only for cross-refs (see topic="spec-tools").

FRONTMATTER — what YOU write (YAML between --- fences):
  domain: ui                         # required
  title: Edit-field character limit  # required — human-readable
  summary: One-line what + why       # required — the index/search hint
  applies_to: [EditField, InputBox]  # required — components/areas it governs
  source_sections: ["3.2"]           # optional — cited source references
  related_specs: [ui-002, web:auth-004]  # optional — KNOWN existing ids
  domain_description: "input widgets" # required ONLY when introducing a NEW domain

ENGINE-SET — do NOT write these (the engine fills them):
  spec_id · scope · created_at · updated_at

NO severity field — every spec is mandatory (MUST by construction). Express
any nuance of obligation in the Rule Statement prose, not a severity tag.
NO status field — a spec that no longer applies is DELETED, not deprecated.

BODY SECTIONS — keep the spec TIGHT (it is read many times by agents who
lack your context; every extra word is a drift surface). REQUIRED, in order:
  ## Rule Statement       ONE sentence, testable, MUST/MUST NOT with concrete
                          values. No hedging ("appropriate", "as needed"). Carry
                          obligation strength in the prose — never strengthen a
                          source "can/may/should" into a "must". A source that only
                          GRANTS an option ("can X", "may Y", "Z, if any") is NOT an
                          obligation: fold it as a clause in the related MUST spec, or
                          write no spec — do not turn a permissive capability into a
                          standalone MUST (there is no severity field to soften it).
  ## Validation Criteria  the EXECUTABLE audit oracle: WHAT to verify, WHERE, and
                          what to EXCLUDE. spec-audit runs it against the code; a
                          violation = a real, REACHABLE path (an unreachable/inert
                          occurrence is NOT one — not a keyword match).
  ## Source Reference     the verbatim source quote + exact section (or, for a spec
                          raised in conversation, the originating decision).
OPTIONAL (add ONLY when the rule is ambiguous; skip when self-evident — a padded
example is dead weight, not a safety net):
  ## Valid Examples       a concrete compliant case.
  ## Invalid Examples     a concrete violating case (often the sharpest audit signal).
Every section must be ADDITIVE, not a restatement of the rule.

CROSS-REFERENCES (two separate channels — never mix):
  • related_specs       refs to ALREADY-EXISTING specs, by id (bare same-scope
                        "ui-002" or qualified "web:auth-004").
  • related_by_temp_key refs to OTHER drafts in the SAME create_batch, by
                        temp_key (the engine resolves them to minted ids).
                        Batch payload only — see topic="spec-tools".

HOW SPECS ARE PRODUCED (never hand-write the .md into .riglane/specs/):
  spec_write(op:create)        one spec (mints id, dedups, writes, indexes).
  spec_write(op:create_batch)  many mutually-referencing specs, atomically.
  spec_write(op:update)        edit an existing spec (id/scope preserved).
  Full tool reference: workflow_learn(topic="spec-tools").

RELATED: topic="spec-tools" (the 3 engine tools + dedup + domains);
  topic="scopes" (scope model); topic="spec-check" (respecting specs when
  changing code).
