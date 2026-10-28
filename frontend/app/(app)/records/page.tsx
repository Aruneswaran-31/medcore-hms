'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/table';
import { Badge, EmptyState, ErrorNote, Modal, Spinner } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import type { MedicalRecordDto, UserDto } from '@medcore/types';

type PatientUser = UserDto & { patient?: { id: string; mrn: string } | null };

type RecordRow = MedicalRecordDto & {
  presentingSymptoms?: string | null;
  appointment?: { scheduledDate: string; startTime: string } | null;
  doctor?: { user?: { firstName: string; lastName: string } } | null;
};

export default function RecordsPage() {
  const [patientId, setPatientId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const patients = useApi<PatientUser[]>('/users?role=PATIENT&limit=200');
  const records = useApi<RecordRow[]>(
    patientId ? `/medical-records/patient/${patientId}` : null,
  );

  const options = (patients.data ?? []).filter((p) => p.patient);
  const rows = records.data ?? [];
  const detail = rows.find((r) => r.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        title="Medical Records"
        subtitle="Encounter notes, vitals, diagnosis and treatment plans."
        actions={
          <select className="input max-w-xs" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">Select a patient…</option>
            {options.map((p) => (
              <option key={p.patient!.id} value={p.patient!.id}>
                {p.firstName} {p.lastName} — {p.patient!.mrn}
              </option>
            ))}
          </select>
        }
      />

      {!patientId ? (
        <EmptyState
          title="Choose a patient to open their record history."
          hint="Every encounter links back to the appointment that created it."
        />
      ) : records.loading ? (
        <Spinner label="Loading records…" />
      ) : records.error ? (
        <ErrorNote message={records.error} onRetry={records.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="No encounters recorded for this patient yet." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <button
              key={r.id}
              className="card p-4 text-left transition hover:border-brand-300"
              onClick={() => setOpenId(r.id)}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {r.appointment
                    ? `${r.appointment.scheduledDate.slice(0, 10)} · ${r.appointment.startTime}`
                    : new Date(r.createdAt).toLocaleDateString()}
                </span>
                <Badge value={r.status} />
              </div>
              <p className="text-sm font-medium text-slate-800">{r.chiefComplaint ?? 'Encounter'}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {r.diagnosis ?? 'No diagnosis recorded'}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Dr. {r.doctor?.user?.firstName} {r.doctor?.user?.lastName}
              </p>
            </button>
          ))}
        </div>
      )}

      <Modal title="Encounter detail" open={Boolean(detail)} onClose={() => setOpenId(null)} wide>
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Chief complaint" value={detail.chiefComplaint} />
              <Field label="Presenting symptoms" value={detail.presentingSymptoms} />
              <Field label="Diagnosis" value={detail.diagnosis} />
              <Field label="ICD-10" value={detail.icd10Code} />
              <Field label="Treatment plan" value={detail.treatmentPlan} />
              <Field label="Notes" value={detail.notes} />
            </div>

            {detail.vitals ? (
              <div>
                <p className="label">Vitals</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {Object.entries(detail.vitals)
                    .filter(([, v]) => v !== undefined && v !== null)
                    .map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">{k}</p>
                        <p className="text-sm font-medium text-slate-700">{String(v)}</p>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

            {detail.allergies?.length ? (
              <div>
                <p className="label">Allergies</p>
                <p className="text-rose-600">{detail.allergies.join(', ')}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="text-slate-700">{value || <span className="text-slate-400">—</span>}</p>
    </div>
  );
}
