# Failure handling and evaluation

Retries cover transient network failures, `5xx`, and `429`. Kantata users, projects, and allocations
are required: unavailable or malformed data fails the run with HTTP 500. Optional collection
failures degrade to an empty collection and a disclosed `{path, reason}`. A malformed optional
collection is quarantined in full as `invalid_payload`; valid rows are not silently salvaged.
Duplicate emails within a provider remain fatal because ambiguous identity joins are unsafe.

Linking failure never blocks independent deterministic findings. Each run exposes model status,
candidate dispositions, rejection reasons, and request/response metadata. An incomplete or failed
review adds a warning to any rendered message; a quiet run still exposes status in JSON.

`clientMatchBaseline` counts active projects a client-name match supplies for each candidate deal.
One candidate does not prove a continuation, and two candidates do not prove a model selected the
right one. This is a measure of candidate ambiguity, not an accuracy score.

`GET /run?dry=1&demo=1` adds a synthetic competing Halden project to exercise same-client ambiguity.
It never posts. A verifier can reject cross-client links while accepting a semantically wrong
project for the right client, so demo success alone is limited evidence.

Fixed labels and scenario limits are recorded in [../eval/EXPECTATIONS.md](../eval/EXPECTATIONS.md).
Repeated model comparison evidence is in [../eval/results.json](../eval/results.json), with the
exact reproduction command in [../README.md](../README.md#linker-evaluation). Compare candidate
dispositions as well as selected links; missing answers are not correct abstentions. Results
describe those inputs, prompts, and returned model identities, not general model accuracy.

Run `deno task check` and `deno test` for formatting, lint, types, and focused regression checks.
Tests cover payload boundaries, link verification and coverage, source degradation, follow-on
questions, detector edge cases, rendering, and routes. Dry runs against the same fixtures verify
integration; model variation and response metadata mean full run JSON need not be byte-identical.
