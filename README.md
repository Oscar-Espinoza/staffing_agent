# Staffing Risk Agent

An on-demand Deno service that reconciles the supplied Kantata, Salesforce, and ClickUp mock
data into a Slack-shaped staffing-risk message.

## Trigger and output

`GET /health` is a dependency-free liveness check. `GET /run?dry=1` runs the full pipeline and
returns structured metadata plus the rendered message without posting to Slack. `GET /last` shows
the last result for the current isolate. `GET /run?dry=1&demo=1` adds synthetic competing Halden
project context to exercise the model's free-text matching boundary; demo requests without
`dry=1` are rejected and can never be posted.

`MOCK_API_BASE_URL` is required. `OPENAI_API_KEY` is optional: without it, deterministic findings
still run and the result reports `modelStatus: "not_configured"`. `SLACK_WEBHOOK_URL` is optional:
when absent, a non-dry run returns its message but records `delivered: false`. `OPENAI_MODEL`
defaults to `gpt-5.4-nano`.

## Local checks

```sh
deno fmt --check
deno lint
deno check src/
deno test
```

For a local mock, run the supplied case-study API on a loopback port, then start this service with
`MOCK_API_BASE_URL` set to that URL. Use `dry=1` while validating. The service is configured for
Deno Deploy through `src/index.ts`; see [DECISIONS.md](DECISIONS.md) for the completed local model
evaluation and the remaining deployment/live-delivery evidence.
