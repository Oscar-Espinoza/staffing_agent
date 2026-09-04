import type { ModelProject, ModelRecord } from './model-record.ts';

/**
 * DEMO ONLY — synthetic data, not a fixture. Safe to delete this file and its `demo` flag.
 *
 * Every client in the real fixtures has exactly one active project, so matching an opportunity's
 * account name to a project's client name resolves every link without a model. This appends a
 * second active Halden project so that match returns two candidates and cannot choose: only the
 * free-text names say that "Halden — Phase 3 Scope" continues "Phase 2 Delivery" rather than the
 * support retainer. Toggled live with `/run?demo=1`.
 */
const SUPPORT_RETAINER: ModelProject = {
  id: 'p_9001',
  title: 'Halden — Support Retainer',
  clientName: 'Halden',
  status: 'Active',
  startDate: '2026-06-01',
  dueDate: '2027-06-01',
  budgetedHours: 200,
  leadUserId: null,
  salesforceAccountName: 'Halden',
  clickupListName: null,
  loggedHours: 0,
  matchedDeals: [],
};

export function applyDemoScenario(record: ModelRecord): ModelRecord {
  return { ...record, projects: [...record.projects, SUPPORT_RETAINER] };
}
