import type { Finding } from '../finding.ts';
import type { ModelAllocation, ModelRecord } from '../model-record.ts';
import { allocationPeaks, horizon, overlaps } from '../window.ts';

/**
 * Rule 3 (S08): evaluate concurrent allocations inside the horizon, never every row that merely
 * touches it. A guessed-scale row blocks a confident claim only at the dates it is active.
 */
export function detectOverAllocated(record: ModelRecord): Finding[] {
  const { start: windowStart, end: windowEnd } = horizon(record.referenceDate);
  const ambiguousIds = new Set(record.ambiguousAllocations.map((row) => row.id));
  const clientByProjectId = new Map(
    record.projects.map((project) => [project.id, project.clientName]),
  );

  const byPerson = new Map<string, ModelAllocation[]>();
  for (const allocation of record.allocations) {
    if (!overlaps(allocation.startDate, allocation.endDate, windowStart, windowEnd)) continue;
    const rows = byPerson.get(allocation.userId) ?? [];
    rows.push(allocation);
    byPerson.set(allocation.userId, rows);
  }

  const findings: Finding[] = [];
  for (const userId of [...byPerson.keys()].sort()) {
    const rows = byPerson.get(userId)!;
    const peak = allocationPeaks(rows, windowStart, windowEnd)
      .filter((candidate) =>
        candidate.percentage > 100 && !candidate.rows.some((row) => ambiguousIds.has(row.id))
      )
      .sort((left, right) =>
        right.percentage - left.percentage || (left.date < right.date ? -1 : 1)
      )[0];
    if (!peak) continue;

    const sortedRows = [...peak.rows].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    );
    const allocationPct = peak.percentage;

    const person = record.personIndex[userId];
    const personName = person?.name ?? userId;
    const projectCount = new Set(sortedRows.map((row) => row.projectId)).size;

    // Client name, not project title: "80% on Veridia" is what a lead says out loud.
    const split = sortedRows
      .map((row) =>
        `${row.percentage}% on ${clientByProjectId.get(row.projectId) ?? row.projectId}`
      )
      .join(' + ');
    const capacity = person?.weeklyCapacityHours;
    const detail = capacity == null
      ? `${split}.`
      : `${split} against a ${capacity}h/week capacity.`;

    findings.push({
      id: `OVER_ALLOCATED:${userId}`,
      type: 'OVER_ALLOCATED',
      severity: 'critical',
      group: { kind: 'person', id: userId, label: personName },
      title: `${personName} — ${allocationPct}% allocated`,
      detail,
      rationale: `This creates an immediate capacity conflict across ${
        projectCount === 2 ? 'both' : `all ${projectCount}`
      } active projects.`,
      metrics: { allocationPct, projectCount },
      sources: [
        ...sortedRows.map((row) => `kantata:allocations/${row.id}`),
        `kantata:users/${userId}`,
      ],
      ambiguous: false,
      // Bucketed to the nearest 10 points — S21 owns the final bucketing rule for suppression.
      fingerprint: `OVER_ALLOCATED:${userId}:${Math.round(allocationPct / 10) * 10}`,
    });
  }

  return findings;
}
