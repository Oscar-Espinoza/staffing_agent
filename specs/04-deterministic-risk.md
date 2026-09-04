# Deterministic risk

Six detectors, all arithmetic, all reproducible — same snapshot, same findings, every run.

| Clause | Detector | What it computes |
|---|---|---|
| 1 | `over-allocated` | Sums one person's overlapping allocation percentages in a 30-day window; over 100% fires critical. |
| 1 (question) | `scale-ambiguous` | An allocation value at or below 1 could be a fraction or a literal percentage. Asks; never asserts. |
| 2 | `unavailable-capacity` | A live allocation held by an inactive person, or approved leave against a person at 80%+ on a project that outlives the leave. Pending leave is not committed loss. |
| 3 | `dead-deal` | A project still Active with people allocated, whose opportunity is Closed Lost and none Closed Won. |
| 4 | `unstaffed-demand` | A likely deal inside the horizon whose account has no project at all. |
| 5 | `follow-on` | Needs a verified model link — see spec 05. |

Ordering favours the reader over the cap: every critical finding is shown, and the caps bound only
the watch and question tails. Hiding a critical behind "N more not shown" defeats the point of
severity.

Ambiguous-scale allocations are excluded from confident claims everywhere, and a person skipped
for that reason is surfaced as a question rather than silently dropped.
