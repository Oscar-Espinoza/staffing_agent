import { assertEquals } from '@std/assert';
import { deliver, selectShown } from './run.ts';
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

Deno.test('selection keeps all criticals and distributes capped tails across groups', () => {
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
    'question-b',
    'question-c',
  ]);
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
