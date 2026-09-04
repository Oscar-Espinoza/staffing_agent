import { selectCandidates } from '../candidates.ts';
import type { Finding } from '../finding.ts';
import type { ModelRecord } from '../model-record.ts';

const UNSTAFFED_DEMAND = 'UNSTAFFED_DEMAND';

/**
 * S19 rule 3 — likely incoming work that cannot be staffed, because the account it lands on has
 * no Kantata project at all. The account link is the one already on ModelProject (S04), never a
 * second mapping. A deal with no estimated hours is asked about, not sized at zero.
 */
export function detectUnstaffedDemand(record: ModelRecord): Finding[] {
  const accountNameById = new Map(record.accounts.map((account) => [account.id, account.name]));
  const accountsWithProjects = new Set(
    record.projects
      .filter((project) => project.status === 'Active')
      .map((project) => project.salesforceAccountName)
      .filter((name): name is string => name !== null),
  );

  return selectCandidates(record)
    .filter((opportunity) => {
      const accountName = accountNameById.get(opportunity.accountId);
      return accountName !== undefined && !accountsWithProjects.has(accountName);
    })
    .map((opportunity) => {
      const accountName = accountNameById.get(opportunity.accountId)!;
      const closeDate = opportunity.closeDate.slice(0, 10);
      const daysOut = Math.round(
        (Date.parse(`${closeDate}T00:00:00Z`) -
          Date.parse(`${record.referenceDate.date}T00:00:00Z`)) / 86_400_000,
      );
      const hours = opportunity.estimatedDeliveryHours;

      return {
        id: `${UNSTAFFED_DEMAND}:${opportunity.id}`,
        type: UNSTAFFED_DEMAND,
        severity: 'critical',
        group: { kind: 'account', id: opportunity.accountId, label: accountName },
        title: `${opportunity.name} — no team to land on`,
        detail: hours === null
          ? `Salesforce lists it at ${opportunity.probability}% with a ${closeDate} close, ` +
            `${daysOut} days out, but its estimated delivery hours are blank and ${accountName} ` +
            'has no Kantata project.'
          : `Salesforce lists it at ${opportunity.probability}% with a ${closeDate} close, ` +
            `${daysOut} days out, needing ${hours} delivery hours, and ${accountName} has no ` +
            'Kantata project and nobody allocated.',
        rationale: hours === null
          ? `How many delivery hours should be planned for ${accountName}?`
          : `${hours} hours of work is about to arrive with no team standing behind it.`,
        metrics: hours === null
          ? { probability: opportunity.probability, daysOut }
          : { probability: opportunity.probability, daysOut, estimatedDeliveryHours: hours },
        sources: [
          `salesforce:opportunities/${opportunity.id}`,
          `salesforce:accounts/${opportunity.accountId}`,
        ],
        ambiguous: hours === null,
        fingerprint: `${UNSTAFFED_DEMAND}:${opportunity.id}`,
      } satisfies Finding;
    });
}
