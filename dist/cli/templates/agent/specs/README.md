# Behavioral Specs

This directory contains behavioral specifications — requirements the project's
code must satisfy. Specs are **engine-owned**: they are created, indexed, and
linked to code exclusively through the engine's spec tools; never hand-edit
`_index.json` / `_registry.json` (a hook blocks it).

## Structure

```
specs/
├── _scope-config.json    # Declared scopes (generic always exists implicitly)
├── README.md             # This file
└── {scope}/              # Per-scope directories (generic/, plus any declared scope)
    ├── _index.json       # Per-scope spec index (ENGINE-owned)
    ├── _registry.json    # Per-scope code↔spec linkage (ENGINE-owned)
    └── {domain}/         # Per-domain directories
        └── {spec_id}.md  # One spec = one behavioral rule (frontmatter + body)
```

## How Specs Are Created

- **Interactively:** run the `/riglane-spec-author` skill — it drives the engine's
  `spec_write` tool (op:create / create_batch / update / delete, with dedup
  and dry-run preview).
- **In bulk from documentation:** run the `doc-spec-extraction` workflow
  (analyze → extract → validate → commit).
- **Never manually** — the engine mints spec ids, sets the scope, and derives
  the index; hand-placed files bypass all of that.

## How Specs Are Consumed

- **Discovery:** the `spec_search` tool (deterministic index query; the
  `domain` filter is the reliable one).
- **Compliance while coding:** steps with `spec_check: true` get engine-injected
  guidance; `/riglane-spec-check` audits interactively; the `spec-audit` workflow
  runs a full read-only code-compliance audit.
- **Code↔spec linkage:** the `spec_link` tool records which files implement /
  configure / verify / use / affect a spec; `registry-sync` reconciles drift.

## Format Reference

Call `workflow_learn(topic="spec-format")` for the authoritative spec format
and `workflow_learn(topic="spec-tools")` for the tool surface.
