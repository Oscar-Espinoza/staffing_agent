import { assertEquals } from '@std/assert';
import { render } from './render.ts';

const risk = {
  id: 'OVER_ALLOCATED:u_10024',
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
      '🚨 Staffing snapshot — as of 19 Aug 2026',
      'Run: manual',
      '1 risk needs attention · 1 item needs review',
      '',
      '• M. Ferreira — 140% allocated',
      '  80% on Veridia + 60% on Corvane against a 40h/week capacity.',
      '  Sources: Kantata allocations a_9001, a_9002; Kantata users u_10024',
      '',
      '────────────────────',
      'Needs review',
      '',
      '• Quillspace — Devika Balasubramanian',
      "  Kantata lists Devika's allocation as 0.25.",
      "  It's unclear whether 0.25 means 0.25% or 25%, so Devika's exact workload can't be calculated reliably.",
      '  Sources: Kantata allocations a_9004',
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
      '🚨 Staffing snapshot — as of 19 Aug 2026',
      'Run: manual',
      '2 risks need attention · 0 items need review',
      '',
      '• M. Ferreira — 140% allocated',
      '  80% on Veridia + 60% on Corvane against a 40h/week capacity.',
      '  Sources: Kantata allocations a_9001, a_9002; Kantata users u_10024',
      '',
      '• A second risk',
      '  80% on Veridia + 60% on Corvane against a 40h/week capacity.',
      '  Sources: Kantata allocations a_9001, a_9002; Kantata users u_10024',
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
  assertEquals(message.includes('a_9001'), true);
  assertEquals(message.endsWith('⚠️ Incomplete data: /kantata/time_entries unavailable.'), true);
});

Deno.test('discloses omitted findings, missing model coverage and normalization notes', () => {
  const message = render({
    findings: [risk],
    referenceDate: '2026-08-19',
    degradedSources: [],
    omittedFindings: 2,
    trigger: 'manual',
    modelWarning: 'Follow-on review unavailable; deterministic checks completed.',
    dataQualityNotes: ['Duplicate opportunity OPP02 dropped.'],
  });
  assertEquals(message.includes('2 additional findings omitted; see the run result.'), true);
  assertEquals(
    message.includes('⚠️ Follow-on review unavailable; deterministic checks completed.'),
    true,
  );
  assertEquals(message.endsWith('DATA QUALITY NOTES\nDuplicate opportunity OPP02 dropped.'), true);
  assertEquals(message.includes('1 risk needs attention · 0 items need review'), true);
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
    '🚨 Staffing snapshot — as of 19 Aug 2026',
    'Run: scheduled (cron)',
  ]);
});
