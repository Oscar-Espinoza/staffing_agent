import type { Finding } from './finding.ts';
import type { LinkDisposition } from './linker.ts';
import type { ModelRecord } from './model-record.ts';

export type ProjectConnectionNotice = {
  client: string | null;
  opportunity: string;
  projects: string[];
};

/** Candidate names come only from normalized records, never a rejected model reference. */
export function buildProjectConnectionNotices(
  record: ModelRecord,
  dispositions: LinkDisposition[],
  findings: Finding[],
): ProjectConnectionNotice[] {
  const covered = new Set(findings.flatMap((finding) => finding.sources));
  const unresolved = new Set(
    dispositions.filter((decision) =>
      decision.disposition === 'missing' || decision.disposition === 'rejected' ||
      decision.disposition === 'uncertain'
    ).map((decision) => decision.opportunityId),
  );
  return record.opportunities.filter((opportunity) =>
    unresolved.has(opportunity.id) &&
    !covered.has(`salesforce:opportunities/${opportunity.id}`)
  ).map((opportunity) => {
    const account = record.accounts.find((account) => account.id === opportunity.accountId);
    const projects = record.projects.filter((project) =>
      account !== undefined && project.status === 'Active' &&
      project.salesforceAccountName === account.name
    ).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return {
      client: projects[0]?.clientName ?? account?.name ?? null,
      opportunity: opportunity.name,
      projects: projects.map((project) => project.title),
    };
  });
}
