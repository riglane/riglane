# gate-hook-check

Fast diagnostic workflow (3 steps) that tests the full hook → gate → trace pipeline. Each step tests a different scenario:

| Step | What it tests | Expected behavior |
|------|--------------|-------------------|
| `probe-hook` | Does the hook fire at all? | the gate hook invoked, writes to invocations.log and trace |
| `probe-struct` | Does struct validation work? | the gate hook validates output against schema, PASS |
| `probe-retry` | Does the retry loop work? | First attempt FAILS (invalid output), subagent gets feedback, retries, PASSES |

## When to Use

- After initial installation (`riglane init`) to verify hooks work
- After updating the gate hook (`riglane gate-check`) or `hooks.json` to confirm nothing broke
- When troubleshooting "hook not firing" issues
- When verifying the gate retry loop (followup_message → subagent retry)

## Usage

```
/riglane-run-workflow gate-hook-check
```

## Diagnostic Checklist After Running

| File | What to check |
|------|---------------|
| `.riglane/gate-check-invocations.log` | **Most important.** Should have INVOKED + RESULT entries for each step. If empty — the host is not calling the hook. |
| `.riglane/gate-check-error.log` | Should NOT have new entries. If it does — the gate hook is crashing. |
| `.riglane/local/workflow_runs/<run_id>/gate-result.json` | Should exist in the per-run dir. Shows last gate check result. |
| `.riglane/local/workflow_runs/<run_id>/trace.json` | Should have 3 step entries with real invocation data (not synthetic). |

## Interpreting Results

**All 3 steps pass with real trace data** — hook infrastructure is healthy.

**invocations.log is empty** — the host is not calling the `subagentStop` hook. Check:
- the host's hook config has the correct subagentStop entry (`.claude/settings.json` / `.cursor/hooks.json` / `.codex/config.toml`)
- The `command` path is correct relative to the host's CWD
- the host (Claude Code / Cursor / Codex) version supports hooks

**invocations.log has INVOKED but no RESULT** — the gate hook starts but crashes mid-execution. Check gate-check-error.log.

**probe-hook passes but probe-struct fails** — structural validation (`riglane schema-validate`) has an issue.

**probe-retry never gets feedback** — followup_message is not being delivered to the subagent. The hook fires but the host ignores the response.

**All steps are Synthetic in trace** — the orchestrator ignored the STOP rule. This is an orchestrator compliance issue, not a hook issue.
