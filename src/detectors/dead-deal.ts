import type { Finding } from '../finding.ts';
import type { ModelRecord } from '../model-record.ts';
import { horizon, overlaps } from '../window.ts';

const DEAD_DEAL = 'DEAD_DEAL';

/**
 * A deal is related only at account level, so this is deliberately a question rather than a claim
 * that it funded the project. It gives a lead the evidence needed to confirm the work is real.
 */
export function detectDeadDeal(record: ModelRecord): Finding[] {
  const { start: windowStart, end: windowEnd } = horizon(record.referenceDate);

  const findings: Finding[] = [];
  for (const project of record.projects) {
    if (project.status !== 'Active') continue;

    const lost = project.matchedDeals.filter((deal) => deal.stageName === 'Closed Lost');
    if (lost.length === 0) continue;
    if (project.matchedDeals.some((deal) => deal.stageName === 'Closed Won')) continue;

    const rows = record.allocations
      .filter((allocation) =>
        allocation.projectId === project.id &&
        overlaps(allocation.startDate, allocation.endDate, windowStart, windowEnd)
      )
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    if (rows.length === 0) continue;

    const finding: Finding = {
      id: `${DEAD_DEAL}:${project.id}`,
      type: DEAD_DEAL,
      severity: 'watch',
      group: { kind: 'project', id: project.id, label: project.title },
      title: 'Confirm project approval after a lost opportunity',
      detail: `Client: ${project.clientName}\nProject: ${project.title}\n\n` +
        [...new Set(lost.map((deal) => deal.name))].map((name) =>
          name === project.title
            ? 'The Salesforce opportunity with the same name is marked Closed Lost.'
            : `The Salesforce opportunity “${name}” belongs to the same client and is marked Closed Lost; its connection to this project is unconfirmed.`
        ).join(' ') +
        ` However, the project is still active in Kantata with people allocated (${rows.length} active allocation record${
          rows.length === 1 ? '' : 's'
        }).`,
      rationale: 'Confirm this project still has approved work before changing its staffing plan.',
      metrics: { allocationCount: rows.length, lostDealCount: lost.length },
      sources: [
        `kantata:projects/${project.id}`,
        ...rows.map((row) => `kantata:allocations/${row.id}`),
        ...lost.map((deal) => `salesforce:opportunities/${deal.id}`),
      ],
      ambiguous: true,
      fingerprint: `${DEAD_DEAL}:${project.id}`,
    };

    // The explicit mapping is a list name, not a project key. Refuse shared project mappings
    // and duplicate list names rather than attributing a task to the wrong delivery project.
    const listName = project.clickupListName;
    const tasks = record.tasks.filter((task) => task.listName === listName);
    if (
      listName &&
      record.projects.filter((candidate) => candidate.clickupListName === listName).length === 1 &&
      new Set(tasks.map((task) => task.listId)).size === 1
    ) {
      const people = rows.map((row) => record.personIndex[row.userId]);
      for (
        const task of tasks.sort((left, right) =>
          left.id < right.id ? -1 : left.id > right.id ? 1 : 0
        )
      ) {
        if (task.status !== 'in progress') continue;
        // Rows are already sorted by allocation ID, making multiple matching assignees stable too.
        const person = people.find((person) =>
          person?.clickupMemberId != null && task.assigneeIds.includes(person.clickupMemberId)
        );
        if (!person) continue;
        finding.detail += ` In ClickUp, the task “${task.name}” is marked ${task.status} ` +
          `and assigned to ${person.name}.`;
        finding.sources.push(
          `clickup:tasks/${task.id}`,
          `clickup:members/${person.clickupMemberId}`,
          `kantata:users/${person.kantataUserId}`,
        );
        break;
      }
    }
    finding.detail += '\n\nIs this project still approved to continue?';
    findings.push(finding);
  }

  return findings;
}
