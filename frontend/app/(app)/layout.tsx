'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '▦' },
  { href: '/appointments', label: 'Appointments', icon: 'Calendar' },
  { href: '/patients', label: 'Patients', icon: '☺' },
  { href: '/records', label: 'Medical Records', icon: 'Clipboard' },
  { href: '/prescriptions', label: 'Prescriptions', icon: 'Rx' },
  { href: '/lab', label: 'Laboratory', icon: '⚗' },
  { href: '/pharmacy', label: 'Pharmacy', icon: '⚕' },
  { href: '/billing', label: 'Billing', icon: '₹' },
  { href: '/staff', label: 'Staff', icon: '☺' },
  { href: '/audit', label: 'Audit Log', icon: '≡' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Restoring session…" />
      </div>
    );
  }

  const signOut = async () => {
    setBusy(true);
    await logout();
    router.replace('/login');
  };

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            M
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">MedCore HMS</p>
            <p className="text-[11px] text-slate-500">Hospital Management</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <p className="truncate text-sm font-medium text-slate-900">
            {user.firstName} {user.lastName}
          </p>
          <p className="mb-2 truncate text-xs text-slate-500">{user.email}</p>
          <span className="mb-3 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {user.role.replace(/_/g, ' ')}
          </span>
          <button className="btn-ghost w-full" onClick={signOut} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur">
          <div className="md:hidden">
            <span className="text-sm font-semibold text-slate-900">MedCore HMS</span>
          </div>
          <p className="hidden text-sm text-slate-500 md:block">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
              {user.firstName?.[0] ?? '?'}
              {user.lastName?.[0] ?? ''}
            </span>
          </div>
        </header>

        <main className="flex-1 p-5 md:p-7">{children}</main>
      </div>
    </div>
  );
}
