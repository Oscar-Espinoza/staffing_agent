import { selectCandidates } from './candidates.ts';
import type { ModelRecord } from './model-record.ts';

/**
 * How many active projects a plain client-name match would return for each candidate deal — the
 * cheap deterministic rule the model call replaces. 0 or 1 means arithmetic could have answered
 * and the model is redundant on this data; 2+ means nothing but the names can choose, and the
 * call is the only thing that can. Reported every run so the boundary is measured, not asserted.
 */
export function clientMatchBaseline(record: ModelRecord): Record<string, number> {
  const active = record.projects.filter((project) => project.status === 'Active');
  const baseline: Record<string, number> = {};
  for (const opportunity of selectCandidates(record)) {
    const accountName = record.accounts.find((account) => account.id === opportunity.accountId)
      ?.name;
    baseline[opportunity.id] = active.filter((project) =>
      project.salesforceAccountName === accountName
    ).length;
  }
  return baseline;
}
