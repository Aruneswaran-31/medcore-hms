'use client';

import { PageHeader } from '@/components/table';
import { Column, DataTable } from '@/components/table';
import { ErrorNote, Spinner } from '@/components/ui';
import { useApi } from '@/lib/use-api';

type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  createdAt: string;
  user?: { firstName: string; lastName: string; email: string } | null;
  before?: unknown;
  after?: unknown;
};

export default function AuditPage() {
  const list = useApi<AuditRow[]>('/audit?limit=100');

  const columns: Column<AuditRow>[] = [
    {
      header: 'When',
      cell: (a) => new Date(a.createdAt).toLocaleString(),
      className: 'whitespace-nowrap',
    },
    {
      header: 'Actor',
      cell: (a) =>
        a.user ? (
          <div>
            <p className="font-medium text-slate-800">
              {a.user.firstName} {a.user.lastName}
            </p>
            <p className="text-xs text-slate-500">{a.user.email}</p>
          </div>
        ) : (
          <span className="text-slate-400">System</span>
        ),
    },
    { header: 'Action', cell: (a) => <span className="font-medium text-slate-700">{a.action}</span> },
    {
      header: 'Entity',
      cell: (a) => (
        <span className="text-slate-600">
          {a.entityType}
          {a.entityId ? <span className="ml-1 font-mono text-xs text-slate-400">{a.entityId.slice(0, 8)}</span> : null}
        </span>
      ),
    },
    { header: 'IP', cell: (a) => a.ip ?? <span className="text-slate-400">—</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Every state-changing action, retained for compliance review."
      />
      {list.loading ? (
        <Spinner label="Loading audit trail…" />
      ) : list.error ? (
        <ErrorNote message={list.error} onRetry={list.refetch} />
      ) : (
        <DataTable columns={columns} rows={list.data ?? []} rowKey={(a) => a.id} empty="No audit entries." />
      )}
    </div>
  );
}
