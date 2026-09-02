---
used-by: src/engine/workflow-engine.ts
placeholders: stepName
---
INBOX MESSAGE RULES — step '{{stepName}}' (posting is now unlocked for this pass):

FORMS (exactly one):
• Single question: { title, body?, request?: {action, args?, choices?,
  recommended?}, options?: {accept?, reject?, respond?, edit?} }.
  Whenever request is present, request.action is REQUIRED — a short
  phrase naming the ask (e.g. "pick deployment strategy").
• Group — SEVERAL related questions answered together: { title, body?,
  items: [{id, title, body?, options?, request?}, …] } — 2 to 20 items,
  unique ids. ONE question is NEVER a group: use the top-level fields.

ANSWER KINDS you enable (per message / per item) — enable ONLY what you
will honor:
• options.accept / options.reject — approve / refuse verdicts. These
  are the ONLY engine-enforced answers (a fresh reject refuses
  step_complete as USER_REJECTED). Do NOT enable them alongside
  request.choices: one response answers the whole message, so verdict
  buttons beside a choice list read as two competing questions.
• request.choices — YOUR predefined answers for picking among
  alternatives; the user picks EXACTLY ONE (response type "choice").
  NEVER verdict-shaped: an "Approve…"/"Reject…" entry belongs to
  options.accept/reject, whose enforcement a choice pick would bypass.
  A verdict PLUS a pick is TWO questions — use items, or accept/reject
  with the pick carried in the respond note. If several could apply
  together, offer
  composite entries ("A + B") as their own choices. To suggest one, set
  request.recommended to EXACTLY one of the choices — the engine renders
  the tag on EVERY channel; NEVER decorate a relayed question yourself.
• options.respond — FREE TEXT from the user. You may ALWAYS add it,
  including alongside choices, when a written answer is acceptable.
• options.edit — the user returns edited request.args.
At least one kind must be enabled.

THE RESPONSE (engine-recorded; validated against YOUR message):
  { type: accept|reject|choice|respond|edit, text?, args?, via,
    responded_at } — "choice" carries one of your entries in text; a
  grouped message returns { type:"items", items: {<id>: {type, text?,
  args?}} } covering every item.

CONDUCT: never answer for the user; never invent options beyond the
message's own; if the channel is 'both', present the SAME question in the
terminal (identical title and entries — no additions like "wait" or
"simulate"). If an answer is unclear, post a FOLLOW-UP question instead
of guessing.

VERIFIED CONTEXT (human_gate): the ENGINE reads the step's declared
outputs from disk at post time and attaches excerpts to your message on
every channel — the human sees the real artifacts beside your body. So:
describe the decision AS THE ARTIFACTS STATE IT (do not summarize from
memory — on a resume your context may predate the files), and do not
paste the artifacts into body yourself: the engine already delivers them,
verified.
