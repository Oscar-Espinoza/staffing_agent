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
  assertEquals(findings[0]?.metrics, { allocationPct: 50 });
  assertEquals(findings[0]?.sources, [
    'kantata:allocations/a_9011',
    'kantata:users/u_10099',
    'kantata:projects/p_5004',
  ]);
  assertEquals(
    findings[0]?.rationale,
    'The plan includes a 50% allocation for a user marked inactive; confirm availability or replacement coverage.',
  );
  assertEquals(findings[1]?.metrics.allocationPct, 90);
  assertEquals(findings[1]?.sources, [
    'kantata:time_off/to_301',
    'kantata:users/u_10052',
    'kantata:allocations/a_9009',
    'kantata:projects/p_5001',
  ]);
  assertEquals(findings[1]?.rationale.includes('confirm planned coverage'), true);
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

Deno.test('unstaffed demand fires only for an account with no matching Active project', () => {
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
    ],
    ambiguousAllocations: [
      { id: 'a_simon', rawPercentage: 1, normalisedPercentage: 100 },
      { id: 'a_devika', rawPercentage: 0.25, normalisedPercentage: 25 },
    ],
  }));

  assertEquals(findings.map(({ title, detail, metrics }) => ({ title, detail, metrics })), [
    {
      title: 'Quillspace — Devika Balasubramanian',
      detail: "Kantata lists Devika's allocation as 0.25. It's unclear whether " +
        'this means 0.25% or 25%, so exact utilization cannot be ' +
        'calculated reliably.',
      metrics: { rawPercentage: 0.25, normalisedPercentage: 25 },
    },
    {
      title: 'Corvane — Simon Zhao',
      detail: "Kantata lists Simon's allocation as 1.0. It's unclear whether " +
        'this means 1% or 100%, so exact utilization cannot be ' +
        'calculated reliably.',
      metrics: { rawPercentage: 1, normalisedPercentage: 100 },
    },
  ]);
  assertEquals(findings.map((finding) => finding.sources), [
    ['kantata:allocations/a_devika', 'kantata:users/u_devika', 'kantata:projects/p_quillspace'],
    ['kantata:allocations/a_simon', 'kantata:users/u_simon', 'kantata:projects/p_corvane'],
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
  assertEquals(findings[0]?.title, 'Kestrel — RevOps Foundation — no active project recorded');
  assertEquals(
    findings[0]?.detail,
    'Salesforce lists it at 90% with a 2026-08-28 close, 9 days out, and estimates 700 delivery hours. ' +
      'No matching active project for Kestrel Logistics was found in the retrieved Kantata data.',
  );
  assertEquals(
    findings[0]?.rationale,
    'Confirm the staffing plan for Kestrel Logistics if this deal closes; ' +
      'estimated hours and a sales close date do not establish when delivery starts.',
  );
  assertEquals(findings[0]?.sources, [
    'salesforce:opportunities/006Ho00000OPP08',
    'salesforce:accounts/001Ho00000NRD09',
  ]);
});

Deno.test('future over-allocation names its date and cites the records used, regardless of project status', () => {
  const [finding] = detectOverAllocated(record({
    people: [matias],
    projects: [
      project('p_5001', 'Veridia — Account Hierarchy Redesign'),
      project('p_5005', 'Corvane — CPQ Migration', { status: 'Completed' }),
    ],
    allocations: [
      allocation('a_9001', 'p_5001', 'u_10024', 80),
      { ...allocation('a_9002', 'p_5005', 'u_10024', 60), startDate: '2026-08-26' },
    ],
  }));
  assertEquals(finding?.metrics, { allocationPct: 140, projectCount: 2 });
  assertEquals(
    finding?.detail,
    'On 2026-08-26: 80% on Veridia + 60% on Corvane against a 40h/week capacity.',
  );
  assertEquals(
    finding?.rationale,
    'Recorded allocations total 140% on 2026-08-26, exceeding 100% across 2 project references; ' +
      'review the overlapping commitments.',
  );
  assertEquals(finding?.sources, [
    'kantata:allocations/a_9001',
    'kantata:allocations/a_9002',
    'kantata:users/u_10024',
    'kantata:projects/p_5001',
    'kantata:projects/p_5005',
  ]);
});

Deno.test('missing person or project references never become fabricated source citations', () => {
  const unknown = record({
    allocations: [allocation('a_orphan', 'p_missing', 'u_missing', 140)],
  });
  const [overAllocated] = detectOverAllocated(unknown);
  assertEquals(overAllocated?.metrics, { allocationPct: 140, projectCount: 1 });
  assertEquals(overAllocated?.sources, ['kantata:allocations/a_orphan']);

  const [scale] = detectScaleAmbiguous(record({
    allocations: [allocation('a_orphan', 'p_missing', 'u_missing', 100)],
    ambiguousAllocations: [{ id: 'a_orphan', rawPercentage: 1, normalisedPercentage: 100 }],
  }));
  assertEquals(scale?.sources, ['kantata:allocations/a_orphan']);

  const [inactive] = detectUnavailableCapacity(record({
    people: [desmond],
    allocations: [allocation('a_orphan', 'p_missing', 'u_10099', 50)],
  }));
  assertEquals(inactive?.sources, ['kantata:allocations/a_orphan', 'kantata:users/u_10099']);

  const [leave] = detectUnavailableCapacity(record({
    projects: [project('p_5001', 'Veridia — Account Hierarchy Redesign')],
    allocations: [allocation('a_9009', 'p_5001', 'u_10052', 90)],
    timeOff: [vacation],
  }));
  assertEquals(leave?.sources, [
    'kantata:time_off/to_301',
    'kantata:allocations/a_9009',
    'kantata:projects/p_5001',
  ]);
});

Deno.test('approved leave uses inclusive window boundaries and signed start timing', () => {
  for (
    const [startDate, endDate, status, timing, days] of [
      ['2026-08-17', '2026-08-22', 'Approved', 'already underway', -2],
      ['2026-08-19', '2026-08-22', 'Approved', 'starting today', 0],
      ['2026-08-17', '2026-08-19', 'Approved', 'already underway', -2],
      ['2026-08-23', '2026-09-06', 'Approved', 'starting in 4 days', 4],
      ['2026-08-17', '2026-08-18', 'Approved', '', 0],
      ['2026-08-17', '2026-08-22', 'Pending', '', 0],
      ['2026-09-19', '2026-09-26', 'Approved', '', 0],
    ] as const
  ) {
    const findings = detectUnavailableCapacity(record({
      people: [marta],
      projects: [project('p', 'Veridia')],
      allocations: [allocation('a', 'p', vacation.userId, 80)],
      timeOff: [{ ...vacation, startDate, endDate, status }],
    }));
    assertEquals(findings.length, timing ? 1 : 0);
    if (timing) {
      assertEquals(findings[0]?.detail.endsWith(`${timing}.`), true);
      assertEquals(findings[0]?.metrics, { allocationPct: 80, startsInDays: days });
    }
  }
});

Deno.test('ongoing leave ignores past commitments and peaks beyond the horizon', () => {
  const base = record({
    projects: [project('p', 'Veridia')],
    timeOff: [{ ...vacation, startDate: '2026-08-17', endDate: '2026-09-25' }],
    allocations: [
      { ...allocation('past', 'p', vacation.userId, 90), endDate: '2026-08-18' },
      allocation('current', 'p', vacation.userId, 30),
      { ...allocation('future', 'p', vacation.userId, 90), startDate: '2026-09-19' },
    ],
  });
  assertEquals(detectUnavailableCapacity(base), []);
  base.allocations[1]!.percentage = 80;
  const [finding] = detectUnavailableCapacity(base);
  assertEquals(finding?.metrics.allocationPct, 80);
  assertEquals(finding?.rationale.includes('on 2026-08-19'), true);
  assertEquals(finding?.sources.includes('kantata:allocations/past'), false);
  assertEquals(finding?.sources.includes('kantata:allocations/future'), false);
});

Deno.test('Tomás enters the inclusive window on August 20 with the same records', () => {
  const base = record({
    people: [person('u_10036', 'Tomás Iglesias')],
    projects: [
      project('p_5007', 'Tessellate — Multi-Track Integration', { dueDate: '2026-11-13' }),
    ],
    allocations: [{
      ...allocation('a_9015', 'p_5007', 'u_10036', 85),
      startDate: '2026-08-15',
      endDate: '2026-11-13',
    }],
    timeOff: [{
      id: 'to_302',
      userId: 'u_10036',
      startDate: '2026-09-19',
      endDate: '2026-09-26',
      type: 'Vacation',
      status: 'Approved',
    }],
  });
  assertEquals(detectUnavailableCapacity(base), []);
  const [finding] = detectUnavailableCapacity({
    ...base,
    referenceDate: { date: '2026-08-20', note: null },
  });
  assertEquals(finding?.id, 'LEAVE_COLLISION:to_302');
  assertEquals(finding?.metrics, { allocationPct: 85, startsInDays: 30 });
  assertEquals(detectUnavailableCapacity(base), []);
});

Deno.test('Simon keeps his uncertainty question with approved sick-leave coverage context', () => {
  const base = record({
    people: [person('u_10005', 'Simon Zhao')],
    projects: [project('p_5005', 'Corvane — CPQ Migration', { dueDate: '2026-10-11' })],
    allocations: [
      {
        ...allocation('a_9012', 'p_5005', 'u_10005', 100),
        startDate: '2026-08-12',
        endDate: '2026-10-11',
      },
      {
        ...allocation('a_9018', 'p_5099', 'u_10005', 30),
        startDate: '2026-07-31',
        endDate: '2026-09-29',
      },
    ],
    ambiguousAllocations: [{ id: 'a_9012', rawPercentage: 1, normalisedPercentage: 100 }],
  });
  const [original] = detectScaleAmbiguous(base);
  const sick: ModelTimeOff = {
    id: 'to_303',
    userId: 'u_10005',
    startDate: '2026-08-17',
    endDate: '2026-08-19',
    type: 'Sick',
    status: 'Approved',
  };
  const enriched = { ...base, timeOff: [sick] };
  const [finding] = detectScaleAmbiguous(enriched);
  assertEquals(finding, {
    ...original,
    detail: original!.detail +
      ' Approved sick from 2026-08-17 to 2026-08-19 overlaps this allocation in the analysis window. What coverage is planned during this leave?',
    sources: ['kantata:time_off/to_303', ...original!.sources],
  });
  assertEquals(finding?.id, 'SCALE_AMBIGUOUS:a_9012');
  assertEquals(finding?.severity, 'watch');
  assertEquals(finding?.ambiguous, true);
  assertEquals(detectUnavailableCapacity(enriched), []);
  for (
    const leave of [
      { ...sick, status: 'Pending' },
      { ...sick, endDate: '2026-08-18' },
      { ...sick, startDate: '2026-10-12', endDate: '2026-10-15' },
      { ...sick, userId: 'someone_else' },
    ]
  ) assertEquals(detectScaleAmbiguous({ ...base, timeOff: [leave] }), [original]);
  const pastOnly = {
    ...base,
    allocations: [{ ...base.allocations[0]!, startDate: '2026-08-20' }],
    timeOff: [sick],
  };
  assertEquals(detectScaleAmbiguous(pastOnly), [original]);
  const leaves = [
    { ...sick, id: 'z', startDate: '2026-08-19' },
    { ...sick, id: 'b' },
    { ...sick, id: 'a' },
  ];
  const [multiple] = detectScaleAmbiguous({ ...base, timeOff: leaves });
  assertEquals(multiple?.sources.slice(0, 3), [
    'kantata:time_off/a',
    'kantata:time_off/b',
    'kantata:time_off/z',
  ]);
  assertEquals(detectScaleAmbiguous({ ...base, timeOff: leaves.reverse() }), [multiple]);
});
