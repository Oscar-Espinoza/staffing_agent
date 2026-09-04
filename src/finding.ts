/** Which risk clause fired. Grows by one member per detector (S16-S19 add to this union). */
export type FindingType =
  | 'OVER_ALLOCATED'
  | 'SCALE_AMBIGUOUS'
  | 'INACTIVE_ALLOCATED'
  | 'LEAVE_COLLISION'
  | 'DEAD_DEAL'
  | 'UNSTAFFED_DEMAND'
  | 'FOLLOW_ON';

export type FindingSeverity = 'critical' | 'watch';

export type FindingGroup = {
  kind: 'person' | 'project' | 'account';
  id: string;
  label: string;
};

/**
 * The one record shape every detector emits and S09 renders — so render parses one shape
 * instead of a different ad-hoc object per clause. A finding with no `sources` is an opinion,
 * not a finding (Rule 1); every number in the prose must already live in `metrics` or the
 * model record, never generated (Rule 2).
 */
export type Finding = {
  /** Stable identity for this occurrence, e.g. `OVER_ALLOCATED:u_10024`. */
  id: string;
  type: FindingType;
  severity: FindingSeverity;
  /** The one business entity under which Slack renders this finding. */
  group: FindingGroup;
  /** The line a lead scans, names first: `M. Ferreira — 140% allocated`. */
  title: string;
  /** The arithmetic behind the title, in one sentence, every number read off a source record. */
  detail: string;
  /** Why it matters — the consequence, not the calculation. Empty when `detail` already says it. */
  rationale: string;
  /** The numbers `detail` quotes, kept structured. */
  metrics: Record<string, number>;
  /** `system:collection/id`, e.g. `kantata:allocations/a_9001` — render turns these into `Sources:`. */
  sources: string[];
  /** `true` files this under NEEDS REVIEW as a question, never an assertion. */
  ambiguous: boolean;
  /** Suppression key (S21): type, subject and a bucketed metric. */
  fingerprint: string;
};
