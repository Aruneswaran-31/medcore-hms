'use client';

import { useState } from 'react';
import { Column, DataTable, PageHeader } from '@/components/table';
import { Badge, ErrorNote, Spinner } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import type { UserDto } from '@medcore/types';

type PatientRow = UserDto & {
  patient?: {
    id: string;
    mrn: string;
    dateOfBirth?: string | null;
    gender?: string | null;
    bloodGroup?: string | null;
    allergies?: string[];
    insuranceProvider?: string | null;
  } | null;
};

export default function PatientsPage() {
  const [q, setQ] = useState('');
  const path = `/users?role=PATIENT&limit=100${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`;
  const list = useApi<PatientRow[]>(path);

  const age = (dob?: string | null) =>
    dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000)) : '—';

  const columns: Column<PatientRow>[] = [
    {
      header: 'Patient',
      cell: (p) => (
        <div>
          <p className="font-medium text-slate-800">
            {p.firstName} {p.lastName}
          </p>
          <p className="text-xs text-slate-500">{p.email}</p>
        </div>
      ),
    },
    { header: 'MRN', cell: (p) => <span className="font-mono text-xs">{p.patient?.mrn ?? '—'}</span> },
    { header: 'Age', cell: (p) => age(p.patient?.dateOfBirth) },
    { header: 'Gender', cell: (p) => p.patient?.gender ?? '—' },
    { header: 'Blood group', cell: (p) => p.patient?.bloodGroup ?? '—' },
    {
      header: 'Allergies',
      cell: (p) =>
        p.patient?.allergies?.length ? (
          <span className="text-rose-600">{p.patient.allergies.join(', ')}</span>
        ) : (
          <span className="text-slate-400">None recorded</span>
        ),
    },
    {
      header: 'Insurance',
      cell: (p) => p.patient?.insuranceProvider ?? <span className="text-slate-400">—</span>,
    },
    { header: 'Status', cell: (p) => <Badge value={p.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle={`${list.data?.length ?? 0} registered patient accounts`}
        actions={
          <input
            className="input max-w-xs"
            placeholder="Search name, email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      />

      {list.loading ? (
        <Spinner label="Loading patients…" />
      ) : list.error ? (
        <ErrorNote message={list.error} onRetry={list.refetch} />
      ) : (
        <DataTable columns={columns} rows={list.data ?? []} rowKey={(p) => p.id} empty="No patients found." />
      )}
    </div>
  );
}
