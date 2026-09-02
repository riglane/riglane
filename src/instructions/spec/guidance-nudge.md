# Riglane behavioral specs

This project uses Riglane behavioral specs (`.riglane/specs/`). Two reflexes:

- **Changing the project?** First consult the relevant specs for the area you touch
  (`spec_search`), and honor them. A spec conflict is above your level → **STOP and
  surface it**, don't silently override. → the `riglane-spec-check` skill.
- **A durable / regulatory requirement emerged in discussion?** Propose a spec
  (`spec_write`). → the `riglane-spec-author` skill.

Never hand-edit `.riglane/specs/**/_index.json` or `_registry.json` (engine-owned — use
`spec_write` / `spec_link`). These are Riglane `workflow_engine` MCP tools; full
reference: `workflow_learn`.
