# Deployment decisions and At 100x

A Deno HTTP server exposing `/`, `/health`, `/run` and `/last`. No database, no scheduler, no
queue, no auth. The trigger is an HTTP GET so a reviewer can force a run; `/last` shows the most
recent result in a browser and each run also writes one structured log line.

Deployment note, stated rather than hidden: the agent reads a mock API that has no public instance
we control, so a deployed agent points at whatever host is running the fixtures. Slack delivery is
a Workflow Builder trigger, which accepts the payload and runs the workflow afterwards — success
means handed off, not posted, and a broken workflow step surfaces only in Slack's own log.

**At 100x — 500 projects, 60 people, 12 clients, each defining "over-allocated" differently.** What
breaks, in order:

1. **The client map.** A hand-written table of 8 clients does not survive 12 clients with churn.
   It becomes a stored mapping with an explicit unmapped queue, not a constant.
2. **Per-client thresholds.** "Over-allocated" stops being 100% globally. Thresholds move into
   per-client config, and the detectors read them instead of a shared constant.
3. **Message volume.** 500 projects will not produce 9 findings, it will produce hundreds. Showing
   every critical stops working, and ranking by imminence times magnitude becomes mandatory —
   along with the memory and suppression this build deliberately left out, so the same unchanged
   finding does not re-alert daily.
4. **The linking call.** Its cost and latency scale with candidate count, and this is where it
   starts genuinely earning its place: one client running several concurrent phases is exactly the
   case a client-name match cannot resolve. Batch it, cache by opportunity and project id pair.
5. **Fan-out.** One channel becomes per-lead routing, which needs the project lead field that is
   currently null on some projects.
