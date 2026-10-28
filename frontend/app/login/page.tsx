'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';

const DEMO = [
  ['superadmin@medcore.demo', 'Platform operator (all tenants)'],
  ['admin.chennai@medcore.demo', 'Hospital admin — Chennai'],
  ['reception.chennai@medcore.demo', 'Reception desk'],
  ['dr.*.medcore.demo', 'Doctor accounts (see seed output)'],
  ['lab.chennai@medcore.demo', 'Lab technician'],
  ['pharmacy.chennai@medcore.demo', 'Pharmacist'],
];

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('superadmin@medcore.demo');
  const [password, setPassword] = useState('Passw0rd!123');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-brand-700 p-10 text-white lg:flex">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 font-bold">
            M
          </span>
          <span className="font-semibold">MedCore HMS</span>
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-snug">
            One platform for patient care,
            <br />
            clinical records and hospital ops.
          </h1>
          <p className="mt-4 max-w-md text-sm text-brand-100">
            Multi-tenant appointments, EMR, prescriptions, laboratory, pharmacy and billing —
            with role-based access and a full audit trail.
          </p>
        </div>
        <p className="text-xs text-brand-200">
          Demo data: 2 hospitals · 8 doctors · 30 patients · 4 weeks of history
        </p>
      </div>

      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <form onSubmit={submit} className="card w-full max-w-sm p-7">
          <h2 className="text-lg font-semibold text-slate-900">Sign in</h2>
          <p className="mb-5 mt-1 text-sm text-slate-500">
            Use a seeded demo account to explore the system.
          </p>

          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input mb-4"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input mb-4"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error ? (
            <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          ) : null}

          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Demo accounts
            </p>
            <ul className="space-y-1 text-xs text-slate-500">
              {DEMO.map(([mail, desc]) => (
                <li key={mail} className="flex justify-between gap-2">
                  <button
                    type="button"
                    className="truncate text-brand-600 hover:underline"
                    onClick={() => {
                      if (!mail.includes('*')) setEmail(mail);
                      setPassword('Passw0rd!123');
                    }}
                  >
                    {mail}
                  </button>
                  <span className="shrink-0 text-right">{desc}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-400">Password for every demo account: Passw0rd!123</p>
          </div>
        </form>
      </div>
    </div>
  );
}
