import { MIN_PROBABILITY } from './config.ts';
import type { ModelOpportunity, ModelRecord } from './model-record.ts';
import { horizon } from './window.ts';

const CLOSED_STAGES = new Set(['Closed Won', 'Closed Lost']);

/**
 * Which opportunities are worth staffing against at all. Seriousness is three numbers we already
 * hold, so deciding it is arithmetic and the model is never asked to weigh it (S12). Duplicates
 * were already collapsed in the model record — this never re-checks for them.
 */
export function selectCandidates(record: ModelRecord): ModelOpportunity[] {
  const { end } = horizon(record.referenceDate);
  return record.opportunities.filter((opportunity) =>
    !CLOSED_STAGES.has(opportunity.stageName) &&
    opportunity.probability >= MIN_PROBABILITY &&
    opportunity.closeDate >= record.referenceDate.date &&
    opportunity.closeDate <= end
  );
}
