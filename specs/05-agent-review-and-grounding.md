# Agent review and grounding

The model is asked exactly one question: **for each candidate opportunity, which active project is
it a continuation of?** Matching "Halden — Phase 3 Scope" to "Halden — Phase 2 Delivery" is
open-vocabulary judgment over two free-text strings typed independently in two systems with no
shared key. Everything else — totals, headroom, demand sizing, severity, the message itself —
stays arithmetic.

**It is never shown a number.** The payload is two flat lists: opportunities as id, name, account
name, stage; Active projects as id, title, client name. No percentages, hours, dates, or person
names at any depth. A model cannot invent a fact it was never given, which is a stronger guarantee
than a prompt asking it not to.

**Its answer has four fields and no free text**: opportunity id, project id or null, relation
(continuation or unrelated), confidence (high or low). Five verification rules then run before any
finding is built: ids must be among those sent, confidence must be high, ids must resolve, the
project's client re-derived through the client map must match the opportunity's account, and the
first link for an opportunity wins. A null "continues nothing" answer is correct, not a rejection.

Any failure — missing key, non-2xx, schema violation — yields no links and marks the model unused.
Removing the model costs exactly one finding type; it never costs the run.
