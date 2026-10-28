'use client';

import { useState } from 'react';
import { Column, DataTable, PageHeader } from '@/components/table';
import { Badge, ErrorNote, Spinner } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import type { UserDto } from '@medcore/types';

type StaffRow = UserDto & {
  doctor?: { id: string; specialization?: string } | null;
  patient?: { id: string; mrn?: string } | null;
  lastLoginAt?: string | null;
};

const ROLES = [
  '',
  'SUPER_ADMIN',
  'HOSPITAL_ADMIN',
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'LAB_TECHNICIAN',
  'PHARMACIST',
  'ACCOUNTANT',
  'PATIENT',
];

export default function StaffPage() {
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');

  const params = new URLSearchParams({ limit: '100' });
  if (role) params.set('role', role);
  if (q.trim()) params.set('q', q.trim());

  const list = useApi<StaffRow[]>(`/users?${params.toString()}`);

  const columns: Column<StaffRow>[] = [
    {
      header: 'Name',
      cell: (u) => (
        <div>
          <p className="font-medium text-slate-800">
            {u.firstName} {u.lastName}
          </p>
          <p className="text-xs text-slate-500">{u.email}</p>
        </div>
      ),
    },
    { header: 'Role', cell: (u) => <Badge value={u.role} /> },
    {
      header: 'Detail',
      cell: (u) =>
        u.doctor ? (
          <span className="text-slate-600">Dr. · {u.doctor.specialization}</span>
        ) : u.patient ? (
          <span className="text-slate-600">MRN {u.patient.mrn}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { header: 'Phone', cell: (u) => u.phone ?? <span className="text-slate-400">—</span> },
    { header: 'Status', cell: (u) => <Badge value={u.status} /> },
    {
      header: 'Last sign-in',
      cell: (u) =>
        u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : <span className="text-slate-400">Never</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Staff & accounts"
        subtitle={`${list.data?.length ?? 0} accounts across roles`}
        actions={
          <>
            <input
              className="input max-w-[14rem]"
              placeholder="Search name, email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className="input max-w-[12rem]" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r === '' ? 'All roles' : r.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </>
        }
      />

      {list.loading ? (
        <Spinner label="Loading accounts…" />
      ) : list.error ? (
        <ErrorNote message={list.error} onRetry={list.refetch} />
      ) : (
        <DataTable columns={columns} rows={list.data ?? []} rowKey={(u) => u.id} empty="No accounts found." />
      )}
    </div>
  );
}
