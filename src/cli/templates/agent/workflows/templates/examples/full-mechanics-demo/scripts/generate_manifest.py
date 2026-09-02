#!/usr/bin/env python3
"""full-mechanics-demo — `generate_manifest` script tool.

Contract (Riglane script tool):
  - the engine invokes this when the subagent calls the tool; args arrive BOTH
    as the WORKFLOW_TOOL_ARGS env var (full JSON) and as CLI `--key=value`
    flags. Parsing the env JSON is the reliable path.
  - print the result as JSON to stdout (exit 0); the stdout text is returned to
    the subagent as the tool result.

Builds a deterministic work manifest of `count` items so the demo run is
reproducible (no LLM-invented data). Output conforms to the work-manifest
struct: {"total": <count>, "items": [{"name": "item-01", "status": "pending"}, ...]}.
"""
import json
import os
import sys


def _read_count(default: int = 3) -> int:
    # Preferred: full args JSON in the env var.
    raw = os.environ.get("WORKFLOW_TOOL_ARGS")
    if raw:
        try:
            args = json.loads(raw)
            if isinstance(args, dict) and "count" in args:
                return int(args["count"])
        except (ValueError, TypeError):
            pass
    # Fallback: CLI `--count=N` or `--count N`.
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a.startswith("--count="):
            try:
                return int(a.split("=", 1)[1])
            except ValueError:
                break
        if a == "--count" and i + 1 < len(argv):
            try:
                return int(argv[i + 1])
            except ValueError:
                break
    return default


def main() -> int:
    count = _read_count()
    if count < 1:
        count = 1
    items = [{"name": f"item-{i:02d}", "status": "pending"} for i in range(1, count + 1)]
    # `token` is a per-call, non-guessable value. The item list is deterministic
    # (so `seed` is reproducible), but the token is something a worker cannot
    # know without actually calling this tool — the `confirm-tool` step requires
    # it, which is how the demo proves a real script-tool round-trip happened.
    token = os.urandom(4).hex()
    print(json.dumps({"total": count, "items": items, "token": token}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
