import type { RuntimeConfig } from './config.ts';
import { selectCandidates } from './candidates.ts';
import { mapClient } from './clients.ts';
import type { ModelRecord } from './model-record.ts';

export type LinkerPayload = {
  opportunities: { id: string; name: string; accountName: string; stage: string }[];
  projects: { id: string; title: string; clientName: string }[];
};

export type ModelStatus =
  | 'completed'
  | 'no_candidates'
  | 'not_configured'
  | 'request_failed'
  | 'invalid_response';

export type LinkResult = {
  links: Map<string, string>;
  rejected: number;
  rejectionReasons: Partial<Record<LinkRejectionReason, number>>;
  modelUsed: boolean;
  modelStatus: ModelStatus;
};

export type LinkRejectionReason =
  | 'unknown_opportunity'
  | 'missing_project'
  | 'relation_mismatch'
  | 'unknown_project'
  | 'unresolved_record'
  | 'cross_client'
  | 'duplicate_opportunity';

type LinkRecord = {
  opportunity_id: string;
  project_id: string | null;
  relation: 'continuation' | 'unrelated';
};

const linkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['links'],
  properties: {
    links: {
      type: 'array',
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['opportunity_id', 'project_id', 'relation'],
            properties: {
              opportunity_id: { type: 'string' },
              project_id: { type: 'string' },
              relation: { type: 'string', enum: ['continuation'] },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['opportunity_id', 'project_id', 'relation'],
            properties: {
              opportunity_id: { type: 'string' },
              project_id: { type: 'null' },
              relation: { type: 'string', enum: ['unrelated'] },
            },
          },
        ],
      },
    },
  },
} as const;

const INSTRUCTION =
  'You are matching open opportunities to the active delivery projects they continue. ' +
  'Use only ids that appear in the lists given; never invent an id. ' +
  'A matching client only supplies candidates; it does not prove continuity. ' +
  'Compare the opportunity and project names for the same delivery workstream or phase, and ' +
  'distinguish a phase continuation from a different service such as a support retainer. ' +
  'Never link an opportunity to a project belonging to a different client. ' +
  'When an opportunity names a numbered phase and one active project for that client names an ' +
  'earlier delivery phase, select that delivery phase. ' +
  'Do not select it for an unnumbered support, retainer, or recurring-service project. ' +
  'For a continuation, provide one listed active project with relation "continuation". ' +
  'If no listed project is a continuation, return project_id null with relation "unrelated". ' +
  'Return at most one record per opportunity.';

/**
 * S13: hand-built projections, never a spread. Every field the model is not shown is a fact it
 * cannot fabricate or infer — amounts, probabilities, hours, dates and person names all stop here.
 */
export function buildPayload(record: ModelRecord): LinkerPayload {
  const accountNameById = new Map(record.accounts.map((account) => [account.id, account.name]));
  return {
    opportunities: selectCandidates(record).map((opportunity) => ({
      id: opportunity.id,
      name: opportunity.name,
      accountName: accountNameById.get(opportunity.accountId) ?? opportunity.accountId,
      stage: opportunity.stageName,
    })),
    projects: record.projects
      .filter((project) => project.status === 'Active')
      .map((project) => ({ id: project.id, title: project.title, clientName: project.clientName })),
  };
}

function outputText(response: unknown): string {
  if (!response || typeof response !== 'object') throw new Error('invalid response');
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) throw new Error('no structured output');
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'output_text') {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string') return text;
      }
    }
  }
  throw new Error('no structured output');
}

/** S14 rule 1: the shape is the contract. One bad record fails the call; nothing is salvaged. */
function parseLinks(text: string): LinkRecord[] {
  const parsed = JSON.parse(text) as { links?: unknown };
  if (!Array.isArray(parsed.links)) throw new Error('no links array');
  return parsed.links.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('malformed link');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).length !== 3) throw new Error('malformed link');
    const { opportunity_id, project_id, relation } = item;
    if (
      typeof opportunity_id !== 'string' ||
      (project_id !== null && typeof project_id !== 'string') ||
      (relation !== 'continuation' && relation !== 'unrelated') ||
      (project_id === null) !== (relation === 'unrelated')
    ) throw new Error('malformed link');
    return { opportunity_id, project_id, relation };
  });
}

/**
 * S15. Deterministic rejection rules over the model's raw answer. A null project id with relation
 * "unrelated" is the correct answer for a client with no active project — not a link, and not a
 * rejection: counting it would inflate the one number that says whether this guard catches
 * anything.
 */
export function verifyLinks(
  proposed: LinkRecord[],
  payload: LinkerPayload,
  record: ModelRecord,
): {
  links: Map<string, string>;
  rejected: number;
  rejectionReasons: Partial<Record<LinkRejectionReason, number>>;
} {
  const offeredOpportunities = new Set(payload.opportunities.map((row) => row.id));
  const offeredProjects = new Set(payload.projects.map((row) => row.id));
  const opportunityById = new Map(record.opportunities.map((row) => [row.id, row]));
  const projectById = new Map(record.projects.map((row) => [row.id, row]));
  const accountIdByName = new Map(record.accounts.map((account) => [account.name, account.id]));

  const links = new Map<string, string>();
  let rejected = 0;
  const rejectionReasons: Partial<Record<LinkRejectionReason, number>> = {};
  const reject = (reason: LinkRejectionReason) => {
    rejected += 1;
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  };
  for (const link of proposed) {
    if (link.project_id === null && link.relation === 'unrelated') continue;
    const opportunity = opportunityById.get(link.opportunity_id);
    const project = link.project_id === null ? undefined : projectById.get(link.project_id);
    const client = project === undefined
      ? null
      : mapClient(project.clientName, []).salesforceAccountName;
    if (!offeredOpportunities.has(link.opportunity_id)) {
      reject('unknown_opportunity');
      continue;
    }
    if (link.project_id === null) {
      reject('missing_project');
      continue;
    }
    if (link.relation !== 'continuation') {
      reject('relation_mismatch');
      continue;
    }
    if (!offeredProjects.has(link.project_id)) {
      reject('unknown_project');
      continue;
    }
    if (opportunity === undefined || project === undefined) {
      reject('unresolved_record');
      continue;
    }
    if (client === null || accountIdByName.get(client) !== opportunity.accountId) {
      reject('cross_client');
      continue;
    }
    if (links.has(link.opportunity_id)) {
      reject('duplicate_opportunity');
      continue;
    }
    links.set(link.opportunity_id, link.project_id);
  }
  return { links, rejected, rejectionReasons };
}

/** S14: one call for every candidate at once. Any failure at all degrades to nothing. */
export async function linkOpportunities(
  record: ModelRecord,
  config: RuntimeConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkResult> {
  const empty = (modelStatus: Exclude<ModelStatus, 'completed'>): LinkResult => ({
    links: new Map<string, string>(),
    rejected: 0,
    rejectionReasons: {},
    modelUsed: false,
    modelStatus,
  });
  const payload = buildPayload(record);
  if (payload.opportunities.length === 0) return empty('no_candidates');
  const apiKey = config.openAiApiKey?.trim();
  if (!apiKey) return empty('not_configured');

  let response: Response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openAiModel,
        reasoning: { effort: 'low' },
        input: [
          { role: 'system', content: [{ type: 'input_text', text: INSTRUCTION }] },
          { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(payload) }] },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'opportunity_links',
            strict: true,
            schema: linkSchema,
          },
        },
      }),
    });
  } catch {
    return empty('request_failed');
  }
  if (!response.ok) return empty('request_failed');

  try {
    const proposed = parseLinks(outputText(await response.json()));
    return { ...verifyLinks(proposed, payload, record), modelUsed: true, modelStatus: 'completed' };
  } catch {
    return empty('invalid_response');
  }
}
