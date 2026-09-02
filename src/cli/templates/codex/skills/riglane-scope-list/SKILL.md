---
name: riglane-scope-list
description: "List all available scopes (implicit generic + declared in _scope-config.json)"
---

# $riglane-scope-list (Codex)

Display the available scopes for the current project.

> **Codex invocation:** explicitly with `$riglane-scope-list [--counts]`, or implicitly when the user's request matches. (Codex skills use `$name`, not the `/name` form used by other hosts.)

## Usage

```
$riglane-scope-list              # Table with id, source, label
$riglane-scope-list --counts     # Also show number of specs per scope
```

## Behavior

Run:

```bash
riglane scope list [--counts]
```

The `generic` scope is always listed first and marked `[implicit]`. Scopes declared in `_scope-config.json` are marked `[config]`.

With `--counts`, the script scans each scope's directory for `.md` files (excluding management files starting with `_`) and appends a count.

Example output:

```
Available scopes:
  generic     [implicit]  Cross-cutting invariants   (12 specs)
  payments    [config  ]  Payments integration       (47 specs)
  fulfilment  [config  ]  Fulfilment integration     ( 0 specs)
```

## Related

- `$riglane-scope-show` — active scope + available list
- `$riglane-scope-add <id> "<label>"` — create a new scope
