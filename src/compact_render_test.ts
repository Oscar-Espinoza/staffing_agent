import { assertEquals, assertStringIncludes } from '@std/assert';
import { buildFindingContext, render } from './render.ts';
import type { ModelRecord } from './model-record.ts';
import { detectUnstaffedDemand } from './detectors/unstaffed-demand.ts';
import { detectUnavailableCapacity } from './detectors/unavailable-capacity.ts';
import { detectOverAllocated } from './detectors/over-allocated.ts';
import { detectScaleAmbiguous } from './detectors/scale-ambiguous.ts';
import { detectFollowOn } from './detectors/follow-on.ts';
import { detectDeadDeal } from './detectors/dead-deal.ts';
import type { Finding } from './finding.ts';

function fixture(): ModelRecord {
  const r: ModelRecord = {
    referenceDate: { date: '2026-08-19', note: null },
    people: [],
    personIndex: {},
    projects: [],
    allocations: [],
    timeOff: [],
    opportunities: [],
    accounts: [],
    tasks: [],
    notes: [],
    ambiguousAllocations: [],
    unmappedClients: [],
  };
  for (
    const [id, name] of [
      ['desmond', 'Desmond Kerrigan'],
      ['ferreira', 'M. Ferreira'],
      ['marta', 'Marta Zielinska-Ortiz'],
      ['devika', 'Devika Balasubramanian'],
      ['simon', 'Simon Zhao'],
      ['tomas', 'Tomás Iglesias'],
    ]
  ) {
    const person = {
      email: id + '@example.com',
      name: name!,
      kantataUserId: id!,
      salesforceUserId: null,
      clickupMemberId: id === 'tomas' ? 7 : null,
      title: null,
      weeklyCapacityHours: 40,
      isExternal: false,
      isActive: id !== 'desmond',
    };
    r.people.push(person);
    r.personIndex[id!] = person;
  }
  for (
    const [id, title, client] of [
      ['halden', 'Halden — Phase 2 Delivery', 'Halden'],
      ['veridia', 'Veridia — Account Hierarchy Redesign', 'Veridia'],
      ['corvane', 'Corvane — CPQ Migration', 'Corvane'],
      ['quill', 'Quillspace — AI Enablement Advisory', 'Quillspace'],
      ['tess', 'Tessellate — Multi-Track Integration', 'Tessellate'],
    ]
  ) {
    r.projects.push({
      id: id!,
      title: title!,
      clientName: client!,
      status: 'Active',
      startDate: '2026-08-08',
      dueDate: '2026-11-02',
      budgetedHours: 900,
      leadUserId: null,
      salesforceAccountName: client!,
      clickupListName: id === 'tess' ? 'Tessellate' : null,
      loggedHours: 0,
      matchedDeals: [],
    });
  }
  const rows: [string, string, number][] = [
    ['desmond', 'halden', 50],
    ['ferreira', 'veridia', 80],
    ['ferreira', 'corvane', 60],
    ['marta', 'veridia', 90],
    ['devika', 'quill', 25],
    ['simon', 'corvane', 100],
    ['tomas', 'tess', 40],
    ['devika', 'tess', 20],
    ['tomas', 'halden', 10],
  ];
  rows.forEach(([userId, projectId, percentage], i) =>
    r.allocations.push({
      id: String(i),
      userId,
      projectId,
      percentage,
      startDate: '2026-08-08',
      endDate: '2026-11-02',
    })
  );
  r.ambiguousAllocations = [
    { id: '4', rawPercentage: 0.25, normalisedPercentage: 25 },
    { id: '5', rawPercentage: 1, normalisedPercentage: 100 },
  ];
  r.timeOff = [
    {
      id: 'vacation',
      userId: 'marta',
      type: 'Vacation',
      status: 'Approved',
      startDate: '2026-08-23',
      endDate: '2026-09-06',
    },
    {
      id: 'sick',
      userId: 'simon',
      type: 'Sick leave',
      status: 'Approved',
      startDate: '2026-08-17',
      endDate: '2026-08-19',
    },
  ];
  for (
    const [id, name, account, close, hours] of [
      ['incoming', 'Kestrel — RevOps Foundation', 'Kestrel Logistics', '2026-08-28', 700],
      ['follow', 'Halden — Phase 3 Scope', 'Halden', '2026-08-26', null],
      ['lost', 'Tessellate — Multi-Track Integration', 'Tessellate', '2026-08-01', null],
    ] as const
  ) {
    r.accounts.push({ id: account, name: account, industry: '' });
    r.opportunities.push({
      id,
      name,
      accountId: account,
      closeDate: close,
      estimatedDeliveryHours: hours,
      stageName: id === 'lost' ? 'Closed Lost' : 'Negotiation',
      probability: 90,
      amount: 1,
      ownerId: '',
    });
  }
  r.projects.find((p) => p.id === 'tess')!.matchedDeals = [r.opportunities[2]!];
  r.tasks.push({
    id: 'task',
    name: 'Flow refactor',
    status: 'in progress',
    listId: 'list',
    listName: 'Tessellate',
    assigneeIds: [7],
    timeEstimateHours: null,
  });
  r.notes = [
    'Salesforce: Possible duplicate for Corvane: “Corvane — CPQ Migration Copy” excluded from demand calculations; retained “Corvane — CPQ Migration”. Account, amount, close date, and estimated hours match.',
    "Simon Zhao's allocation orphan references missing Kantata project unknown; it counts toward total allocation but cannot be attributed to a known project.",
  ];
  return r;
}

function findings(r: ModelRecord): Finding[] {
  const unavailable = detectUnavailableCapacity(r);
  return [
    ...detectUnstaffedDemand(r),
    ...unavailable.filter((f) => f.type === 'INACTIVE_ALLOCATED'),
    ...detectOverAllocated(r),
    ...unavailable.filter((f) => f.type === 'LEAVE_COLLISION'),
    ...detectScaleAmbiguous(r),
    ...detectFollowOn(r, new Map([['follow', 'halden']])),
    ...detectDeadDeal(r),
  ];
}
function briefing(r: ModelRecord, shown = findings(r)): string {
  return render({
    findings: shown,
    findingContext: buildFindingContext(r, shown),
    referenceDate: r.referenceDate.date,
    trigger: 'manual',
    degradedSources: [],
    dataQualityNotes: r.notes,
  });
}

Deno.test('complete illustrated briefing is concise, source labeled, and preserves structured evidence', () => {
  const r = fixture();
  const shown = findings(r);
  const before = structuredClone({ r, shown });
  const message = briefing(r, shown);
  assertEquals(
    message,
    `Staffing snapshot · as of 19 Aug 2026
Manual check · 4 risks · 4 questions

NEEDS ATTENTION

Incoming work without a recorded project
Client: Kestrel Logistics
Salesforce opportunity: Kestrel — RevOps Foundation · 90% probability · closes 28 Aug · 700 estimated delivery hours.
Kantata: No matching active project found for this client in the retrieved data.
Confirm staffing and delivery timing if this closes.

Desmond Kerrigan — inactive but allocated
Client: Halden
Project: Halden — Phase 2 Delivery
Kantata records 50% on this project, 8 Aug–2 Nov; person marked inactive.
Confirm availability or replacement coverage.

Over capacity: M. Ferreira — 140%
This person has two project allocations overlapping from 8 Aug to 2 Nov (61 weekdays), totaling 140% of weekly capacity.
Kantata projects:
• Veridia — Account Hierarchy Redesign (Client: Veridia): 80%
• Corvane — CPQ Migration (Client: Corvane): 60%
Which commitment can be reduced or reassigned?

Marta Zielinska-Ortiz — leave conflicts with commitment
Client: Veridia
Project: Veridia — Account Hierarchy Redesign
Kantata records 90% on this project; approved vacation 23 Aug–6 Sep.
Confirm leave coverage.

NEEDS REVIEW

Devika Balasubramanian — allocation units unclear
Client: Quillspace
Project: Quillspace — AI Enablement Advisory
Recorded allocation: 0.25; could mean 0.25% or 25%.
Confirm the intended units.

Simon Zhao — allocation units and leave coverage unclear
Client: Corvane
Project: Corvane — CPQ Migration
Recorded allocation: 1.0; could mean 1% or 100%.
Approved sick leave: 17–19 Aug, overlapping this allocation.
Confirm the intended units and leave coverage.

Follow-on schedule to confirm
Client: Halden
Project: Halden — Phase 2 Delivery
Salesforce opportunity: Halden — Phase 3 Scope · closes 26 Aug · delivery hours not estimated.
The project is scheduled in Kantata through 2 Nov.
When would delivery start, for how long, and with which team?

Client: Tessellate
Project: Tessellate — Multi-Track Integration

The Salesforce opportunity with the same name is marked Closed Lost. However, the project is still active in Kantata with people allocated (2 active allocation records). In ClickUp, the task “Flow refactor” is marked in progress and assigned to Tomás Iglesias.

Is this project still approved to continue?

DATA QUALITY NOTES
Salesforce: Possible duplicate for Corvane: “Corvane — CPQ Migration Copy” excluded from demand calculations; retained “Corvane — CPQ Migration”. Account, amount, close date, and estimated hours match.
Kantata: Simon Zhao’s allocation references project unknown, not found in the retrieved Kantata projects; included in personal allocation totals.`,
  );
  for (const f of shown) {
    const block = briefing({ ...r, notes: [] }, [f]);
    for (
      const name of [
        ...r.people.map((p) => p.name),
        ...r.projects.map((p) => p.title),
        ...r.opportunities.map((o) => o.name),
        ...r.tasks.map((t) => t.name),
      ]
    ) {
      assertEquals(block.split(name).length <= 2, true, name);
    }
  }
  assertEquals({ r, shown }, before);
});

Deno.test('cross-year windows, future peak, missing hours, and repeated project rows retain their meaning', () => {
  const r = fixture();
  r.allocations[0]!.endDate = '2027-01-03';
  r.allocations[2]!.startDate = '2026-08-26';
  r.allocations.push({ ...r.allocations[1]!, id: 'extra', percentage: 5 });
  r.opportunities[0]!.estimatedDeliveryHours = null;
  r.projects[0]!.dueDate = '2027-02-03';
  const message = briefing(r);
  assertStringIncludes(message, '8 Aug–3 Jan 2027');
  assertStringIncludes(
    message,
    '• Veridia — Account Hierarchy Redesign (Client: Veridia): 85%',
  );
  assertStringIncludes(message, 'closes 28 Aug · delivery hours not estimated.');
  assertStringIncludes(message, 'scheduled in Kantata through 3 Feb 2027.');
});

Deno.test('identical follow-on names appear once and missing cited records restore original text', () => {
  const r = fixture();
  r.opportunities[1]!.name = r.projects[0]!.title;
  const shown = detectFollowOn(r, new Map([['follow', 'halden']]));
  const message = briefing(r, shown);
  assertEquals(message.split(r.projects[0]!.title).length, 2);
  assertStringIncludes(message, 'The Salesforce opportunity with the same name · closes 26 Aug');
  for (const missing of ['projects', 'people', 'allocations', 'opportunities'] as const) {
    const incomplete = { ...r, [missing]: [], notes: [] };
    assertEquals(
      briefing(incomplete, shown),
      render({
        findings: shown,
        referenceDate: r.referenceDate.date,
        trigger: 'manual',
        degradedSources: [],
      }),
    );
  }
});

Deno.test('a prior ambiguous allocation cannot move the displayed peak earlier', () => {
  const r = fixture();
  r.allocations.push({
    ...r.allocations[1]!,
    id: 'early-ambiguous',
    percentage: 10,
    endDate: '2026-08-22',
  });
  r.ambiguousAllocations.push({
    id: 'early-ambiguous',
    rawPercentage: 0.1,
    normalisedPercentage: 10,
  });
  r.allocations.push({
    ...r.allocations[1]!,
    id: 'later-start',
    percentage: 0,
    startDate: '2026-08-23',
  });
  const shown = detectOverAllocated(r);
  assertStringIncludes(
    briefing(r, shown),
    'Kantata projects:',
  );
});

Deno.test('leave against multiple projects shows each commitment once', () => {
  const r = fixture();
  r.allocations[3]!.percentage = 50;
  r.allocations.push({
    ...r.allocations[3]!,
    id: 'leave-second',
    projectId: 'corvane',
    percentage: 40,
  });
  const shown = detectUnavailableCapacity(r).filter((f) => f.type === 'LEAVE_COLLISION');
  assertStringIncludes(
    briefing(r, shown),
    `Kantata:
50% — Project: Veridia — Account Hierarchy Redesign · Client: Veridia
40% — Project: Corvane — CPQ Migration · Client: Corvane
Approved vacation: 23 Aug–6 Sep.
Confirm leave coverage.`,
  );
});

Deno.test('unconfirmed identical names appear once and notices alone render a question', () => {
  const r = fixture();
  const input = {
    findings: findings(r),
    referenceDate: r.referenceDate.date,
    trigger: 'manual' as const,
    degradedSources: [],
    projectConnectionNotices: [{
      client: 'Auralis',
      opportunity: 'Auralis — Expansion',
      projects: ['Auralis — Expansion'],
    }],
  };
  const message = render(input);
  assertEquals(message.split('Auralis — Expansion').length, 2);
  assertStringIncludes(
    message,
    'Project connection unconfirmed. Does this extend the existing project, or is it separate work?',
  );
  assertStringIncludes(render({ ...input, findings: [] }), '0 risks · 1 question\n\nNEEDS REVIEW');
});

Deno.test('connection questions show shared names once with multiple candidates', () => {
  const message = render({
    findings: [],
    referenceDate: '2026-08-19',
    trigger: 'manual',
    degradedSources: [],
    projectConnectionNotices: [{
      client: 'Auralis',
      opportunity: 'Auralis — Expansion',
      projects: ['Auralis — Expansion', 'Auralis — Support', 'Auralis — Support'],
    }],
  });
  assertEquals(message.split('Auralis — Expansion').length, 2);
  assertEquals(message.split('Auralis — Support').length, 2);
  assertStringIncludes(message, '0 risks · 1 question');
});

Deno.test('lost opportunities retain explicit roles and client context without repeating names', () => {
  const r = fixture();
  const project = r.projects.find((p) => p.id === 'tess')!;
  // The client must come from the record even when the official title suggests another name.
  project.clientName = 'Recorded client';
  const other = { ...r.opportunities[2]!, id: 'other-lost', name: 'Separate proposal' };
  r.opportunities.push(other);
  project.matchedDeals.push(other);
  const shown = detectDeadDeal(r);
  const message = briefing(r, shown);
  assertStringIncludes(message, 'Client: Recorded client');
  assertStringIncludes(message, 'Project: Tessellate — Multi-Track Integration');
  assertStringIncludes(
    message,
    'The Salesforce opportunity with the same name is marked Closed Lost.',
  );
  assertStringIncludes(
    message,
    'The Salesforce opportunity “Separate proposal” belongs to the same client and is marked Closed Lost; its connection to this project is unconfirmed.',
  );
  for (const name of [project.title, other.name, r.tasks[0]!.name]) {
    assertEquals(message.split(name).length, 2);
  }
  assertEquals(shown[0]!.metrics.lostDealCount, 2);
  assertStringIncludes(shown[0]!.sources.join(' '), 'salesforce:opportunities/other-lost');

  for (const missing of ['projects', 'opportunities', 'tasks', 'people'] as const) {
    const fallback = briefing({ ...r, [missing]: [], notes: [] }, shown);
    assertStringIncludes(fallback, 'Client: Recorded client');
    assertStringIncludes(fallback, 'Is this project still approved to continue?');
    assertEquals(fallback.split(project.title).length, 2);
    assertEquals(fallback.includes('other-lost'), false);
  }

  const withoutTasks = briefing({ ...r, tasks: [] }, detectDeadDeal({ ...r, tasks: [] }));
  assertEquals(withoutTasks.includes('In ClickUp'), false);
  assertStringIncludes(withoutTasks, 'Is this project still approved to continue?');
});

Deno.test('connection questions label client, every candidate, and unknown client without guessing', () => {
  const message = render({
    findings: [],
    referenceDate: '2026-08-19',
    trigger: 'manual',
    degradedSources: [],
    projectConnectionNotices: [{
      client: 'Recorded client',
      opportunity: 'Shared name',
      projects: ['Shared name', 'Other candidate'],
    }, {
      client: null,
      opportunity: 'Misleading client — Proposal',
      projects: [],
    }],
  });
  assertStringIncludes(message, 'Client: Recorded client');
  assertStringIncludes(message, 'Kantata project to check: Shared name');
  assertStringIncludes(message, 'Kantata project to check: Other candidate');
  assertStringIncludes(message, 'Salesforce opportunity: same name as the project.');
  assertStringIncludes(message, 'Client: Unknown (not found in retrieved records)');
  assertStringIncludes(message, 'Salesforce opportunity: Misleading client — Proposal');
  assertEquals(message.split('Shared name').length, 2);
  assertStringIncludes(message, '0 risks · 2 questions');
});

Deno.test('capacity explanation uses recorded role and allocation overlap rather than project dates', () => {
  const r = fixture();
  r.people.find((p) => p.kantataUserId === 'ferreira')!.title = 'Delivery Consultant';
  r.allocations[1]!.startDate = '2026-08-20';
  r.allocations[1]!.endDate = '2026-09-04';
  r.allocations[2]!.startDate = '2026-08-26';
  r.allocations[2]!.endDate = '2026-10-01';
  const message = briefing(r, detectOverAllocated(r));
  assertStringIncludes(message, 'This Delivery Consultant has two project allocations');
  assertStringIncludes(message, 'Kantata projects:');
  assertStringIncludes(
    message,
    'overlapping from 26 Aug to 4 Sep (8 weekdays), totaling 140% of weekly capacity.',
  );
  assertStringIncludes(message, '(Client: Veridia): 80%');
  assertStringIncludes(message, '(Client: Corvane): 60%');
  assertEquals(message.includes('2 Nov'), false);

  r.allocations[1]!.endDate = '2026-08-26';
  assertStringIncludes(
    briefing(r, detectOverAllocated(r)),
    'overlapping from 26 Aug to 26 Aug (1 weekday)',
  );

  r.people.find((p) => p.kantataUserId === 'ferreira')!.weeklyCapacityHours = null;
  const unknown = briefing(r, detectOverAllocated(r));
  assertStringIncludes(unknown, 'totaling 140% of weekly capacity.');
  assertEquals(unknown.includes('hours/week'), false);
});

Deno.test('over-capacity weekday counts include endpoints and exclude weekends across years', () => {
  for (
    const [start, end, expected] of [
      ['2026-08-12', '2026-09-27', '33 weekdays'],
      ['2026-12-31', '2027-01-04', '3 weekdays'],
      ['2026-08-22', '2026-08-23', '0 weekdays'],
      ['2026-08-21', '2026-08-21', '1 weekday'],
    ]
  ) {
    const r = fixture();
    r.referenceDate.date = start!;
    for (const allocation of r.allocations) {
      allocation.startDate = start!;
      allocation.endDate = end!;
    }
    const person = r.people.find((p) => p.kantataUserId === 'ferreira')!;
    person.title = 'Technical Architect';
    const shown = detectOverAllocated(r);
    const before = structuredClone(shown);
    const message = briefing(r, shown);
    assertStringIncludes(message, 'Over capacity: M. Ferreira — 140%');
    assertStringIncludes(message, 'This Technical Architect has two project allocations');
    assertStringIncludes(message, '(' + expected + ')');
    assertEquals(shown, before);
  }
});
