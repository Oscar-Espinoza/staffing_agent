# AGENTS.md

Guidance for agents working in this repository.

## Scope and checks

Go Nimbly Staffing Risk Agent case study (brief: `/home/oscar/Documents/Go_Nimbly_case.txt`). Deno +
TypeScript, `fetch`, and Zod; no database or framework. The eight files in `specs/` describe the
implemented contract. Read them before changing behavior. Comments may reference finer-grained
S00–S21 sections; they are not evidence that a feature exists.

```sh
deno task dev        # watch + --env-file
deno task start      # production entrypoint: src/index.ts
deno task check      # formatting, lint, typecheck; run before finishing
deno test            # deterministic, linker, source, renderer, and route checks
```

Use `GET /run?dry=1` for verification. `/run` may deliver to Slack; `/health` touches no dependency;
`/last` shows the current isolate's last result. `/run?dry=1&demo=1` adds synthetic competing Halden
context. Demo requests without dry mode are rejected. Deno cron runs real checks Monday–Friday at
13:00 UTC using the same trigger. There is no persisted deduplication, suppression, or new/worsening
detection; `/last` is not durable history.

Run results and logs carry `trigger: "manual" | "cron"`; messages show the trigger below the
source-data snapshot date. HTTP runs are manual, including dry/demo requests.

Only `MOCK_API_BASE_URL` is required. `OPENAI_API_KEY` and `SLACK_WEBHOOK_URL` are optional;
`OPENAI_MODEL` defaults to `gpt-5.6-luna`, `PORT` to 8080. Read config per request so liveness works
before secrets exist. Missing model configuration preserves deterministic findings with
`modelStatus: "not_configured"`; missing Slack configuration returns `delivered: false`.

## Pipeline

1. `snapshot.ts` fetches ten collections through `source.ts`, with transient retries and ClickUp
   pagination. Kantata users/projects/allocations are required. Optional failures degrade to `[]`
   plus `{path, reason}`; malformed optional rows quarantine the whole collection as
   `invalid_payload`. Malformed required rows and duplicate provider emails remain fatal.
2. `model-record.ts` joins once into `ModelRecord`. People join on normalized email; clients use an
   explicit name map. Reference date comes from latest time entry, then latest project start, rather
   than the wall clock. Duplicate opportunities are deduped on account/amount/close/hours. Orphan
   allocations still count toward personal capacity and produce a data-quality note.
3. Five independent deterministic detectors cover over-allocation, unavailable capacity, lost deals,
   unstaffed demand, and ambiguous allocation scale. Shared date-window helpers filter the relevant
   records before arithmetic.
4. `linker.ts` makes one bounded Responses call to match candidate opportunities to active projects.
   `detectors/follow-on.ts` turns verified continuations into review questions.
5. `run.ts` selects every critical finding and review question, plus a bounded, group-balanced watch
   tail. `render.ts` assembles plain-text findings, source IDs, omitted count, data-quality notes,
   and incomplete-review warnings. Full rationale remains in the structured findings. `run.ts`
   delivers at most one message and logs metadata.

## Invariants

- Every finding carries source IDs in `system:collection/id` format. Numbers and staffing prose come
  from normalized data or code, never the model.
- Kantata is the capacity source of truth. ClickUp is activity context only.
- Allocation values greater than 0 and at most 1 are interpreted as fractions and flagged ambiguous.
  Zero is unambiguous. Ambiguous units cannot support confident capacity claims.
- Follow-ons always have `ambiguous: true`. A sales close is not a delivery start; the current
  project's due date is not the new work's deadline. Do not derive weekly demand from that interval.
- Slack is plain text because Workflow Builder posts the variable verbatim. Never introduce Markdown
  or Slack link markup. Silence is valid: no findings means no post.

## Model boundary and evaluation

`buildPayload()` projects IDs, opportunity/project names, client names, and stages only. No
allocations, dates, probabilities, hours, or person records. The response has exactly three fields
per candidate: `opportunity_id`, `project_id`, and `relation` (`continuation`, `unrelated`, or
`uncertain`). Only continuations have a non-null project ID. There is no self-reported confidence
field and no generated staffing narrative.

`verifyLinks()` checks offered IDs, resolved records, client agreement, duplicate decisions, and
candidate coverage. Missing/rejected decisions are distinct from unrelated/uncertain decisions and
cause `incomplete_response`. Request/schema failures yield no links; deterministic detectors remain
available. Every run exposes `modelDispositions`, rejection reasons, and `modelMetadata` (requested
and response model, response ID, prompt version/hash, payload hash, reasoning effort).

`clientMatchBaseline` counts same-client active projects. One candidate does not prove continuity;
several candidates expose ambiguity but do not prove a model answer is correct. The demo adds one
synthetic competing project and is not production evidence. Fixed labels, evaluation limits, and
recorded comparisons live in `eval/EXPECTATIONS.md` and `eval/results.json`; README has the exact
reproduction command. Never infer model quality from a single demo or silently change the default.

## Conventions

- Zod parses external rows at the boundary; no new dependency for behavior the platform covers.
- TypeScript uses `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- Single quotes, semicolons, 100 columns; use `deno fmt`.
- Comments explain decisions and data ambiguity. Keep them aligned with implemented behavior.
- New detector clauses use `FindingType` and `src/detectors/`, not a new message shape.
