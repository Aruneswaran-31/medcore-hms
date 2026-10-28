'use client';

import { useState } from 'react';
import { Column, DataTable, PageHeader } from '@/components/table';
import { Badge, ErrorNote, Modal, Spinner } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import type { PrescriptionDto, PrescriptionItemDto } from '@medcore/types';

type PrescriptionRow = PrescriptionDto & {
  patient?: { user?: { firstName: string; lastName: string }; mrn?: string } | null;
  doctor?: { user?: { firstName: string; lastName: string }; specialization?: string } | null;
};

export default function PrescriptionsPage() {
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const path = `/prescriptions?limit=50${status ? `&status=${status}` : ''}`;
  const list = useApi<PrescriptionRow[]>(path);

  const rows = list.data ?? [];
  const detail = rows.find((r) => r.id === openId) ?? null;

  const columns: Column<PrescriptionRow>[] = [
    {
      header: 'Patient',
      cell: (p) => (
        <div>
          <p className="font-medium text-slate-800">
            {p.patient?.user?.firstName} {p.patient?.user?.lastName}
          </p>
          <p className="text-xs text-slate-500">{p.patient?.mrn}</p>
        </div>
      ),
    },
    {
      header: 'Prescriber',
      cell: (p) => (
        <span className="text-slate-700">
          Dr. {p.doctor?.user?.firstName} {p.doctor?.user?.lastName}
        </span>
      ),
    },
    { header: 'Issued', cell: (p) => <span>{new Date(p.issuedAt).toLocaleDateString()}</span> },
    { header: 'Medicines', cell: (p) => <span>{p.items?.length ?? 0}</span> },
    { header: 'Status', cell: (p) => <Badge value={p.status} /> },
    {
      header: '',
      cell: (p) => (
        <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setOpenId(p.id)}>
          View
        </button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Prescriptions"
        subtitle="Issued scripts and their dispensing status."
        actions={
          <select className="input max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ISSUED">Issued</option>
            <option value="PARTIALLY_DISPENSED">Partially dispensed</option>
            <option value="DISPENSED">Dispensed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        }
      />

      {list.loading ? (
        <Spinner label="Loading prescriptions…" />
      ) : list.error ? (
        <ErrorNote message={list.error} onRetry={list.refetch} />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(p) => p.id} empty="No prescriptions found." />
      )}

      <Modal title="Prescription" open={Boolean(detail)} onClose={() => setOpenId(null)} wide>
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900">
                  {detail.patient?.user?.firstName} {detail.patient?.user?.lastName}
                  <span className="ml-2 text-xs text-slate-500">{detail.patient?.mrn}</span>
                </p>
                <p className="text-xs text-slate-500">
                  Dr. {detail.doctor?.user?.firstName} {detail.doctor?.user?.lastName} ·{' '}
                  {new Date(detail.issuedAt).toLocaleDateString()}
                </p>
              </div>
              <Badge value={detail.status} />
            </div>

            <div className="card divide-y divide-slate-100">
              {(detail.items ?? []).map((item: PrescriptionItemDto) => (
                <div key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="font-medium text-slate-800">{item.medicineName}</p>
                    <p className="text-xs text-slate-500">
                      {item.form} · {item.dosage} · {item.frequency} for {item.durationDays} days
                    </p>
                    {item.instructions ? (
                      <p className="mt-0.5 text-xs text-slate-400">{item.instructions}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {detail.notes ? (
              <div>
                <p className="label">Notes</p>
                <p className="text-slate-700">{detail.notes}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
