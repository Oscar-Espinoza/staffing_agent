import type { Finding } from '../finding.ts';
import type { ModelRecord } from '../model-record.ts';
import { horizon, overlaps } from '../window.ts';

/**
 * The abstention OVER_ALLOCATED makes, said out loud. That detector skips anyone holding an
 * allocation whose scale had to be guessed; without this the lead never learns the person was
 * skipped, and silence reads as "no problem". Deterministic on purpose: a question that appears
 * only in the runs a model happened to mention it is worse than no question at all.
 */
export function detectScaleAmbiguous(record: ModelRecord): Finding[] {
  const { start: windowStart, end: windowEnd } = horizon(record.referenceDate);
  const ambiguousById = new Map(record.ambiguousAllocations.map((row) => [row.id, row]));
  const clientByProjectId = new Map(
    record.projects.map((project) => [project.id, project.clientName]),
  );

  return record.allocations
    .filter((allocation) =>
      ambiguousById.has(allocation.id) &&
      overlaps(allocation.startDate, allocation.endDate, windowStart, windowEnd)
    )
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((allocation) => {
      const person = record.personIndex[allocation.userId];
      const personName = person?.name ?? allocation.userId;
      const firstName = personName.split(' ')[0] ?? personName;
      const client = clientByProjectId.get(allocation.projectId) ?? allocation.projectId;
      const ambiguity = ambiguousById.get(allocation.id)!;
      const rawPercentage = ambiguity.rawPercentage === 1
        ? ambiguity.rawPercentage.toFixed(1)
        : String(ambiguity.rawPercentage);
      const literalPercentage = String(ambiguity.rawPercentage);
      return {
        id: `SCALE_AMBIGUOUS:${allocation.id}`,
        type: 'SCALE_AMBIGUOUS',
        severity: 'watch',
        group: { kind: 'person', id: allocation.userId, label: personName },
        title: `${client} — ${personName}`,
        detail:
          `Kantata lists ${firstName}'s allocation as ${rawPercentage}. It's unclear whether ` +
          `this means ${literalPercentage}% or ${allocation.percentage}%, so exact utilization cannot be ` +
          'calculated reliably.',
        rationale: '',
        metrics: {
          rawPercentage: ambiguity.rawPercentage,
          normalisedPercentage: allocation.percentage,
        },
        sources: [
          `kantata:allocations/${allocation.id}`,
          ...(person ? [`kantata:users/${allocation.userId}`] : []),
          ...(clientByProjectId.has(allocation.projectId)
            ? [`kantata:projects/${allocation.projectId}`]
            : []),
        ],
        ambiguous: true,
        fingerprint: `SCALE_AMBIGUOUS:${allocation.id}`,
      } satisfies Finding;
    });
}
