import { assertEquals } from '@std/assert';
import { fetchSnapshot } from './snapshot.ts';

const fetcher = ((input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url).pathname;
  if (path === '/kantata/time_entries') {
    return Promise.resolve(new Response('unavailable', { status: 500 }));
  }

  const body = path === '/clickup/tasks'
    ? { tasks: [], last_page: true }
    : path === '/clickup/members'
    ? { members: [] }
    : path.startsWith('/salesforce/')
    ? { records: [] }
    : path === '/kantata/users'
    ? { users: [] }
    : path === '/kantata/projects'
    ? { projects: [] }
    : path === '/kantata/allocations'
    ? { allocations: [] }
    : { time_off: [] };
  return Promise.resolve(Response.json(body));
}) as typeof fetch;

Deno.test('persistent optional time-entry failure is disclosed without failing the snapshot', async () => {
  const degraded: string[] = [];
  const snapshot = await fetchSnapshot({
    baseUrl: 'https://mock.test/',
    degraded,
    fetcher,
    sleep: async () => {},
  });

  assertEquals(snapshot.kantata.time_entries, []);
  assertEquals(degraded, ['/kantata/time_entries']);
  assertEquals(snapshot.degradations, [{ path: '/kantata/time_entries', reason: 'unavailable' }]);
});
