---
used-by: src/engine/workflow-engine.ts
---
CHANNEL both: prefer inbox(op:'ask') — the ENGINE delivers the question to
the terminal itself (a native host dialog rendered from the stored
structure) and holds your call until the answer arrives from ANY channel;
you relay nothing and record nothing. Only when ask returns relay_required
(a host without dialogs) does the terminal side become yours — then:
relay terminal_presentation VERBATIM, as PLAIN TEXT in your reply —
NEVER through a blocking prompt/questionnaire widget: while the widget
waits you cannot see an answer arriving through another channel (you
freeze), and widgets inject entries of their own. Never rephrase, never
add entries (no "wait", no "simulate", no "abort"), never mark an entry as
recommended yourself — a suggestion travels ONLY through
request.recommended, which the engine renders on every channel. After
relaying, poll op:'check' with wait_ms — an answer from
any OTHER channel appears there. Stay in the turn while you wait — an
ended turn sees neither channel. A terminal answer (the user replies while
you wait) reaches the store ONLY when YOU record it IMMEDIATELY via
inbox(op:'respond', name, message_id, type, text) — op:'check' never
reports an unrecorded terminal answer. Whichever channel answers first
wins — the audit trail carries every answer regardless of channel.
