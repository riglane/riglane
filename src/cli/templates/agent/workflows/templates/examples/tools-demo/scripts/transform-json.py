#!/usr/bin/env python3
"""transform-json.py — example Python script tool for tools-demo.

Demonstrates a co-located script tool written in Python. The workflow declares
it as `command: "python .riglane/workflows/templates/examples/tools-demo/scripts/transform-json.py"`.
The workflow_tools loader spawns this with the tool's input_schema args as
--key=value flags (here: --input=<path> [--operation=enrich|summarize]).

Input:  --input=<path> [--operation=enrich|summarize]
Output: JSON on stdout.

Operations:
  enrich (default): adds "_enriched": true and "_field_count": <n>
  summarize:        returns {"summary": "N fields", "keys": [first 10 keys]}
"""

import json
import sys


def main(argv):
    input_path = None
    operation = "enrich"
    for arg in argv:
        if arg.startswith("--input="):
            input_path = arg[len("--input="):]
        elif arg.startswith("--operation="):
            operation = arg[len("--operation="):]

    if not input_path:
        print(json.dumps({"error": "Missing --input argument"}))
        return 1

    try:
        with open(input_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(json.dumps({"error": str(e)}))
        return 1

    if not isinstance(data, dict):
        print(json.dumps({"error": "Input is not a JSON object"}))
        return 1

    if operation == "enrich":
        data["_enriched"] = True
        data["_field_count"] = len(data)
        result = data
    elif operation == "summarize":
        result = {"summary": f"{len(data)} fields", "keys": list(data.keys())[:10]}
    else:
        result = data

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
