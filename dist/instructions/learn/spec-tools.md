SPEC TOOLS — the engine-owned spec system (write / search / link)
═════════════════════════════════════════════════════════════════

Specs, their index (_index.json), and their code-linkage registry
(_registry.json) are ENGINE-OWNED: never write those JSON files by hand
(a PreToolUse hook hard-blocks it). Three MCP tools are the ONLY sanctioned
way to change them. Steps that author or consume specs are granted these
tools by their capability flags (see topic="spec-check").

─── spec_write — author specs (op-polymorphic) ───
  op:create        one new spec. Engine mints <domain>-NNN (high-water),
                   runs dedup, writes the .md, derives _index.
  op:create_batch  N mutually-referencing specs in ONE atomic call
                   (all-or-nothing). drafts:[{path, temp_key,
                   related_by_temp_key}]. Engine mints all ids, resolves the
                   intra-batch temp_key cross-refs, dedups (incl. candidate-
                   vs-candidate), and writes ALL or writes NOTHING + returns
                   per-draft verdicts to fix and resubmit the whole batch.
  op:update        edit an existing spec (spec_id required; id/scope/
                   created_at preserved, updated_at restamped). No mint.
  op:delete        remove a spec (.md + index entry).
  op:move          RELOCATE spec(s) to another domain/scope — never delete+recreate.
                   spec_id (one) or spec_ids (batch, atomic) + to_domain (+ to_scope
                   for cross-scope, e.g. promote to generic). Engine re-mints the id,
                   moves file+index+registry, rewrites SAME-scope related_specs, and
                   RETURNS cross_scope_refs/body_refs it left for you to op:update.
  op:rename_domain rename a domain (domain → new_domain); moves all its specs. Refused
                   if new_domain already exists (that is a merge, not a rename).
  WHEN to move/rename: a domain has grown into mixed concerns, a spec now belongs to
    another domain/scope, or a domain name no longer fits its specs. Keeping the map
    clean is part of authoring — reorganize proactively; preview with dry_run:true.
  dry_run:true     run the full validation + dedup preview, write NOTHING
                   (the VALIDATE-class preview pattern). For move/rename it also
                   returns the full remap + which refs would auto-rewrite.
  DEDUP HOLD: a near-certain match to an existing spec HOLDS the create
    (status:"near_certain" + matches). Resolve by acknowledging it distinct
    (genuinely different) or dropping it (a real duplicate) — never blindly
    acknowledge to force a write.

─── spec_search — discover specs (deterministic index query) ───
  Returns { results, domains }:
    results  matching spec summaries (spec_id/title/summary/domain/
             applies_to/path); Read the path for the full spec.
    domains  the whole scope landscape (name + description), ALWAYS present.
  Filters (all optional, AND-combined): query (title+summary substring),
    domain (exact/prefix — the RELIABLE filter), applies_to (set overlap),
    scope (default = active + generic).
  DISCOVERY PATTERN: unsure which specs apply? Call spec_search (even with no
    filter), read `domains`, then call again with domain:<name> for that
    domain's COMPLETE spec-set. query/applies_to are recall-limited; domain is
    exact. spec_search({}) is valid — a first call need not know a domain.

─── spec_link — maintain the code↔spec registry ───
  op:add     record that a file relates to a spec:
             spec_link(op:add, spec_id, file, role). role ∈
             {implements, configures, verifies, uses, affects}:
               implements — produces the behavior (verify ALL requirements)
               configures — sets constrained values
               verifies   — tests it
               uses       — consumes the contract
               affects    — indirect dependency (re-verify on change)
  op:remove  remove a mapping; requires a `reason`; the engine warns with
             provenance (no silent removal). Remove only if YOUR change is the
             cause; flag a suspected pre-existing wrong mapping instead.
  Provenance (added_by / added_at) is ENGINE-SET — you do not pass it.

DOMAINS:
  A domain groups many specs; its name is the spec_id prefix. Introducing a
  NEW domain requires a one-line domain_description on the spec frontmatter.
  REUSE an existing domain rather than coining a near-synonym ("auth",
  not "authn") — spec_write and spec_search echo the domain landscape to help.

RELATED: topic="spec-format" (the .md shape); topic="spec-check" (respecting
  and registering specs when changing code); topic="scopes".
