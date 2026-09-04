import { handle, triggerRun } from './router.ts';

// The entire coupling to the runtime and to the host. Deno Deploy routes to whatever
// port the isolate listens on, but PORT is the platform-agnostic contract and keeps the
// local override that `deno task dev` documents — one line to stay portable.
Deno.serve({
  hostname: '0.0.0.0',
  port: Number(Deno.env.get('PORT') ?? 8080),
}, handle);

// Deno Deploy cron (free tier: supported, minimum granularity 1 minute). Posts to
// Slack for real — not a dry run — on the same path /run takes, so /last reflects it.
// ponytail: fixed schedule, no per-tenant config; add if multiple delivery leads need
// different cadences.
Deno.cron('staffing risk check', '0 13 * * 1-5', async () => {
  await triggerRun({ dryRun: false, demo: false });
});
