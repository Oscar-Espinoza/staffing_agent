import { getJson, type GetJsonOptions } from './source.ts';

export type SourceDegradation = {
  path: string;
  reason: 'unavailable' | 'invalid_payload';
};

export type SourceSnapshot = {
  kantata: {
    users: unknown[];
    projects: unknown[];
    allocations: unknown[];
    time_off: unknown[];
    time_entries: unknown[];
  };
  salesforce: {
    accounts: unknown[];
    users: unknown[];
    opportunities: unknown[];
  };
  clickup: {
    members: unknown[];
    tasks: unknown[];
  };
  /** Optional for hand-built snapshots; fetchSnapshot always includes it. */
  degradations?: SourceDegradation[];
};

function arrayEnvelope(value: unknown, path: string, key: string): unknown[] {
  if (value && typeof value === 'object') {
    const collection = (value as Record<string, unknown>)[key];
    if (Array.isArray(collection)) return collection;
  }
  throw new Error(`${path} returned an invalid array envelope`);
}

function markDegraded(
  path: string,
  reason: SourceDegradation['reason'],
  degraded: string[],
  degradations: SourceDegradation[],
): void {
  if (!degraded.includes(path)) degraded.push(path);
  if (!degradations.some((degradation) => degradation.path === path)) {
    degradations.push({ path, reason });
  }
}

function degradationReason(error: unknown): SourceDegradation['reason'] {
  return error instanceof Error && error.message.includes('invalid')
    ? 'invalid_payload'
    : 'unavailable';
}

async function optionalArray(
  path: string,
  key: string,
  options: GetJsonOptions,
  degradations: SourceDegradation[],
): Promise<unknown[]> {
  try {
    return arrayEnvelope(await getJson<unknown>(path, options), path, key);
  } catch (error) {
    markDegraded(path, degradationReason(error), options.degraded, degradations);
    return [];
  }
}

async function fetchTasks(
  options: GetJsonOptions,
  degradations: SourceDegradation[],
): Promise<unknown[]> {
  const rootPath = '/clickup/tasks';
  const tasks: unknown[] = [];
  const taskOptions = { ...options, degraded: [] };

  for (let page = 0;; page++) {
    const path = `${rootPath}?page=${page}`;
    try {
      const result = await getJson<unknown>(path, taskOptions);
      if (
        !result ||
        typeof result !== 'object' ||
        !Array.isArray((result as { tasks?: unknown }).tasks) ||
        typeof (result as { last_page?: unknown }).last_page !== 'boolean'
      ) {
        throw new Error(`${path} returned an invalid task envelope`);
      }

      const taskPage = result as { tasks: unknown[]; last_page: boolean };
      tasks.push(...taskPage.tasks);
      if (taskPage.last_page) return tasks;
    } catch (error) {
      markDegraded(rootPath, degradationReason(error), options.degraded, degradations);
      return [];
    }
  }
}

export async function fetchSnapshot(options: GetJsonOptions): Promise<SourceSnapshot> {
  const degradations: SourceDegradation[] = [];
  const [
    users,
    projects,
    allocations,
    timeOff,
    timeEntries,
    accounts,
    salesforceUsers,
    opportunities,
    members,
    tasks,
  ] = await Promise.all([
    getJson<unknown>('/kantata/users', options).then(arrayEnvelopeFor('/kantata/users', 'users')),
    getJson<unknown>('/kantata/projects', options).then(
      arrayEnvelopeFor('/kantata/projects', 'projects'),
    ),
    getJson<unknown>('/kantata/allocations', options).then(
      arrayEnvelopeFor('/kantata/allocations', 'allocations'),
    ),
    optionalArray('/kantata/time_off', 'time_off', options, degradations),
    optionalArray('/kantata/time_entries', 'time_entries', options, degradations),
    optionalArray('/salesforce/accounts', 'records', options, degradations),
    optionalArray('/salesforce/users', 'records', options, degradations),
    optionalArray('/salesforce/opportunities', 'records', options, degradations),
    optionalArray('/clickup/members', 'members', options, degradations),
    fetchTasks(options, degradations),
  ]);

  return {
    kantata: { users, projects, allocations, time_off: timeOff, time_entries: timeEntries },
    salesforce: { accounts, users: salesforceUsers, opportunities },
    clickup: { members, tasks },
    degradations: degradations.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    ),
  };
}

function arrayEnvelopeFor(path: string, key: string): (value: unknown) => unknown[] {
  return (value) => arrayEnvelope(value, path, key);
}
