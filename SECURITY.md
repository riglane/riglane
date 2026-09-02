# Security policy

Riglane runs agent workflows inside other people's repositories: it spawns
subagents with tool access, executes author-declared shell commands, and gates
what those runs are allowed to advance past. It also installs workflows written
by strangers. A private reporting path is therefore not optional, and this file
is it.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting on
this repository (Security → Report a vulnerability), which opens a private
advisory only the maintainer can see.

Please include, as far as you can:

- what an attacker gains, stated plainly (read a file, run a command, get a run
  past a gate that should have stopped it);
- the smallest reproduction you can manage — a `workflow.yaml`, a catalog entry,
  or a sequence of CLI commands;
- the versions: `riglane --version`, `node --version`, and which agent harness
  and version;
- whether it needs a malicious *author* (a shared workflow), a malicious
  *project*, or only a mistaken user.

**Expectations, honestly.** This is a one-maintainer project. You should get an
acknowledgement within a few days. A fix for something that lets shared code run
before a user has enabled it takes priority over everything else on the list.
If you get no reply in a week, please ping the advisory — it means the
notification was missed, not that the report was judged unimportant.

## In scope

Anything that defeats a boundary Riglane claims to hold:

- **The trust gate.** A community workflow becoming runnable without an explicit
  `riglane trust`, or staying trusted after its files changed.
- **Catalog verification.** An installed tree that does not match the entry's
  capability inventory, or a way to make `riglane add` skip the check, the
  revocation list, or the pinned commit.
- **The structural gate.** Getting a run to advance past a step whose declared
  outputs are missing, stale, or schema-invalid.
- **The engine's own files.** Writing `manifest.json`, `trace.json`,
  `gate-result.json`, the write-proof snapshots, `trusted.json`, or the spec
  `_index.json` / `_registry.json` through a path the guards are supposed to
  cover.
- **Command injection** into any of the three places author strings reach a
  shell (`tools[].command` and the two `when.script` deciders) beyond what the
  entry declares, or a *fourth* such place that the audit missed.
- **Secret exposure** — credentials, tokens or environment values reaching a
  place the design says they do not.

## Not in scope

These are known properties of the design, documented rather than hidden. Reports
about them are welcome as discussion, but they are not vulnerabilities:

- **A shared workflow being malicious.** Nothing in the catalog establishes that
  a workflow is harmless — the design says so in the manual, in the CLI, and on
  every entry page. That is what pre-install inspection, the pinned commit and
  `riglane trust` exist to make visible and deliberate. A *specific* malicious
  entry is a **revocation request**: report it privately here or in the catalog
  repository, and it will be added to the revocation list, which the CLI refuses
  to install from.
- **Prose steering an agent.** A step's `goal` reaches a model that already has
  tools in the project. A shared workflow is also a shared prompt. This is
  stated in the docs; it is not solved by showing commands, and we do not claim
  to have solved it.
- **Shell-mediated writes bypassing the file guards.** The guards cover the
  agent's edit tools; a shell redirect is not parsed. This is an accepted,
  documented seam, with self-healing and reconciliation as the backstop.
- **`--skip-approvals` and equivalents.** Deliberately dangerous, labelled as
  such, and off by default.
- Anything requiring an attacker who already has code execution as your user.

## Supported versions

Pre-1.0: fixes land on the latest release, and there is no backporting.
