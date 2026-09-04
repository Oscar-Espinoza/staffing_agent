import { assertEquals } from '@std/assert';
import { handle } from './router.ts';

Deno.test('a demo request without dry mode is rejected before it can run', async () => {
  const response = await handle(new Request('http://agent.test/run?demo=1'));
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: 'Demo runs require dry=1.' });
});
