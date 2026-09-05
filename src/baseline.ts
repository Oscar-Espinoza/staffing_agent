import { selectCandidates } from './candidates.ts';
import type { ModelRecord } from './model-record.ts';

/**
 * Counts active projects for the same client. This measures candidate ambiguity, not matching
 * accuracy: even one candidate may be unrelated work, and several candidates may remain
 * unresolved from names alone. It is not a labeled evaluation of the model's decisions.
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
