'use client';

import { useMemo, useState } from 'react';
import { Column, DataTable, PageHeader } from '@/components/table';
import { Badge, ErrorNote, Modal, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import type { AppointmentDto, DoctorDto, SlotDto, UserDto } from '@medcore/types';

/** Patient accounts come from /users?role=PATIENT with a nested Patient profile. */
type PatientUser = UserDto & { patient?: { id: string; mrn: string } | null };

const NEXT: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const STATUSES = ['', 'PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

export default function AppointmentsPage() {
  const [status, setStatus] = useState('');
  const [date, setDate] = useState('');
  const [q, setQ] = useState('');
  const [booking, setBooking] = useState(false);

  const params = new URLSearchParams({ limit: '50' });
  if (status) params.set('status', status);
  if (date) params.set('date', date);
  if (q.trim()) params.set('q', q.trim());

  const list = useApi<AppointmentDto[]>(`/appointments?${params.toString()}`);
  const doctors = useApi<DoctorDto[]>(booking ? '/doctors?limit=100' : null);

  const rows = list.data ?? [];

  const columns: Column<AppointmentDto>[] = [
    {
      header: 'Date',
      cell: (a) => (
        <div>
          <p className="font-medium text-slate-800">{a.scheduledDate.slice(0, 10)}</p>
          <p className="text-xs text-slate-500">
            {a.startTime} – {a.endTime}
          </p>
        </div>
      ),
    },
    {
      header: 'Patient',
      cell: (a) => (
        <div>
          <p className="font-medium text-slate-800">
            {a.patient?.user?.firstName ?? ''} {a.patient?.user?.lastName ?? ''}
          </p>
          <p className="text-xs text-slate-500">{a.patient?.mrn}</p>
        </div>
      ),
    },
    {
      header: 'Doctor',
      cell: (a) => (
        <div>
          <p className="text-slate-800">
            Dr. {a.doctor?.user?.firstName ?? ''} {a.doctor?.user?.lastName ?? ''}
          </p>
          <p className="text-xs text-slate-500">{a.doctor?.specialization}</p>
        </div>
      ),
    },
    { header: 'Type', cell: (a) => <span className="text-slate-600">{a.type}</span> },
    { header: 'Status', cell: (a) => <Badge value={a.status} /> },
    {
      header: '',
      cell: (a) => (
        <div className="flex justify-end gap-1.5">
          {(NEXT[a.status] ?? []).map((next) => (
            <button
              key={next}
              className={`px-2 py-1 text-xs font-medium rounded-md ${
                next === 'CANCELLED' || next === 'NO_SHOW'
                  ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                  : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
              }`}
              onClick={() => move(a.id, next)}
            >
              {next === 'CANCELLED' ? 'Cancel' : next === 'NO_SHOW' ? 'No-show' : next}
            </button>
          ))}
        </div>
      ),
      className: 'text-right',
    },
  ];

  async function move(id: string, next: string) {
    try {
      await api(`/appointments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      list.refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle="Book, confirm and complete consultations."
        actions={
          <button className="btn-primary" onClick={() => setBooking(true)}>
            + New appointment
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search patient name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === '' ? 'All statuses' : s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input className="input max-w-[11rem]" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {(status || date || q) && (
          <button
            className="btn-ghost"
            onClick={() => {
              setStatus('');
              setDate('');
              setQ('');
            }}
          >
            Clear
          </button>
        )}
      </div>

      {list.loading ? (
        <Spinner label="Loading appointments…" />
      ) : list.error ? (
        <ErrorNote message={list.error} onRetry={list.refetch} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          empty="No appointments match these filters."
        />
      )}

      <BookModal
        open={booking}
        onClose={() => setBooking(false)}
        doctors={doctors.data ?? []}
        onBooked={() => {
          setBooking(false);
          list.refetch();
        }}
      />
    </div>
  );
}

function BookModal({
  open,
  onClose,
  doctors,
  onBooked,
}: {
  open: boolean;
  onClose: () => void;
  doctors: DoctorDto[];
  onBooked: () => void;
}) {
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patients = useApi<PatientUser[]>(open ? '/users?role=PATIENT&limit=200' : null);
  const slots = useApi<SlotDto[]>(open && doctorId && date ? `/doctors/${doctorId}/slots?date=${date}` : null);

  const patientOptions = (patients.data ?? []).filter((p) => p.patient);

  const freeSlots = useMemo(() => (slots.data ?? []).filter((s) => s.available), [slots.data]);

  const reset = () => {
    setPatientId('');
    setDoctorId('');
    setDate('');
    setSlot('');
    setReason('');
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          doctorId,
          scheduledDate: date,
          startTime: slot,
          type: 'CONSULTATION',
          reason: reason || undefined,
        }),
      });
      reset();
      onBooked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New appointment" open={open} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Patient</label>
          <select className="input" value={patientId} onChange={(e) => setPatientId(e.target.value)} required>
            <option value="">Select a patient…</option>
            {patientOptions.map((p) => (
              <option key={p.patient!.id} value={p.patient!.id}>
                {p.firstName} {p.lastName} — {p.patient!.mrn}
              </option>
            ))}
          </select>
          {patients.error ? <p className="mt-1 text-xs text-rose-600">{patients.error}</p> : null}
        </div>

        <div>
          <label className="label">Doctor</label>
          <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required>
            <option value="">Select a doctor…</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                Dr. {d.user?.firstName} {d.user?.lastName} — {d.specialization}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="label">Slot</label>
            <select className="input" value={slot} onChange={(e) => setSlot(e.target.value)} required disabled={!doctorId || !date}>
              <option value="">
                {!doctorId || !date ? 'Pick doctor + date' : slots.loading ? 'Loading…' : 'Select a slot'}
              </option>
              {freeSlots.map((s) => (
                <option key={s.startTime} value={s.startTime}>
                  {s.startTime} – {s.endTime}
                </option>
              ))}
            </select>
            {slots.data && freeSlots.length === 0 ? (
              <p className="mt-1 text-xs text-amber-600">No free slots that day.</p>
            ) : null}
          </div>
        </div>

        <div>
          <label className="label">Reason (optional)</label>
          <textarea
            className="input"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Fever for 3 days"
          />
        </div>

        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Booking…' : 'Book appointment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
