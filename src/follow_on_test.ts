import { assertEquals } from '@std/assert';
import { detectFollowOn } from './detectors/follow-on.ts';
import type { ModelRecord } from './model-record.ts';

function record(estimatedDeliveryHours: number | null, percentage: number): ModelRecord {
  return {
    referenceDate: { date: '2026-08-19', note: null },
    people: [],
    personIndex: {
      u_1: {
        email: 'a@gonimbly.com',
        name: 'Devika Balasubramanian',
        kantataUserId: 'u_1',
        salesforceUserId: null,
        clickupMemberId: null,
        title: null,
        weeklyCapacityHours: 40,
        isExternal: false,
        isActive: true,
      },
      u_2: {
        email: 'b@gonimbly.com',
        name: 'Desmond Kerrigan',
        kantataUserId: 'u_2',
        salesforceUserId: null,
        clickupMemberId: null,
        title: null,
        weeklyCapacityHours: 40,
        isExternal: false,
        isActive: false,
      },
    },
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
    allocations: [
      {
        id: 'a_1',
        projectId: 'p_5004',
        userId: 'u_1',
        percentage,
        startDate: '2026-08-01',
        endDate: '2026-11-02',
      },
      {
        id: 'a_2',
        projectId: 'p_5004',
        userId: 'u_2',
        percentage: 50,
        startDate: '2026-08-01',
        endDate: '2026-11-02',
      },
    ],
    timeOff: [],
    opportunities: [{
      id: 'OPP03',
      name: 'Halden — Phase 3 Scope',
      accountId: 'acc',
      stageName: 'Negotiation',
      amount: 1,
      closeDate: '2026-08-26',
      estimatedDeliveryHours,
      probability: 85,
      ownerId: 'o',
    }],
    accounts: [],
    tasks: [],
    notes: [],
    ambiguousAllocations: [],
    unmappedClients: [],
  };
}

const links = new Map([['OPP03', 'p_5004']]);

Deno.test('an ambiguous follow-on explains the overlap in human terms', () => {
  const [finding] = detectFollowOn(record(null, 100), links);
  assertEquals(finding?.title, 'Halden — Phase 3 may overlap Phase 2');
  assertEquals(
    finding?.detail,
    'Salesforce says Phase 3 could close on Aug 26 while Phase 2 is scheduled through Nov 2.\n' +
      'If the same team is expected to support both phases, additional capacity may be needed.',
  );
  // The inactive person is excluded from the roster behind this question.
  assertEquals(finding?.metrics.rosterSize, 1);
  assertEquals(finding?.ambiguous, true);
});

// The sized branch had no test, which is how a NaN percentage shipped: `NaN <= headroom` is
// false, so the restraint check silently fired on every hours-bearing follow-on.
Deno.test('a sized follow-on states a real percentage, never NaN', () => {
  const [finding] = detectFollowOn(record(600, 100), links);
  assertEquals(finding?.severity, 'critical');
  assertEquals(finding?.detail.includes('NaN'), false);
  assertEquals(Number.isFinite(finding?.metrics.requiredPct ?? NaN), true);
  assertEquals(new Set(finding?.sources).size, finding?.sources.length);
  assertEquals(finding?.group, {
    kind: 'project',
    id: 'p_5004',
    label: 'Halden — Phase 2 Delivery',
  });
});

Deno.test('headroom that absorbs the work produces no finding at all', () => {
  assertEquals(detectFollowOn(record(1, 10), links).length, 0);
});

Deno.test('follow-on ignores a roster allocation that ends before the deal closes', () => {
  const input = record(600, 100);
  input.allocations[0] = { ...input.allocations[0]!, endDate: '2026-08-25' };
  assertEquals(detectFollowOn(input, links), []);
});

Deno.test('split rows for one person do not double their capacity or headroom', () => {
  const input = record(300, 50);
  input.allocations = [
    { ...input.allocations[0]!, id: 'a_1', percentage: 50 },
    { ...input.allocations[0]!, id: 'a_3', percentage: 50 },
  ];
  const [finding] = detectFollowOn(input, links);
  assertEquals(finding?.severity, 'critical');
  assertEquals(finding?.metrics.availableWeeklyHours, 0);
});

Deno.test('other active commitments consume a continuing team member’s headroom', () => {
  const input = record(100, 50);
  input.projects.push({
    id: 'p_other',
    title: 'Other commitment',
    clientName: 'Other',
    status: 'Active',
    startDate: '2026-08-01',
    dueDate: '2026-11-02',
    budgetedHours: 1,
    leadUserId: null,
    salesforceAccountName: null,
    clickupListName: null,
    loggedHours: 0,
    matchedDeals: [],
  });
  input.allocations.push({
    id: 'a_other',
    projectId: 'p_other',
    userId: 'u_1',
    percentage: 50,
    startDate: '2026-08-01',
    endDate: '2026-11-02',
  });
  assertEquals(detectFollowOn(input, links)[0]?.severity, 'critical');
});

Deno.test('ambiguous roster allocations produce a question instead of a critical claim', () => {
  const input = record(600, 100);
  input.ambiguousAllocations = [{ id: 'a_1', rawPercentage: 1, normalisedPercentage: 100 }];
  const [finding] = detectFollowOn(input, links);
  assertEquals(finding?.ambiguous, true);
  assertEquals(finding?.severity, 'watch');
});
