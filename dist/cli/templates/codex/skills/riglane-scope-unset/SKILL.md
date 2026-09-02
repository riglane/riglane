---
name: riglane-scope-unset
description: "Clear the user-level active scope override and fall back to project default"
---

# $riglane-scope-unset (Codex)

Remove `.riglane/local/active-scope`. Next command will resolve the active scope from `_scope-config.json` → `default_active_scope` or fall back to `generic`.

> **Codex invocation:** explicitly with `$riglane-scope-unset`, or implicitly when the user's request matches. (Codex skills use `$name`, not the `/name` form used by other hosts.)

## Usage

```
$riglane-scope-unset
```

No arguments.

## Behavior

Run:

```bash
riglane scope unset
```

If the file did not exist, reports "no override to clear" (no-op, not an error).

## Related

- `$riglane-scope-set <id>` — set user-level override
- `$riglane-scope-show` — display current active scope after unset
