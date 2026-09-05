# Deployment decisions and at 100x

A Deno HTTP server exposes `/`, `/health`, `/run`, and `/last`. Deno cron triggers real checks at
13:00 UTC Monday–Friday. HTTP GET also lets a reviewer force a run; `/last` shows the most recent
result in that isolate and each completed run writes a structured log line. There is no database,
queue, authentication, persistent deduplication, or new/worsening detection.

The agent is hosted at https://staffing-agent.oscar-espinoza.deno.net/ and uses the mock API at
https://gn-case-study-api.onrender.com. Slack delivery is a Workflow Builder trigger: success means
the webhook accepted the handoff, not proof that its downstream channel-posting step ran. Dry runs
exercise analysis without delivery, and synthetic demo runs require dry mode.

At 100x — 500 projects, 60 people, and 12 clients — prioritize:

1. Persist canonical identity/client mappings with an explicit unresolved queue.
2. Persist findings to detect changes and suppress unchanged alerts across scheduled runs.
3. Move thresholds into per-client configuration and add per-lead routing.
4. Replace repeated full ingestion with incremental synchronization and source-health monitoring.
5. Cache model decisions by actual inputs and prompt version, bound request batches, and retain
   labeled evaluations for same-client mistakes. Candidate count alone does not measure correctness.

Deno Deploy keeps the prototype small. A Render background worker with PostgreSQL for durable
mappings, findings, and delivery state is an alternative production design, not part of this
implementation. Either host would need authenticated triggers and explicit delivery idempotency
before relying on repeated execution as a durable alerting workflow.
