---
name: riglane-scope-set
description: "Set the active scope for spec operations (user-level override, or project default with --project)"
---

# riglane-scope-set (OpenCode)

Change the active scope used by spec-touching workflows and skills.

> **OpenCode invocation:** loaded on demand via the `skill` tool when the user's request matches — ask conversationally (e.g. "set the active scope to payments"). OpenCode has no slash form for skills.

## Usage

```
riglane-scope-set <scope-id>              # User-level override (writes .riglane/local/active-scope)
riglane-scope-set <scope-id> --project    # Team-level default (writes _scope-config.json default_active_scope)
```

## Behavior

Run:

```bash
riglane scope set <scope-id> [--project]
```

The script:

1. Validates that `<scope-id>` matches `^[a-z][a-z0-9-]*$`
2. Validates that `<scope-id>` is either `generic` (implicit) or declared in `_scope-config.json`
3. Without `--project`: writes `<scope-id>\n` to `.riglane/local/active-scope` (creates dir if needed, gitignored)
4. With `--project`: sets `default_active_scope: <scope-id>` in `.riglane/specs/_scope-config.json`, commits via atomic replace

If the scope is not found, the command exits with error and suggests `riglane-scope-add` or `riglane-scope-list`.

## Examples

```
riglane-scope-set payments             → user now works in payments scope
riglane-scope-set generic              → user explicitly works only on generic rules
riglane-scope-set fulfilment --project → team default becomes fulfilment (committed to git)
```

## Related

- `riglane-scope-add` — create a new scope
- `riglane-scope-unset` — remove user override
- `riglane-scope-show` — display current active scope
- `riglane-scope-list` — list available scopes
