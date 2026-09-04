import { assertEquals } from '@std/assert';
import { clientMatchBaseline } from './baseline.ts';
import { applyDemoScenario } from './demo.ts';
import type { ModelRecord } from './model-record.ts';

function haldenRecord(): ModelRecord {
  return {
    referenceDate: { date: '2026-08-19', note: null },
    people: [],
    personIndex: {},
    projects: [{
      id: 'p_5004',
      title: 'Halden — Phase 2 Delivery',
      clientName: 'Halden',
      status: 'Active',
      startDate: '2026-07-01',
      dueDate: '2026-11-02',
      budgetedHours: 900,
      leadUserId: null,
      salesforceAccountName: 'Halden',
      clickupListName: null,
      loggedHours: 0,
      matchedDeals: [],
    }],
    allocations: [],
    timeOff: [],
    opportunities: [{
      id: '006Ho00000OPP03',
      name: 'Halden — Phase 3 Scope',
      accountId: 'acc_halden',
      stageName: 'Negotiation',
      amount: 1,
      closeDate: '2026-08-26',
      estimatedDeliveryHours: null,
      probability: 85,
      ownerId: 'o',
    }],
    accounts: [{ id: 'acc_halden', name: 'Halden', industry: 'x' }],
    tasks: [],
    notes: [],
    ambiguousAllocations: [],
    unmappedClients: [],
  };
}

// The honest measurement: on the real fixtures a client-name match is unambiguous, so the model
// is redundant. The demo scenario is what makes it load-bearing.
Deno.test('one active project per client means arithmetic could answer', () => {
  assertEquals(clientMatchBaseline(haldenRecord())['006Ho00000OPP03'], 1);
});

Deno.test('a second concurrent project makes the client match ambiguous', () => {
  const record = applyDemoScenario(haldenRecord());
  assertEquals(clientMatchBaseline(record)['006Ho00000OPP03'], 2);
  // Both candidates are Halden, so the verifier's client check clears either one: the model's
  // reading of the names is the only thing separating them.
  const halden = record.projects.filter((project) =>
    project.salesforceAccountName === 'Halden' && project.status === 'Active'
  );
  assertEquals(halden.length, 2);
  assertEquals(halden.every((project) => project.title.startsWith('Halden')), true);
});
