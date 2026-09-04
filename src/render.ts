import type { Finding } from './finding.ts';

export type RenderFinding = Pick<
  Finding,
  'title' | 'detail' | 'ambiguous'
>;

export type RenderInput = {
  /** Already ordered and capped upstream — this is exactly the "shown" set, nothing more. */
  findings: RenderFinding[];
  referenceDate: string;
  /** Source paths S02 pushed onto `degraded`, e.g. `/kantata/time_entries`. */
  degradedSources: string[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-19` reads as `19 Aug 2026`: a lead skims a date, they do not parse one. */
function humanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const name = MONTHS[Number(month) - 1];
  if (year === undefined || day === undefined || name === undefined) return isoDate;
  return `${Number(day)} ${name} ${year}`;
}

/**
 * Plain text on purpose: the Workflow Builder trigger posts this variable verbatim. Findings keep
 * their full audit detail in the run result; Slack gets the scan-friendly title and evidence only.
 */
export function render(input: RenderInput): string {
  if (input.findings.length === 0) return '';

  const risks = input.findings.filter((finding) => !finding.ambiguous);
  const questions = input.findings.filter((finding) => finding.ambiguous);

  const blocks = (findings: RenderFinding[]) =>
    findings.map((finding) => `• ${finding.title}\n  ${finding.detail.replaceAll('\n', '\n  ')}`)
      .join('\n\n');
  const sections = [
    [
      `🚨 Staffing check — ${humanDate(input.referenceDate)}`,
      `${risks.length} risk${risks.length === 1 ? '' : 's'} ${
        risks.length === 1 ? 'needs' : 'need'
      } attention · ${questions.length} item${questions.length === 1 ? '' : 's'} ${
        questions.length === 1 ? 'needs' : 'need'
      } review`,
    ].join('\n'),
    blocks(risks),
  ];

  if (questions.length > 0) {
    sections.push(`────────────────────\nNeeds review\n\n${blocks(questions)}`);
  }

  if (input.degradedSources.length > 0) {
    sections.push(`⚠️ Incomplete data: ${input.degradedSources.join(', ')} unavailable.`);
  }

  return sections.filter((section) => section !== '').join('\n\n');
}
