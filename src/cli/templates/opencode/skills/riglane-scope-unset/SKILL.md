---
name: riglane-scope-unset
description: "Clear the user-level active scope override and fall back to project default"
---

# riglane-scope-unset (OpenCode)

Remove `.riglane/local/active-scope`. Next command will resolve the active scope from `_scope-config.json` → `default_active_scope` or fall back to `generic`.

> **OpenCode invocation:** loaded on demand via the `skill` tool when the user's request matches — ask conversationally. OpenCode has no slash form for skills.

## Usage

```
riglane-scope-unset
```

No arguments.

## Behavior

Run:

```bash
riglane scope unset
```

If the file did not exist, reports "no override to clear" (no-op, not an error).

## Related

- `riglane-scope-set <id>` — set user-level override
- `riglane-scope-show` — display current active scope after unset
