export interface ClientLink {
  salesforceAccountName: string | null;
  clickupListName: string | null;
}

const clients = new Map<string, ClientLink>([
  ['Veridia', { salesforceAccountName: 'Veridia', clickupListName: 'Veridia Hierarchy' }],
  ['Auralis', { salesforceAccountName: 'Auralis', clickupListName: 'Auralis Ledger Bridge' }],
  ['Fernbrook Health', {
    salesforceAccountName: 'Fernbrook Health',
    clickupListName: 'Fernbrook Health Forecast',
  }],
  ['Halden', { salesforceAccountName: 'Halden', clickupListName: 'Halden Phase 2' }],
  ['Corvane', { salesforceAccountName: 'Corvane', clickupListName: 'Corvane CPQ' }],
  ['Quillspace', {
    salesforceAccountName: 'Quillspace Software',
    clickupListName: 'Quillspace AI Advisory',
  }],
  ['Tessellate', {
    salesforceAccountName: 'Tessellate',
    clickupListName: 'Tessellate Integration',
  }],
  ['Ironvale', { salesforceAccountName: 'Ironvale Data Group', clickupListName: null }],
]);

export function mapClient(clientName: string, unmappedClients: string[]): ClientLink {
  const client = clients.get(clientName);
  if (client) return client;

  if (!unmappedClients.includes(clientName)) unmappedClients.push(clientName);
  return { salesforceAccountName: null, clickupListName: null };
}
