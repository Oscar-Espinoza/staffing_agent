# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A submission for the Go Nimbly "Staffing Risk Agent" case study (brief: `/home/oscar/Documents/Go_Nimbly_case.txt`).
An agent reads a mock API exposing Kantata + Salesforce + ClickUp, detects staffing risk, and emits one
Slack-shaped message. Deno + TypeScript, no database, no scheduler, no framework.

Graded on reasoning, not coverage: problem framing, cross-system data modeling, where the model does and
does not belong, failure handling, scaling. `specs/01`–`specs/08` are the written scope — read them before
changing behavior; they are the contract, the code is the implementation.

## Commands

```
deno task dev        # watch + --env-file, local run
deno task start      # production entrypoint (Deno Deploy uses src/index.ts)
deno task check      # fmt --check && lint && typecheck — run this before finishing
deno task typecheck  # deno check src/
```

`deno test src/` covers the render-layer string logic only (`src/render_test.ts`); everything else
is verified manually by repeated `/run?dry=1` comparisons, per
`specs/07-failure-handling-and-manual-evaluation.md`. Single case: `deno test src/render_test.ts --filter "name"`.

Endpoints: `GET /` (self-description), `GET /health` (liveness, touches nothing), `GET /run` (posts to
Slack), `GET /run?dry=1` (same analysis, no side effects — use this while developing).

Config is environment-only (`.env.example`): `MOCK_API_BASE_URL`, `OPENAI_API_KEY`, `SLACK_WEBHOOK_URL`
required by `/run`; `OPENAI_MODEL`, `PORT` optional. `runtimeConfig()` is deliberately called per-request
so `/health` works before secrets exist.

## Pipeline

`router.ts` → `run.ts` orchestrates one linear pass:

1. **`snapshot.ts`** — fetches all ten collections in parallel via `source.ts` (retries 5xx/429/network with
   backoff + `Retry-After`). Kantata users/projects/allocations are **required** (failure = HTTP 500);
   everything else is **optional** and degrades to `[]` plus a `{path, reason}` entry. ClickUp tasks paginate.
2. **`model-record.ts`** — the single join. Every later stage reads `ModelRecord`, never a raw response.
   Delegates to `people.ts` (identity), `clients.ts` (client→Salesforce/ClickUp names),
   `allocations.ts` (percentage scale), `reference-date.ts` ("today").
3. **`detectors/`** — the deterministic risk clauses, both emitting `Finding[]`:
   `over-allocated.ts` (⚠️ risks) and `scale-ambiguous.ts` (❓ questions, the abstention the first
   detector makes said out loud). Both filter through the shared window in `window.ts`.
4. **`run.ts:review()`** — one OpenAI Responses call, strict JSON schema, ≤5 risks.
5. **`render.ts`** — Slack text from `Finding`s only.

### Cross-system joins (the interesting part)

- **People**: no shared key — joined on normalized email. `Person` carries all three ids; `@gonimbly.com`
  determines `isExternal`. Duplicate emails within one provider throw.
- **Clients**: a hardcoded map in `clients.ts` because the three systems spell client names differently
  (`Quillspace` → `Quillspace Software`). Unmapped names accumulate in `unmappedClients`, never guessed.
- **Reference date** is derived from the data (latest time entry, falling back to latest project start),
  never `Date.now()` — a run months from now must reproduce today's findings against the same fixtures.

### Deliberate messiness handling

- `allocation_percentage` mixes 0–100 and 0–1 scales. `≤ 1` is read as a fraction **and flagged ambiguous**;
  a person holding any ambiguous allocation in the window is excluded from confident over-allocation claims.
- Duplicate Salesforce opportunities are deduped on `(AccountId, Amount, CloseDate, hours)`, first kept,
  the drop recorded in `notes`.
- Allocations pointing at nonexistent projects still count toward a person's total but attach to no project;
  recorded as a note, not a finding.

## Invariants

These are enforced by convention and referenced throughout the comments as "Rule N":

1. **Every claim is traceable.** A `Finding` without `sources` is an opinion. Sources are
   `system:collection/id` strings, rendered as one compact `Sources: Kantata allocations a_9001,
   a_9002; user u_10024` line under the finding. Records support a finding; they never dominate it.
2. **Numbers are read, never generated.** Anything quoted in `statement` lives in `metrics` or the model record.
3. **ClickUp is activity context only** — never capacity or allocation evidence. Kantata is the capacity
   source of truth.
4. **Ambiguity becomes a question, not an assertion** (`Finding.ambiguous` renders as `[QUESTION]`).
5. **Filter to the horizon window before summing**, not after (`HORIZON_DAYS = 30`).
6. **Code renders, the model fills slots.** The review pass returns `{severity, title, detail,
   rationale, sources}`; `render.ts` assembles every line from a template. Three guards in
   `run.ts` enforce provenance rather than trusting the prompt: cited source ids must exist,
   a risk citing an ambiguous allocation is forced to `ambiguous: true`, and **every numeric token
   in model prose must appear in the snapshot or the deterministic findings** — an unmatched
   number discards the whole risk, counted as `discardedRisks` in the `/run` response.
7. **The Slack message is plain text.** The webhook is a Workflow Builder trigger, which posts the
   variable verbatim, so `*bold*`, backticks and `<url|label>` arrive as literal punctuation.
   Structure comes from uppercase section labels and blank lines. Never reintroduce markup.

## The model boundary

Arithmetic stays arithmetic. The over-allocation math is deterministic, auditable, and cheap — a model is
never asked to add percentages. The LLM does one bounded job: a second-pass review over the *normalized
snapshot plus the deterministic findings*, returning at most five additional risks under a strict JSON schema.

Grounding is enforced in code, not in the prompt: `normalizedSnapshot()` builds the set of legal source ids
while serializing, and every model-returned risk whose sources aren't all in that set — or that reuses a
deterministic finding's sources — is discarded silently. Widen the model's remit only by widening that set.

A review failure never blocks deterministic alerts; it surfaces as `reviewError` in the response and a note
in the message. Silence is a valid outcome: no findings means no Slack post.

## Conventions

- Deno stdlib and `fetch` only; `zod` is the sole dependency and parses every external row at the boundary.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are on — index access yields `T | undefined`.
- Single quotes, semicolons, 100 columns (`deno fmt` enforces).
- Comments explain *why a decision was made*, especially where the data was messy. Keep that density;
  the decision log is derived from them.
- Detector output funnels through the `Finding` union in `finding.ts`. A new risk clause = a new
  `FindingType` member + a file in `src/detectors/`, not a new message shape.

## The demo switch

`GET /run?dry=1&demo=1` appends one synthetic active project (`src/demo.ts` — demo data, not a
fixture, safe to delete). It exists to answer a specific debrief question honestly: on the real
fixtures every client has exactly one active project, so `clientName === accountName` resolves
every link and the model is redundant. The demo adds a second concurrent Halden project so that
match returns two candidates and only the free-text names can choose.

`clientMatchBaseline` in `src/baseline.ts` reports, on every run, how many projects that plain
rule would have returned per candidate. 1 means arithmetic could have answered; 2+ means the model
is the only thing that can. Measured each run rather than argued.

Comments reference spec sections (`S02`, `S08`, `S21`) from a numbering finer than `specs/`'s eight files —
`S21` (suppression across runs) and `S16`–`S19` (further detectors) describe work not yet built.
`suppressedCount` is currently always `0` and there is no state between runs.
