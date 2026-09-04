# Failure handling and manual evaluation

Retries cover transient network, 5xx and 429 responses. Kantata users, projects and allocations are
required and their failure is an HTTP 500; everything else degrades to an empty collection plus a
disclosed `{path, reason}`. Linking failure never blocks deterministic findings.

**How we know the model-driven part works.** Every run reports `clientMatchBaseline`: how many
active projects a plain client-name match would have returned for each candidate deal. 1 means
arithmetic could have answered and the model was redundant on that data; 2 or more means nothing
but the names can choose. On the shipped fixtures it is 1 everywhere — the model is honestly
redundant today, and the metric says so rather than hiding it.

`GET /run?dry=1&demo=1` injects one synthetic second Halden project so the baseline becomes 2 and
the ambiguity is real. Measured over eight runs: **8/8 correct** (`p_5004`, Phase 2 Delivery), 0
wrong, 0 declined. Note the limit honestly — both candidates are Halden projects, so the verifier's
cross-client check clears either one. It catches a link to the wrong client; it cannot catch a link
to the wrong project within the right client. There the model's judgment is unguarded, and 8/8 on
one ambiguity with a strong lexical signal is evidence, not proof.

Deterministic output is verified by repeated dry runs being byte-identical, and by unit tests over
the payload (asserting no number or name leaks into it), the verifier's five rules, and the
detector edge cases that actually bit: a NaN percentage, an inactive person counted as roster, and
pending leave treated as committed.
