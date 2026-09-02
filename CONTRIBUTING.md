# Contributing

Riglane is MIT licensed and maintained by one person. This file is mostly about
**where things go** and **what gets refused** — both of which save you more time
than a style guide would.

## This repository is a mirror

The code you are reading is published from a private working tree. The mirror is
regenerated on every release and force-pushed, so **a pull request opened here
cannot be merged** — the next sync would erase it. Pull requests are disabled for
that reason, not to discourage you.

**Issues are open and are the right place** for anything about the engine, the
CLI, or a harness contract.

## Where things go

| You want to | Go to |
|---|---|
| Report something that behaves differently from the docs | **Issues here** |
| Ask how something works | **Discussions → Q&A** |
| Fix or improve the manual | the **`riglane-docs`** repository (pull requests welcome, they merge fastest) |
| Share a workflow | the **`riglane-catalog`** repository (fork, two files, pull request) |
| Report a security problem | **[SECURITY.md](SECURITY.md)** — privately, never a public issue |
| Report a malicious catalog entry | privately too — it becomes a revocation |

## What a good bug report contains

The issue form asks for these because without them the first reply is always a
request for them:

- `riglane --version` and `node --version`;
- **which harness** and its version (the six differ in hook contracts, subagent
  spawning and tool scoping — "it does not work" is not localisable without it);
- the **workflow that misbehaved**, or the smallest version of it that still does;
- what the gate said, if it said anything;
- **the trace**, if the run got far enough to write one. This is the single most
  useful attachment: it records what the engine verified rather than what anyone
  remembers.

Before filing, two commands answer most questions faster than a thread:
`riglane doctor` checks the whole install chain, and
`/riglane-run-workflow gate-hook-check` proves whether the gate fires on your
harness at all. A surprising share of reports turn out to be a harness that was
not restarted after `riglane init-workflow`.

## What gets refused

Stated up front, because a refusal after you have written the code is worse than
one before:

- **Features that belong in a workflow.** The engine is deliberately small. If
  something can be expressed as a workflow, a script tool, or a decider, that is
  where it goes — not into the engine.
- **A general `goto`.** Backward repetition (`loop_back`) and forward branching
  (`routes`) are separate mechanisms with enforced directions, on purpose.
  Arbitrary jumps were discussed and declined; the validator rejects them.
- **Anything that makes a guarantee weaker to make a run easier.** A flag that
  skips the pre-install inspection, auto-trusts a community workflow, or lets an
  orchestrator advance past a failed gate will not be accepted, however
  convenient. Where enforcement is impossible we say so in the docs instead of
  pretending.
- **Per-harness special cases that leak into shared code.** Each harness is its
  own layer with its own switch arm. Adapters do not reuse each other's files or
  paths.
- **Internal references in text a user or an agent will read.** Issue numbers,
  phase codes and internal file names belong in code comments, never in an error
  message, an agent instruction, a schema description or a template.

## If you do write code

Two things about this codebase that are not obvious:

**The tests are the review.** The suite is large, and several tests are
*inverted* — they assert that a whole category of thing does not exist (no new
process-spawn site, no stale brand string, no NUL byte in source) rather than
that a known case works. If your change breaks one, it is usually the test doing
its job: the fix is to classify what you added, not to relax the assertion.

**Behaviour changes want a note about why.** Most mechanisms have their present
shape because something went wrong once, and the reasoning is recorded next to
them. A change that explains its reasoning is far easier to accept than a diff
that only shows what moved.

Run `npm run build` and the full suite before opening an issue with a patch
attached — and say which harness you verified on, if the change touches one.
