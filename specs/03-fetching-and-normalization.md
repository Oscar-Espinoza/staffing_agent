# Fetching and normalization

Required source failures fail the run; optional ones become sorted `{path, reason}` degradations.
The service joins the three systems once, and every later stage reads that record rather than a
raw response.

Three joins do the reconciling, none of which has a shared key to lean on: people are matched on
normalized email across all three systems; client names are mapped explicitly because the same
client is spelled differently in each ("Quillspace" is "Quillspace Software" in the CRM), with
unmapped names collected rather than guessed; and "today" is derived from the data — the latest
time entry, falling back to the latest project start — so a run months from now reproduces the
same findings against the same fixtures.

The data is messy on purpose and the mess is handled explicitly: duplicate opportunities are
deduped on account, amount, close date and hours before anything is summed; allocations pointing at
a project that does not exist still count toward the person's total but attach to no project;
Salesforce close dates are normalized to calendar dates at the boundary, because a raw datetime
compared against a plain date silently drops deals and produces NaN downstream.
