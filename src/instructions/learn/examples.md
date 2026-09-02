EXAMPLES — common workflow patterns
═══════════════════════════════════

── MINIMAL (2 steps, no params, no structs) ──

name: code-review
version: 1
description: Review code and write summary

steps:
  - name: analyze
    goal: "Read src/ and identify code quality issues"
    outputs:
      - path: data/issues.md
  - name: report
    goal: "Write a summary report of all findings"
    inputs:
      - path: data/issues.md
        inject: "reference"
    outputs:
      - path: data/report.md

── WITH STRUCT VALIDATION ──

steps:
  - name: extract
    goal: "Extract API endpoints from source code"
    outputs:
      - path: data/endpoints.json
        struct: endpoint-list     # Validated by gate

── PARALLEL FAN-OUT ──

steps:
  - name: discover
    goal: "List all modules to audit"
    outputs:
      - path: data/modules.json
        struct: module-list
  - name: audit
    goal: "Audit the assigned module for issues"
    parallel: true
    parallel_key: "module-list.modules[*]"
    outputs:
      - path: data/audit-result.json
        struct: audit-result
  - name: summarize
    goal: "Combine all audit results into final report"
    carry_forward: true
    outputs:
      - path: data/final-report.md

── CONTROL FLOW (loop/routes/lanes/inbox) — learn from the LIVE demos ──

Runnable reference workflows exist for every control-flow mechanic:
loop-demo, routes-demo, parallel-lanes-demo, inbox-demo, planning-demo.
See workflow_learn(topic="predefined-workflows") for what each shows.

── DELEGATION (reuse existing workflow) ──

steps:
  - name: analyze-component
    delegate_to: delegation-demo-target   # any workflow name resolves
    subagent: false                        # REQUIRED for delegation
    params:
      component: "{component}"             # values INTO the child
    param_bindings:
      verdict: "data/analysis.json::verdict"  # values OUT of the child run

Live reference: examples/delegation-demo (+ delegation-demo-target).
