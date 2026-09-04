import type { Finding } from '../finding.ts';
import type { ModelRecord } from '../model-record.ts';
import { horizon, overlaps } from '../window.ts';

const DEAD_DEAL = 'DEAD_DEAL';

/**
 * A deal is related only at account level, so this is deliberately a question rather than a claim
 * that it funded the project. It gives a lead the evidence needed to confirm the work is real.
 */
export function detectDeadDeal(record: ModelRecord): Finding[] {
  const { start: windowStart, end: windowEnd } = horizon(record.referenceDate);

  const findings: Finding[] = [];
  for (const project of record.projects) {
    if (project.status !== 'Active') continue;

    const lost = project.matchedDeals.filter((deal) => deal.stageName === 'Closed Lost');
    if (lost.length === 0) continue;
    if (project.matchedDeals.some((deal) => deal.stageName === 'Closed Won')) continue;

    const rows = record.allocations
      .filter((allocation) =>
        allocation.projectId === project.id &&
        overlaps(allocation.startDate, allocation.endDate, windowStart, windowEnd)
      )
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    if (rows.length === 0) continue;

    findings.push({
      id: `${DEAD_DEAL}:${project.id}`,
      type: DEAD_DEAL,
      severity: 'watch',
      group: { kind: 'project', id: project.id, label: project.title },
      title: `${project.clientName} — confirm work after lost deal`,
      detail: `${project.title} has ${rows.length} active allocation record${
        rows.length === 1 ? '' : 's'
      }, while its account has Closed Lost opportunit${lost.length === 1 ? 'y' : 'ies'} ${
        lost.map((deal) => deal.id).join(', ')
      }.`,
      rationale: 'Confirm this project still has approved work before changing its staffing plan.',
      metrics: { allocationCount: rows.length, lostDealCount: lost.length },
      sources: [
        `kantata:projects/${project.id}`,
        ...rows.map((row) => `kantata:allocations/${row.id}`),
        ...lost.map((deal) => `salesforce:opportunities/${deal.id}`),
      ],
      ambiguous: true,
      fingerprint: `${DEAD_DEAL}:${project.id}`,
    });
  }

  return findings;
}
