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
  | 'incomplete_response'
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
  dispositions: LinkDisposition[];
  metadata: {
    requestedModel: string;
    responseModel: string | null;
    responseId: string | null;
    promptVersion: string;
    promptHash: string;
    payloadHash: string;
    reasoningEffort: 'low';
  };
};

export type LinkDisposition = {
  opportunityId: string;
  projectId: string | null;
  disposition: LinkRecord['relation'] | 'missing' | 'rejected' | 'not_evaluated';
  reason?: LinkRejectionReason;
};

export type LinkRejectionReason =
  | 'unknown_opportunity'
  | 'missing_project'
  | 'relation_mismatch'
  | 'unknown_project'
  | 'unresolved_record'
  | 'cross_client'
  | 'missing_opportunity'
  | 'duplicate_opportunity';

type LinkRecord = {
  opportunity_id: string;
  project_id: string | null;
  relation: 'continuation' | 'unrelated' | 'uncertain';
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
              relation: { type: 'string', enum: ['unrelated', 'uncertain'] },
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
  'If no project exists for the client, or the names clearly describe different work, return ' +
  'project_id null with relation "unrelated". If names only suggest a connection, or several ' +
  'projects are equally plausible, return project_id null with relation "uncertain". ' +
  'A shared broad topic alone does not establish continuity. ' +
  'Return exactly one record for every opportunity, including unrelated and uncertain decisions.';

const PROMPT_VERSION = 'continuation-v2';

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

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
  if (!parsed || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.links)) {
    throw new Error('no links array');
  }
  return parsed.links.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('malformed link');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).length !== 3) throw new Error('malformed link');
    const { opportunity_id, project_id, relation } = item;
    if (
      typeof opportunity_id !== 'string' ||
      (project_id !== null && typeof project_id !== 'string') ||
      (relation !== 'continuation' && relation !== 'unrelated' && relation !== 'uncertain') ||
      (project_id !== null) !== (relation === 'continuation')
    ) throw new Error('malformed link');
    return { opportunity_id, project_id, relation };
  });
}

/**
 * S15. Validate negative decisions too. Missing answers and conflicting duplicates must remain
 * visible; neither is evidence that the opportunity is unrelated.
 */
export function verifyLinks(
  proposed: LinkRecord[],
  payload: LinkerPayload,
  record: ModelRecord,
): {
  links: Map<string, string>;
  rejected: number;
  rejectionReasons: Partial<Record<LinkRejectionReason, number>>;
  dispositions: LinkDisposition[];
} {
  const offeredOpportunities = new Set(payload.opportunities.map((row) => row.id));
  const offeredProjects = new Set(payload.projects.map((row) => row.id));
  const opportunityById = new Map(record.opportunities.map((row) => [row.id, row]));
  const projectById = new Map(record.projects.map((row) => [row.id, row]));
  const accountIdByName = new Map(record.accounts.map((account) => [account.name, account.id]));

  const links = new Map<string, string>();
  const decisions = new Map<string, LinkDisposition>();
  let rejected = 0;
  const rejectionReasons: Partial<Record<LinkRejectionReason, number>> = {};
  const reject = (reason: LinkRejectionReason) => {
    rejected += 1;
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  };
  for (const link of proposed) {
    const opportunity = opportunityById.get(link.opportunity_id);
    const project = link.project_id === null ? undefined : projectById.get(link.project_id);
    const client = project === undefined
      ? null
      : mapClient(project.clientName, []).salesforceAccountName;
    if (!offeredOpportunities.has(link.opportunity_id)) {
      reject('unknown_opportunity');
      continue;
    }
    const rejectCandidate = (reason: LinkRejectionReason) => {
      reject(reason);
      links.delete(link.opportunity_id);
      decisions.set(link.opportunity_id, {
        opportunityId: link.opportunity_id,
        projectId: null,
        disposition: 'rejected',
        reason,
      });
    };
    if (decisions.has(link.opportunity_id)) {
      rejectCandidate('duplicate_opportunity');
      continue;
    }
    if (opportunity === undefined) {
      rejectCandidate('unresolved_record');
      continue;
    }
    if (
      link.project_id === null && (link.relation === 'unrelated' || link.relation === 'uncertain')
    ) {
      decisions.set(link.opportunity_id, {
        opportunityId: link.opportunity_id,
        projectId: null,
        disposition: link.relation,
      });
      continue;
    }
    if (link.project_id === null) {
      rejectCandidate('missing_project');
      continue;
    }
    if (link.relation !== 'continuation') {
      rejectCandidate('relation_mismatch');
      continue;
    }
    if (!offeredProjects.has(link.project_id)) {
      rejectCandidate('unknown_project');
      continue;
    }
    if (project === undefined) {
      rejectCandidate('unresolved_record');
      continue;
    }
    if (client === null || accountIdByName.get(client) !== opportunity.accountId) {
      rejectCandidate('cross_client');
      continue;
    }
    links.set(link.opportunity_id, link.project_id);
    decisions.set(link.opportunity_id, {
      opportunityId: link.opportunity_id,
      projectId: link.project_id,
      disposition: 'continuation',
    });
  }
  const dispositions = payload.opportunities.map(({ id }): LinkDisposition => {
    const decision = decisions.get(id);
    if (decision) return decision;
    reject('missing_opportunity');
    return {
      opportunityId: id,
      projectId: null,
      disposition: 'missing',
      reason: 'missing_opportunity',
    };
  });
  return { links, rejected, rejectionReasons, dispositions };
}

/** S14: one call for every candidate. Request/schema failures yield no links; omissions are explicit. */
export async function linkOpportunities(
  record: ModelRecord,
  config: RuntimeConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkResult> {
  const payload = buildPayload(record);
  const payloadText = JSON.stringify(payload);
  const metadata: LinkResult['metadata'] = {
    requestedModel: config.openAiModel,
    responseModel: null,
    responseId: null,
    promptVersion: PROMPT_VERSION,
    promptHash: await sha256(INSTRUCTION + JSON.stringify(linkSchema)),
    payloadHash: await sha256(payloadText),
    reasoningEffort: 'low',
  };
  const empty = (modelStatus: Exclude<ModelStatus, 'completed'>): LinkResult => ({
    links: new Map<string, string>(),
    rejected: 0,
    rejectionReasons: {},
    modelUsed: false,
    modelStatus,
    dispositions: payload.opportunities.map(({ id }) => ({
      opportunityId: id,
      projectId: null,
      disposition: 'not_evaluated',
    })),
    metadata,
  });
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
          { role: 'user', content: [{ type: 'input_text', text: payloadText }] },
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
    const body = await response.json();
    metadata.responseModel = typeof body?.model === 'string' ? body.model : null;
    metadata.responseId = typeof body?.id === 'string' ? body.id : null;
    const proposed = parseLinks(outputText(body));
    const verified = verifyLinks(proposed, payload, record);
    return {
      ...verified,
      modelUsed: true,
      modelStatus: verified.rejected ? 'incomplete_response' : 'completed',
      metadata,
    };
  } catch {
    return empty('invalid_response');
  }
}
