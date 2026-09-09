import { assertEquals } from '@std/assert';
import { render } from './render.ts';

const risk = {
  id: 'OVER_ALLOCATED:u_10024',
  type: 'OVER_ALLOCATED' as const,
  severity: 'critical' as const,
  title: 'M. Ferreira — 140% allocated',
  detail: '80% on Veridia + 60% on Corvane against a 40h/week capacity.',
  rationale: 'Recorded concurrent allocations exceed capacity on 2026-08-19.',
  sources: ['kantata:allocations/a_9001', 'kantata:allocations/a_9002', 'kantata:users/u_10024'],
  ambiguous: false,
  group: { kind: 'person' as const, id: 'u_10024', label: 'M. Ferreira' },
};

const question = {
  id: 'SCALE_AMBIGUOUS:a_9004',
  severity: 'watch' as const,
  title: 'Quillspace — Devika Balasubramanian',
  detail: "Kantata lists Devika's allocation as 0.25.\nIt's unclear whether 0.25 means 0.25% or " +
    "25%, so Devika's exact workload can't be " +
    'calculated reliably.',
  rationale: '',
  sources: ['kantata:allocations/a_9004'],
  ambiguous: true,
  group: { kind: 'person' as const, id: 'u_10024', label: 'M. Ferreira' },
};

Deno.test('renders a compact risk and question digest', () => {
  const message = render({
    findings: [risk, question],
    referenceDate: '2026-08-19',
    trigger: 'manual',
    degradedSources: [],
  });
  assertEquals(
    message,
    [
      'Staffing snapshot · as of 19 Aug 2026',
      'Manual check · 1 risk · 1 question',
      '',
      'NEEDS ATTENTION',
      '',
      'M. Ferreira — 140% allocated',
      '80% on Veridia + 60% on Corvane against a 40h/week capacity.',
      '',
      'NEEDS REVIEW',
      '',
      'Quillspace — Devika Balasubramanian',
      "Kantata lists Devika's allocation as 0.25.",
      "It's unclear whether 0.25 means 0.25% or 25%, so Devika's exact workload can't be calculated reliably.",
    ].join('\n'),
  );
});

Deno.test('renders plural risk counts without an empty review section', () => {
  const message = render({
    findings: [risk, { ...risk, title: 'A second risk' }],
    referenceDate: '2026-08-19',
    trigger: 'manual',
    degradedSources: [],
  });
  assertEquals(
    message,
    [
      'Staffing snapshot · as of 19 Aug 2026',
      'Manual check · 2 risks · 0 questions',
      '',
      'NEEDS ATTENTION',
      '',
      'M. Ferreira — 140% allocated',
      '80% on Veridia + 60% on Corvane against a 40h/week capacity.',
      '',
      'A second risk',
      '80% on Veridia + 60% on Corvane against a 40h/week capacity.',
    ].join('\n'),
  );
});

Deno.test('keeps degraded-source warnings at the bottom', () => {
  const message = render({
    findings: [risk, question],
    referenceDate: '2026-08-19',
    degradedSources: ['/kantata/time_entries'],
    trigger: 'manual',
  });
  assertEquals(message.includes('a_9001'), false);
  assertEquals(message.includes('/last'), false);
  assertEquals(message.includes('Full details and source records'), false);
  assertEquals(message.includes('⚠️ Incomplete data: /kantata/time_entries unavailable.'), true);
});

Deno.test('discloses omitted findings and normalization notes without model diagnostics', () => {
  const message = render({
    findings: [risk],
    referenceDate: '2026-08-19',
    degradedSources: [],
    omittedFindings: 2,
    trigger: 'manual',
    dataQualityNotes: ['Duplicate opportunity OPP02 dropped.'],
  });
  assertEquals(message.includes('2 additional findings omitted; see the run result.'), true);
  assertEquals(
    message.includes('follow-on review is incomplete'),
    false,
  );
  assertEquals(message.includes('DATA QUALITY NOTES\nDuplicate opportunity OPP02 dropped.'), true);
  assertEquals(message.includes('1 risk · 0 questions'), true);
});

Deno.test('renders nothing when only source degradation occurred', () => {
  assertEquals(
    render({
      findings: [],
      trigger: 'cron',
      referenceDate: '2026-08-19',
      degradedSources: ['/kantata/time_entries'],
    }),
    '',
  );
});

Deno.test('scheduled runs label the trigger without changing the source snapshot date', () => {
  const message = render({
    findings: [risk],
    referenceDate: '2026-08-19',
    trigger: 'cron',
    degradedSources: [],
  });
  assertEquals(message.split('\n').slice(0, 2), [
    'Staffing snapshot · as of 19 Aug 2026',
    'Scheduled check · 1 risk · 0 questions',
  ]);
});

Deno.test('readable dates and data notes preserve the underlying audit evidence', () => {
  const finding = { ...risk, detail: 'On 2026-08-26: 80% on Veridia + 60% on Corvane.' };
  const notes = [
    'Salesforce: Possible duplicate for Corvane: “Corvane — CPQ Migration Copy” excluded from demand calculations; retained “Corvane — CPQ Migration”. Account, amount, close date, and estimated hours match.',
    "Simon Zhao's allocation a_9018 references missing Kantata project p_5099; it counts toward total allocation but cannot be attributed to a known project.",
  ];
  const before = structuredClone({ finding, notes });
  const message = render({
    findings: [finding],
    referenceDate: '2026-08-19',
    trigger: 'manual',
    degradedSources: [],
    dataQualityNotes: notes,
  });
  assertEquals(message.includes('On 26 Aug 2026: 80% on Veridia + 60% on Corvane.'), true);
  assertEquals(
    message.includes(
      'Salesforce: Possible duplicate for Corvane: “Corvane — CPQ Migration Copy” excluded from demand calculations; retained “Corvane — CPQ Migration”. Account, amount, close date, and estimated hours match.',
    ),
    true,
  );
  assertEquals(
    message.includes(
      'Kantata: Simon Zhao’s allocation references project p_5099, not found in the retrieved Kantata projects;',
    ),
    true,
  );
  for (const id of ['006Ho00000OPP05', '006Ho00000OPP04', 'a_9018', 'a_9001']) {
    assertEquals(message.includes(id), false);
  }
  assertEquals({ finding, notes }, before);
});

Deno.test('questions retain leave evidence without repeating their next step or adding empty risks', () => {
  const message = render({
    findings: [{
      ...question,
      type: 'SCALE_AMBIGUOUS',
      detail: 'Approved sick leave from 2026-08-17 to 2026-08-19. What coverage is planned?',
    }],
    referenceDate: '2026-08-19',
    trigger: 'manual',
    degradedSources: [],
  });
  assertEquals(message.includes('NEEDS ATTENTION'), false);
  assertEquals(
    message.includes(
      'Approved sick leave from 17 Aug 2026 to 19 Aug 2026. What coverage is planned?',
    ),
    true,
  );
  assertEquals(message.includes('Confirm the intended allocation units.'), false);
});

Deno.test('unresolved capacity findings retain their original evidence', () => {
  for (
    const type of [
      'OVER_ALLOCATED',
      'INACTIVE_ALLOCATED',
      'LEAVE_COLLISION',
      'SCALE_AMBIGUOUS',
    ] as const
  ) {
    const finding = { ...risk, type, detail: 'Recorded evidence on 2026-08-19.' };
    const message = render({
      findings: [finding],
      referenceDate: '2026-08-19',
      trigger: 'manual',
      degradedSources: [],
    });
    assertEquals(message.includes('Recorded evidence on 19 Aug 2026.'), true);
    assertEquals(message.includes('1 risk · 0 questions'), true);
    assertEquals(finding.detail, 'Recorded evidence on 2026-08-19.');
  }
});

Deno.test('missing presentation records preserve original evidence without partial labels', () => {
  const message = render({
    findings: [risk],
    referenceDate: '2026-08-19',
    trigger: 'manual',
    degradedSources: [],
  });
  assertEquals(message.endsWith(risk.title + '\n' + risk.detail), true);
});
