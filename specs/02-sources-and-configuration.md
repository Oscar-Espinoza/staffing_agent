# Sources and configuration

`MOCK_API_BASE_URL` is required by `/run`. `OPENAI_API_KEY` and `SLACK_WEBHOOK_URL` are optional.
Without the model key, deterministic findings run and `modelStatus` is `not_configured`. Without the
Slack webhook, the response still includes a message but `delivered` is false. `OPENAI_MODEL`
defaults to `gpt-5.6-luna` and `PORT` to 8080. Configuration is environment-only and read per
request, so `/health` answers before any secret is set.

Kantata users, projects, and allocations are required. Time off, time entries, Salesforce, and
ClickUp are optional and degrade to empty collections when unavailable or malformed. Duplicate
provider emails remain a fatal identity error.

Thresholds live in `config.ts`: a 30-day horizon, a 70% probability floor for likely deals, and caps
that bound only the watch and question sections. ClickUp is activity context, never capacity
evidence.
