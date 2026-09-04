import { HORIZON_DAYS } from './config.ts';
import type { ModelAllocation } from './model-record.ts';
import type { ReferenceDate } from './reference-date.ts';

/** `referenceDate` is an ISO calendar date, not a clock reading — UTC keeps the day count exact. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function overlaps(
  start: string,
  end: string,
  windowStart: string,
  windowEnd: string,
): boolean {
  return start <= windowEnd && end >= windowStart;
}

export type AllocationPeak = {
  date: string;
  rows: ModelAllocation[];
  percentage: number;
};

/**
 * Allocation totals can only increase when a row begins. Evaluating the interval start and every
 * in-window row start therefore finds every maximum without treating sequential work as concurrent.
 */
export function allocationPeaks(
  allocations: ModelAllocation[],
  windowStart: string,
  windowEnd: string,
): AllocationPeak[] {
  const dates = new Set<string>([windowStart]);
  for (const allocation of allocations) {
    if (!overlaps(allocation.startDate, allocation.endDate, windowStart, windowEnd)) continue;
    dates.add(allocation.startDate < windowStart ? windowStart : allocation.startDate);
  }

  return [...dates].sort().map((date) => {
    const rows = allocations.filter((allocation) =>
      allocation.startDate <= date && allocation.endDate >= date
    );
    return { date, rows, percentage: rows.reduce((sum, row) => sum + row.percentage, 0) };
  });
}

/** The one "right now" every detector filters against, so two clauses cannot disagree on it. */
export function horizon(referenceDate: ReferenceDate): { start: string; end: string } {
  return { start: referenceDate.date, end: addDays(referenceDate.date, HORIZON_DAYS) };
}
