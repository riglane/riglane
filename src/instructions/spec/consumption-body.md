---
used-by: src/engine/spec-tools.ts
---
**Spec check — respect behavioral specs when changing the project.**

BEFORE you change anything:
1. Find the specs relevant to the AREA you are touching — do NOT limit yourself
   to a file list. Discover via spec_search; the RELIABLE path is by domain
   (the recorded domains above — reuse the one your change touches).
   spec_search(domain:<name>) returns that domain's COMPLETE spec-set. If the
   area is broad or unclear, call spec_search by keyword / applies_to (or with
   no filter) and read the returned `domains` to orient. applies_to and
   _registry.json are FAST HINTS, not the only channel — judge by what your
   change actually affects. (Reading _index directly is a last resort — it is
   TWO files, <scope>/_index.json + generic/_index.json; spec_search spans both.)
2. Read each relevant spec and plan your changes to honor its Rule Statement.

AFTER you change:
3. Re-verify the same specs — confirm nothing you changed violates a requirement.
4. If a violation is unavoidable → STOP and report the conflict in your summary.
   A spec conflict is a decision above your level; do NOT silently override a spec.

REGISTRY (spec_link) — when your change makes a file relate to a spec:
5. add: spec_link(op:add, spec_id, file, role). role ∈ {implements, configures,
   verifies, uses, affects} — implements=produces the behavior (verify ALL reqs);
   configures=sets constrained values; verifies=tests it; uses=consumes the
   contract; affects=indirect dependency (re-verify on change).
6. remove: spec_link(op:remove, ..., reason) ONLY if YOUR change is the cause.
   A suspected pre-existing wrong mapping → flag it in your summary, do NOT remove.
