import type { Finding } from '../finding.ts';
import type { ModelRecord } from '../model-record.ts';
import { overlaps } from '../window.ts';

const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function workLabel(name: string, clientName: string): string {
  const phase = name.match(/\bPhase \d+\b/)?.[0];
  if (phase !== undefined) return phase;
  const prefix = `${clientName} — `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * The one finding that exists only because the model answered (S16). A deterministic rule skips
 * any opportunity whose account already has a project — reasonable for new business, blind to a
 * follow-on landing mid-phase on a team already committed. Nothing here trusts the model beyond
 * the verified link itself. A sales close is not a delivery start, and the current project's due
 * date is not the new work's deadline. Without that schedule even known hours cannot prove overload.
 */
export function detectFollowOn(record: ModelRecord, links: Map<string, string>): Finding[] {
  const findings: Finding[] = [];

  for (const [opportunityId, projectId] of links) {
    const opportunity = record.opportunities.find((row) => row.id === opportunityId);
    const project = record.projects.find((row) => row.id === projectId);
    if (!opportunity || !project) continue;
    // Only flag a possible overlap when the sales close precedes the current phase's finish.
    if (opportunity.closeDate >= project.dueDate) continue;

    const projectRows = record.allocations
      .filter((allocation) =>
        allocation.projectId === project.id &&
        overlaps(
          allocation.startDate,
          allocation.endDate,
          opportunity.closeDate,
          project.dueDate,
        )
      );
    const rosterIds = [
      ...new Set(
        projectRows
          .filter((allocation) => record.personIndex[allocation.userId]?.isActive === true)
          .map((allocation) => allocation.userId),
      ),
    ].sort();
    if (rosterIds.length === 0) continue;

    const sources = [
      `salesforce:opportunities/${opportunity.id}`,
      `kantata:projects/${project.id}`,
      ...projectRows.map((allocation) => `kantata:allocations/${allocation.id}`),
      ...rosterIds.map((userId) => `kantata:users/${userId}`),
    ];
    const base = {
      id: `FOLLOW_ON:${opportunity.id}`,
      type: 'FOLLOW_ON' as const,
      sources,
      group: { kind: 'project' as const, id: project.id, label: project.title },
    };

    const incoming = workLabel(opportunity.name, project.clientName);
    const current = workLabel(project.title, project.clientName);
    const hours = opportunity.estimatedDeliveryHours === null
      ? 'Delivery hours are not estimated.'
      : `Salesforce estimates ${opportunity.estimatedDeliveryHours} delivery hours.`;
    findings.push({
      ...base,
      severity: 'watch',
      title: `${project.clientName} — ${incoming} may overlap ${current}`,
      detail:
        `Salesforce says ${incoming} could close on ${
          SHORT_DATE.format(new Date(opportunity.closeDate))
        } while ${current} is scheduled through ${
          SHORT_DATE.format(new Date(project.dueDate))
        }.\n` +
        `${hours} When would delivery start, for how long, and with which team?`,
      rationale:
        'A possible continuation needs a delivery schedule and team before capacity can be assessed.',
      metrics: {
        rosterSize: rosterIds.length,
        ...(opportunity.estimatedDeliveryHours === null
          ? {}
          : { estimatedHours: opportunity.estimatedDeliveryHours }),
      },
      ambiguous: true,
      fingerprint: `FOLLOW_ON:${opportunity.id}`,
    });
  }

  return findings;
}
