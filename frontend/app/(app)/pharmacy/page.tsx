'use client';

import { useState } from 'react';
import { Column, DataTable, PageHeader } from '@/components/table';
import { ErrorNote, KpiCard, Spinner } from '@/components/ui';
import { useApi } from '@/lib/use-api';

type MedicineRow = {
  id: string;
  name: string;
  genericName?: string | null;
  form: string;
  strength?: string | null;
  reorderLevel: number;
  availableQuantity: number;
  expiredQuantity?: number;
  earliestExpiry?: string | null;
  lowStock: boolean;
  isActive: boolean;
};

type Alerts = {
  lowStock: Array<{
    medicineId: string;
    name: string;
    form: string;
    reorderLevel: number;
    available: number;
  }>;
  expiring: Array<{
    batchId: string;
    medicine: string;
    batchNumber: string;
    expiresAt: string;
    quantity: number;
  }>;
};

export default function PharmacyPage() {
  const [q, setQ] = useState('');
  const path = `/medicines?limit=100${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`;
  const list = useApi<MedicineRow[]>(path);
  const alerts = useApi<Alerts>('/medicines/alerts');

  const rows = list.data ?? [];

  const columns: Column<MedicineRow>[] = [
    {
      header: 'Medicine',
      cell: (m) => (
        <div>
          <p className="font-medium text-slate-800">{m.name}</p>
          <p className="text-xs text-slate-500">{m.genericName ?? '—'}</p>
        </div>
      ),
    },
    { header: 'Form', cell: (m) => <span className="text-slate-600">{m.form}</span> },
    { header: 'Strength', cell: (m) => m.strength ?? '—' },
    {
      header: 'On hand',
      cell: (m) => (
        <span className={m.lowStock ? 'font-semibold text-amber-600' : 'tabular-nums text-slate-700'}>
          {m.availableQuantity}
        </span>
      ),
    },
    { header: 'Reorder level', cell: (m) => <span className="tabular-nums text-slate-500">{m.reorderLevel}</span> },
    {
      header: 'Earliest expiry',
      cell: (m) =>
        m.earliestExpiry ? (
          <span className={new Date(m.earliestExpiry) < new Date(Date.now() + 90 * 86400000) ? 'text-amber-600' : ''}>
            {m.earliestExpiry.slice(0, 10)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      header: 'Health',
      cell: (m) =>
        m.lowStock ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Low stock</span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">OK</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Pharmacy"
        subtitle="Formulary, stock levels and expiry watch."
        actions={
          <input
            className="input max-w-xs"
            placeholder="Search medicine or salt…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Formulary items" value={list.data?.length ?? 0} />
        <KpiCard
          label="Below reorder level"
          value={alerts.data?.lowStock?.length ?? 0}
          accent={(alerts.data?.lowStock?.length ?? 0) > 0 ? 'text-amber-600' : 'text-slate-900'}
        />
        <KpiCard
          label="Batches expiring ≤30d"
          value={alerts.data?.expiring?.length ?? 0}
          accent={(alerts.data?.expiring?.length ?? 0) > 0 ? 'text-rose-600' : 'text-slate-900'}
        />
      </div>

      {list.loading ? (
        <Spinner label="Loading formulary…" />
      ) : list.error ? (
        <ErrorNote message={list.error} onRetry={list.refetch} />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(m) => m.id} empty="No medicines found." />
      )}

      {(alerts.data?.expiring?.length ?? 0) > 0 ? (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Expiring soon</h2>
          <div className="card divide-y divide-slate-100">
            {alerts.data!.expiring.slice(0, 8).map((b) => (
              <div key={b.batchId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{b.medicine}</p>
                  <p className="text-xs text-slate-500">Batch {b.batchNumber}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-rose-600">{b.expiresAt.slice(0, 10)}</p>
                  <p className="text-xs text-slate-500">{b.quantity} units</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
