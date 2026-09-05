# Staffing Risk Agent

A Deno service that reconciles Kantata, Salesforce, and ClickUp mock data into a plain-text Slack
staffing-risk message. Arithmetic stays in code; one bounded model call matches possible follow-on
opportunities to active projects.

Agent: https://staffing-agent.oscar-espinoza.deno.net/\
Mock API: https://gn-case-study-api.onrender.com

## Trigger and output

`GET /health` is a dependency-free liveness check. `GET /run?dry=1` runs the full pipeline and
returns structured metadata plus the rendered message without posting to Slack. `GET /last` shows
the last result for the current isolate. `GET /run?dry=1&demo=1` adds synthetic competing Halden
project context to exercise the model's free-text matching boundary; demo requests without `dry=1`
are rejected and can never be posted.

`MOCK_API_BASE_URL` is required. `OPENAI_API_KEY` is optional: without it, deterministic findings
still run and the result reports `modelStatus: "not_configured"`. `SLACK_WEBHOOK_URL` is optional:
when absent, a non-dry run returns its message but records `delivered: false`. `OPENAI_MODEL`
defaults to `gpt-5.6-luna`. An existing environment value overrides this fallback.

`GET /run` can deliver a real message. Deno cron runs the same trigger at 13:00 UTC Monday–Friday.
There is no persistent deduplication or new/worsening detection: unchanged findings can recur.
Follow-ons are review questions until their delivery schedule and team are known; a sales close date
does not establish a delivery start date.

Run metadata includes every candidate's model disposition, rejection reasons, requested/response
model, response ID, prompt version/hash, and payload hash. Missing or rejected answers report
`incomplete_response`; deterministic findings remain available.

## Local checks

```sh
deno task check
deno test
```

For a local mock, run the supplied case-study API on a loopback port, then start this service with
`MOCK_API_BASE_URL` set to that URL. Use `dry=1` while validating. The service is configured for
Deno Deploy through `src/index.ts`.

## Linker evaluation

Fixed labels and evaluation limits are in [eval/EXPECTATIONS.md](eval/EXPECTATIONS.md);
[eval/results.json](eval/results.json) contains recorded run evidence. To repeat the comparison with
the sibling case-study fixtures and an `OPENAI_API_KEY` in `.env`:

```sh
deno run --allow-read --allow-write=eval --allow-env --allow-net=api.openai.com --env-file eval/linker_eval.ts ../eng-case-study/app/fixtures eval/results.json 5 gpt-5.4-nano,gpt-5.6-luna
```

This makes paid model requests and replaces the result file. `clientMatchBaseline` measures how many
projects share a candidate's client; it does not establish whether a deal continues one of them. See
[DECISIONS.md](DECISIONS.md) for the model boundary, failure policy, and scaling choices.
