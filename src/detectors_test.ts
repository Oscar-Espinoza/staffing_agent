import { assertEquals } from '@std/assert';
import { normaliseAllocationPercentage } from './allocations.ts';
import { selectCandidates } from './candidates.ts';
import { detectOverAllocated } from './detectors/over-allocated.ts';
import type { Person } from './people.ts';
import type {
  ModelAllocation,
  ModelOpportunity,
  ModelProject,
  ModelRecord,
  ModelTimeOff,
} from './model-record.ts';
import { detectUnavailableCapacity } from './detectors/unavailable-capacity.ts';
import { detectDeadDeal } from './detectors/dead-deal.ts';
import { detectScaleAmbiguous } from './detectors/scale-ambiguous.ts';
import { detectUnstaffedDemand } from './detectors/unstaffed-demand.ts';

function person(id: string, name: string, isActive = true): Person {
  return {
    email: `${id}@gonimbly.com`,
    name,
    kantataUserId: id,
    salesforceUserId: null,
    clickupMemberId: null,
    title: null,
    weeklyCapacityHours: 40,
    isExternal: false,
    isActive,
  };
}

function project(id: string, title: string, over: Partial<ModelProject> = {}): ModelProject {
  return {
    id,
    title,
    clientName: title.split(' — ')[0] ?? title,
    status: 'Active',
    startDate: '2026-08-01',
    dueDate: '2026-11-02',
    budgetedHours: 500,
    leadUserId: null,
    salesforceAccountName: null,
    clickupListName: null,
    loggedHours: 0,
    matchedDeals: [],
    ...over,
  };
}

function allocation(
  id: string,
  projectId: string,
  userId: string,
  percentage: number,
): ModelAllocation {
  return { id, projectId, userId, percentage, startDate: '2026-08-08', endDate: '2026-11-02' };
}

function opportunity(over: Partial<ModelOpportunity> = {}): ModelOpportunity {
  return {
    id: '006Ho00000OPP08',
    name: 'Kestrel — RevOps Foundation',
    accountId: '001Ho00000NRD09',
    stageName: 'Negotiation',
    amount: 275_000,
    closeDate: '2026-08-28T00:00:00.000+0000',
    estimatedDeliveryHours: 700,
    probability: 90,
    ownerId: '005Ho00000GLD11',
    ...over,
  };
}

function record(over: Partial<ModelRecord> = {}): ModelRecord {
  const people = over.people ?? [];
  const personIndex: Record<string, Person> = {};
  for (const entry of people) {
    if (entry.kantataUserId !== null) personIndex[entry.kantataUserId] = entry;
  }
  return {
    referenceDate: { date: '2026-08-19', note: null },
    people,
    projects: [],
    allocations: [],
    timeOff: [],
    opportunities: [],
    accounts: [],
    tasks: [],
    notes: [],
    ambiguousAllocations: [],
    unmappedClients: [],
    ...over,
    personIndex: over.personIndex ?? personIndex,
  };
}

const marta = person('u_10052', 'Marta Zielinska-Ortiz');
const matias = person('u_10024', 'M. Ferreira');
const desmond = person('u_10099', 'Desmond Kerrigan', false);

const vacation: ModelTimeOff = {
  id: 'to_301',
  userId: 'u_10052',
  startDate: '2026-08-23',
  endDate: '2026-09-06',
  type: 'Vacation',
  status: 'Approved',
};
const pendingLeave: ModelTimeOff = {
  id: 'to_304',
  userId: 'u_10024',
  startDate: '2026-09-01',
  endDate: '2026-09-05',
  type: 'Vacation',
  status: 'Pending',
};

Deno.test('unavailable capacity names the inactive person and the approved leave, never the pending one', () => {
  const findings = detectUnavailableCapacity(record({
    people: [marta, matias, desmond],
    projects: [
      project('p_5001', 'Veridia — Account Hierarchy Redesign', { dueDate: '2026-09-27' }),
      project('p_5004', 'Halden — Phase 2 Delivery'),
    ],
    allocations: [
      allocation('a_9009', 'p_5001', 'u_10052', 90),
      allocation('a_9011', 'p_5004', 'u_10099', 50),
      allocation('a_9001', 'p_5001', 'u_10024', 80),
    ],
    timeOff: [vacation, pendingLeave],
  }));

  assertEquals(findings.map((finding) => finding.id), [
    'INACTIVE_ALLOCATED:a_9011',
    'LEAVE_COLLISION:to_301',
  ]);
  assertEquals(findings[0]?.title, 'Desmond Kerrigan — inactive but still allocated');
  assertEquals(findings[1]?.metrics.allocationPct, 90);
  assertEquals(
    findings.some((finding) => finding.sources.includes('kantata:time_off/to_304')),
    false,
  );
});

Deno.test('a heavy commitment with an unreadable allocation is skipped, not asserted', () => {
  const findings = detectUnavailableCapacity(record({
    people: [marta],
    projects: [
      project('p_5001', 'Veridia — Account Hierarchy Redesign', { dueDate: '2026-09-27' }),
    ],
    allocations: [allocation('a_9009', 'p_5001', 'u_10052', 90)],
    timeOff: [vacation],
    ambiguousAllocations: [{ id: 'a_9009', rawPercentage: 0.9, normalisedPercentage: 90 }],
  }));

  assertEquals(findings, []);
});

Deno.test('dead deal fires on a Closed Lost project and stays quiet when a deal was won', () => {
  const lost = opportunity({
    id: '006Ho00000OPP06',
    name: 'Tessellate — Multi-Track Integration',
    stageName: 'Closed Lost',
  });
  const base = {
    people: [person('u_10015', 'Gareth Holloway'), person('u_10036', 'Tomás Iglesias')],
    allocations: [
      allocation('a_9005', 'p_5007', 'u_10015', 50),
      allocation('a_9015', 'p_5007', 'u_10036', 85),
    ],
  };

  const fired = detectDeadDeal(record({
    ...base,
    projects: [project('p_5007', 'Tessellate — Multi-Track Integration', { matchedDeals: [lost] })],
  }));
  assertEquals(fired.length, 1);
  assertEquals(fired[0]?.id, 'DEAD_DEAL:p_5007');
  assertEquals(fired[0]?.severity, 'watch');
  assertEquals(fired[0]?.ambiguous, true);
  assertEquals(fired[0]?.group, {
    kind: 'project',
    id: 'p_5007',
    label: 'Tessellate — Multi-Track Integration',
  });

  const won = detectDeadDeal(record({
    ...base,
    projects: [project('p_5007', 'Tessellate — Multi-Track Integration', {
      matchedDeals: [lost, opportunity({ id: '006Ho00000OPP99', stageName: 'Closed Won' })],
    })],
  }));
  assertEquals(won, []);
});

Deno.test('dead deal is a question for Active projects only', () => {
  const lost = opportunity({ id: '006Ho00000OPP06', stageName: 'Closed Lost' });
  const findings = detectDeadDeal(record({
    people: [marta],
    projects: [project('p_5001', 'Veridia — Account Hierarchy Redesign', {
      status: 'On Hold',
      matchedDeals: [lost],
    })],
    allocations: [allocation('a_9009', 'p_5001', 'u_10052', 90)],
  }));
  assertEquals(findings, []);
});

Deno.test('unstaffed demand fires only for an account with no project', () => {
  const accounts = [
    { id: '001Ho00000NRD09', name: 'Kestrel Logistics', industry: 'Logistics' },
    { id: '001Ho00000ESO04', name: 'Halden', industry: 'Energy' },
  ];
  const kestrel = opportunity();
  const halden = opportunity({
    id: '006Ho00000OPP03',
    name: 'Halden — Phase 3 Scope',
    accountId: '001Ho00000ESO04',
    estimatedDeliveryHours: null,
    probability: 85,
    closeDate: '2026-08-26T00:00:00.000+0000',
  });

  const findings = detectUnstaffedDemand(record({
    accounts,
    opportunities: [kestrel, halden],
    projects: [project('p_5004', 'Halden — Phase 2 Delivery', { salesforceAccountName: 'Halden' })],
  }));

  assertEquals(findings.map((finding) => finding.id), ['UNSTAFFED_DEMAND:006Ho00000OPP08']);
  assertEquals(findings[0]?.ambiguous, false);
  assertEquals(findings[0]?.metrics.estimatedDeliveryHours, 700);
  assertEquals(findings[0]?.group, {
    kind: 'account',
    id: '001Ho00000NRD09',
    label: 'Kestrel Logistics',
  });
  assertEquals(findings[0]?.detail.includes(kestrel.name), false);
  assertEquals(findings[0]?.detail.startsWith('Salesforce lists it at 90%'), true);
});

Deno.test('a deal with no estimated hours is asked about, never sized at zero', () => {
  const findings = detectUnstaffedDemand(record({
    accounts: [{ id: '001Ho00000NRD09', name: 'Kestrel Logistics', industry: 'Logistics' }],
    opportunities: [opportunity({ estimatedDeliveryHours: null })],
  }));

  assertEquals(findings.length, 1);
  assertEquals(findings[0]?.ambiguous, true);
  assertEquals(findings[0]?.metrics.estimatedDeliveryHours, undefined);
});

Deno.test('sequential assignments do not create an over-allocation', () => {
  const findings = detectOverAllocated(record({
    people: [matias],
    projects: [
      project('p_5001', 'Veridia — Account Hierarchy Redesign'),
      project('p_5004', 'Halden — Phase 2 Delivery'),
    ],
    allocations: [
      { ...allocation('a_9001', 'p_5001', 'u_10024', 80), endDate: '2026-08-25' },
      { ...allocation('a_9002', 'p_5004', 'u_10024', 80), startDate: '2026-08-26' },
    ],
  }));
  assertEquals(findings, []);
});

Deno.test('only an ambiguous row active at the peak blocks over-allocation', () => {
  const findings = detectOverAllocated(record({
    people: [matias],
    projects: [
      project('p_5001', 'Veridia — Account Hierarchy Redesign'),
      project('p_5004', 'Halden — Phase 2 Delivery'),
      project('p_5005', 'Corvane — CPQ Migration'),
    ],
    allocations: [
      allocation('a_9001', 'p_5001', 'u_10024', 80),
      allocation('a_9002', 'p_5004', 'u_10024', 60),
      { ...allocation('a_9003', 'p_5005', 'u_10024', 50), startDate: '2026-09-10' },
    ],
    ambiguousAllocations: [{ id: 'a_9003', rawPercentage: 0.5, normalisedPercentage: 50 }],
  }));
  assertEquals(findings[0]?.metrics.allocationPct, 140);
  assertEquals(findings[0]?.group.kind, 'person');
});

Deno.test('zero is not an ambiguous allocation', () => {
  assertEquals(normaliseAllocationPercentage(0), { value: 0, ambiguous: false });
});

Deno.test('ambiguous allocations explain both possible percentage interpretations', () => {
  const simon = person('u_simon', 'Simon Zhao');
  const devika = person('u_devika', 'Devika Balasubramanian');
  const findings = detectScaleAmbiguous(record({
    people: [simon, devika],
    projects: [
      project('p_corvane', 'Corvane — CPQ Migration'),
      project('p_quillspace', 'Quillspace — Revenue Architecture'),
    ],
    allocations: [
      allocation('a_simon', 'p_corvane', 'u_simon', 100),
      allocation('a_devika', 'p_quillspace', 'u_devika', 25),
      allocation('reference_50', 'p_corvane', 'u_simon', 50),
      allocation('reference_80', 'p_quillspace', 'u_devika', 80),
    ],
    ambiguousAllocations: [
      { id: 'a_simon', rawPercentage: 1, normalisedPercentage: 100 },
      { id: 'a_devika', rawPercentage: 0.25, normalisedPercentage: 25 },
    ],
  }));

  assertEquals(findings.map(({ title, detail, metrics }) => ({ title, detail, metrics })), [
    {
      title: 'Quillspace — Devika Balasubramanian',
      detail:
        "Kantata lists Devika's allocation as 0.25, while most allocations use values like 50 " +
        "or 80.\nIt's unclear whether 0.25 means 0.25% or 25%, so Devika's workload can't be " +
        'calculated reliably.',
      metrics: { rawPercentage: 0.25, normalisedPercentage: 25 },
    },
    {
      title: 'Corvane — Simon Zhao',
      detail:
        "Kantata lists Simon's allocation as 1.0, while most allocations use values like 50 or " +
        "80.\nIt's unclear whether 1.0 means 1% or 100%, so Simon's workload can't be " +
        'calculated reliably.',
      metrics: { rawPercentage: 1, normalisedPercentage: 100 },
    },
  ]);
});

Deno.test('leave only collides with allocation active during the leave', () => {
  const findings = detectUnavailableCapacity(record({
    people: [marta],
    projects: [
      project('p_5001', 'Veridia — Account Hierarchy Redesign', { dueDate: '2026-09-27' }),
    ],
    allocations: [{ ...allocation('a_9009', 'p_5001', 'u_10052', 90), endDate: '2026-08-22' }],
    timeOff: [vacation],
  }));
  assertEquals(findings, []);
});

Deno.test('past opportunities are not staffing candidates', () => {
  const candidates = selectCandidates(record({
    opportunities: [
      opportunity({ id: 'past', closeDate: '2026-08-18' }),
      opportunity({ id: 'today', closeDate: '2026-08-19' }),
    ],
  }));
  assertEquals(candidates.map((candidate) => candidate.id), ['today']);
});

Deno.test('only Active projects suppress unstaffed demand', () => {
  const findings = detectUnstaffedDemand(record({
    accounts: [{ id: '001Ho00000NRD09', name: 'Kestrel Logistics', industry: 'Logistics' }],
    opportunities: [opportunity()],
    projects: [project('p_5001', 'Kestrel — Previous Engagement', {
      status: 'Completed',
      salesforceAccountName: 'Kestrel Logistics',
    })],
  }));
  assertEquals(findings.map((finding) => finding.id), ['UNSTAFFED_DEMAND:006Ho00000OPP08']);
});
