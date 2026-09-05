import { assertEquals, assertThrows } from '@std/assert';
import { fetchSnapshot, type SourceSnapshot } from './snapshot.ts';
import { assembleModelRecord } from './model-record.ts';
import { detectOverAllocated } from './detectors/over-allocated.ts';

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

Deno.test('malformed optional rows are quarantined while required staffing evidence survives', () => {
  const snapshot: SourceSnapshot = {
    kantata: {
      users: [{
        id: 'u1',
        full_name: 'Test Person',
        email_address: 'test@gonimbly.com',
        weekly_capacity_hours: 40,
      }],
      projects: [{
        id: 'p1',
        title: 'Test project',
        client_name: 'Halden',
        status: 'Active',
        start_date: '2026-08-19',
        due_date: '2026-09-30',
        budgeted_hours: 100,
        lead_user_id: 'u1',
      }],
      allocations: [{
        id: 'a1',
        project_id: 'p1',
        user_id: 'u1',
        allocation_percentage: 140,
        start_date: '2026-08-19',
        end_date: '2026-09-30',
      }],
      time_off: [{}],
      // Missing the date used by reference-date derivation, but otherwise valid.
      time_entries: [{ project_id: 'p1', hours: 4 }],
    },
    salesforce: {
      accounts: [{ Id: 'account1', Name: 'Halden', Industry: 'Test' }, {}],
      users: [{ Id: 'sf1', Name: 'Bad email', Email: 'invalid' }],
      opportunities: [{}],
    },
    clickup: { members: [{}], tasks: [{}] },
  };

  const record = assembleModelRecord(snapshot);
  assertEquals(detectOverAllocated(record).length, 1);
  assertEquals(record.referenceDate.date, '2026-08-19');
  assertEquals(record.referenceDate.note?.includes('falls back'), true);
  assertEquals(record.people.length, 1);
  assertEquals(record.accounts, []);
  assertEquals(record.opportunities, []);
  assertEquals(record.tasks, []);
  assertEquals(record.timeOff, []);
  assertEquals(snapshot.kantata.time_entries, []);
  assertEquals(snapshot.salesforce.accounts, []);
  assertEquals(
    snapshot.degradations,
    [
      '/clickup/members',
      '/clickup/tasks',
      '/kantata/time_entries',
      '/kantata/time_off',
      '/salesforce/accounts',
      '/salesforce/opportunities',
      '/salesforce/users',
    ].map((path) => ({ path, reason: 'invalid_payload' })),
  );

  for (const collection of ['users', 'projects', 'allocations'] as const) {
    const corrupt = structuredClone(snapshot);
    corrupt.kantata[collection] = [{}];
    assertThrows(() => assembleModelRecord(corrupt));
  }

  for (const date of ['invalid', '2026-02-30']) {
    const invalidDate = structuredClone(snapshot);
    invalidDate.kantata.time_entries = [{ project_id: 'p1', hours: 4, date_performed: date }];
    const fallback = assembleModelRecord(invalidDate);
    assertEquals(fallback.referenceDate.date, '2026-08-19');
    assertEquals(detectOverAllocated(fallback).length, 1);
    assertEquals(invalidDate.kantata.time_entries, []);
  }

  // Valid-but-conflicting identities still fail instead of silently merging two people.
  snapshot.salesforce.users = [
    { Id: 'sf1', Name: 'First', Email: 'TEST@gonimbly.com' },
    { Id: 'sf2', Name: 'Second', Email: ' test@gonimbly.com ' },
  ];
  assertThrows(() => assembleModelRecord(snapshot), Error, 'duplicate Salesforce email');
});
