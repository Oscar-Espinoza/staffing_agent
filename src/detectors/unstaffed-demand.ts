import { selectCandidates } from '../candidates.ts';
import type { Finding } from '../finding.ts';
import type { ModelRecord } from '../model-record.ts';

const UNSTAFFED_DEMAND = 'UNSTAFFED_DEMAND';

/**
 * S19 rule 3 — likely incoming work with no matching Active project in the retrieved Kantata data.
 * The account link is the one already on ModelProject (S04), never a
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
        title: `${opportunity.name} — no active project recorded`,
        detail: hours === null
          ? `Salesforce lists it at ${opportunity.probability}% with a ${closeDate} close, ` +
            `${daysOut} days out, but its estimated delivery hours are blank. No matching active ` +
            `project for ${accountName} was found in the retrieved Kantata data.`
          : `Salesforce lists it at ${opportunity.probability}% with a ${closeDate} close, ` +
            `${daysOut} days out, and estimates ${hours} delivery hours. No matching active ` +
            `project for ${accountName} was found in the retrieved Kantata data.`,
        rationale: hours === null
          ? `Confirm the staffing plan and estimated delivery hours for ${accountName}; ` +
            'a sales close date does not establish when delivery starts.'
          : `Confirm the staffing plan for ${accountName} if this deal closes; ` +
            'estimated hours and a sales close date do not establish when delivery starts.',
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
