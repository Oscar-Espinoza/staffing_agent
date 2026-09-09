import { assertEquals, assertStringIncludes } from '@std/assert';
import { assembleModelRecord } from './model-record.ts';
import { detectDeadDeal } from './detectors/dead-deal.ts';
import { detectOverAllocated } from './detectors/over-allocated.ts';
import { buildPayload } from './linker.ts';
import { buildFindingContext, render } from './render.ts';
import type { SourceSnapshot } from './snapshot.ts';

function snapshot(): SourceSnapshot {
  return {
    kantata: {
      users: [{
        id: 'u1',
        full_name: 'Allocated Person',
        email_address: ' PERSON@gonimbly.com ',
        weekly_capacity_hours: 40,
      }],
      projects: [{
        id: 'p1',
        title: 'Delivery project',
        client_name: 'Tessellate',
        status: 'Active',
        start_date: '2026-08-19',
        due_date: '2026-10-01',
        budgeted_hours: 100,
        lead_user_id: null,
      }],
      allocations: [{
        id: 'a1',
        project_id: 'p1',
        user_id: 'u1',
        allocation_percentage: 140,
        start_date: '2026-08-19',
        end_date: '2026-10-01',
      }],
      time_off: [],
      time_entries: [],
    },
    salesforce: {
      users: [],
      accounts: [{ Id: 'account', Name: 'Tessellate', Industry: 'Test' }],
      opportunities: [{
        Id: 'lost',
        Name: 'Lost sale',
        AccountId: 'account',
        StageName: 'Closed Lost',
        Amount: 100,
        CloseDate: '2026-08-19',
        Estimated_Delivery_Hours__c: 100,
        Probability: 0,
        OwnerId: 'owner',
      }],
    },
    clickup: {
      members: [{ id: 7, username: 'Different display name', email: 'person@gonimbly.com' }],
      tasks: [{
        id: 'task-b',
        name: 'Recorded task',
        status: { status: 'in progress' },
        list: { id: 'list', name: 'Tessellate Integration' },
        assignees: [{ id: 7 }],
        time_estimate: null,
      }],
    },
  };
}

Deno.test('lost-deal evidence uses explicit list and email joins, with structured citations and approval question', () => {
  const record = assembleModelRecord(snapshot());
  const base = { ...record, tasks: [] };
  const [original] = detectDeadDeal(base);
  const [finding] = detectDeadDeal(record);
  assertEquals(detectDeadDeal(record).length, 1);
  assertEquals(finding, {
    ...original,
    detail: original!.detail.replace('\n\nIs this project still approved to continue?', '') +
      ' In ClickUp, the task “Recorded task” is marked in progress and assigned to Allocated Person.\n\nIs this project still approved to continue?',
    sources: [
      ...original!.sources,
      'clickup:tasks/task-b',
      'clickup:members/7',
      'kantata:users/u1',
    ],
  });
  assertEquals(detectOverAllocated(record), detectOverAllocated(base));
  assertEquals(buildPayload(record), buildPayload(base));
  const message = render({
    findings: [finding!],
    findingContext: buildFindingContext(record, [finding!]),
    referenceDate: record.referenceDate.date,
    degradedSources: [],
  });
  assertStringIncludes(message, 'Is this project still approved to continue?');
  for (
    const line of [
      'Client: Tessellate',
      'The Salesforce opportunity “Lost sale” belongs to the same client and is marked Closed Lost; its connection to this project is unconfirmed.',
      'Project: Delivery project',
      'In ClickUp, the task “Recorded task” is marked in progress and assigned to Allocated Person.',
    ]
  ) assertStringIncludes(message, line);
  assertEquals(message.includes('Sources:'), false);
  assertEquals(message.includes('task-b'), false);
});

Deno.test('task and matched assignee selection is reproducible without reordering input', () => {
  const record = assembleModelRecord(snapshot());
  const task = record.tasks[0]!;
  record.tasks.push({ ...task, id: 'task-a', name: 'First task', assigneeIds: [999, 7] });
  const expected = detectDeadDeal(record);
  assertStringIncludes(expected[0]!.detail, '“First task”');
  assertEquals(record.tasks[0]!.id, 'task-b');
  assertEquals(detectDeadDeal({ ...record, tasks: [...record.tasks].reverse() }), expected);
});

Deno.test('unusable ClickUp evidence leaves the entire lost-deal finding unchanged', () => {
  const original = assembleModelRecord(snapshot());
  const expected = detectDeadDeal({ ...original, tasks: [] });
  const cases = [
    (r: typeof original) => {
      r.tasks = [];
    },
    (r: typeof original) => {
      r.tasks[0]!.status = 'complete';
    },
    (r: typeof original) => {
      r.tasks[0]!.assigneeIds = [];
    },
    (r: typeof original) => {
      r.tasks[0]!.assigneeIds = [999];
    },
    (r: typeof original) => {
      r.personIndex = {};
    },
    (r: typeof original) => {
      r.personIndex.u1!.clickupMemberId = null;
    },
    (r: typeof original) => {
      r.tasks[0]!.listName = 'Delivery project';
    },
    (r: typeof original) => {
      r.projects[0]!.clickupListName = null;
    },
    (r: typeof original) => {
      r.projects.push({ ...r.projects[0]!, id: 'other', status: 'Completed' });
    },
    (r: typeof original) => {
      r.tasks.push({ ...r.tasks[0]!, id: 'other', listId: 'another-list' });
    },
    (r: typeof original) => {
      r.allocations.push({
        ...r.allocations[0]!,
        id: 'expired',
        userId: 'u2',
        endDate: '2026-08-18',
      });
      r.personIndex.u2 = { ...r.personIndex.u1!, kantataUserId: 'u2', clickupMemberId: 8 };
      r.tasks[0]!.assigneeIds = [8];
    },
  ];
  for (const change of cases) {
    const record = structuredClone(original);
    change(record);
    assertEquals(detectDeadDeal(record), expected);
  }
  for (const collection of ['members', 'tasks'] as const) {
    for (const unavailable of [[], [{}]]) {
      const source = snapshot();
      source.clickup[collection] = unavailable;
      assertEquals(detectDeadDeal(assembleModelRecord(source)), expected);
    }
  }
});

Deno.test('ClickUp cannot trigger a lost-deal review on its own', () => {
  for (const change of ['no lost', 'won', 'inactive', 'no allocations']) {
    const record = assembleModelRecord(snapshot());
    if (change === 'no lost') record.projects[0]!.matchedDeals = [];
    if (change === 'won') {
      record.projects[0]!.matchedDeals.push({
        ...record.opportunities[0]!,
        id: 'won',
        stageName: 'Closed Won',
      });
    }
    if (change === 'inactive') record.projects[0]!.status = 'Completed';
    if (change === 'no allocations') record.allocations = [];
    assertEquals(detectDeadDeal(record), []);
  }
});
