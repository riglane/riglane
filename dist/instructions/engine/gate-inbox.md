---
used-by: src/engine/workflow-engine.ts
---
HUMAN GATE (external channel) — the user answers OUTSIDE the terminal,
through the run inbox:
1. STOP and call inbox(op:'rules', name, step) FIRST. It returns the
   message-composition rules and unlocks posting for this pass — a post
   without it is refused, even a valid one. Do not compose from memory.
2. Compose the message per those rules: short `title`, markdown `body`
   giving enough context to decide, `request: {action, args?, choices?,
   recommended?}` (choices = YOUR predefined answers, the user picks
   EXACTLY ONE; offer composite entries like "A + B" when several could
   apply together; recommended names ONE choice as your suggestion —
   rendered on every channel), and
   `options` enabling EXACTLY the response kinds you can act on
   (accept/reject; respond = free text, addable even alongside choices;
   edit only if you will honor it). SEVERAL related questions in ONE
   exchange: `items: [{id, title, body?, options?, request?}, …]` (2+
   items) instead of top-level options/request. ONE question is NOT a
   group: use the top-level fields. Write title, body, and choices in the
   language the run's human-facing reports use (e.g. a workflow output-
   language param) — the person deciding reads the question, so it must
   speak their chosen language.
3. Call inbox(op:'ask', name, step, message) — ONE held call: the engine
   validates + stores the message (on validation errors, fix and ask
   again), delivers it on EVERY channel (inbox UI, webhook, and the
   terminal via a native host dialog when the host supports it), HOLDS
   your call until the answer arrives, records it, and returns it. You
   relay nothing and poll nothing on this path.
4. The ask can return three other shapes — each tells you what to do:
   relay_required (this host cannot render the dialog) → follow its
   ordered directive: relay terminal_presentation as plain text FIRST,
   THEN poll inbox(op:'check', name, message_id) in the SAME turn (wait_ms
   up to 15000; a terminal reply is recorded via inbox(op:'respond'));
   pending (the hold outlived its ceiling) → call ask again with the
   returned message_id IMMEDIATELY to keep holding; a tool timeout or
   cancellation is NOT an answer and NOT a failure → ask again with the
   message_id, same turn. Re-composing the question instead of carrying the
   id does NOT create a second card — ask adopts the open one and tells you
   so (reused_open_question); that is a correction, not an error. Ask
   something genuinely new only after this one is answered, or send both at
   once as `items`. Never answer for the user, never invent options
   the message does not carry, never ask the user how to wait — and never
   proceed without the response. If the user stays away, STOP and report
   the run is waiting — it holds durably and resumes when the answer
   arrives. NEVER abort, clear, or finalize a run because an answer is
   pending.
5. Interpret the response: accept → call step_complete. reject → re-spawn
   THIS step with the response text as feedback (the cursor has not moved);
   choice → the picked entry is in text; respond/edit → apply the text/args
   per their meaning, then complete or re-spawn. For a grouped message,
   response.items carries one answer per item id. If an answer is unclear,
   post a FOLLOW-UP question (posting is already unlocked this pass) — do
   NOT guess, and do NOT edit the step outputs yourself.
6. step_complete REQUIRES a fresh recorded response for EVERY message you
   posted for this step — without them it refuses with
   AWAITING_HUMAN_RESPONSE. A fresh REJECT on a single message refuses
   completion too (USER_REJECTED): re-run the step with the feedback.
