'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/table';
import { BarChart, LineChart } from '@/components/charts';
import { EmptyState, ErrorNote, KpiCard, Spinner } from '@/components/ui';
import { money, useApi } from '@/lib/use-api';
import type {
  AppointmentDto,
  DashboardStats,
  RevenuePoint,
} from '@medcore/types';

type DayPoint = { date: string; appointments: number };
type DeptPoint = { id: string; name: string; doctors: number; appointments: number };

export default function DashboardPage() {
  const stats = useApi<DashboardStats>('/analytics/overview');
  const revenue = useApi<RevenuePoint[]>('/analytics/revenue?from=' + daysAgo(29));
  const volume = useApi<DayPoint[]>('/analytics/appointments?days=14');
  const departments = useApi<DeptPoint[]>('/analytics/departments');
  const todays = useApi<AppointmentDto[]>(
    `/appointments?date=${today()}&limit=8&sort=startTime`,
  );

  if (stats.loading) return <Spinner label="Loading dashboard…" />;
  if (stats.error || !stats.data) {
    return <ErrorNote message={stats.error ?? 'Dashboard unavailable.'} onRetry={stats.refetch} />;
  }

  const s = stats.data;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live operational picture across every tenant you can access."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label="Patients today" value={s.patientsToday} />
        <KpiCard label="Appointments today" value={s.appointmentsToday} />
        <KpiCard label="Revenue today" value={money(s.revenueToday)} accent="text-emerald-600" />
        <KpiCard label="Active doctors" value={s.activeDoctors} />
        <KpiCard label="In consultation" value={s.occupiedBeds} />
        <KpiCard
          label="Low stock items"
          value={s.lowStockCount}
          accent={s.lowStockCount > 0 ? 'text-amber-600' : 'text-slate-900'}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Revenue — last 30 days
          </h2>
          <LineChart
            data={(revenue.data ?? []).map((p) => ({ label: p.date, value: p.revenue }))}
          />
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Appointments — last 14 days
          </h2>
          <BarChart
            data={(volume.data ?? []).map((p) => ({ label: p.date, value: p.appointments }))}
          />
        </section>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Today&apos;s schedule</h2>
            <Link href="/appointments" className="text-xs font-medium text-brand-600 hover:underline">
              View all →
            </Link>
          </div>
          {todays.loading ? (
            <Spinner />
          ) : (todays.data ?? []).length === 0 ? (
            <EmptyState title="No appointments today." hint="Book one from the Appointments screen." />
          ) : (
            <div className="card divide-y divide-slate-100">
              {todays.data!.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {a.startTime} – {a.endTime}
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.patient?.user?.firstName} {a.patient?.user?.lastName} ·{' '}
                      {a.doctor?.user?.firstName} {a.doctor?.user?.lastName}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-slate-500">{a.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Department load</h2>
          {departments.loading ? (
            <Spinner />
          ) : (departments.data ?? []).length === 0 ? (
            <EmptyState title="No departments yet." />
          ) : (
            <div className="card divide-y divide-slate-100">
              {departments.data!.slice(0, 8).map((d) => (
                <div key={d.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{d.name}</p>
                    <p className="text-xs text-slate-500">{d.doctors} doctors</p>
                  </div>
                  <span className="text-sm tabular-nums text-slate-600">
                    {d.appointments} appts
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
