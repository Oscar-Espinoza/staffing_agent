import { runtimeConfig } from './config.ts';
import { runStaffingCheck } from './run.ts';

/** In-memory on purpose: a viewing convenience, not durable delivery state. Empty after a redeploy. */
let lastRun: { at: string; result: object } | null = null;

function readable(body: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Shared by the /run route and Deno.cron so both go through one path and update `lastRun`. */
export async function triggerRun(
  options: { dryRun: boolean; demo: boolean },
): Promise<{ at: string; result: object }> {
  const at = new Date().toISOString();
  try {
    const result = await runStaffingCheck({ config: runtimeConfig(), ...options });
    lastRun = { at, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Run failed';
    lastRun = { at, result: { error: message } };
    console.error(JSON.stringify({ event: 'staffing_check_failed', at }));
  }
  return lastRun;
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Liveness. Must not touch the source API or the state store: it answers
  // "is this process up", not "is everything it depends on healthy".
  if (req.method === 'GET' && url.pathname === '/health') {
    return Response.json({ status: 'ok' });
  }

  if (req.method === 'GET' && url.pathname === '/') {
    return readable({
      service: 'staffing-risk-agent',
      trigger: '/run?dry=1 for full analysis without posting to Slack',
      endpoints: {
        '/health': 'Liveness check; no dependency calls.',
        '/run': 'Run analysis and post findings to Slack if configured.',
        '/run?dry=1': 'Run analysis without posting to Slack; updates /last.',
        '/run?dry=1&demo=1': 'Dry run with a synthetic competing project to test matching.',
        '/last': 'Last result in this instance; not durable history.',
      },
    });
  }

  if (req.method === 'GET' && url.pathname === '/last') {
    return lastRun === null
      ? readable({ error: 'No run recorded since this instance started. Trigger /run.' }, 404)
      : readable(lastRun);
  }

  if (req.method === 'GET' && url.pathname === '/run') {
    const dryRun = url.searchParams.get('dry') === '1';
    const demo = url.searchParams.get('demo') === '1';
    if (demo && !dryRun) {
      return readable({ error: 'Demo runs require dry=1.' }, 400);
    }
    const run = await triggerRun({ dryRun, demo });
    return readable(run, 'error' in run.result ? 500 : 200);
  }

  return new Response('Not found', { status: 404 });
}
