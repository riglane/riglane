GOALS — writing the instruction a subagent executes
═══════════════════════════════════════════════════

The goal is the ONE field only you can write. Everything around it —
outputs with their schemas, resolved paths, inputs, platform facts,
constraints — the engine composes and injects itself. What it cannot
compose is the intent. That is the goal, and it is handed VERBATIM to
the executing agent.

WHO READS IT (write to this audience, and the rules below follow):
  • An agent that REASONS — not a script that matches.
  • In a FRESH context — it has read none of your conversation, none of
    the other steps' goals, nothing "we discussed".
  • Inside an engine-composed frame — outputs, schemas, inputs and
    platform facts arrive alongside the goal, already resolved.
  • Sequentially, within one context — long procedures degrade.

EXPLAIN, DON'T ENUMERATE:
  The executor reasons. Give it the PROBLEM — what this step is for,
  and what must hold when it is done — and it can close gaps you did
  not foresee. Give it only a list of the cases you knew at writing
  time, and that list quietly becomes its whole world: the unlisted
  case is not handled badly, it is NOT HANDLED — or force-fitted to
  the nearest listed one.
  • Where the step must recognize that differently-named things are
    the same thing, state the CRITERION for sameness and let the
    executor judge. Recognition under varied naming is precisely what
    a reasoning executor can do and no fixed mapping can — and a
    hand-listed mapping is stale the day the data grows.
  • Examples are welcome as anchors, never as the specification: mark
    them ("e.g.", "such as") AND state the criterion separately, so
    the executor knows the set is open. An unmarked example reads as
    the complete spec.
  • Test your goal: would tomorrow's new instance require EDITING it?
    Then it describes today's data, not the task.

SELF-CONTAINED (the fresh-context consequence):
  • The subagent starts empty. No "as discussed", no "like the previous
    step did" — data from earlier steps travels via inputs and
    param_bindings, narrative context via carry_forward. If the goal
    needs a fact, thread it through one of those channels.
  • Do NOT restate what the engine injects: output paths and schemas
    are composed into the prompt (restating them in the goal drifts
    when they change), and platform facts (interpreter names, temp
    dirs) are injected per host — "run a Python script" is enough
    (topic "tools").
  • Goal says WHAT to produce; the outputs section says WHERE.

LENGTH IS A RELIABILITY BUDGET (when a goal is really several steps):
  Instructions inside one goal are executed by one agent in one
  context. When many of them are individually SLOW, attention degrades
  with distance — the middle instructions quietly drop (the
  lost-in-the-middle failure). And the gate can only judge the step's
  declared OUTPUTS — never whether instruction 4 of 9 actually
  happened. Splitting converts instruction-following into step
  machinery: each part gets a fresh context and its own gate.
  • A goal that reads as a procedure of slow phases is a step to
    split — see topic "design-choices" (GRANULARITY).
  • A goal that repeats the same work over items is loop_back or
    parallel wearing prose — use the mechanic, not the paragraph.

RELATED: topic="step-fields" (the syntax around the goal);
  topic="design-choices" (when to split); topic="inputs" /
  topic="param-bindings" / topic="carry-forward" (the channels that
  make a goal self-containable); topic="outputs" (WHAT vs WHERE).
