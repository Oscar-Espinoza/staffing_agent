# Goal and scope

This service turns three unconnected systems into one short decision alert for a delivery lead. It
fetches, normalizes, joins, runs six deterministic detectors, asks a model exactly one question,
verifies the answer, and posts at most one Slack message.

**Staffing risk has five clauses.** A condition qualifies only if it is new or worsening within the
next 30 days and backed by readable source data:

1. Confirmed work exceeds capacity.
2. Capacity we are counting on is not actually available.
3. Committed capacity points at unconfirmed work.
4. Likely incoming work cannot be staffed.
5. A follow-on deal lands on a team still committed to the phase it follows.

Every clause maps to at least one detector and every detector maps back to a clause; either
without the other is a defect in the definition. Where a number's unit is genuinely unreadable the
finding becomes a question, never an assertion.

Out of scope by decision, not oversight: memory between runs, suppression of repeats, alert
routing, scheduling, authentication, a UI, and any persistence at all.
