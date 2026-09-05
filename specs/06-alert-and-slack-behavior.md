# Alert and Slack behavior

**The message is plain text.** The Slack destination is a Workflow Builder trigger, which posts the
variable verbatim, so `*bold*`, backticks and `<url|label>` would all arrive as literal punctuation.
Structure comes from section labels, blank lines, and bullets — never markup.

Layout is a briefing: an explicit snapshot "as of" date and honest counts, then risks, then Needs
review for questions, then optional DATA QUALITY NOTES. Each finding includes its title,
deterministic detail, and a compact `Sources:` line. Full rationale remains in the structured
findings. Record ids support a finding; they never dominate it, and they are plain text because the
source API exposes no per-record URL to link to. Header counts are computed from what is actually
rendered, so they can never disagree with the body.

The snapshot date comes from source data, not execution time. Relative day counts refer to this
date. A finding's quoted allocation peak date makes future commitments explicit.

The header also identifies `Run: manual` or `Run: scheduled (cron)`. The JSON result and completion
or failure logs carry `trigger: "manual" | "cron"`. HTTP requests (including dry/demo runs) are
manual; only the scheduler sets cron. The trigger label does not change the source snapshot date.

The message discloses omitted findings when the non-ambiguous watch cap applies, unavailable source
paths, and an incomplete follow-on review when the model fails or rejects/omits answers. These notes
are not additional staffing findings. Every critical finding and review question is shown; no
findings means no post, even if status or data-quality metadata exists in the run result.

Review questions are uncapped at prototype scale. An extra Auralis finding therefore adds a question
without hiding Halden or a deterministic question. Model matching can still vary between runs; no
decision cache is implemented. At larger volumes, use a separate digest or an explicit
prioritization policy rather than silently reintroducing displacement.

`GET /run` posts at most once and stays silent when there is nothing to say — reporting _why_ it was
quiet rather than returning nothing. `GET /run?dry=1` runs the same analysis without Slack delivery
(API calls and the in-memory last result still occur), `GET /run?dry=1&demo=1` adds the linking demo
of spec 07, `GET /last` shows the last run in a browser, and `GET /health` answers liveness without
touching any dependency.
