import { buildProjectConnectionNotices } from './project-connections.ts';
import { detectFollowOn } from './detectors/follow-on.ts';
import { detectUnstaffedDemand } from './detectors/unstaffed-demand.ts';
import { buildFindingContext, render } from './render.ts';
import { selectShown } from './run.ts';
import { assertEquals } from '@std/assert';
import { buildPayload, linkOpportunities, verifyLinks } from './linker.ts';
import type { ModelOpportunity, ModelProject, ModelRecord } from './model-record.ts';
import type { RuntimeConfig } from './config.ts';

const account = (id: string, name: string) => ({ id, name, industry: 'Software' });

const opportunity = (
  id: string,
  name: string,
  accountId: string,
  stageName: string,
  probability: number,
  amount: number,
  closeDate: string,
): ModelOpportunity => ({
  id,
  name,
  accountId,
  stageName,
  amount,
  closeDate,
  estimatedDeliveryHours: 480,
  probability,
  ownerId: '005Ho00000USR01',
});

const project = (
  id: string,
  title: string,
  clientName: string,
  status: string,
  budgetedHours: number,
  dueDate: string,
): ModelProject => ({
  id,
  title,
  clientName,
  status,
  startDate: '2026-06-01',
  dueDate,
  budgetedHours,
  leadUserId: 'u_10024',
  salesforceAccountName: clientName,
  clickupListName: null,
  loggedHours: 320,
  matchedDeals: [],
});

const record: ModelRecord = {
  referenceDate: { date: '2026-08-19', note: null },
  people: [{
    email: 'devika@example.com',
    name: 'Devika Balasubramanian',
    kantataUserId: 'u_10024',
    salesforceUserId: null,
    clickupMemberId: null,
    title: 'Consultant',
    weeklyCapacityHours: 40,
    isExternal: false,
    isActive: true,
  }],
  personIndex: {},
  projects: [
    project(
      'p_5001',
      'Veridia — Account Hierarchy Redesign',
      'Veridia',
      'Active',
      600,
      '2026-10-01',
    ),
    project('p_5002', 'Auralis — Ledger Reporting Bridge', 'Auralis', 'Active', 480, '2026-10-15'),
    project(
      'p_5003',
      'Fernbrook Health — Forecast Stabilization',
      'Fernbrook Health',
      'Active',
      520,
      '2026-10-20',
    ),
    project('p_5004', 'Halden — Phase 2 Delivery', 'Halden', 'Active', 900, '2026-11-02'),
    project('p_5005', 'Corvane — CPQ Migration', 'Corvane', 'Active', 640, '2026-11-10'),
    project(
      'p_5006',
      'Quillspace — AI Enablement Advisory',
      'Quillspace',
      'Active',
      320,
      '2026-09-30',
    ),
    project(
      'p_5007',
      'Tessellate — Multi-Track Integration',
      'Tessellate',
      'Active',
      700,
      '2026-12-01',
    ),
    project(
      'p_5008',
      'Ironvale — Outreach Architecture',
      'Ironvale',
      'Completed',
      400,
      '2026-07-31',
    ),
  ],
  allocations: [{
    id: 'a_9004',
    projectId: 'p_5004',
    userId: 'u_10024',
    percentage: 100,
    startDate: '2026-08-01',
    endDate: '2026-11-02',
  }],
  timeOff: [],
  opportunities: [
    opportunity(
      '006Ho00000OPP01',
      'Veridia — Hierarchy Phase 2',
      '001Ho00000MWS01',
      'Proposal',
      60,
      185000,
      '2026-09-10',
    ),
    opportunity(
      '006Ho00000OPP02',
      'Auralis — Reporting Expansion',
      '001Ho00000OVJ02',
      'Negotiation',
      80,
      96000,
      '2026-08-31',
    ),
    opportunity(
      '006Ho00000OPP03',
      'Halden — Phase 3 Scope',
      '001Ho00000ESO04',
      'Negotiation',
      85,
      240000,
      '2026-08-26',
    ),
    opportunity(
      '006Ho00000OPP08',
      'Kestrel — RevOps Foundation',
      '001Ho00000NRD09',
      'Negotiation',
      90,
      275000,
      '2026-08-28',
    ),
  ],
  accounts: [
    account('001Ho00000MWS01', 'Veridia'),
    account('001Ho00000OVJ02', 'Auralis'),
    account('001Ho00000TMC03', 'Fernbrook Health'),
    account('001Ho00000ESO04', 'Halden'),
    account('001Ho00000ITC05', 'Corvane'),
    account('001Ho00000LCD06', 'Quillspace Software'),
    account('001Ho00000AVT07', 'Tessellate'),
    account('001Ho00000BLC08', 'Ironvale Data Group'),
    account('001Ho00000NRD09', 'Kestrel Logistics'),
  ],
  tasks: [],
  notes: [],
  ambiguousAllocations: [],
  unmappedClients: [],
};

const config: RuntimeConfig = {
  mockApiBaseUrl: 'http://127.0.0.1:8000',
  openAiApiKey: 'sk-test',
  openAiModel: 'gpt-5.4-nano',
  slackWebhookUrl: 'https://example.invalid/hook',
};

/** A fetch that records every call, so "no request was made" is assertable, not assumed. */
function stubFetch(respond: () => Response): { calls: number; fetch: typeof fetch } {
  const stub = {
    calls: 0,
    fetch: ((..._args: Parameters<typeof fetch>) => {
      stub.calls += 1;
      return Promise.resolve(respond());
    }) as typeof fetch,
  };
  return stub;
}

const modelResponse = (text: string) =>
  new Response(
    JSON.stringify({
      id: 'resp_test',
      model: 'test-model-snapshot',
      output: [{ content: [{ type: 'output_text', text }] }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

Deno.test('the payload carries four fields per row and no fact the model could copy', () => {
  const payload = buildPayload(record);
  assertEquals(payload.opportunities.map((row) => row.id), [
    '006Ho00000OPP02',
    '006Ho00000OPP03',
    '006Ho00000OPP08',
  ]);
  assertEquals(payload.projects.map((row) => row.id), [
    'p_5001',
    'p_5002',
    'p_5003',
    'p_5004',
    'p_5005',
    'p_5006',
    'p_5007',
  ]);

  const serialized = JSON.stringify(payload);
  for (
    const leak of ['900', '100', '96000', '2026-08-26', 'Devika', '85', '240000', '2026-11-02']
  ) {
    assertEquals(serialized.includes(leak), false, `payload leaked ${leak}`);
  }
  assertEquals(
    Object.keys(payload.opportunities[0] ?? {}),
    ['id', 'name', 'accountName', 'stage'],
  );
  assertEquals(Object.keys(payload.projects[0] ?? {}), ['id', 'title', 'clientName']);
});

Deno.test('no credential configured makes no request at all', async () => {
  const stub = stubFetch(() => modelResponse('{"links":[]}'));
  const result = await linkOpportunities(record, { ...config, openAiApiKey: '' }, stub.fetch);
  assertEquals(stub.calls, 0);
  assertEquals(result.modelUsed, false);
  assertEquals(result.modelStatus, 'not_configured');
  assertEquals(result.links.size, 0);
  assertEquals(result.rejected, 0);
});

Deno.test('a response that violates the schema yields nothing, not a partial list', async () => {
  const malformed = JSON.stringify({
    links: [
      {
        opportunity_id: '006Ho00000OPP03',
        project_id: 'p_5004',
        relation: 'continuation',
      },
      {
        opportunity_id: '006Ho00000OPP02',
        project_id: 'p_5002',
        relation: 'maybe',
        note: 'looks related',
      },
    ],
  });
  const stub = stubFetch(() => modelResponse(malformed));
  const result = await linkOpportunities(record, config, stub.fetch);
  assertEquals(stub.calls, 1);
  assertEquals(result.modelUsed, false);
  assertEquals(result.modelStatus, 'invalid_response');
  assertEquals(result.links.size, 0);
  assertEquals(result.rejected, 0);
});

Deno.test('the verifier keeps one link, rejects two, and counts the null as neither', () => {
  const { links, rejected, rejectionReasons } = verifyLinks(
    [
      {
        opportunity_id: '006Ho00000OPP08',
        project_id: null,
        relation: 'unrelated',
      },
      {
        opportunity_id: '006Ho00000OPP03',
        project_id: 'p_5004',
        relation: 'continuation',
      },
      {
        opportunity_id: '006Ho00000OPP02',
        project_id: 'p_5004',
        relation: 'continuation',
      },
      {
        opportunity_id: '006Ho00000OPP08',
        project_id: 'p_5002',
        relation: 'continuation',
      },
    ],
    buildPayload(record),
    record,
  );
  assertEquals([...links], [['006Ho00000OPP03', 'p_5004']]);
  assertEquals(rejected, 2);
  assertEquals(rejectionReasons, { cross_client: 1, duplicate_opportunity: 1 });
});

Deno.test('the verifier rejects a project marked unrelated with a safe reason', () => {
  const { links, rejected, rejectionReasons } = verifyLinks(
    [{
      opportunity_id: '006Ho00000OPP03',
      project_id: 'p_5004',
      relation: 'unrelated',
    }],
    buildPayload(record),
    record,
  );
  assertEquals(links.size, 0);
  assertEquals(rejected, 3);
  assertEquals(rejectionReasons, { relation_mismatch: 1, missing_opportunity: 2 });
});

Deno.test('a relation and project pair that violates the schema invalidates the response', async () => {
  const stub = stubFetch(() =>
    modelResponse(JSON.stringify({
      links: [{
        opportunity_id: '006Ho00000OPP03',
        project_id: 'p_5004',
        relation: 'unrelated',
      }],
    }))
  );
  const result = await linkOpportunities(record, config, stub.fetch);
  assertEquals(result.modelUsed, false);
  assertEquals(result.modelStatus, 'invalid_response');
  assertEquals(result.rejectionReasons, {});
});

Deno.test('model request failure has a safe status', async () => {
  const failingFetch =
    (() => Promise.reject(new Error('provider details must not escape'))) as typeof fetch;
  const result = await linkOpportunities(record, config, failingFetch);
  assertEquals(result.modelUsed, false);
  assertEquals(result.modelStatus, 'request_failed');
});

Deno.test('no candidates skips the model with a distinct status', async () => {
  const stub = stubFetch(() => modelResponse('{"links":[]}'));
  const result = await linkOpportunities({ ...record, opportunities: [] }, config, stub.fetch);
  assertEquals(stub.calls, 0);
  assertEquals(result.modelStatus, 'no_candidates');
});

Deno.test('a valid structured response completes the model path', async () => {
  const stub = stubFetch(() =>
    modelResponse(JSON.stringify({
      links: [
        { opportunity_id: '006Ho00000OPP02', project_id: null, relation: 'uncertain' },
        { opportunity_id: '006Ho00000OPP03', project_id: 'p_5004', relation: 'continuation' },
        { opportunity_id: '006Ho00000OPP08', project_id: null, relation: 'unrelated' },
      ],
    }))
  );
  const result = await linkOpportunities(record, config, stub.fetch);
  assertEquals(result.modelUsed, true);
  assertEquals(result.modelStatus, 'completed');
  assertEquals([...result.links], [['006Ho00000OPP03', 'p_5004']]);
  assertEquals(result.rejectionReasons, {});
  assertEquals(result.dispositions.map((row) => row.disposition), [
    'uncertain',
    'continuation',
    'unrelated',
  ]);
  assertEquals(result.metadata.requestedModel, config.openAiModel);
  assertEquals(result.metadata.responseModel, 'test-model-snapshot');
  assertEquals(result.metadata.responseId, 'resp_test');
});

Deno.test('omitted candidates are incomplete, not silent negative decisions', async () => {
  const stub = stubFetch(() =>
    modelResponse(JSON.stringify({
      links: [{
        opportunity_id: '006Ho00000OPP03',
        project_id: 'p_5004',
        relation: 'continuation',
      }],
    }))
  );
  const result = await linkOpportunities(record, config, stub.fetch);
  assertEquals(result.modelStatus, 'incomplete_response');
  assertEquals(result.rejectionReasons, { missing_opportunity: 2 });
  assertEquals(result.dispositions.map((row) => row.disposition), [
    'missing',
    'continuation',
    'missing',
  ]);
  assertEquals([...result.links], [['006Ho00000OPP03', 'p_5004']]);
});

Deno.test('unknown and duplicate negative decisions are rejected and a conflicting link is removed', () => {
  const result = verifyLinks(
    [
      { opportunity_id: 'unknown', project_id: null, relation: 'unrelated' },
      { opportunity_id: '006Ho00000OPP02', project_id: null, relation: 'uncertain' },
      { opportunity_id: '006Ho00000OPP03', project_id: 'p_5004', relation: 'continuation' },
      { opportunity_id: '006Ho00000OPP03', project_id: null, relation: 'unrelated' },
      { opportunity_id: '006Ho00000OPP08', project_id: null, relation: 'unrelated' },
      { opportunity_id: '006Ho00000OPP08', project_id: null, relation: 'unrelated' },
    ],
    buildPayload(record),
    record,
  );
  assertEquals(result.links.size, 0);
  assertEquals(result.rejectionReasons, { unknown_opportunity: 1, duplicate_opportunity: 2 });
  assertEquals(result.dispositions.map((row) => row.disposition), [
    'uncertain',
    'rejected',
    'rejected',
  ]);
});

Deno.test('request metadata fingerprints the actual payload and survives provider failure safely', async () => {
  let payloadText = '';
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    payloadText = body.input[1].content[0].text;
    return Promise.resolve(new Response('secret provider details', { status: 500 }));
  }) as typeof fetch;
  const result = await linkOpportunities(record, config, fetcher);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadText));
  const expected = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  assertEquals(result.metadata.payloadHash, expected);
  assertEquals(result.metadata.promptHash.length, 64);
  assertEquals(result.dispositions.every((row) => row.disposition === 'not_evaluated'), true);
  assertEquals(JSON.stringify(result).includes('secret provider details'), false);
});

Deno.test('the model request asks for a grounded phase decision, not self-reported confidence', async () => {
  let request: Request | undefined;
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    request = new Request(input, init);
    return Promise.resolve(modelResponse('{"links":[]}'));
  }) as typeof fetch;

  await linkOpportunities(record, config, fetcher);

  const payload = await request?.json() as {
    input: { content: { text: string }[] }[];
    reasoning: { effort: string };
    text: { format: { schema: { properties: { links: { items: { anyOf: unknown[] } } } } } };
  };
  const instruction = payload.input[0]?.content[0]?.text ?? '';
  assertEquals(instruction.includes('earlier delivery phase'), true);
  assertEquals(payload.reasoning.effort, 'low');
  assertEquals(payload.text.format.schema.properties.links.items.anyOf.length, 2);
  assertEquals(JSON.stringify(payload.text.format.schema).includes('confidence'), false);
});

for (const disposition of ['missing', 'uncertain'] as const) {
  Deno.test(`mocked ${disposition} decisions add only Auralis while preserving Kestrel and Halden`, () => {
    const input = structuredClone(record);
    input.personIndex['u_10024'] = input.people[0]!;
    const verified = verifyLinks(
      [
        ...(disposition === 'uncertain'
          ? [{
            opportunity_id: '006Ho00000OPP02',
            project_id: null,
            relation: 'uncertain' as const,
          }]
          : []),
        { opportunity_id: '006Ho00000OPP03', project_id: 'p_5004', relation: 'continuation' },
      ],
      buildPayload(input),
      input,
    );
    const findings = [
      ...detectUnstaffedDemand(input),
      ...detectFollowOn(input, verified.links),
    ];
    assertEquals(findings.length, 2);
    const before = structuredClone(findings);
    const notices = buildProjectConnectionNotices(input, verified.dispositions, findings);
    assertEquals(notices, [{
      client: 'Auralis',
      opportunity: 'Auralis — Reporting Expansion',
      projects: ['Auralis — Ledger Reporting Bridge'],
    }]);
    const rendered = render({
      findings: selectShown(findings),
      findingContext: buildFindingContext(input, findings),
      referenceDate: input.referenceDate.date,
      trigger: 'manual',
      degradedSources: [],
      projectConnectionNotices: notices,
    });
    assertEquals(
      rendered.includes([
        'Client: Auralis',
        'Kantata project to check: Auralis — Ledger Reporting Bridge',
        'Salesforce opportunity: Auralis — Reporting Expansion',
        'Project connection unconfirmed. Does this extend the existing project, or is it separate work?',
      ].join('\n')),
      true,
    );
    assertEquals(
      rendered.includes('Salesforce opportunity: Halden — Phase 3 Scope'),
      true,
    );
    assertEquals(rendered.includes('1 risk · 2 questions'), true);
    assertEquals(rendered.includes('Veridia'), false);
    assertEquals(
      rendered.indexOf('NEEDS REVIEW') < rendered.indexOf('Salesforce opportunity: Halden'),
      true,
    );
    assertEquals(
      rendered.indexOf('Salesforce opportunity: Halden') <
        rendered.indexOf('Salesforce opportunity: Auralis'),
      true,
    );
    assertEquals(findings, before);
    assertEquals(
      render({
        findings: [],
        referenceDate: input.referenceDate.date,
        trigger: 'manual',
        degradedSources: [],
        projectConnectionNotices: notices,
      }).includes('0 risks · 1 question\n\nNEEDS REVIEW'),
      true,
    );
  });
}

Deno.test('connection notices use all active mapped candidates and tolerate missing records', () => {
  const input = structuredClone(record);
  const decision = {
    opportunityId: '006Ho00000OPP02',
    projectId: 'rejected-id',
    disposition: 'rejected' as const,
  };
  input.projects.push(
    { ...input.projects[1]!, id: 'second', title: 'Auralis — Separate Support' },
    { ...input.projects[1]!, id: 'closed', title: 'Closed title', status: 'Completed' },
    { ...input.projects[1]!, id: 'unmapped', title: 'Unmapped title', salesforceAccountName: null },
  );
  const notices = buildProjectConnectionNotices(input, [decision], []);
  assertEquals(notices[0]?.projects, [
    'Auralis — Ledger Reporting Bridge',
    'Auralis — Separate Support',
  ]);
  const message = render({
    findings: detectUnstaffedDemand(input),
    referenceDate: input.referenceDate.date,
    trigger: 'manual',
    degradedSources: [],
    projectConnectionNotices: notices,
  });
  for (const title of notices[0]!.projects) {
    assertEquals(message.includes(title), true);
    assertEquals(message.split(title).length, 2);
  }
  assertEquals(message.includes('rejected-id'), false);
  input.accounts = [];
  const missing = buildProjectConnectionNotices(input, [decision], []);
  assertEquals(missing[0], {
    client: null,
    opportunity: 'Auralis — Reporting Expansion',
    projects: [],
  });
  const fallback = render({
    findings: detectUnstaffedDemand(record),
    referenceDate: input.referenceDate.date,
    trigger: 'manual',
    degradedSources: [],
    projectConnectionNotices: missing,
  });
  assertEquals(fallback.includes('Please confirm the delivery plan.'), true);
  assertEquals(fallback.includes('Kantata project to check:'), false);
  input.opportunities = [];
  assertEquals(buildProjectConnectionNotices(input, [decision], []), []);
});

Deno.test('unrelated answers and outages do not create connection notices', () => {
  for (const disposition of ['unrelated', 'not_evaluated'] as const) {
    assertEquals(
      buildProjectConnectionNotices(record, [{
        opportunityId: '006Ho00000OPP02',
        projectId: null,
        disposition,
      }], []),
      [],
    );
  }
  assertEquals(
    buildProjectConnectionNotices(record, [{
      opportunityId: '006Ho00000OPP02',
      projectId: null,
      disposition: 'missing',
    }], []).length,
    1,
  );
});

Deno.test('accepted Auralis and Halden reviews label full source names and preserve evidence', () => {
  const input = structuredClone(record);
  input.personIndex['u_10024'] = input.people[0]!;
  input.allocations.push({ ...input.allocations[0]!, id: 'auralis-team', projectId: 'p_5002' });
  const verified = verifyLinks(
    [
      { opportunity_id: '006Ho00000OPP02', project_id: 'p_5002', relation: 'continuation' },
      { opportunity_id: '006Ho00000OPP03', project_id: 'p_5004', relation: 'continuation' },
      { opportunity_id: '006Ho00000OPP01', project_id: null, relation: 'unrelated' },
      { opportunity_id: '006Ho00000OPP08', project_id: null, relation: 'unrelated' },
    ],
    buildPayload(input),
    input,
  );
  const findings = detectFollowOn(input, verified.links);
  const before = structuredClone(findings);
  const renderInput = {
    findings: selectShown(findings),
    referenceDate: input.referenceDate.date,
    trigger: 'manual' as const,
    degradedSources: [],
    projectConnectionNotices: buildProjectConnectionNotices(input, verified.dispositions, findings),
  };
  const context = buildFindingContext(input, findings);
  const message = render({ ...renderInput, findingContext: context });
  assertEquals(findings.length, 2);
  assertEquals(message.includes('0 risks · 2 questions\n\nNEEDS REVIEW'), true);
  assertEquals(
    message,
    [
      'Staffing snapshot · as of 19 Aug 2026',
      'Manual check · 0 risks · 2 questions',
      '',
      'NEEDS REVIEW',
      '',
      'Follow-on schedule to confirm',
      'Client: Auralis',
      'Project: Auralis — Ledger Reporting Bridge',
      'Salesforce opportunity: Auralis — Reporting Expansion · closes 31 Aug · 480 estimated delivery hours.',
      'The project is scheduled in Kantata through 15 Oct.',
      'When would delivery start, for how long, and with which team?',
      '',
      'Follow-on schedule to confirm',
      'Client: Halden',
      'Project: Halden — Phase 2 Delivery',
      'Salesforce opportunity: Halden — Phase 3 Scope · closes 26 Aug · 480 estimated delivery hours.',
      'The project is scheduled in Kantata through 2 Nov.',
      'When would delivery start, for how long, and with which team?',
    ].join('\n'),
  );
  assertEquals(message.includes('PROJECT CONNECTION TO CHECK'), false);
  assertEquals(findings, before);
  for (const disposition of ['missing', 'rejected', 'uncertain'] as const) {
    assertEquals(
      buildProjectConnectionNotices(input, [{
        opportunityId: '006Ho00000OPP02',
        projectId: null,
        disposition,
      }], findings),
      [],
    );
  }

  // Either missing source record restores the complete original finding rendering.
  const fallback = render(renderInput);
  for (const missing of ['opportunities', 'projects'] as const) {
    const incomplete = { ...input, [missing]: [] };
    assertEquals(
      render({
        ...renderInput,
        findingContext: buildFindingContext(incomplete, findings),
      }),
      fallback,
    );
  }
  for (const finding of findings) assertEquals(fallback.includes(finding.title), true);
  // Finding IDs and group labels are not used to resolve source names.
  const renamed = findings.map((finding) => ({
    ...finding,
    id: `display:${finding.id}`,
    group: { ...finding.group, label: 'stale label' },
  }));
  assertEquals(
    render({
      ...renderInput,
      findings: renamed,
      findingContext: buildFindingContext(input, renamed),
    }),
    message,
  );
});

Deno.test('incoming evidence preserves the differing Salesforce account name', () => {
  const findings = detectUnstaffedDemand(record);
  const context = buildFindingContext(record, findings);
  const message = render({
    findings,
    findingContext: context,
    referenceDate: record.referenceDate.date,
    trigger: 'manual',
    degradedSources: [],
  });
  assertEquals(message.includes('Salesforce opportunity: Kestrel — RevOps Foundation'), true);
  assertEquals(message.includes('Client: Kestrel Logistics'), true);
  assertEquals(message.includes('Kantata project:'), false);
});
