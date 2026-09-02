---
name: riglane-scope-add
description: "Create a new scope — add entry in _scope-config.json (id + label + coverage hint), create directory + empty indexes"
---

# $riglane-scope-add (Codex)

Declare a new scope. Self-contained: updates config and creates the directory with empty `_index.json` and `_registry.json`.

> **Codex invocation:** explicitly with `$riglane-scope-add <id> "<label>"`, or implicitly when the user's request matches. (Codex skills use `$name`, not the `/name` form used by other hosts.)

## Usage

```
$riglane-scope-add <id> "<label>" [--hint "<coverage>"]
```

- `<id>`: lowercase, starts with a letter, digits and hyphens only (`^[a-z][a-z0-9-]*$`)
- `<label>`: human-readable description (used in `$riglane-scope-list`, error messages, analysis reports)
- `--hint`: **coverage hint** — WHAT this scope's specs govern and, ideally, what they do NOT (with where those belong instead). Strongly recommended (see below).

## Proactively capture a coverage hint

A scope's **coverage hint** is the single most useful signal for keeping specs in the right scope: the engine injects it into the scope-orientation guidance agents receive at `spec_check` / `spec_authoring` steps, and it is what lets an agent judge whether a given spec or file belongs to THIS scope or another. Without it, cross-scope placement is pure guesswork.

**If the user did not supply a hint, ASK for one before creating the scope.** Interview briefly:

- What does this scope cover? (protocol / integration / regulatory area / subsystem)
- What is explicitly OUT of scope, and where does it belong instead? (e.g. "shared validation → generic", "the fulfilment integration → fulfilment")

Then compose a one-to-three-sentence hint, e.g.:

> `Payments API protocol, checkout, refunds. NOT: cross-cutting invariants (→ generic); the fulfilment integration (→ fulfilment).`

Only skip the hint if the user declines — then remind them they can add it later with `riglane scope hint <id> "<text>"`.

## Behavior

Run:

```bash
riglane scope add <id> "<label>" --hint "<coverage>"
```

The script:

1. Validates `<id>` format
2. Refuses if `<id>` == `generic` (reserved)
3. Refuses if `<id>` already exists in `_scope-config.json`
4. Creates `_scope-config.json` if absent (with `scopes: [], default_active_scope: null`)
5. Appends `{id, label, hint?}` to `scopes[]`
6. Creates `.riglane/specs/<id>/` with empty `_index.json` and `_registry.json`

Atomic writes where possible. When `--hint` is omitted the CLI prints a TIP with the exact `riglane scope hint` command to add one later.

## Examples

```
$riglane-scope-add payments "Payments integration (v2 API)" --hint "Payments API protocol, checkout, refunds. NOT: cross-cutting invariants (→ generic), the fulfilment integration (→ fulfilment)."
$riglane-scope-add fulfilment "Fulfilment integration (v1 API)"
$riglane-scope-add compliance "Regional compliance requirements" --hint "Audit logging, retention limits, data residency. NOT: business rules (→ generic)."
```

## Related

- `riglane scope hint <id> "<text>"` — set or replace the coverage hint later (empty text clears it)
- `$riglane-scope-list` — verify the new scope appears (with its hint)
- `$riglane-scope-set <id>` — switch to working in the new scope
