'use client';

import { useState } from 'react';
import { Column, DataTable, PageHeader } from '@/components/table';
import { Badge, ErrorNote, Modal, Spinner } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import type { LabOrderDto, LabOrderItemDto } from '@medcore/types';

type LabRow = LabOrderDto & {
  patient?: { user?: { firstName: string; lastName: string }; mrn?: string } | null;
  orderedBy?: { user?: { firstName: string; lastName: string } } | null;
  items?: Array<LabOrderItemDto & { labTest?: { name: string; code: string; price: string } }>;
};

const STATUSES = [
  '',
  'ORDERED',
  'SAMPLE_COLLECTED',
  'IN_PROCESS',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
];

const PRIORITY_TONE: Record<string, string> = {
  STAT: 'text-rose-600 font-semibold',
  URGENT: 'text-amber-600 font-semibold',
  ROUTINE: 'text-slate-500',
};

export default function LabPage() {
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const path = `/lab-orders?limit=50${status ? `&status=${status}` : ''}`;
  const list = useApi<LabRow[]>(path);

  const rows = list.data ?? [];
  const detail = rows.find((r) => r.id === openId) ?? null;

  const columns: Column<LabRow>[] = [
    {
      header: 'Ordered',
      cell: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
    {
      header: 'Patient',
      cell: (r) => (
        <div>
          <p className="font-medium text-slate-800">
            {r.patient?.user?.firstName} {r.patient?.user?.lastName}
          </p>
          <p className="text-xs text-slate-500">{r.patient?.mrn}</p>
        </div>
      ),
    },
    {
      header: 'Tests',
      cell: (r) => (
        <span className="text-slate-700">
          {(r.items ?? []).map((i) => i.labTest?.name ?? 'Test').join(', ')}
        </span>
      ),
    },
    {
      header: 'Priority',
      cell: (r) => <span className={PRIORITY_TONE[r.priority] ?? 'text-slate-500'}>{r.priority}</span>,
    },
    { header: 'Status', cell: (r) => <Badge value={r.status} /> },
    {
      header: '',
      cell: (r) => (
        <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setOpenId(r.id)}>
          View
        </button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Laboratory"
        subtitle="Orders, sample workflow and result flags."
        actions={
          <select className="input max-w-[14rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All statuses' : s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        }
      />

      {list.loading ? (
        <Spinner label="Loading lab orders…" />
      ) : list.error ? (
        <ErrorNote message={list.error} onRetry={list.refetch} />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="No lab orders found." />
      )}

      <Modal title="Lab order" open={Boolean(detail)} onClose={() => setOpenId(null)} wide>
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900">
                  {detail.patient?.user?.firstName} {detail.patient?.user?.lastName}
                  <span className="ml-2 text-xs text-slate-500">{detail.patient?.mrn}</span>
                </p>
                <p className="text-xs text-slate-500">
                  Ordered by Dr. {detail.orderedBy?.user?.firstName} {detail.orderedBy?.user?.lastName} ·{' '}
                  {new Date(detail.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${PRIORITY_TONE[detail.priority] ?? ''}`}>
                  {detail.priority}
                </span>
                <Badge value={detail.status} />
              </div>
            </div>

            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr className="bg-slate-50">
                  <th className="th">Test</th>
                  <th className="th">Result</th>
                  <th className="th">Flag</th>
                  <th className="th text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(detail.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td className="td">
                      <p className="font-medium text-slate-800">{item.labTest?.name ?? 'Test'}</p>
                      <p className="text-xs text-slate-500">{item.labTest?.code}</p>
                    </td>
                    <td className="td">
                      {item.resultValue ?? item.resultText ?? <span className="text-slate-400">Pending</span>}
                    </td>
                    <td className="td">{item.flag ? <Badge value={item.flag} /> : '—'}</td>
                    <td className="td text-right">{item.labTest?.price ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {detail.notes ? (
              <div>
                <p className="label">Clinical notes</p>
                <p className="text-slate-700">{detail.notes}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
