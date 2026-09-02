RUN INBOX — human answers outside the terminal
═══════════════════════════════════════════════

WHAT: every run has a durable inbox (one file per message in the run dir).
A human-gated step — and the loop/route human deciders — can deliver its
question there instead of (or in addition to) the harness terminal. The
question AND the answer become engine-owned artifacts: who answered, what,
when, through which channel. The engine is the sole writer of the store;
agents never touch the files directly.

WHEN TO USE: the user is not watching the terminal (long unattended runs,
runs launched from a page or another program), an external system must
consume the question (webhook), or the approval must be auditable.

CONFIG (channel per human question; step gate override wins over the
workflow gate default):
  gate:
    human: true
    human_channel: external     # terminal (default) | external | both
  loop_back:
    when: { human: true, human_channel: both }
  routes:
    when: { human: true, human_channel: external }
  human_channel without a resolved human: true is a LOAD error — the
  channel would never route anything.

THE TRANSPORT (why a question can be refused): answers arrive over the
project's LOCAL SERVER — the Local API is the only way IN. A webhook
notifies a consumer and carries the return address, a browser page or a
terminal relay only SHOW the question; all of them answer through that one
endpoint. The engine brings the server up because a message leaves the
terminal — no browser and no viewer is involved. If it cannot start:
  • channel external — the post is REFUSED and NOTHING is stored (a stored
    question with no way back would park the run forever). This is not a
    failure of the step: do NOT retry it, clear it, or finalize the run —
    report that the channel has no transport. `riglane serve` in the
    project hosts the same answer endpoint; then ask again.
  • channel both — the message is stored and the result carries a
    channel_warning: only the terminal side can answer for now.
workflow_init reports external_channel {declared, discovery} when the
workflow has such a gate; `discovery` is the file where a program reads the
live base URL + token, so it never has to guess a port.

THE FLOW (gate.human with an external channel; ONE op-polymorphic tool:
  inbox(op: rules | ask | post | check | respond)):
  0. inbox(op:'rules', name, step) — fetch the message-composition rules
     IMMEDIATELY before composing. This is forced by construction: the
     call stamps the manifest, and asking without a stamp fresh for the
     current pass is refused EVEN IF the message is valid. The rules are
     meant to be the last thing in context at composition time (anti
     lost-in-the-middle); a loop pass expires the previous fetch.
  1. The orchestrator composes a STRUCTURED message per those rules and
     calls inbox(op:'ask', name, step, message) — ONE HELD CALL: the
     ENGINE validates the structure BEFORE storing (invalid = rejected
     with per-field errors; fix and ask again), stores it, delivers it on
     EVERY channel, HOLDS the call open until the answer arrives, records
     it, and returns it. On channel both the terminal question is the
     ENGINE'S OWN: a native host dialog (MCP elicitation) rendered from
     the stored structure — a dialog answer is engine-recorded
     (via:"terminal"), so no agent ever composes or relays it. Degraded
     shapes tell you what to do: relay_required (host without dialogs) →
     relay terminal_presentation as plain text FIRST, then poll in the
     SAME turn; pending (hold ceiling reached) or a tool timeout/cancel →
     ask again with the returned message_id, same turn. Carrying that id
     is the contract, but not the safety net: a fresh ask on a step that
     ALREADY has an unanswered question from this pass ADOPTS it rather
     than minting a second card beside it (reused_open_question says so).
     That matters because step_complete demands a fresh answer for EVERY
     message posted this pass — a duplicate is not clutter, it is a second
     obligation the person cannot see. Genuinely several questions at once
     are `items`: ONE message, one exchange. The lower-level
     ops remain for manual control: inbox(op:'post', name, step, message)
     stores without holding (and does NOT adopt — several questions in
     flight is its business); fix and re-post on validation errors.
  2. The engine stores it durably and, when configured, POSTs a
     SELF-CONTAINED envelope to the inbox webhook. WHERE it goes comes
     from two tiers that are NOT interchangeable — a RUN-level
     destination, resolved at workflow_init and frozen into that run, and
     an AMBIENT project default, resolved at post time:
       RUN-level (first one given wins): --inbox-webhook on the run (or
         the inbox_webhook field of an /api/run call) → the workflow's
         own inbox_webhook field.
       AMBIENT (consulted ONLY when no run-level value was given): config
         engine.inbox_webhook_url → env RIGLANE_INBOX_WEBHOOK.
     Mind the ambient order: the CONFIG value wins over the env var, so
     exporting RIGLANE_INBOX_WEBHOOK does NOT redirect a project that
     already sets one in config.json (the two env vars are different
     things — the run override travels its own way and outranks both).
     To send ONE run somewhere else, use the run-level channel; that is
     what it exists for, and it is also the only one that never writes a
     private URL into a committed file.
     (Sibling per-run lever, same tier model: --no-trace-viewer on the run
     / trace_viewer:"off" on /api/run suppresses auto-opening the trace
     viewer for THIS run — an application with its own UI refuses the
     foreign browser tab without editing the user's config. Viewer only:
     it never suppresses the inbox transport.)
     Every envelope carries an `event`: "question" (a new one, WITH the
     respond block), "answered" (it now HAS an answer, given on ANY channel)
     or "superseded" (its step asked again, so it can never be answered).
     Only "question" carries a respond block — the other two are terminal
     for the question they name. A consumer that
     treats every POST as a new question shows a phantom: branch on `event`.
     The push is a DOORBELL — best-effort, retried, and RECORDED: a refused
     or unreachable consumer leaves post's result carrying a
     delivery_warning and the engine retries on the next inbox call, so do
     NOT re-post the question. The state a client should trust is
     GET /api/inbox.json, which is also how it catches up after downtime.
     The envelope:
     { message, respond: {url, token, body}, run } — the consumer program
     shows the question in ITS OWN UI and answers by POSTing back to
     respond.url with respond.token (a one-shot credential that answers
     only that message and survives server restarts). Fire-and-forget,
     never affects the store.
  3. The human answers through ANY channel: the Agent Messages section
     of the Workflow Studio or the dialog on the trace card, the Local API
     (POST /api/inbox/respond with the serve token — pages and external
     programs), or the terminal — the orchestrator records what it heard
     via inbox(op:'respond') (stamped via:"terminal"). Every answer lands
     as the same durable response record; a message answers exactly once.
  3b. WHERE THE HUMAN LOOKS: post/ask return `inbox_url` — the served
     Messages page. Relay it while you wait, or when you report a pending
     answer: with the viewer never opened (or auto-open off) nothing else
     points the user at their question.
  4. Under relay_required, inbox(op:'check', name, message_id) is the ONLY
     way an agent receives an OUTSIDE answer (an LLM cannot be pushed; it
     sees tool results). Use wait_ms (bounded, max 15000) and wait between
     calls — never busy-loop. A TERMINAL answer never appears in
     op:'check': the store learns it only when you record it via
     op:'respond' — record it immediately instead of polling.
     The run is durable while it waits: the cursor has
     not moved and the manifest holds the state. If the user stays away,
     STOP and report the run is waiting — it resumes when the answer
     arrives; NEVER abort, clear, or finalize a run because an answer is
     pending (a waiting run is a healthy run).
  5. step_complete REQUIRES a FRESH recorded response for EVERY message
     this step posted in the current pass when the channel is
     external|both — without them it refuses (action
     AWAITING_HUMAN_RESPONSE with self-contained instructions). Fresh =
     posted and answered after the step's current started_at, so a loop
     pass can never reuse the previous pass's approval. A fresh REJECT
     on a single-form message also refuses completion (action
     USER_REJECTED): re-run the step with the user's feedback. An
     item-level reject inside a grouped message is YOURS to interpret
     (it can be survey data), not an automatic refusal.

MESSAGE SHAPE (you write CONTENT; the engine mints identity):
  { kind: "human_gate",           # human_gate (default) | loop_decision |
                                  #   route_decision | info
    title: "…",                   # required, short
    body: "…",                    # markdown — enough context to decide
    request: { action: "…", args?: {…}, choices?: ["…", …],
               recommended?: "…" },
    options: { accept: true, reject: true, respond: false, edit: false } }
  Enable EXACTLY the response kinds you can act on (at least one must be
  allowed). OFFERED CHOICES allow a pick on their own (response type
  "choice"): a choices list is an invitation to pick EXACTLY ONE of YOUR
  predefined answers. If several could apply together, offer composite
  entries ("A + B") as their own choices. request.recommended names
  EXACTLY one choice as your suggestion — the engine renders the tag on
  every channel (terminal entry + UI badge); never tag a relayed question
  yourself. options.respond = FREE TEXT —
  you may ALWAYS add it, including alongside choices, when a written
  answer is acceptable.
  Engine-set (never write): message_id, run_id, workflow, step,
  created_at, response, verified_context.

VERIFIED CONTEXT (human_gate messages): the engine reads the step's
  declared outputs from disk at post time and attaches bounded excerpts
  to the stored message (verified_context) — rendered on every channel
  as "verified from disk". The human judges your body AGAINST the real
  artifacts, so a summary composed from stale context (e.g. after a
  resume) cannot silently misdescribe the decision being signed. Write
  body from the artifacts, not from memory; never paste them wholesale
  (the engine already delivers them, verified).

SEVERAL QUESTIONS IN ONE EXCHANGE (grouped message — items):
  { title: "Review the plan",     # the group headline
    body: "…",                    # shared context (optional)
    items: [                      # 2..20 questions, each with its own
      { id: "scope",              #   agent-chosen id (unique, [a-zA-Z0-9_-])
        title: "Is the scope right?",
        options: { accept: true, reject: true } },
      { id: "deploy",
        title: "Where do we deploy first?",
        request: { action: "pick target", choices: ["staging", "prod"] } },
      { id: "notes",
        title: "Anything else?",
        options: { respond: true } } ] }
  items REPLACES top-level options/request (mutually exclusive). The user
  answers every item together; the response arrives as ONE record:
    { type: "items", items: { scope: {type: "accept"}, deploy: {type:
      "choice", text: "staging"}, notes: {type: "respond", text: "…"} },
      responded_at, via }
  Prefer ONE grouped message over N separate posts when the questions are
  related — one notification, one exchange, one audit record. Separate
  messages also work: the engine then requires an answer to EACH.
  A SINGLE question is NOT a group: use the top-level options/request —
  a one-item items list is a SCHEMA ERROR (items requires 2+).

A QUESTION THE RUN LEFT BEHIND: workflow_resume reports the current
step's stored exchange (human_gate_messages + instructions). An ANSWERED
question is consumed, never repeated: do NOT re-ask and do NOT re-begin
(a re-begin re-stamps the pass and orphans the answer) — interpret the
recorded response and complete/re-run accordingly. A still-PENDING one is
resumed with inbox(op:'ask', message_id) — the same exchange. Only when a
step is genuinely begun AGAIN does it ask afresh — the engine counts the
CURRENT pass. The
earlier pass's unanswered questions are marked superseded (they name their
replacement) and refuse an answer, so nobody answers into the void: the store
refuses it, ask/check refuse it instead of waiting forever, the webhook gets a
"superseded" event, and the UI stops offering its controls. Several questions
in ONE pass are untouched: each still needs its own answer.

THE RESPONSE (engine-recorded):
  { type: accept | reject | choice | respond | edit,  # an enabled kind
    text?, args?, responded_at, via: terminal | web | api | webhook }
  Interpretation is YOUR job: accept → step_complete; reject → re-spawn
  THIS step with the response text as feedback (the cursor has not moved) —
  you relay the text into the fresh prompt; to reach LATER passes or steps,
  wire it through a declared output or param_bindings (topic="loop-back");
  choice → text carries the picked entry; respond/edit → apply the
  text/args per their meaning, then complete or re-spawn. If an answer is
  unclear, post a FOLLOW-UP question (posting stays unlocked for the pass)
  — never guess. Never edit the step outputs yourself.

ONE QUESTION, TWO ROLES: the ask posted for a step (default kind
human_gate) IS the message that gate.human enforcement checks at
step_complete — the gate never posts a second question. One ask, from
whoever composes it, both informs the user and satisfies the gate.

DECIDERS (loop_back / routes when.human_channel): the question travels the
same way (kind loop_decision / route_decision + request.choices); the
decision still returns through the loop_decision / route_decision argument
on step_complete, which the engine validates against the legal values.
The hard fresh-response requirement applies to gate.human; decider answers
are recorded for the audit trail.

CHANNEL both: prefer inbox(op:'ask') — the ENGINE renders the terminal
question itself (native host dialog from the stored structure) and holds
the call until any channel answers; you relay nothing. ONLY under
relay_required (a host without dialogs) is the terminal side yours: post's
terminal_presentation is the ENGINE'S rendering of the question (exact
entries + the answer→respond mapping). Relay it VERBATIM as PLAIN TEXT —
NEVER through
a blocking prompt/questionnaire widget (while it waits the orchestrator
cannot see an answer arriving through another channel, and widgets inject
entries of their own). Never rephrase, never add entries (no "wait" /
"simulate" / "abort" inventions), never mark an entry as recommended
yourself (request.recommended is the only way to suggest — the engine
renders it).
After relaying, poll op:'check'; a terminal answer (the user replies while
you wait) is recorded IMMEDIATELY via inbox(op:'respond') — op:'check'
never reports an unrecorded terminal answer. Whichever channel answers
first wins — the audit trail carries every answer regardless of source.

RELATED: topic="gate" (the human gate itself); topic="loop-back" /
  topic="routes" (the deciders); topic="mcp-tools" (the inbox tool
  signature).
