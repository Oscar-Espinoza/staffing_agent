# Opportunity linking and grounding

The model has one bounded task: for every candidate opportunity, identify an active project it
continues, decide it is unrelated, or abstain as uncertain. Independently written names can
distinguish a phase continuation from a concurrent support retainer. A shared client supplies
candidates; it does not establish continuity.

The payload contains opportunity IDs, names, account names, and stages, plus active project IDs,
titles, and client names. It excludes allocation, leave, probability, hours, schedule, and person
fields. Names and IDs may contain digits; the boundary is about excluding staffing facts, not
removing all numeric characters. The model cannot directly supply staffing prose or arithmetic.

Each answer has exactly three fields: `opportunity_id`, `project_id`, and `relation`
(`continuation`, `unrelated`, or `uncertain`). Only continuations have a non-null project ID. The
strict response schema and local parser reject malformed answers. Verification checks offered IDs,
resolved records, mapped client agreement, duplicates, and complete candidate coverage. Duplicate
answers invalidate that candidate rather than keeping the first.

Every candidate has a recorded disposition. `unrelated` and `uncertain` are valid decisions;
`missing` and `rejected` are failures, never silent negative answers. Any verification rejection or
omission sets `modelStatus: "incomplete_response"`; other verified links can still be used.
Request/schema failures return no links, mark candidates `not_evaluated`, and preserve independent
deterministic findings. A missing key reports `not_configured`; no candidates reports
`no_candidates`.

Run metadata exposes requested/response model, response ID, prompt version/hash, payload hash, and
reasoning effort, alongside dispositions and rejection reasons. These identify what was actually
evaluated without assuming an alias returned the requested model identity.

A same-client wrong-project answer can still pass verification. Fixed labeled evaluations measure
that remaining judgment risk. Accepted continuations produce review questions, never a claimed
capacity deficit based on assumed delivery dates.
