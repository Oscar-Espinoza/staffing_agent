import { MAX_WATCH_PER_MESSAGE, type RuntimeConfig, type RunTrigger } from './config.ts';
import { detectOverAllocated } from './detectors/over-allocated.ts';
import { detectScaleAmbiguous } from './detectors/scale-ambiguous.ts';
import { detectDeadDeal } from './detectors/dead-deal.ts';
import { detectFollowOn } from './detectors/follow-on.ts';
import { detectUnavailableCapacity } from './detectors/unavailable-capacity.ts';
import { detectUnstaffedDemand } from './detectors/unstaffed-demand.ts';
import { linkOpportunities } from './linker.ts';
import type { Finding } from './finding.ts';
import { assembleModelRecord } from './model-record.ts';
import { applyDemoScenario } from './demo.ts';
import { clientMatchBaseline } from './baseline.ts';
import { render } from './render.ts';
import { fetchSnapshot } from './snapshot.ts';

type RunOptions = {
  config: RuntimeConfig;
  trigger: RunTrigger;
  dryRun: boolean;
  /** Injects the synthetic second Halden project — see src/demo.ts. Demo only. */
  demo: boolean;
};

export async function deliver(
  webhook: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`Slack delivery failed (${response.status})`);

  // Slack reports rejection as 200 + `{"ok": false}`. A classic webhook's bare `ok` is not JSON,
  // so a parse failure is success.
  const body = (await response.text()).trim();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return;
  }
  if (payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === false) {
    const reason = (payload as { error?: unknown }).error;
    throw new Error(`Slack rejected the payload: ${typeof reason === 'string' ? reason : body}`);
  }
}

/** Stable display order independent of detector or provider response order. */
function compareFindings(left: Finding, right: Finding): number {
  return left.group.kind.localeCompare(right.group.kind) ||
    left.group.label.localeCompare(right.group.label) ||
    left.group.id.localeCompare(right.group.id) ||
    left.id.localeCompare(right.id);
}

function groupFairly(findings: Finding[], cap: number): Finding[] {
  const queues = new Map<string, Finding[]>();
  for (const finding of [...findings].sort(compareFindings)) {
    const key = `${finding.group.kind}:${finding.group.id}`;
    const queue = queues.get(key) ?? [];
    queue.push(finding);
    queues.set(key, queue);
  }

  const selected: Finding[] = [];
  const groups = [...queues.entries()].sort(([left], [right]) => left.localeCompare(right));
  while (selected.length < cap) {
    let added = false;
    for (const [, queue] of groups) {
      const finding = queue.shift();
      if (finding === undefined) continue;
      selected.push(finding);
      added = true;
      if (selected.length === cap) break;
    }
    if (!added) break;
  }
  return selected;
}

export function selectShown(findings: Finding[]): Finding[] {
  const critical = findings.filter((finding) =>
    !finding.ambiguous && finding.severity === 'critical'
  );
  const watch = findings.filter((finding) => !finding.ambiguous && finding.severity !== 'critical');
  const questions = findings.filter((finding) => finding.ambiguous);
  return [
    ...critical.sort(compareFindings),
    ...groupFairly(watch, MAX_WATCH_PER_MESSAGE),
    // ponytail: show all questions at fixture scale; add a separate digest if volume grows.
    // A variable follow-on must not displace another detected question from the message.
    ...questions.sort(compareFindings),
  ];
}

export async function runStaffingCheck(
  { config, trigger, dryRun, demo }: RunOptions,
): Promise<object> {
  if (demo && !dryRun) throw new Error('Demo runs require dry=1.');
  const degraded: string[] = [];
  const snapshot = await fetchSnapshot({ baseUrl: config.mockApiBaseUrl, degraded });
  const base = assembleModelRecord(snapshot);
  const record = demo ? applyDemoScenario(base) : base;

  // One detector per risk clause (S00). All arithmetic, all reproducible.
  const deterministic: Finding[] = [
    ...detectOverAllocated(record),
    ...detectUnavailableCapacity(record),
    ...detectDeadDeal(record),
    ...detectUnstaffedDemand(record),
    ...detectScaleAmbiguous(record),
  ];

  // The model answers one question — which project does this deal continue — and every link it
  // proposes is re-derived against the client map before a single finding is built from it.
  const model = await linkOpportunities(record, config);
  const {
    links,
    rejected: linksRejected,
    rejectionReasons: linkRejections,
    modelUsed,
    modelStatus,
    dispositions: modelDispositions,
    metadata: modelMetadata,
  } = model;
  const linked = detectFollowOn(record, links);

  const findings = [...deterministic, ...linked];
  const shown = selectShown(findings);
  const degradations = snapshot.degradations?.map((entry) => entry.path) ?? degraded;
  const omittedFindings = Math.max(findings.length - shown.length, 0);
  const modelWarning = modelStatus === 'completed' || modelStatus === 'no_candidates'
    ? undefined
    : modelStatus === 'incomplete_response'
    ? 'Some opportunity matches could not be verified; follow-on review is incomplete.'
    : 'Opportunity matching was unavailable; follow-on review is incomplete.';
  const dataQualityNotes = [
    ...record.notes,
    ...record.unmappedClients.map((client) =>
      `Unmapped client: ${client}; cross-system links unresolved.`
    ),
    ...(record.referenceDate.note === null ? [] : [record.referenceDate.note]),
  ];
  const slackMessage = shown.length === 0 ? null : render({
    findings: shown,
    referenceDate: record.referenceDate.date,
    trigger,
    degradedSources: degradations,
    omittedFindings,
    dataQualityNotes,
    ...(modelWarning === undefined ? {} : { modelWarning }),
  });
  const message = slackMessage === null
    ? null
    : demo
    ? `DEMO ONLY — synthetic project context; never sent to Slack.\n\n${slackMessage}`
    : slackMessage;

  // A quiet channel is indistinguishable from a dead one unless the run says why it was quiet.
  const quietBecause = message !== null
    ? null
    : degradations.length > 0
    ? 'no findings, and some sources did not respond'
    : 'no findings — nothing crossed a threshold this run';

  const delivered = !dryRun && message !== null && config.slackWebhookUrl !== null;
  if (!dryRun && message !== null && config.slackWebhookUrl !== null) {
    await deliver(config.slackWebhookUrl, message);
  }
  const result = {
    trigger,
    dryRun,
    demo,
    delivered,
    deterministicFindings: deterministic.length,
    linkedFindings: linked.length,
    modelUsed,
    modelStatus,
    linksRejected,
    linkRejections,
    modelDispositions,
    modelMetadata,
    dataQualityNotes,
    // What the model chose, and whether a plain client-name match could have chosen it.
    modelLinks: Object.fromEntries(links),
    clientMatchBaseline: clientMatchBaseline(record),
    degradedSources: degradations,
    quietBecause,
    findings,
    slackFindings: shown,
    omittedFindings,
    message,
  };
  const { findings: _findings, slackFindings: _slackFindings, message: _message, ...metadata } =
    result;
  console.info(
    JSON.stringify({ event: 'staffing_check_completed', ...metadata }),
  );
  return result;
}
