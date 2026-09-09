import type { ProjectConnectionNotice } from './project-connections.ts';
import type { Finding } from './finding.ts';
import type { ModelRecord } from './model-record.ts';
import { allocationPeaks, horizon } from './window.ts';

export type RenderFinding =
  & Pick<
    Finding,
    'title' | 'detail' | 'ambiguous'
  >
  & Partial<Pick<Finding, 'id' | 'sources' | 'type'>>;

type FindingContext = { finding: Finding; record: ModelRecord };

/** Internal presentation records leave the public findings unchanged. */
export function buildFindingContext(
  record: ModelRecord,
  findings: Finding[],
): Map<string, FindingContext> {
  return new Map(findings.map((finding) => [finding.id, { finding, record }]));
}

export type RenderInput = {
  /** Already ordered and capped upstream — this is exactly the "shown" set, nothing more. */
  findings: RenderFinding[];
  referenceDate: string;
  /** Source paths S02 pushed onto `degraded`, e.g. `/kantata/time_entries`. */
  degradedSources: string[];
  omittedFindings?: number;
  dataQualityNotes?: string[];
  projectConnectionNotices?: ProjectConnectionNotice[];
  findingContext?: ReadonlyMap<string, FindingContext>;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-19` reads as `19 Aug 2026`: a lead skims a date, they do not parse one. */
function humanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const name = MONTHS[Number(month) - 1];
  if (year === undefined || day === undefined || name === undefined) return isoDate;
  return `${Number(day)} ${name} ${year}`;
}

// Monday–Friday, inclusive. No holiday calendar is available.
function weekdays(start: string, end: string): number {
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  let count = Math.floor(days / 7) * 5;
  const firstDay = new Date(start).getUTCDay();
  for (let i = 0; i < days % 7; i++) {
    const day = (firstDay + i) % 7;
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/** Presentation only: retain original dates and audit notes in the structured result. */
function readableText(text: string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, humanDate);
}

function readableNote(note: string): string {
  if (note.startsWith('Salesforce:')) return note;
  const orphan = note.match(/^(.+)'s allocation \S+ references missing Kantata project (\S+);/);
  if (orphan) {
    return `Kantata: ${orphan[1]}’s allocation references project ${
      orphan[2]
    }, not found in the retrieved Kantata projects; included in personal allocation totals.`;
  }
  const readable = readableText(note);
  if (note.startsWith('time entries were')) return `Kantata: ${readable}`;
  if (note.startsWith('Unmapped client:')) return `Cross-system client mapping: ${readable}`;
  return readable;
}

/**
 * Plain text on purpose: the Workflow Builder trigger posts this variable verbatim. Findings keep
 * their full audit detail in the run result; Slack gets the scan-friendly title and evidence only.
 */
export function render(input: RenderInput): string {
  const notices = input.projectConnectionNotices ?? [];
  if (input.findings.length === 0 && notices.length === 0) return '';

  const risks = input.findings.filter((finding) => !finding.ambiguous);
  const questions = input.findings.filter((finding) => finding.ambiguous);

  const questionCount = questions.length + notices.length;

  const blocks = (findings: RenderFinding[]) =>
    findings.map((finding) => {
      const context = finding.id === undefined ? undefined : input.findingContext?.get(finding.id);
      return (context && compactFinding(context, input.referenceDate)) ??
        `${finding.title}\n${readableText(finding.detail)}`;
    }).join('\n\n');
  const sections = [
    [
      `Staffing snapshot · as of ${humanDate(input.referenceDate)}`,
      `${risks.length} risk${risks.length === 1 ? '' : 's'} · ` +
      `${questionCount} question${questionCount === 1 ? '' : 's'}`,
    ].join('\n'),
  ];

  if (risks.length > 0) sections.push(`NEEDS ATTENTION\n\n${blocks(risks)}`);
  const reviewBlocks = questions.length > 0 ? [blocks(questions)] : [];
  for (const notice of notices) {
    const shared = notice.projects.includes(notice.opportunity);
    reviewBlocks.push([
      `Client: ${notice.client ?? 'Unknown (not found in retrieved records)'}`,
      ...[...new Set(notice.projects)].map((name) => `Kantata project to check: ${name}`),
      shared
        ? 'Salesforce opportunity: same name as the project.'
        : `Salesforce opportunity: ${notice.opportunity}`,
      notice.projects.length > 0
        ? 'Project connection unconfirmed. Does this extend the existing project, or is it separate work?'
        : 'Project connection unconfirmed. Please confirm the delivery plan.',
    ].join('\n'));
  }
  if (reviewBlocks.length > 0) sections.push(`NEEDS REVIEW\n\n${reviewBlocks.join('\n\n')}`);

  const omitted = input.omittedFindings ?? 0;
  if (omitted > 0) {
    sections.push(
      `${omitted} additional finding${omitted === 1 ? '' : 's'} omitted; see the run result.`,
    );
  }
  if (input.dataQualityNotes?.length) {
    sections.push(`DATA QUALITY NOTES\n${input.dataQualityNotes.map(readableNote).join('\n')}`);
  }

  if (input.degradedSources.length > 0) {
    sections.push(`⚠️ Incomplete data: ${input.degradedSources.join(', ')} unavailable.`);
  }

  return sections.filter((section) => section !== '').join('\n\n');
}

/** Render cited facts directly, falling back as a whole when required records are unavailable. */
function compactFinding(
  { finding: f, record: r }: FindingContext,
  referenceDate: string,
): string | undefined {
  const cited = (source: string) => f.sources.includes(source);
  const projects = r.projects.filter((p) => cited(`kantata:projects/${p.id}`));
  const opportunities = r.opportunities.filter((o) => cited(`salesforce:opportunities/${o.id}`));
  const allocations = r.allocations.filter((a) => cited(`kantata:allocations/${a.id}`));
  const leaves = r.timeOff.filter((l) => cited(`kantata:time_off/${l.id}`));
  const people = r.people.filter((p) => cited(`kantata:users/${p.kantataUserId}`));
  const tasks = r.tasks.filter((t) => cited(`clickup:tasks/${t.id}`));
  const resolved = new Set([
    ...projects.map((p) => `kantata:projects/${p.id}`),
    ...opportunities.map((o) => `salesforce:opportunities/${o.id}`),
    ...allocations.map((a) => `kantata:allocations/${a.id}`),
    ...leaves.map((l) => `kantata:time_off/${l.id}`),
    ...people.map((p) => `kantata:users/${p.kantataUserId}`),
    ...people.map((p) => `clickup:members/${p.clickupMemberId}`),
    ...tasks.map((t) => `clickup:tasks/${t.id}`),
    ...r.accounts.map((a) => `salesforce:accounts/${a.id}`),
  ]);
  if (f.sources.some((source) => !resolved.has(source))) return;
  const date = (iso: string) =>
    iso.slice(0, 4) === referenceDate.slice(0, 4)
      ? humanDate(iso).replace(/ \d{4}$/, '')
      : humanDate(iso);
  const range = (start: string, end: string) =>
    start.slice(0, 7) === end.slice(0, 7)
      ? `${Number(start.slice(8))}–${date(end)}`
      : `${date(start)}–${date(end)}`;
  const hours = (o: ModelRecord['opportunities'][number]) =>
    o.estimatedDeliveryHours === null
      ? 'delivery hours not estimated'
      : `${o.estimatedDeliveryHours} estimated delivery hours`;
  const person = people[0];
  const project = projects[0];
  const opportunity = opportunities[0];
  const allocation = allocations[0];
  const leave = leaves[0];
  const shared = projects.length === 1 && opportunities.length === 1 &&
    project?.title === opportunity?.name;

  const opportunityLabel = shared
    ? 'The Salesforce opportunity with the same name'
    : `Salesforce opportunity: ${opportunity?.name}`;
  const projectContext = () => [
    `Client: ${project!.clientName}`,
    `Project: ${project!.title}`,
  ];
  const splits = () =>
    projects.map((p) =>
      `${
        allocations.filter((a) => a.projectId === p.id).reduce((sum, a) => sum + a.percentage, 0)
      }% — Project: ${p.title} · Client: ${p.clientName}`
    );
  switch (f.type) {
    case 'UNSTAFFED_DEMAND': {
      const account = r.accounts.find((a) => a.id === opportunity?.accountId);
      if (!opportunity || !account) return;
      return [
        'Incoming work without a recorded project',
        `Client: ${account.name}`,
        `Salesforce opportunity: ${opportunity.name} · ${opportunity.probability}% probability · closes ${
          date(opportunity.closeDate)
        } · ${hours(opportunity)}.`,
        `Kantata: No matching active project found for this client in the retrieved data.`,
        'Confirm staffing and delivery timing if this closes.',
      ].join('\n');
    }
    case 'FOLLOW_ON':
      if (!opportunity || !project) return;
      return [
        'Follow-on schedule to confirm',
        ...projectContext(),
        `${opportunityLabel} · closes ${date(opportunity.closeDate)} · ${hours(opportunity)}.`,
        `The project is scheduled in Kantata through ${date(project.dueDate)}.`,
        'When would delivery start, for how long, and with which team?',
      ].join('\n');
    case 'DEAD_DEAL':
      if (!project || !opportunities.length) return;
      return readableText(f.detail);
    default:
      if (
        !person || !allocation ||
        allocations.some((a) => !projects.some((p) => p.id === a.projectId))
      ) return;
  }
  switch (f.type) {
    case 'INACTIVE_ALLOCATED':
      return [
        `${person.name} — inactive but allocated`,
        ...projectContext(),
        `Kantata records ${allocation.percentage}% on this project, ${
          range(allocation.startDate, allocation.endDate)
        }; person marked inactive.`,
        'Confirm availability or replacement coverage.',
      ].join('\n');
    case 'OVER_ALLOCATED': {
      const window = horizon(r.referenceDate);
      // Re-evaluate the detector's eligible dates against all of this person's rows: an earlier
      // date with an uncited ambiguous row must not be presented as a confident peak.
      const ambiguousIds = new Set(r.ambiguousAllocations.map((a) => a.id));
      const peak = allocationPeaks(
        r.allocations.filter((a) => a.userId === person.kantataUserId),
        window.start,
        window.end,
      ).find((p) =>
        p.percentage === f.metrics.allocationPct &&
        !p.rows.some((a) => ambiguousIds.has(a.id)) &&
        p.rows.length === allocations.length &&
        p.rows.every((a) => allocations.some((cited) => cited.id === a.id))
      );
      if (!peak) return;
      // This is the intersection of the cited commitments, not project lifetimes or a claim
      // that no other allocations exist outside the evaluated peak.
      const overlapStart = allocations.map((a) => a.startDate).sort().at(-1)!;
      const overlapEnd = allocations.map((a) => a.endDate).sort()[0]!;
      const days = weekdays(overlapStart, overlapEnd);
      const role = person.title?.trim() || 'person';
      const count = projects.length === 2 ? 'two' : String(projects.length);
      return [
        `Over capacity: ${person.name} — ${f.metrics.allocationPct}%`,
        `This ${role} has ${count} project allocation${projects.length === 1 ? '' : 's'} ` +
        `${projects.length === 1 ? 'running' : 'overlapping'} from ${date(overlapStart)} to ${
          date(overlapEnd)
        } ` +
        `(${days} weekday${
          days === 1 ? '' : 's'
        }), totaling ${peak.percentage}% of weekly capacity.`,
        'Kantata projects:',
        ...projects.map((p) => {
          const pct = allocations.filter((a) => a.projectId === p.id)
            .reduce((sum, a) => sum + a.percentage, 0);
          return `• ${p.title} (Client: ${p.clientName}): ${pct}%`;
        }),
        'Which commitment can be reduced or reassigned?',
      ].join('\n');
    }
    case 'LEAVE_COLLISION':
      if (!leave) return;
      return [
        `${person.name} — leave conflicts with commitment`,
        ...(projects.length === 1
          ? [
            ...projectContext(),
            `Kantata records ${f.metrics.allocationPct}% on this project; approved ${leave.type.toLowerCase()} ${
              range(leave.startDate, leave.endDate)
            }.`,
          ]
          : [
            'Kantata:',
            ...splits(),
            `Approved ${leave.type.toLowerCase()}: ${range(leave.startDate, leave.endDate)}.`,
          ]),
        'Confirm leave coverage.',
      ].join('\n');
    case 'SCALE_AMBIGUOUS': {
      const raw = f.metrics.rawPercentage;
      if (raw === undefined) return;
      return [
        `${person.name} — allocation units${leaves.length ? ' and leave coverage' : ''} unclear`,
        ...projectContext(),
        `Recorded allocation: ${
          raw === 1 ? '1.0' : raw
        }; could mean ${raw}% or ${f.metrics.normalisedPercentage}%.`,
        ...leaves.map((l) =>
          `Approved ${l.type.toLowerCase()}: ${
            range(l.startDate, l.endDate)
          }, overlapping this allocation.`
        ),
        `Confirm the intended units${leaves.length ? ' and leave coverage' : ''}.`,
      ].join('\n');
    }
  }
}
