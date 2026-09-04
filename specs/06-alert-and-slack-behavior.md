# Alert and Slack behavior

**The message is plain text.** The Slack destination is a Workflow Builder trigger, which posts the
variable verbatim, so `*bold*`, backticks and `<url|label>` would all arrive as literal
punctuation. Structure comes from uppercase section labels, blank lines and one leading emoji per
finding — never markup.

Layout is a briefing: a date and honest counts, then risks, then NEEDS REVIEW for questions, then
DATA QUALITY NOTES. Each finding is the names first, the arithmetic behind them, why it matters,
and a compact `Sources:` line. Record ids support a finding; they never dominate it, and they are
plain text because the source API exposes no per-record URL to link to. Header counts are computed
from what is actually rendered, so they can never disagree with the body.

`GET /run` posts at most once and stays silent when there is nothing to say — reporting *why* it
was quiet rather than returning nothing. `GET /run?dry=1` runs the same analysis with no side
effects, `GET /run?dry=1&demo=1` adds the linking demo of spec 07, `GET /last` shows the last run
in a browser, and `GET /health` answers liveness without touching any dependency.
