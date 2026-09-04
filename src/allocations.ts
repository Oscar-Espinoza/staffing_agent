export interface AmbiguousAllocation {
  id: string;
  rawPercentage: number;
  normalisedPercentage: number;
}

/**
 * Kantata's allocation_percentage mixes two scales with nothing in the data saying which:
 * a dominant 0-100 scale, and a minority recorded as a fraction of one whole. A value at or
 * below 1 is read as that fraction and multiplied by 100 — and flagged, because the same raw
 * number could just as easily be a near-zero reading on the 0-100 scale. Zero is the one
 * exception: both scales agree that it means no allocation. Anything above 1 is unambiguous:
 * already on the 0-100 scale.
 */
export function normaliseAllocationPercentage(
  rawPercentage: number,
): { value: number; ambiguous: boolean } {
  return rawPercentage === 0
    ? { value: 0, ambiguous: false }
    : rawPercentage <= 1
    ? { value: rawPercentage * 100, ambiguous: true }
    : { value: rawPercentage, ambiguous: false };
}

/** The rows whose scale had to be guessed, so a later stage can consult them without re-deriving. */
export function ambiguousAllocations(
  rows: { id: string; rawPercentage: number }[],
): AmbiguousAllocation[] {
  const flagged: AmbiguousAllocation[] = [];
  for (const { id, rawPercentage } of rows) {
    const { value, ambiguous } = normaliseAllocationPercentage(rawPercentage);
    if (ambiguous) flagged.push({ id, rawPercentage, normalisedPercentage: value });
  }
  return flagged;
}
