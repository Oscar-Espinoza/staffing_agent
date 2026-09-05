# Staffing Risk Agent: decisions and scaling

Staffing risk means confirmed work exceeding capacity, unavailable committed people, allocations
against lost business, likely incoming work without a project, or a possible follow-on competing
with current delivery. The horizon is 30 days from a reference date derived from the fixtures. This
build detects current conditions; it cannot tell whether they are new or worsening.

## Data and model boundary

People join on normalized email; client names use an explicit map, with unknowns left unresolved.
Duplicate Salesforce opportunities are removed before analysis. Orphan allocations still count
toward personal capacity. Values greater than 0 and at most 1 have ambiguous units, so affected
capacity claims become questions. ClickUp supplies activity context, never capacity evidence.

The model receives opportunity/project IDs, names, client names, and sales stages. It decides
`continuation`, `unrelated`, or `uncertain`, with a project ID only for continuations. It receives
no allocation, leave, hours, probability, or schedule fields and writes no staffing prose. Code
checks the schema, offered IDs, record resolution, client consistency, duplicate decisions, and
coverage of every candidate. Missing and rejected answers remain visible as `incomplete_response`.

Matching clients supplies candidates, not proof of continuity. The model is useful when names
distinguish delivery phases from concurrent support work; same-client errors remain possible.
`clientMatchBaseline` measures candidate ambiguity, not correctness. Fixed expectations and repeated
model comparisons live in [eval/EXPECTATIONS.md](eval/EXPECTATIONS.md) and
[eval/results.json](eval/results.json), including request/response model identity and prompt/payload
hashes. The runtime default is `gpt-5.6-luna`, selected after the fixed comparison: 19/20 runs
passed all labeled checks versus 15/20 for `gpt-5.4-nano`, with the difference on indistinguishable
same-client projects. This supports better abstention on that small sample, not general accuracy or
a definitive Auralis label. Published token rates are comparable; existing environment overrides
still take precedence. Running the evaluation itself never changes runtime configuration.

All staffing calculations, severity, and text are deterministic. Even a verified continuation is
only a review question: a sales close is not a delivery start, and the existing project's due date
is not the new work's deadline. Estimated total hours alone cannot establish weekly demand or
overload. The alert asks for the schedule and team needed to assess capacity.

## Failure and delivery policy

Transient source network failures, `5xx`, and `429` retry. Kantata users, projects, and allocations
are required: unavailable or malformed data fails the run. Optional source failures degrade to empty
collections; malformed optional collections are quarantined with `invalid_payload`. Duplicate emails
within a provider remain fatal because they make identity joins unsafe. Model failure preserves
deterministic findings and discloses incomplete follow-on review.

Slack receives plain text with source IDs, separate review questions and data-quality notes, and an
omitted-finding count when caps apply. Full rationale remains in the structured findings. All
critical findings remain visible. No findings means no post. Dry runs never post; synthetic demo
runs require dry mode. A successful Workflow Builder webhook handoff does not prove its downstream
Slack step completed.

## Hosting and growth

The service uses Deno Deploy, with the mock API hosted separately on Render. HTTP supports manual
review; Deno cron runs weekdays at 13:00 UTC. `/last` is isolate memory only. There is no database,
durable deduplication, alert suppression, or authentication on the prototype trigger.

At 100x, first persist identity/client mappings and findings, then add change detection and
deduplication, client-specific thresholds, incremental ingestion, and per-lead routing. Cache model
decisions against the actual inputs and prompt version, and keep evaluating same-client mistakes. A
Render background worker with PostgreSQL for durable state is an alternative production design; it
is not implemented here. The current stack avoids operating that infrastructure for a stateless
case-study run.
