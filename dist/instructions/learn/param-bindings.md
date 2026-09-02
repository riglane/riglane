PARAM BINDINGS — piping output values between steps
══════════════════════════════════════════════════

  param_bindings:
    component: "data/analysis.json::component_name"
    domain: "data/analysis.json::metadata.domain"

SYNTAX: "<file_path>::<json_field_path>"
  • file_path: relative to the current run's dir (or the delegated child's run dir).
  • json_field_path: dot-separated path into JSON (nested fields OK).
  • Extracted value replaces the named workflow param for subsequent steps.

WHEN TO USE:
  • Step 1 discovers something (component name, file list).
  • Step 2 needs that value in its goal or params.
  • Without param_bindings: you'd hardcode values in goals (fragile).

DELEGATION BASE DIR:
  For delegation steps, param_bindings reads from the DELEGATED child's own
  run dir (not the parent's run). Engine handles path resolution automatically.

EXAMPLE FLOW:
  Step 1 (analyze): outputs data/analysis.json with { "component": "UserService" }
  Step 1 param_bindings: { component: "data/analysis.json::component" }
  Step 2 goal: "Refactor {component}" → resolves to "Refactor UserService"

NOTE: {param} substitution in goal text is a plain string operation — it
  works identically in single-line goals and multi-line block scalars (>).
