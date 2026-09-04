# Decisions

## Scope and trigger

A staffing risk is a source-backed condition inside the next 30 days: concurrent overload,
approved capacity loss, active work needing confirmation after a lost deal, or likely demand with
no credible team. Ambiguous allocation units and uncertain deal/project relationships are
questions, not assertions. The deliberately boring trigger is `GET /run`; `/run?dry=1` is the
reviewer-safe path, and `/last` is only in-memory viewing convenience, not delivery state.

## Data and deterministic boundary

Fetching retries transient source failures and records optional-source degradation rather than
treating missing data as zero. Calculating allocation peaks, dates, capacity, source citations,
deduplication, severity, rendering, and Slack payloads is deterministic because each is
auditable arithmetic or formatting. A source citation accompanies every rendered finding.

## The one model job

The model receives only candidate opportunity id/name/account/stage and active project
id/title/client. It makes one narrow semantic decision: whether a candidate opportunity continues
one active project, or is unrelated. It cannot provide people, dates, hours, amounts, or message
text. The output deliberately omits self-reported confidence: it was not calibrated and rejected
otherwise-correct project choices. Code rejects unknown, cross-client, duplicate, and
project/relation-inconsistent responses before follow-on detection; repeatable normal and
ambiguous-client evaluations measure the semantic decision itself. `modelStatus` distinguishes no
candidates, missing configuration, request failure, invalid response, and completed calls. A
missing key or provider failure yields deterministic findings only; it never blocks a run or
invents a link.

## Delivery and hosting

Slack receives exactly `{ "text": renderedMessage }` only for a non-dry run with a configured
webhook. Operational logs contain metadata, not the rendered message or configuration values.
Deno Deploy is suitable here because the service is a small TypeScript HTTP entrypoint with no
runtime server management. In production, I would add a scheduled trigger, durable idempotency
state, queue-backed delivery, structured monitoring, and per-client policy configuration.

## At 100x

First replace per-run whole-dataset reconciliation with incremental normalized snapshots and
durable source cursors. Next move delivery to a queue with idempotency keys and per-client rate
limits. Then make thresholds and escalation rules tenant-owned configuration, add evaluation
datasets/alerts for the linker, and preserve raw source-version references for audit and replay.

## Validation evidence — 2026-09-04

`deno fmt --check`, `deno lint`, `deno check src/`, and `deno test` passed locally (38 tests).
Stable-loopback route checks passed for `/`, `/health`, initial `/last`, and the non-dry demo
guard.

The first stricter-schema diagnostic passed 10/10 normal and 4/5 demo evaluations; its last demo
omitted `OPP03 -> p_5004`. A subsequent 7/8 normal gate established the more specific failure:
the correct `OPP02 -> p_5002` decision was rejected solely because the model called it
`low_confidence`. This is historical diagnostic evidence, not a semantic error rate.

The response contract then removed the uncalibrated confidence field while retaining strict
relation shape and deterministic offered-ID, active-project, client, and duplicate checks. A fresh
local endpoint gate passed 10/10 normal plus 10/10 demo dry evaluations: each completed-model run
accepted `OPP02 -> p_5002` and `OPP03 -> p_5004`, rejected no links, had no source degradation,
and the demo's plain client match remained ambiguous. No chaos rerun, deployment, or live Slack
delivery was performed; do not claim that evidence from this evaluation.
