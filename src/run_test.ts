import { assertEquals } from '@std/assert';
import { deliver, runStaffingCheck, selectShown } from './run.ts';
import type { Finding } from './finding.ts';

function finding(
  id: string,
  severity: Finding['severity'],
  ambiguous: boolean,
  groupId: string,
): Finding {
  return {
    id,
    type: 'OVER_ALLOCATED',
    severity,
    title: id,
    detail: '',
    rationale: '',
    metrics: {},
    sources: [],
    ambiguous,
    group: { kind: 'person', id: groupId, label: groupId },
    fingerprint: id,
  };
}

Deno.test('selection keeps all criticals and questions while capping only the watch tail', () => {
  const shown = selectShown([
    finding('critical-a', 'critical', false, 'a'),
    finding('critical-b', 'critical', false, 'b'),
    finding('watch-a-1', 'watch', false, 'a'),
    finding('watch-a-2', 'watch', false, 'a'),
    finding('watch-b', 'watch', false, 'b'),
    finding('watch-c', 'watch', false, 'c'),
    finding('question-a-1', 'watch', true, 'a'),
    finding('question-a-2', 'watch', true, 'a'),
    finding('question-b', 'watch', true, 'b'),
    finding('question-c', 'watch', true, 'c'),
  ]);

  assertEquals(shown.map((item) => item.id), [
    'critical-a',
    'critical-b',
    'watch-a-1',
    'watch-b',
    'watch-c',
    'question-a-1',
    'question-a-2',
    'question-b',
    'question-c',
  ]);
});

Deno.test('adding Auralis preserves every existing question and their relative order', () => {
  const questions = ['Simon', 'Devika', 'Tessellate', 'Halden'].map((name) =>
    finding(name, 'watch', true, name)
  );
  const before = selectShown(questions).map((item) => item.id);
  const withAuralis = [...questions, finding('Auralis', 'watch', true, 'Auralis')];
  const after = selectShown(withAuralis).map((item) => item.id);

  assertEquals(after.length, 5);
  assertEquals(after.filter((id) => id !== 'Auralis'), before);
  assertEquals(selectShown([...withAuralis].reverse()).map((item) => item.id), after);
});

Deno.test('Slack delivery sends exactly the Slack webhook text payload', async () => {
  let request: Request | undefined;
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    request = new Request(input, init);
    return Promise.resolve(new Response('ok'));
  }) as typeof fetch;

  await deliver('https://slack.test/hooks/example', 'A rendered message', fetcher);

  assertEquals(request?.method, 'POST');
  assertEquals(request?.headers.get('content-type'), 'application/json');
  assertEquals(await request?.json(), { text: 'A rendered message' });
});

Deno.test('question-only runs preserve model status, silence, dry-run, and delivery rules', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const relation of ['uncertain', 'unrelated', 'failure'] as const) {
      for (const dryRun of [true, false]) {
        for (const webhook of [null, 'https://slack.test/hook']) {
          const posts: unknown[] = [];
          globalThis.fetch = async (input, init) => {
            const request = new Request(input, init);
            const url = new URL(request.url);
            if (url.hostname === 'slack.test') {
              posts.push(await request.json());
              return new Response('ok');
            }
            if (url.hostname === 'api.openai.com') {
              if (relation === 'failure') return new Response('unavailable', { status: 400 });
              return Response.json({
                id: 'response-test',
                model: 'test-model',
                output: [{
                  content: [{
                    type: 'output_text',
                    text: JSON.stringify({
                      links: [{
                        opportunity_id: 'deal',
                        project_id: null,
                        relation,
                      }],
                    }),
                  }],
                }],
              });
            }
            assertEquals(url.hostname, 'source.test');
            const key = url.pathname.split('/').at(-1)!;
            const rows = key === 'projects'
              ? [{
                id: 'project',
                title: 'Auralis — Existing',
                client_name: 'Auralis',
                status: 'Active',
                start_date: '2026-08-19',
                due_date: '2026-10-01',
                budgeted_hours: 100,
                lead_user_id: null,
              }]
              : key === 'accounts'
              ? [{
                Id: 'account',
                Name: 'Auralis',
                Industry: 'Software',
              }]
              : key === 'opportunities'
              ? [{
                Id: 'deal',
                Name: 'Auralis — Expansion',
                AccountId: 'account',
                StageName: 'Negotiation',
                Amount: 100,
                CloseDate: '2026-08-26',
                Estimated_Delivery_Hours__c: 100,
                Probability: 90,
                OwnerId: '',
              }]
              : [];
            return Response.json({
              [url.pathname.startsWith('/salesforce/') ? 'records' : key]: rows,
              ...(key === 'tasks' ? { last_page: true } : {}),
            });
          };
          const result = await runStaffingCheck({
            config: {
              mockApiBaseUrl: 'https://source.test',
              openAiApiKey: 'test',
              openAiModel: 'test-model',
              slackWebhookUrl: webhook,
            },
            dryRun,
            demo: false,
          }) as {
            findings: unknown[];
            message: string | null;
            delivered: boolean;
            quietBecause: string | null;
            modelStatus: string;
            projectConnectionNotices: unknown[];
          };
          assertEquals(result.findings, []);
          const hasQuestion = relation === 'uncertain';
          assertEquals(result.projectConnectionNotices.length, hasQuestion ? 1 : 0);
          assertEquals(result.message !== null, hasQuestion);
          assertEquals(result.quietBecause === null, hasQuestion);
          if (hasQuestion) {
            assertEquals(result.modelStatus, 'completed');
            assertEquals(result.message?.includes('0 risks · 1 question\n\nNEEDS REVIEW'), true);
          }
          const delivered = hasQuestion && !dryRun && webhook !== null;
          assertEquals(result.delivered, delivered);
          assertEquals(posts, delivered ? [{ text: result.message }] : []);
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
