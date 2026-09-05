# Goal and scope

This service turns three unconnected systems into one short alert for a delivery lead. It fetches,
normalizes, joins, runs five independent deterministic detectors, asks a model to classify
opportunity/project continuity, verifies its answers, and runs a sixth detector on accepted links.
It posts at most one plain-text Slack message per run.

Staffing risk has five clauses, assessed against a 30-day horizon and readable source data:

1. Confirmed work exceeds capacity.
2. Capacity we are counting on is not actually available.
3. Committed capacity points at lost business.
4. Likely incoming work has no project in the delivery system.
5. A possible follow-on needs its schedule and team checked against current delivery commitments.

The last clause is always a review question: sales dates alone do not prove delivery overlap.
Ambiguous allocation units also become questions. Data-quality notes are separate from staffing
findings. This implementation observes current conditions; identifying new or worsening findings
requires history that is not stored.

Deno cron runs weekdays at 13:00 UTC. Persistent history, suppression of repeats, per-lead routing,
authentication, and durable state remain out of scope. `/last` holds only the last isolate result.
