# Deterministic risk

Five independent detectors and one detector using verified model links. Given the same snapshot and
accepted links, their calculations and findings are reproducible.

| Clause       | Detector               | What it computes                                                                                                                                                    |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1            | `over-allocated`       | Sums one person's overlapping allocation percentages in a 30-day window; over 100% fires critical.                                                                  |
| 1 (question) | `scale-ambiguous`      | An allocation value greater than 0 and at most 1 could be a fraction or a literal percentage. Zero is unambiguous. Asks; never asserts.                             |
| 2            | `unavailable-capacity` | A live allocation held by an inactive person, or approved leave against a person at 80%+ on a project that outlives the leave. Pending leave is not committed loss. |
| 3            | `dead-deal`            | A project still Active with people allocated, whose opportunity is Closed Lost and none Closed Won.                                                                 |
| 4            | `unstaffed-demand`     | A likely deal inside the horizon whose account has no matching active project in the retrieved Kantata data.                                                        |
| 5 (question) | `follow-on`            | A verified continuation may close before current delivery finishes with an active allocated team. Asks for the new schedule and team; never claims proven overload. |

Ordering favours the reader over the cap: every critical finding is shown, and the caps bound only
the watch and question tails. Hiding a critical behind "N more not shown" defeats the point of
severity.

Ambiguous-scale allocations are excluded from confident claims everywhere, and a person skipped for
that reason is surfaced as a question rather than silently dropped.

These risk definitions and thresholds are unchanged by grounding improvements. Over-allocation
wording includes the evaluated peak date, not an assumed immediate conflict. Inactive-user findings
describe recorded status and ask for coverage confirmation; they do not claim nobody noticed or that
no replacement exists. Pipeline hours remain estimates, and absence of an active project is limited
to the retrieved data, not proof that no team exists. Named people and projects are cited directly
when those records exist; unresolved IDs remain references, not invented source records.

For follow-ons, the sales close is not a delivery start and the current project's due date is not
the new work's deadline. Total estimated hours are quoted as source context only; no weekly demand
or headroom deficit is inferred from that interval. These findings always remain questions.
