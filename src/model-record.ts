import { z } from 'zod';
import type { SourceSnapshot } from './snapshot.ts';
import { joinPeople, type Person } from './people.ts';
import { mapClient } from './clients.ts';
import {
  type AmbiguousAllocation,
  ambiguousAllocations,
  normaliseAllocationPercentage,
} from './allocations.ts';
import { deriveReferenceDate, type ReferenceDate } from './reference-date.ts';

const KantataProjectRow = z.object({
  id: z.string(),
  title: z.string(),
  client_name: z.string(),
  status: z.string(),
  start_date: z.string(),
  due_date: z.string(),
  budgeted_hours: z.number(),
  lead_user_id: z.string().nullable(),
});
const KantataAllocationRow = z.object({
  id: z.string(),
  project_id: z.string(),
  user_id: z.string(),
  allocation_percentage: z.number(),
  start_date: z.string(),
  end_date: z.string(),
});
const KantataTimeOffRow = z.object({
  id: z.string(),
  user_id: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  type: z.string(),
  status: z.string(),
});
const KantataTimeEntryRow = z.object({ project_id: z.string(), hours: z.number() });

const SalesforceAccountRow = z.object({ Id: z.string(), Name: z.string(), Industry: z.string() });
const SalesforceOpportunityRow = z.object({
  Id: z.string(),
  Name: z.string(),
  AccountId: z.string(),
  StageName: z.string(),
  Amount: z.number(),
  CloseDate: z.string(),
  Estimated_Delivery_Hours__c: z.number().nullable(),
  Probability: z.number(),
  OwnerId: z.string(),
});

const ClickUpTaskRow = z.object({
  id: z.string(),
  name: z.string(),
  status: z.object({ status: z.string() }),
  list: z.object({ id: z.string(), name: z.string() }),
  assignees: z.array(z.object({ id: z.number() })),
  time_estimate: z.number().nullable(),
});

export type ModelAllocation = {
  id: string;
  projectId: string;
  userId: string;
  percentage: number;
  startDate: string;
  endDate: string;
};

export type ModelTimeOff = {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
};

export type ModelAccount = { id: string; name: string; industry: string };

export type ModelOpportunity = {
  id: string;
  name: string;
  accountId: string;
  stageName: string;
  amount: number;
  closeDate: string;
  estimatedDeliveryHours: number | null;
  probability: number;
  ownerId: string;
};

/** Activity evidence only — never a source for an allocation or capacity number. See Rule 1. */
export type ModelTask = {
  id: string;
  name: string;
  status: string;
  listId: string;
  listName: string;
  assigneeIds: number[];
  timeEstimateHours: number | null;
};

export type ModelProject = {
  id: string;
  title: string;
  clientName: string;
  status: string;
  startDate: string;
  dueDate: string;
  budgetedHours: number;
  leadUserId: string | null;
  salesforceAccountName: string | null;
  clickupListName: string | null;
  loggedHours: number;
  matchedDeals: ModelOpportunity[];
};

export type ModelRecord = {
  referenceDate: ReferenceDate;
  people: Person[];
  personIndex: Record<string, Person>;
  projects: ModelProject[];
  allocations: ModelAllocation[];
  timeOff: ModelTimeOff[];
  opportunities: ModelOpportunity[];
  accounts: ModelAccount[];
  tasks: ModelTask[];
  notes: string[];
  ambiguousAllocations: AmbiguousAllocation[];
  unmappedClients: string[];
};

function toModelOpportunity(row: z.infer<typeof SalesforceOpportunityRow>): ModelOpportunity {
  return {
    id: row.Id,
    name: row.Name,
    accountId: row.AccountId,
    stageName: row.StageName,
    amount: row.Amount,
    // Salesforce sends `2026-08-26T00:00:00.000+0000`; every consumer compares and formats
    // calendar dates. Normalising here keeps `YYYY-MM-DD` true for all of them at once.
    closeDate: row.CloseDate.slice(0, 10),
    estimatedDeliveryHours: row.Estimated_Delivery_Hours__c,
    probability: row.Probability,
    ownerId: row.OwnerId,
  };
}

/**
 * `006Ho00000OPP04` and `006Ho00000OPP05` are the same Corvane deal entered twice — identical
 * but for `Id`/`Name`. Account, amount, close date and estimated hours together identify a
 * duplicate; the first occurrence is kept, the rest are logged in `notes` and never summed.
 */
function dedupeOpportunities(
  rows: z.infer<typeof SalesforceOpportunityRow>[],
  accountNameById: Map<string, string>,
  notes: string[],
): z.infer<typeof SalesforceOpportunityRow>[] {
  const seen = new Map<string, z.infer<typeof SalesforceOpportunityRow>>();
  const kept: z.infer<typeof SalesforceOpportunityRow>[] = [];
  for (const row of rows) {
    const key =
      `${row.AccountId}|${row.Amount}|${row.CloseDate}|${row.Estimated_Delivery_Hours__c}`;
    const original = seen.get(key);
    if (original) {
      const accountName = accountNameById.get(row.AccountId) ?? row.AccountId;
      notes.push(
        `${accountName} opportunity ${row.Id} appears to duplicate ${original.Id}; ` +
          `it was excluded from demand calculations.`,
      );
      continue;
    }
    seen.set(key, row);
    kept.push(row);
  }
  return kept;
}

/**
 * Assembles the one joined record every later stage reads instead of touching a raw system
 * response again. Reuses S03-S06 rather than re-deriving any of their joins, and keeps ClickUp
 * strictly to `tasks` — activity evidence that can never contribute to an allocation or capacity
 * number (Rule 1).
 */
export function assembleModelRecord(snapshot: SourceSnapshot): ModelRecord {
  const notes: string[] = [];
  const unmappedClients: string[] = [];

  const people = joinPeople(snapshot);
  const personIndex: Record<string, Person> = {};
  for (const person of people) {
    if (person.kantataUserId !== null) personIndex[person.kantataUserId] = person;
  }

  const kantataProjects = snapshot.kantata.projects.map((row) => KantataProjectRow.parse(row));
  const kantataAllocations = snapshot.kantata.allocations.map((row) =>
    KantataAllocationRow.parse(row)
  );
  const kantataTimeOff = snapshot.kantata.time_off.map((row) => KantataTimeOffRow.parse(row));
  const timeEntries = snapshot.kantata.time_entries.map((row) => KantataTimeEntryRow.parse(row));

  const salesforceAccounts = snapshot.salesforce.accounts.map((row) =>
    SalesforceAccountRow.parse(row)
  );
  const accountNameById = new Map(salesforceAccounts.map((account) => [account.Id, account.Name]));
  const accountIdByName = new Map(salesforceAccounts.map((account) => [account.Name, account.Id]));

  const dedupedOpportunities = dedupeOpportunities(
    snapshot.salesforce.opportunities.map((row) => SalesforceOpportunityRow.parse(row)),
    accountNameById,
    notes,
  );
  const opportunities = dedupedOpportunities.map(toModelOpportunity);

  const tasks: ModelTask[] = snapshot.clickup.tasks
    .map((row) => ClickUpTaskRow.parse(row))
    .map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status.status,
      listId: task.list.id,
      listName: task.list.name,
      assigneeIds: task.assignees.map((assignee) => assignee.id),
      timeEstimateHours: task.time_estimate === null ? null : task.time_estimate / 3_600_000,
    }));

  const projectIds = new Set(kantataProjects.map((project) => project.id));

  const projects: ModelProject[] = kantataProjects.map((project) => {
    const client = mapClient(project.client_name, unmappedClients);
    const loggedHours = timeEntries
      .filter((entry) => entry.project_id === project.id)
      .reduce((sum, entry) => sum + entry.hours, 0);
    const accountId = client.salesforceAccountName === null
      ? null
      : accountIdByName.get(client.salesforceAccountName) ?? null;
    const matchedDeals = accountId === null
      ? []
      : opportunities.filter((opportunity) => opportunity.accountId === accountId);

    return {
      id: project.id,
      title: project.title,
      clientName: project.client_name,
      status: project.status,
      startDate: project.start_date,
      dueDate: project.due_date,
      budgetedHours: project.budgeted_hours,
      leadUserId: project.lead_user_id,
      salesforceAccountName: client.salesforceAccountName,
      clickupListName: client.clickupListName,
      loggedHours,
      matchedDeals,
    };
  });

  // The delivery system is the only source of truth for capacity (Rule 1): an allocation whose
  // project Kantata itself does not know about still counts toward the person's total — carried
  // in `allocations` below — but it cannot land on any project here, because that project does
  // not exist. Flagged as a data-quality note, not a staffing finding.
  for (const allocation of kantataAllocations) {
    if (!projectIds.has(allocation.project_id)) {
      const who = personIndex[allocation.user_id]?.name ?? allocation.user_id;
      notes.push(
        `${who}'s allocation ${allocation.id} references missing Kantata project ` +
          `${allocation.project_id}; it counts toward total allocation but cannot be attributed ` +
          `to a known project.`,
      );
    }
  }

  const allocations: ModelAllocation[] = kantataAllocations.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    percentage: normaliseAllocationPercentage(row.allocation_percentage).value,
    startDate: row.start_date,
    endDate: row.end_date,
  }));

  const timeOff: ModelTimeOff[] = kantataTimeOff.map((row) => ({
    id: row.id,
    userId: row.user_id,
    startDate: row.start_date,
    endDate: row.end_date,
    type: row.type,
    status: row.status,
  }));

  return {
    referenceDate: deriveReferenceDate(snapshot),
    people,
    personIndex,
    projects,
    allocations,
    timeOff,
    opportunities,
    accounts: salesforceAccounts.map((account) => ({
      id: account.Id,
      name: account.Name,
      industry: account.Industry,
    })),
    tasks,
    notes,
    ambiguousAllocations: ambiguousAllocations(
      kantataAllocations.map((row) => ({ id: row.id, rawPercentage: row.allocation_percentage })),
    ),
    unmappedClients,
  };
}
