---
name: riglane-scope-list
description: "List all available scopes (implicit generic + declared in _scope-config.json)"
---

# riglane-scope-list (OpenCode)

Display the available scopes for the current project.

> **OpenCode invocation:** loaded on demand via the `skill` tool when the user's request matches — ask conversationally (e.g. "list the spec scopes"). OpenCode has no slash form for skills.

## Usage

```
riglane-scope-list              # Table with id, source, label
riglane-scope-list --counts     # Also show number of specs per scope
```

## Behavior

Run:

```bash
riglane scope list [--counts]
```

The `generic` scope is always listed first and marked `[implicit]`. Scopes declared in `_scope-config.json` are marked `[config]`.

With `--counts`, the script scans each scope's directory for `.md` files (excluding management files starting with `_`) and appends a count.
