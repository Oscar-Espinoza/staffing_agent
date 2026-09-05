import { assertEquals } from '@std/assert';
import { handle, triggerRun } from './router.ts';

Deno.test('root describes every endpoint without running analysis', async () => {
  const response = await handle(new Request('http://agent.test/'));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
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
});

Deno.test('a demo request without dry mode is rejected before it can run', async () => {
  const response = await handle(new Request('http://agent.test/run?demo=1'));
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: 'Demo runs require dry=1.' });
});

Deno.test({
  name: 'entrypoints retain their trigger on failure and HTTP cannot impersonate cron',
  permissions: { env: false, net: false },
  async fn() {
    // Denied config access fails before any source, model, or Slack request.
    const response = await handle(new Request('http://agent.test/run?dry=1&trigger=cron'));
    assertEquals(response.status, 500);
    const manual = await response.json();
    assertEquals(manual.result.trigger, 'manual');

    const scheduled = await triggerRun({ trigger: 'cron', dryRun: false, demo: false });
    assertEquals((scheduled.result as { trigger: string }).trigger, 'cron');
    const last = await handle(new Request('http://agent.test/last'));
    assertEquals((await last.json()).result.trigger, 'cron');
  },
});
