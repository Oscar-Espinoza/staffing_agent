import type { Finding } from '../finding.ts';
import type { ModelRecord } from '../model-record.ts';
import { allocationPeaks, horizon, overlaps } from '../window.ts';

// Cast until they exist — the union is not mine to edit.
const INACTIVE_ALLOCATED = 'INACTIVE_ALLOCATED';
const LEAVE_COLLISION = 'LEAVE_COLLISION';

const LOW_HEADROOM_PCT = 80;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * S17 rules 3 and 4 — the two ways capacity we are counting on is not actually available.
 * Both use the same horizon, but leave is evaluated over the leave interval itself. Guessed-scale
 * rows never support a confident claim; SCALE_AMBIGUOUS asks the data question instead.
 */
export function detectUnavailableCapacity(record: ModelRecord): Finding[] {
  const { start: windowStart, end: windowEnd } = horizon(record.referenceDate);
  const ambiguousIds = new Set(record.ambiguousAllocations.map((row) => row.id));
  const projectById = new Map(record.projects.map((project) => [project.id, project]));

  const live = record.allocations
    .filter((allocation) =>
      overlaps(allocation.startDate, allocation.endDate, windowStart, windowEnd)
    )
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const findings: Finding[] = [];

  // Rule 3: a live allocation held by someone the capacity system says is inactive.
  for (const allocation of live) {
    const person = record.personIndex[allocation.userId];
    if (!person || person.isActive || ambiguousIds.has(allocation.id)) continue;
    const project = projectById.get(allocation.projectId);
    findings.push({
      id: `${INACTIVE_ALLOCATED}:${allocation.id}`,
      type: INACTIVE_ALLOCATED,
      severity: 'critical',
      group: { kind: 'person', id: allocation.userId, label: person.name },
      title: `${person.name} — inactive but still allocated`,
      detail:
        `${person.name} is flagged inactive in Kantata yet holds a ${allocation.percentage}% ` +
        `allocation on ${project?.title ?? allocation.projectId} running ${allocation.startDate} ` +
        `to ${allocation.endDate}.`,
      rationale: `The plan includes a ${allocation.percentage}% allocation for a user marked ` +
        'inactive; confirm availability or replacement coverage.',
      metrics: { allocationPct: allocation.percentage },
      sources: [
        `kantata:allocations/${allocation.id}`,
        `kantata:users/${allocation.userId}`,
        ...(project ? [`kantata:projects/${project.id}`] : []),
      ],
      ambiguous: false,
      fingerprint: `${INACTIVE_ALLOCATED}:${allocation.userId}:${allocation.projectId}`,
    });
  }

  // Rule 4: approved leave that has not started yet, colliding with a heavy readable commitment.
  const leaves = record.timeOff
    .filter((leave) =>
      leave.status === 'Approved' &&
      leave.startDate > record.referenceDate.date &&
      overlaps(leave.startDate, leave.endDate, windowStart, windowEnd)
    )
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  for (const leave of leaves) {
    // Sequential work elsewhere in the horizon is not a leave conflict. Only commitments active
    // during the leave and still owed afterwards reduce capacity.
    const rows = record.allocations.filter((allocation) => {
      const project = projectById.get(allocation.projectId);
      return allocation.userId === leave.userId &&
        !ambiguousIds.has(allocation.id) &&
        project !== undefined &&
        project.dueDate > leave.endDate &&
        overlaps(allocation.startDate, allocation.endDate, leave.startDate, leave.endDate);
    });
    const peak = allocationPeaks(rows, leave.startDate, leave.endDate)
      .filter((candidate) => candidate.percentage >= LOW_HEADROOM_PCT)
      .sort((left, right) =>
        right.percentage - left.percentage || (left.date < right.date ? -1 : 1)
      )[0];
    if (!peak) continue;

    const allocationPct = peak.percentage;
    const projectTitles = [
      ...new Set(peak.rows.map((row) => projectById.get(row.projectId)?.title ?? row.projectId)),
    ];

    const person = record.personIndex[leave.userId];
    const personName = person?.name ?? leave.userId;
    const startsInDays = daysBetween(record.referenceDate.date, leave.startDate);

    findings.push({
      id: `${LEAVE_COLLISION}:${leave.id}`,
      type: LEAVE_COLLISION,
      severity: 'critical',
      group: { kind: 'person', id: leave.userId, label: personName },
      title: `${personName} — approved leave against a ${allocationPct}% commitment`,
      detail:
        `${personName} is ${allocationPct}% committed to ${projectTitles.join(', ')} during ` +
        `approved ${leave.type.toLowerCase()} from ${leave.startDate} to ${leave.endDate}, ` +
        `starting in ${startsInDays} days.`,
      rationale: `Recorded commitments total ${allocationPct}% on ${peak.date} during approved ` +
        'leave, and the referenced projects are scheduled to finish after it; confirm planned coverage.',
      metrics: { allocationPct, startsInDays },
      sources: [
        `kantata:time_off/${leave.id}`,
        ...(person ? [`kantata:users/${leave.userId}`] : []),
        ...peak.rows.map((row) => `kantata:allocations/${row.id}`),
        ...[...new Set(peak.rows.map((row) => row.projectId))].map(
          (projectId) => `kantata:projects/${projectId}`,
        ),
      ],
      ambiguous: false,
      fingerprint: `${LEAVE_COLLISION}:${leave.userId}:${leave.startDate}`,
    });
  }

  return findings;
}
