import type { Finding } from '../finding.ts';
import type { ModelRecord } from '../model-record.ts';
import { allocationPeaks, overlaps } from '../window.ts';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function weeksBetween(from: string, to: string): number {
  const span = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(span / MS_PER_WEEK, 1);
}

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
 * the verified link itself: every name, percentage and hour is read off the record.
 */
export function detectFollowOn(record: ModelRecord, links: Map<string, string>): Finding[] {
  const findings: Finding[] = [];

  for (const [opportunityId, projectId] of links) {
    const opportunity = record.opportunities.find((row) => row.id === opportunityId);
    const project = record.projects.find((row) => row.id === projectId);
    if (!opportunity || !project) continue;
    // The deal has to land during the phase it continues; closing after the due date is a handoff.
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

    const rosterSet = new Set(rosterIds);
    const rosterRows = record.allocations.filter((allocation) =>
      rosterSet.has(allocation.userId) &&
      overlaps(allocation.startDate, allocation.endDate, opportunity.closeDate, project.dueDate)
    );
    const ambiguousIds = new Set(record.ambiguousAllocations.map((row) => row.id));
    const hasAmbiguousAllocation = rosterRows.some((allocation) => ambiguousIds.has(allocation.id));
    const hasUnknownCapacity = rosterIds.some((userId) =>
      record.personIndex[userId]?.weeklyCapacityHours == null
    );
    const sources = [
      `salesforce:opportunities/${opportunity.id}`,
      `kantata:projects/${project.id}`,
      ...projectRows.map((allocation) => `kantata:allocations/${allocation.id}`),
    ];
    const base = {
      id: `FOLLOW_ON:${opportunity.id}`,
      type: 'FOLLOW_ON' as const,
      sources,
      group: { kind: 'project' as const, id: project.id, label: project.title },
    };

    // Missing hours, capacity, or allocation units are questions — never a false capacity claim.
    if (
      opportunity.estimatedDeliveryHours === null || hasAmbiguousAllocation || hasUnknownCapacity
    ) {
      const incoming = workLabel(opportunity.name, project.clientName);
      const current = workLabel(project.title, project.clientName);
      const timing = `Salesforce says ${incoming} could close on ${
        SHORT_DATE.format(new Date(opportunity.closeDate))
      } while ${current} is scheduled through ${SHORT_DATE.format(new Date(project.dueDate))}.`;
      const detail = opportunity.estimatedDeliveryHours === null
        ? `${timing}\nIf the same team is expected to support both phases, additional capacity ` +
          'may be needed.'
        : hasAmbiguousAllocation
        ? `${timing}\nKantata's allocation scale is unclear, so the team's spare capacity can't ` +
          'be calculated reliably.'
        : `${timing}\nA team member has no weekly capacity in Kantata, so the team's spare ` +
          "capacity can't be calculated reliably.";
      const rationale = opportunity.estimatedDeliveryHours === null
        ? `No delivery hours are estimated, so is this expected to run with the same team?`
        : 'Confirm the missing capacity data before deciding whether this team can absorb the work.';
      findings.push({
        ...base,
        severity: 'watch',
        title: `${project.clientName} — ${incoming} may overlap ${current}`,
        detail,
        rationale,
        metrics: { rosterSize: rosterIds.length },
        ambiguous: true,
        fingerprint: `FOLLOW_ON:${opportunity.id}`,
      });
      continue;
    }

    const weeklyHours = opportunity.estimatedDeliveryHours /
      weeksBetween(opportunity.closeDate, project.dueDate);
    const teamCapacity = rosterIds.reduce(
      (sum, userId) => sum + (record.personIndex[userId]?.weeklyCapacityHours ?? 0),
      0,
    );
    if (!Number.isFinite(weeklyHours) || teamCapacity === 0) continue;

    const constraint = allocationPeaks(rosterRows, opportunity.closeDate, project.dueDate)
      .map((peak) => ({
        ...peak,
        availableWeeklyHours: rosterIds.reduce((sum, userId) => {
          const allocatedPct = peak.rows
            .filter((allocation) => allocation.userId === userId)
            .reduce((total, allocation) => total + allocation.percentage, 0);
          const capacity = record.personIndex[userId]?.weeklyCapacityHours ?? 0;
          return sum + capacity * Math.max(0, 100 - allocatedPct) / 100;
        }, 0),
      }))
      .sort((left, right) =>
        left.availableWeeklyHours - right.availableWeeklyHours ||
        (left.date < right.date ? -1 : 1)
      )[0];
    if (!constraint || weeklyHours <= constraint.availableWeeklyHours) continue;

    const requiredPct = Math.round((weeklyHours / teamCapacity) * 100);
    const availableWeeklyHours = Math.round(constraint.availableWeeklyHours * 10) / 10;
    const requiredWeeklyHours = Math.round(weeklyHours * 10) / 10;

    findings.push({
      ...base,
      severity: 'critical',
      title: `${project.clientName} — follow-on needs more than the team has`,
      detail: `${opportunity.name} needs ${requiredWeeklyHours}h/week before ${project.dueDate}, ` +
        `but the team has only ${availableWeeklyHours}h/week spare on ${constraint.date}.`,
      rationale: `The team carrying ${project.title} cannot absorb it without moving something.`,
      metrics: {
        requiredPct,
        requiredWeeklyHours,
        availableWeeklyHours,
        estimatedHours: opportunity.estimatedDeliveryHours,
      },
      sources: [
        ...new Set([
          ...sources,
          ...constraint.rows.map((allocation) => `kantata:allocations/${allocation.id}`),
        ]),
      ],
      ambiguous: false,
      fingerprint: `FOLLOW_ON:${opportunity.id}:${Math.round(requiredPct / 10) * 10}`,
    });
  }

  return findings;
}
