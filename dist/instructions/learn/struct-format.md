STRUCT FORMAT — authoring schema files
══════════════════════════════════════

FILE LOCATION:
  <workflow_dir>/structs/<name>.schema.yaml

  Referenced from workflow.yaml as:  outputs[].struct: <name>
  (omit ".schema.yaml" — engine appends it; the validator ensures the
  file exists at workflow load time, so missing schemas fail loud early.)

STANDARD JSON SCHEMA STYLE (use this for ALL new schemas):

  name: scan-result               # Required. Must match filename basename.
  description: Per-domain results # Required. Human-readable purpose.
  version: 1                      # Optional. Schema version.
  type: object                    # Required — triggers JSON Schema mode.
  required:                       # List of required top-level field names.
    - domain
    - results
  properties:
    domain:
      type: string                # string | integer | number | boolean | array | object
      description: …              # Optional but recommended.
    count:
      type: integer
    results:
      type: array
      min_items: 1
      items:                      # Schema applied to every array element.
        type: object
        required: [spec_id, status]
        properties:
          spec_id: { type: string }
          status:
            type: string
            enum: [compliant, violation, partial]
  file_checks:                    # Optional. File-level (universal).
    exists: true                  # Default true.
    min_size: 200
    max_size: 100000
    name_pattern: "^report-.*\.json$"

FIELD CONSTRAINTS:
  type        string | integer | number | boolean | array | object
  enum        list of allowed values (catches typos for status-like fields)
  pattern     regex (strings only)
  min_items   minimum array length
  items       schema for array elements (object or primitive)
  Objects nest recursively — required + properties at every level.

WHAT THE GATE VALIDATES (deterministic, no LLM):
  • File exists, size within bounds
  • JSON/YAML parses cleanly
  • All required fields present, types match
  • Enum + pattern constraints
  • Required array items present
  Semantic correctness (does the value make sense?) is the LLM job —
  not the struct gate. Use gate.semantic if you need LLM checks.

HOW AGENTS SEE THE SCHEMA:
  step_begin embeds the schema content inline in the outputs_text block.
  Subagents already have it in their prompt — no need to Read the
  .schema.yaml file separately.

LEGACY "CUSTOM" STYLE (still supported, NOT recommended for new schemas):
  Uses `format: json|yaml|markdown` + format-specific blocks
  (`json_schema` / `yaml_schema` / `frontmatter` / `required_sections`).
  Prefer Standard JSON Schema style above. The one case where custom
  style is still useful: validating Markdown output files with required
  `## Heading` sections — Standard style cannot express that.

  Markdown custom-style example:
    name: spec
    description: Validation — frontmatter + body
    format: markdown
    frontmatter:
      required:
        - field: spec_id
          type: string
          pattern: "^[A-Z]+-\d{3}$"
        - field: severity
          type: enum
          values: [MUST, SHOULD, MAY]
    required_sections:
      - "Rule Statement"
      - "Validation Criteria"

FIELD CONTAINERS — the key your fields live under depends on the style:
  Standard json     → `properties:` (a map) + `required: [names]`
  Custom json/yaml  → `json_schema.required_fields` / `yaml_schema.
                      required_fields` (lists; each entry keyed `field:`)
  Custom markdown   → `frontmatter.required` (per-entry `field:`; enum
                      values under `values:`, not `enum:`) +
                      `required_sections`
  Plural `fields:` is NEVER a valid container — anywhere. It leaves the
  recognized container empty, so the schema LOOKS alive (presence checks
  still run) while every type/enum/pattern/min_items constraint is
  silently never read. Three shipped schemas sat like that for months.
  Load-time enforcement: a schema whose top level carries UNKNOWN keys
  and NO recognized container is a HARD workflow-load error; unknown
  keys NEXT TO a working container are merely inert (advisory warning
  struct-extra-keys — top-level additionalProperties is not enforced).

TIPS:
  • Start small: file_checks + 2-3 required fields. Iterate.
  • Use `enum` for status-like fields — catches LLM typos.
  • Use `pattern` for IDs (e.g. "^[A-Z]+-\d{3}$").
  • Same struct can validate an output AND the next step's input —
    declare it once, reference from both sides.
  • The SCHEMA decides the parser, never the file extension: explicit
    `format:` wins; else `type: object` + (`required`|`properties`) is
    parsed as json. A schema with NEITHER degrades to file-level checks
    only — the content is silently never validated.
