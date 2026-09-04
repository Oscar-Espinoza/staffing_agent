# Sources and configuration

`MOCK_API_BASE_URL`, `OPENAI_API_KEY` and `SLACK_WEBHOOK_URL` are required by `/run`;
`OPENAI_MODEL` defaults to `gpt-5.4-nano` and `PORT` to 8080. Configuration is environment-only and
is read per request, so `/health` answers before any secret is set.

Kantata users, projects and allocations are required. Time off, time entries, Salesforce and
ClickUp are optional and degrade to empty collections.

Thresholds live in `config.ts`, never inline: a 30-day horizon, a 70% probability floor for a deal
to count as likely, and caps that bound only the watch and question sections. ClickUp is activity
context and is never capacity evidence.
