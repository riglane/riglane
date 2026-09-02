---
name: riglane-scope-show
description: "Show the currently active scope and where it was resolved from"
---

# $riglane-scope-show (Codex)

Display the active scope for spec operations and its resolution source.

> **Codex invocation:** explicitly with `$riglane-scope-show`, or implicitly when the user's request matches. (Codex skills use `$name`, not the `/name` form used by other hosts.)

## Usage

```
$riglane-scope-show
```

No arguments.

## Behavior

Run the Bash tool to execute:

```bash
riglane scope show
```

The script resolves the active scope via the priority chain:

1. CLI `--scope` flag (n/a for this command — no CLI workflow context)
2. `.riglane/local/active-scope` (user override)
3. `.riglane/specs/_scope-config.json` `default_active_scope`
4. `generic` (hard-coded fallback)

Output format:

```
Active scope: payments
Label:        Payments integration (v2 API)
Source:       user (.riglane/local/active-scope)

Available scopes:
  generic     [implicit]  Cross-cutting invariants (implicit; always available)
  payments    [config  ]  Payments integration (v2 API)
  fulfilment  [config  ]  Fulfilment integration (v1 API)
```

## Related

- `$riglane-scope-set <id>` — change active scope
- `$riglane-scope-unset` — clear override and fall back to project default
- `$riglane-scope-list` — list available scopes only
