# Staffing Risk Agent Decisions and Scaling

## Risk definition

I kept staffing risk narrow: it has to matter within the next 30 days and be supported by source data I can trace back.

**The checks I kept deterministic are:**

- Someone is already booked for more work than they can realistically take on.
- A project depends on someone who will not be available when the work happens.
- The people most likely to take on upcoming work are already busy on other projects.
- A likely new project is approaching with no team assigned to it.
- A likely next phase may start before the current phase ends, so the same team could be needed for both.

> Dates, percentages, working time, severity, and provenance stay deterministic.

If the data itself is unclear, I do not guess. For example, Kantata values like `0.25` or `1.0` are treated as review questions because the fixture does not make it clear whether they are percentages or fractions.

**Data-quality problems are kept separate from staffing risks.**

---

## Data and model boundary

I normalize the three sources before running any checks:

- **People:** matched by normalized email.
- **Clients:** explicit mapping; unknown names stay unresolved.
- **Salesforce opportunities:** duplicates are detected and not counted twice.
- **Missing Kantata projects:** allocations still count toward a person's total, but are not attached to a project I cannot verify.

> I preferred missing a match over incorrectly joining two records.

### Where the model is used

The LLM has one narrow responsibility: deciding whether a Salesforce opportunity is a **high-confidence continuation** of an active Kantata project.

I used the model here because project names are inconsistent enough that exact or fuzzy string matching alone felt unreliable.

**The model sees:**

- IDs
- project and opportunity names
- client names
- deal stage

**The model does not see:**

- allocations
- leave
- percentages
- dates
- hours

Its output is validated again in code. Invalid, unresolved, or cross-client links are discarded. If the model fails, the deterministic checks still run.

> The model never produces a number or factual staffing claim.

---

## Delivery, validation, and failures

### Slack output

Slack separates:

- **Staffing risks**
- **Review questions**
- **Data-quality notes**

No findings means no message, and repeated manifestations of the same problem are grouped together.

Every factual value shown to the user comes from source data or deterministic calculations and keeps its source IDs for traceability.

### Validation

The model output is schema-constrained and validated again in code.

I also used:

- dry runs;
- focused tests;
- the ambiguity demo;
- `clientMatchBaseline` to compare model linking against simple client-name matching.

**With more time**, I would add a small fixed evaluation set for:

- clear continuations;
- unrelated deals;
- same-client wrong matches;
- cross-client matches.

### Failures

Network failures, `5xx`, and `429` responses retry.

**Required:** Kantata users, projects, and allocations.  
If these fail, the run fails.

**Optional:** time off, time entries, Salesforce, and ClickUp.  
If these fail, the run continues and discloses the missing source.

For this prototype, `/last` is only stored in memory. I did not add persistent deduplication or idempotency.

### Deployment

I used **Deno Deploy** because it kept deployment simple.

`GET /run` is intentionally a reviewer-friendly prototype trigger. In production I would use authenticated scheduled or event-driven execution.

---

## At 100x

If this had to support 500 active projects, 60 people, and 12 clients, I would change things in this order:

1. **Persist canonical cross-system mappings**  
   Stop relying on runtime client mapping.

2. **Move staffing thresholds into per-client configuration**  
   Different clients may define over-allocation differently.

3. **Replace full scans with incremental or event-driven ingestion**

4. **Persist findings**  
   Add deduplication, change detection, and alert suppression.

5. **Keep the model narrow**  
   Continue using it only for continuation matching, with stronger evals and caching.

6. **Add source-health monitoring**  
   Track failures, unresolved mappings, and data-quality issues explicitly.
