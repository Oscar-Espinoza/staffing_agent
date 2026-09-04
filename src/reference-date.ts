import { z } from 'zod';
import type { SourceSnapshot } from './snapshot.ts';

export type ReferenceDate = {
  date: string;
  note: string | null;
};

const FALLBACK_NOTE =
  'time entries were unavailable, so the reference date falls back to the latest project start date; day counts in this run are approximate';

const TimeEntry = z.object({ date_performed: z.string() });
const Project = z.object({ start_date: z.string() });

/** ISO `YYYY-MM-DD` strings sort chronologically as plain strings — no Date object needed. */
function latest(dates: string[]): string {
  if (dates.length === 0) {
    throw new Error('cannot derive a reference date without time entries or projects');
  }
  return dates.reduce((max, date) => (date > max ? date : max));
}

/**
 * "Today" for every stage that needs it — taken from the data, never the wall clock, so a run
 * months from now reproduces today's findings against the same fixtures. Time entries are the
 * primary source; an empty collection means S02 found `/kantata/time_entries` degraded, so this
 * falls back to the latest project start date and discloses that day counts are now approximate.
 */
export function deriveReferenceDate(snapshot: SourceSnapshot): ReferenceDate {
  const timeEntries = snapshot.kantata.time_entries.map((row) => TimeEntry.parse(row));
  if (timeEntries.length > 0) {
    return { date: latest(timeEntries.map((entry) => entry.date_performed)), note: null };
  }

  const projects = snapshot.kantata.projects.map((row) => Project.parse(row));
  return { date: latest(projects.map((project) => project.start_date)), note: FALLBACK_NOTE };
}
