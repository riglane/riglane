# Instruction catalog — every agent-facing text, in one map

This directory holds the framework's agent-facing PROSE as files. Code
references text by id through `src/engine/instruction-files.ts`
(`instruction('learn/goals')`); the build copies the tree to
`dist/instructions/` (see `scripts/copy-templates.mjs`). Editing a file here
changes what agents read — treat it as product content: universal wording, no
internal vocabulary (enforced by `test/unit/instruction-hygiene.test.ts`).

## What lives HERE (extracted prose)

| Path | Served by | Content |
| --- | --- | --- |
| `learn/<topic>.md` | `workflow_learn` MCP tool (`src/engine/workflow-learn.ts` registry) | The textbook — one file per topic, served verbatim. 26 topics. |
| `spec/guidance-nudge.md` | `SPEC_GUIDANCE_NUDGE_BODY` (`src/adapters/spec-guidance.ts`) | The always-on spec-guidance rule body shared by every host adapter. Must stay identical to the CC/Cursor rule templates (anti-drift test). |
| `engine/gate-human.md` | step payload composition (`workflow-engine.ts`) | The human-gate clause of a gated step's instructions. |
| `engine/gate-inbox.md` | step payload composition (`workflow-engine.ts`) | The external-channel human-gate protocol (the run inbox). |
| `engine/gate-both-channels-note.md` | step payload composition (`workflow-engine.ts`) | The `channel: both` terminal-mirroring doctrine. |
| `engine/inbox-message-rules.md` | `inbox(op:'rules')` (`workflow-engine.ts`) | The message-composition rules; `{{stepName}}` placeholder. |
| `engine/planning-procedure.md` | `composePlanningProcedure` | The whole planning-step procedure (Step 0–6 + anti-patterns); 8 value placeholders, the restriction clauses stay code. |
| `engine/semantic-gate-planning.md`, `engine/semantic-gate-step.md` | collect verdict composition | The semantic-gate evaluation checklists (planning / regular step). |
| `engine/inbox-answered-act-now.md` | inbox responses | The act-on-the-answer directive. |
| `engine/spawn-note-{codex,cursor,gemini}.md` | `composeStepBeginEngineInstructions` | Host-gated JIT spawn notes on step_begin. |
| `engine/model-mode-{inherit,auto,lightest,strongest}.md` | `composeModelInstruction` | The model-MODE instruction per mode. |
| `engine/authoring-error-directive.md`, `engine/decider-error-directive.md` | runtime error surfaces | Stop-and-surface directives (`{{kind}}` on the decider one); the `\n\n` join seam stays code. |
| `engine/constraints-base.md` | `composeStepMaterial` | The base **Constraints** block of every composed subagent task. |
| `engine/worker-role-clause.md`, `engine/shell-denied-clause.md`, `engine/shell-facts-clause.md` | `composeStepMaterial` (flag-appended) | The worker-role boundary (one step, no nested spawns), the author-denied-shell clause, and the shell-facts clause (`{{nodeVersion}}`, `{{py}}`, `{{otherPy}}`, `{{tmpdir}}`). |
| `spec/authoring-body.md`, `spec/authoring-validate-clause.md` | `composeAuthoringBody` (`spec-tools.ts`) | The spec-authoring guidance (`{{scope}}`, `{{fieldsList}}`, `{{sectionsList}}`) plus the validate-mode dry-run clause. |
| `spec/consumption-body.md` | `composeConsumptionBody` (`spec-tools.ts`) | The spec-check consumption protocol (before/after/registry duties). |

Engine fragments carry frontmatter (`used-by:`, `placeholders:`) validated by
`test/unit/engine/instruction-files.test.ts` — used-by must name real
referencing files, placeholders must match `{{…}}` tokens bidirectionally, and
the prose must be self-contained (no "as above").

## What stays IN CODE (and why)

| Surface | Where | Why not extracted |
| --- | --- | --- |
| Lint messages | `src/engine/workflow-lint.ts` | Short, assembled from rule logic, each carries a `topic` pointer into the textbook — the long prose is already here. |
| Situational `engine_instructions` directives | `src/engine/workflow-engine.ts` (inbox status returns, re-begin notes, hold/relay guidance) | Sentence-to-few-line directives with run values (ids, names, timings) woven in — the "sentence around a value" class stays with its logic. |
| Validation / error messages | `src/engine/workflow-engine.ts` and everywhere | Value-woven, one per condition — same class as lint. |
| MCP tool contract descriptions | `src/scripts/workflow-engine-server.ts` (~130 `description:` fields) | Schema-coupled field docs — extracting them apart from the schema they describe would divorce contract from shape. |
| Remaining task-material seams | `composeStepMaterial` / `composeBranchPrompt` (`workflow-engine.ts`) | The value-woven glue between the extracted clauses (inputs/outputs echoes, tool tables, run token) — sentence-around-value class. |
| Spec guidance preamble seams | `src/engine/spec-tools.ts` (`composeSpecGuidance`) | The domain-landscape echo woven from scope state; the prose bodies are extracted above. |
| Rule-file frontmatters | `src/adapters/spec-guidance.ts` | Host-specific config syntax (YAML/comments), a few lines each, coupled to per-host docs. |
| Templates (skills, agents, tools, workflows) | `src/cli/templates/**` | Already files — seeded into projects by `riglane init`/`update`, not served through this loader. |

## Authoring rules

- One file = one complete prose unit an agent reads as a whole. No `{{var}}`
  placeholders unless the loader call site provides them (loader fails loudly
  on both a leftover and a homeless var).
- Files end with exactly one trailing newline; the loader strips it and
  normalizes CRLF, so served text is byte-stable across checkouts.
- Adding a topic: create `learn/<topic>.md` AND register it in the
  `workflow-learn.ts` registry (the registry is the single source of the topic
  list — tooling derives from it).
